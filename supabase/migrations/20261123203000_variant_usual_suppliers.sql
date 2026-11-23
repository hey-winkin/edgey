create table public.staff_variant_suppliers (
  variant_id uuid not null references public.variants (id) on delete cascade,
  supplier_id uuid not null references public.staff_suppliers (id),
  supplier_part_number text check (length(supplier_part_number) <= 120),
  is_usual boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (variant_id, supplier_id)
);

create unique index staff_variant_suppliers_usual_idx on public.staff_variant_suppliers (variant_id) where is_usual;
create index staff_variant_suppliers_supplier_idx on public.staff_variant_suppliers (supplier_id);

alter table public.staff_variant_suppliers enable row level security;
revoke all on public.staff_variant_suppliers from public, anon, authenticated, service_role;
grant select on public.staff_variant_suppliers to authenticated, service_role;
create policy staff_variant_suppliers_read on public.staff_variant_suppliers for select to authenticated
  using ((select private.has_staff_role('catalogue', 'finance')));

revoke select (supplier_name, supplier_part_number) on public.variants from public, anon, authenticated;

with registered_names as (
  select lower(private.catalogue_trim(name)) as name, (array_agg(id))[1] as id
  from public.staff_suppliers
  where nullif(private.catalogue_trim(name), '') is not null
  group by lower(private.catalogue_trim(name))
  having count(*) = 1
)
insert into public.staff_variant_suppliers (variant_id, supplier_id, supplier_part_number, is_usual)
select v.id, s.id,
  case when length(part.number) <= 120 and part.number !~ '[[:cntrl:]]' then part.number end,
  true
from public.variants v
join registered_names s on s.name = lower(private.catalogue_trim(v.supplier_name))
cross join lateral (select nullif(private.catalogue_trim(v.supplier_part_number), '') as number) part;

create function private.catalogue_has_registered_supplier_part(p_variant_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.staff_variant_suppliers
    where variant_id = p_variant_id and is_usual and nullif(private.catalogue_trim(supplier_part_number), '') is not null
  );
$$;

alter table public.variants drop constraint variants_published_requires_approval,
  add constraint variants_published_requires_approval check (
    publication_status <> 'published' or (approved_at is not null and evidence_source is not null)
  );

create function private.require_published_supplier_part()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.publication_status = 'published' and new.supplier_part_number is null
    and not private.catalogue_has_registered_supplier_part(new.id) then
    raise exception using errcode = '23514', message = 'variants_published_requires_supplier_part';
  end if;
  return new;
end;
$$;

create trigger variants_published_supplier_part before insert or update of publication_status, supplier_part_number
on public.variants for each row execute function private.require_published_supplier_part();

create or replace function private.touch_catalogue_version()
returns trigger language plpgsql set search_path = ''
as $$
declare
  ignored_columns text[] := array[
    'stock_on_hand', 'stock_reserved', 'availability', 'sku_normalised', 'updated_at', 'catalogue_updated_at'
  ];
begin
  new.catalogue_updated_at := case
    when new.catalogue_updated_at is distinct from old.catalogue_updated_at
      or to_jsonb(new) - ignored_columns is distinct from to_jsonb(old) - ignored_columns
    then greatest(clock_timestamp(), old.catalogue_updated_at + interval '1 microsecond')
    else old.catalogue_updated_at
  end;
  return new;
end;
$$;

create or replace function private.admin_catalogue_update(
  p_actor_id uuid, p_variant_id uuid, p_expected_updated_at timestamptz,
  p_expected_product_updated_at timestamptz, p_selling jsonb
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v public.variants := private.lock_admin_catalogue_variant(p_actor_id, p_variant_id, p_expected_updated_at);
  family public.products;
  fields record;
  current_substrates text[];
  next_substrates text[];
  fit_changed boolean;
  supplier_changed boolean;
  usual public.staff_variant_suppliers;
  next_supplier_id uuid;
  next_supplier_part text;
begin
  select * into strict family from public.products where id = v.product_id for no key update;
  if family.updated_at is distinct from p_expected_product_updated_at then
    raise exception using errcode = '22023', message = 'catalogue_stale';
  end if;

  select * into fields from jsonb_to_record(p_selling) as input (
    name text, description text, tool_category text, option_label text, tool text,
    supplier_name text, supplier_part_number text, angle_deg numeric, shank_mm numeric,
    cutting_depth_mm numeric, blade_thickness_mm numeric, diameter_mm numeric, specs jsonb,
    substrates text[], price_1_4_pence integer, price_5_9_pence integer, price_10_plus_pence integer,
    usual_supplier_id uuid, usual_supplier_part_number text
  );

  fields.name := private.catalogue_trim(fields.name);
  fields.description := private.catalogue_trim(fields.description);

  if coalesce(length(fields.name), 0) not between 1 and 160
    or coalesce(length(fields.description), 0) not between 1 and 2000
    or fields.tool_category is null
    or greatest(length(fields.option_label), length(fields.tool),
      length(private.catalogue_trim(fields.supplier_name)), length(private.catalogue_trim(fields.supplier_part_number))) > 160
    or length(private.catalogue_trim(fields.usual_supplier_part_number)) > 120
    or private.catalogue_trim(fields.usual_supplier_part_number) ~ '[[:cntrl:]]'
    or jsonb_typeof(fields.specs) is distinct from 'object'
    or length(fields.specs::text) > 6000
    or cardinality(fields.substrates) is null or cardinality(fields.substrates) > 100
    or not (
      (v.publication_status = 'draft'
        and num_nonnulls(fields.price_1_4_pence, fields.price_5_9_pence, fields.price_10_plus_pence) = 0)
      or (num_nonnulls(fields.price_1_4_pence, fields.price_5_9_pence, fields.price_10_plus_pence) = 3
        and fields.price_10_plus_pence > 0 and fields.price_10_plus_pence <= fields.price_5_9_pence
        and fields.price_5_9_pence <= fields.price_1_4_pence)
    )
    or exists (
      select 1 from unnest(fields.substrates) as substrate where substrate is null
    ) then
    raise exception using errcode = '22023', message = 'catalogue_invalid_selling_data';
  end if;
  if exists (
    select 1 from jsonb_each(fields.specs) as spec
    where length(private.catalogue_trim(spec.key)) not between 1 and 80 or jsonb_typeof(spec.value) <> 'string'
      or length(private.catalogue_trim(spec.value #>> '{}')) not between 1 and 240
  ) then
    raise exception using errcode = '22023', message = 'catalogue_invalid_selling_data';
  end if;
  if fields.angle_deg is not null and (
    fields.angle_deg <= 0 or fields.angle_deg >= 180 or fields.angle_deg <> round(fields.angle_deg, 1)
  ) or exists (
    select 1 from unnest(array[fields.shank_mm, fields.cutting_depth_mm, fields.blade_thickness_mm,
      fields.diameter_mm]) as dimension
    where dimension <= 0 or dimension > 999.99 or dimension <> round(dimension, 2)
  ) then
    raise exception using errcode = '22023', message = 'catalogue_invalid_selling_data';
  end if;

  select array(select substrate from public.variant_substrates where variant_id = v.id order by substrate)
    into current_substrates;
  select array(select distinct substrate from unnest(fields.substrates) as substrate order by substrate)
    into next_substrates;

  fields.option_label := nullif(private.catalogue_trim(fields.option_label), '');
  fields.tool := nullif(private.catalogue_trim(fields.tool), '');
  fields.supplier_name := case
    when not (p_selling ? 'supplier_name') or fields.supplier_name is not distinct from v.supplier_name then v.supplier_name
    else nullif(private.catalogue_trim(fields.supplier_name), '') end;
  fields.supplier_part_number := case
    when not (p_selling ? 'supplier_part_number') or fields.supplier_part_number is not distinct from v.supplier_part_number
      then v.supplier_part_number
    else nullif(private.catalogue_trim(fields.supplier_part_number), '') end;

  select * into usual from public.staff_variant_suppliers where variant_id = v.id and is_usual;
  next_supplier_id := usual.supplier_id;
  next_supplier_part := usual.supplier_part_number;
  if p_selling ? 'usual_supplier_id' then
    next_supplier_id := fields.usual_supplier_id;
    next_supplier_part := null;
    if next_supplier_id is not null then
      if not exists (select 1 from public.staff_suppliers where id = next_supplier_id) then
        raise exception using errcode = '22023', message = 'staff_supplier_not_found';
      end if;
      if p_selling ? 'usual_supplier_part_number' then
        next_supplier_part := nullif(private.catalogue_trim(fields.usual_supplier_part_number), '');
      else
        select supplier_part_number into next_supplier_part from public.staff_variant_suppliers
          where variant_id = v.id and supplier_id = next_supplier_id;
      end if;
    end if;
  end if;

  supplier_changed := (usual.supplier_id, usual.supplier_part_number) is distinct from (next_supplier_id, next_supplier_part);
  if supplier_changed then
    if usual.supplier_id is not null and usual.supplier_id is distinct from next_supplier_id then
      update public.staff_variant_suppliers set is_usual = false,
        updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
        where variant_id = v.id and supplier_id = usual.supplier_id;
    end if;
    if next_supplier_id is not null then
      insert into public.staff_variant_suppliers (variant_id, supplier_id, supplier_part_number, is_usual)
        values (v.id, next_supplier_id, next_supplier_part, true)
        on conflict (variant_id, supplier_id) do update set is_usual = true, supplier_part_number = excluded.supplier_part_number,
          updated_at = greatest(clock_timestamp(), staff_variant_suppliers.updated_at + interval '1 microsecond');
    end if;
  end if;

  fit_changed := supplier_changed or (v.option_label, v.tool, v.supplier_name, v.supplier_part_number, v.angle_deg, v.shank_mm,
    v.cutting_depth_mm, v.blade_thickness_mm, v.diameter_mm, v.specs, current_substrates)
    is distinct from (fields.option_label, fields.tool, fields.supplier_name, fields.supplier_part_number,
      fields.angle_deg, fields.shank_mm, fields.cutting_depth_mm, fields.blade_thickness_mm,
      fields.diameter_mm, fields.specs, next_substrates);

  update public.products set name = fields.name, description = fields.description,
    tool_category = fields.tool_category where id = family.id
    and (name, description, tool_category) is distinct from
      (fields.name, fields.description, fields.tool_category);

  update public.variants set
    catalogue_updated_at = case when supplier_changed then v.catalogue_updated_at + interval '1 microsecond'
      else v.catalogue_updated_at end,
    option_label = fields.option_label, tool = fields.tool, supplier_name = fields.supplier_name,
    supplier_part_number = fields.supplier_part_number, angle_deg = fields.angle_deg, shank_mm = fields.shank_mm,
    cutting_depth_mm = fields.cutting_depth_mm, blade_thickness_mm = fields.blade_thickness_mm,
    diameter_mm = fields.diameter_mm, specs = fields.specs, price_1_4_pence = fields.price_1_4_pence,
    price_5_9_pence = fields.price_5_9_pence, price_10_plus_pence = fields.price_10_plus_pence,
    publication_status = case when fit_changed and v.publication_status = 'published' then 'draft' else v.publication_status end,
    approved_at = case when fit_changed then null else v.approved_at end,
    approved_by = case when fit_changed then null else v.approved_by end,
    rejected_at = case when fit_changed then null else v.rejected_at end,
    rejected_by = case when fit_changed then null else v.rejected_by end
  where id = v.id and (fit_changed or (v.price_1_4_pence, v.price_5_9_pence, v.price_10_plus_pence)
    is distinct from (fields.price_1_4_pence, fields.price_5_9_pence, fields.price_10_plus_pence));

  if current_substrates <> next_substrates then
    delete from public.variant_substrates where variant_id = v.id and not (substrate = any(next_substrates));
    insert into public.variant_substrates (variant_id, substrate)
    select v.id, substrate from unnest(next_substrates) as substrate on conflict do nothing;
  end if;
  if fit_changed then
    update public.compatibility set verification_state = 'candidate', approved_at = null, approved_by = null
      where variant_id = v.id and verification_state = 'approved';
  end if;
  return family.slug;
end;
$$;

create or replace function public.admin_catalogue_set_publication(
  p_actor_id uuid, p_variant_id uuid, p_expected_updated_at timestamptz, p_publish boolean
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v public.variants := private.lock_admin_catalogue_variant(p_actor_id, p_variant_id, p_expected_updated_at);
  family public.products;
begin
  if p_publish is null or v.publication_status = 'archived' then
    raise exception using errcode = '22023', message = 'catalogue_invalid_publication';
  end if;

  select * into strict family from public.products where id = v.product_id for no key update;

  if p_publish then
    if v.approved_at is null or nullif(private.catalogue_trim(v.approved_by), '') is null
      or nullif(private.catalogue_trim(v.evidence_source), '') is null
      or nullif(private.catalogue_trim(v.evidence_note), '') is null then
      raise exception using errcode = '22023', message = 'catalogue_variant_not_approved';
    end if;
    if nullif(private.catalogue_trim(family.name), '') is null or nullif(private.catalogue_trim(family.description), '') is null
      or (
        not private.catalogue_has_registered_supplier_part(v.id)
        and (nullif(private.catalogue_trim(v.supplier_name), '') is null
          or nullif(private.catalogue_trim(v.supplier_part_number), '') is null)
      )
      or nullif(private.catalogue_trim(v.tool), '') is null
      or (num_nonnulls(v.angle_deg, v.shank_mm, v.cutting_depth_mm, v.blade_thickness_mm, v.diameter_mm) = 0
        and (jsonb_typeof(v.specs) <> 'object' or v.specs = '{}'::jsonb))
      or not exists (select 1 from public.variant_substrates where variant_id = v.id)
      or (nullif(private.catalogue_trim(v.option_label), '') is null and exists (
        select 1 from public.variants sibling where sibling.product_id = family.id and sibling.id <> v.id
      ))
      or exists (
        select 1 from public.variants sibling where sibling.product_id = family.id and sibling.id <> v.id
          and sibling.publication_status = 'published'
          and (nullif(private.catalogue_trim(sibling.option_label), '') is null
            or lower(private.catalogue_trim(sibling.option_label)) = lower(private.catalogue_trim(v.option_label)))
      ) then
      raise exception using errcode = '22023', message = 'catalogue_incomplete_selling_data';
    end if;
    if not private.catalogue_has_public_fit(v.id) then
      raise exception using errcode = '22023', message = 'catalogue_verified_fit_required';
    end if;
    update public.variants set publication_status = 'published' where id = v.id and publication_status <> 'published';
  else
    update public.variants set publication_status = 'draft' where id = v.id and publication_status = 'published';
  end if;
  return family.slug;
end;
$$;

create function public.remember_staff_purchase_supplier_part(
  p_purchase_order_id uuid, p_variant_id uuid, p_expected_purchase_revision integer, p_expected_association_updated_at timestamptz
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  po public.staff_purchase_orders;
  v public.variants;
  association public.staff_variant_suppliers;
  remembered_supplier_id uuid;
  remembered_part text;
  first_supplier boolean;
begin
  if not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;

  select * into po from public.staff_purchase_orders where id = p_purchase_order_id for update;
  if not found or po.revision is distinct from p_expected_purchase_revision then
    raise exception using errcode = '40001', message = 'staff_purchase_order_revision_conflict';
  end if;
  if po.status = 'cancelled' then
    raise exception using errcode = '22023', message = 'staff_purchase_order_not_editable';
  end if;

  select costs.supplier_id, nullif(private.catalogue_trim(line.supplier_part_number), '')
    into remembered_supplier_id, remembered_part
  from public.staff_purchase_order_costs costs
  join public.staff_purchase_order_line_costs line using (purchase_order_id)
  where costs.purchase_order_id = po.id and line.variant_id = p_variant_id;
  if remembered_supplier_id is null then
    raise exception using errcode = '22023', message = 'staff_purchase_supplier_line_required';
  end if;

  select * into v from public.variants where id = p_variant_id for no key update;
  if not found or v.publication_status = 'archived' then
    raise exception using errcode = '22023', message = 'staff_purchase_order_variant_unavailable';
  end if;

  select * into association from public.staff_variant_suppliers
    where variant_id = v.id and supplier_id = remembered_supplier_id;
  if association.updated_at is distinct from p_expected_association_updated_at then
    raise exception using errcode = '40001', message = 'staff_variant_supplier_conflict';
  end if;

  first_supplier := not exists (select 1 from public.staff_variant_suppliers where variant_id = v.id);
  if not first_supplier and (remembered_part is null or association.supplier_part_number is not distinct from remembered_part) then
    return false;
  end if;

  insert into public.staff_variant_suppliers (variant_id, supplier_id, supplier_part_number, is_usual)
    values (v.id, remembered_supplier_id, remembered_part, first_supplier)
    on conflict (variant_id, supplier_id) do update set supplier_part_number = excluded.supplier_part_number,
      updated_at = greatest(clock_timestamp(), staff_variant_suppliers.updated_at + interval '1 microsecond');

  update public.variants set catalogue_updated_at = v.catalogue_updated_at + interval '1 microsecond' where id = v.id;
  return true;
end;
$$;

revoke all on function private.catalogue_has_registered_supplier_part(uuid),
  private.require_published_supplier_part(),
  public.remember_staff_purchase_supplier_part(uuid, uuid, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.remember_staff_purchase_supplier_part(uuid, uuid, integer, timestamptz) to authenticated;
