create table public.staff_deliveries (
  id uuid primary key,
  reference text not null check (length(reference) between 1 and 120 and reference !~ '[[:cntrl:]]'),
  received_on date not null check (isfinite(received_on)),
  note text check (length(note) between 1 and 500),
  received_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  line_count integer not null check (line_count between 1 and 200),
  unit_count bigint not null check (unit_count >= line_count)
);
create index staff_deliveries_received_at_idx on public.staff_deliveries (received_at desc, id desc);

create table public.staff_delivery_lines (
  delivery_id uuid not null references public.staff_deliveries (id),
  position integer not null check (position between 1 and 200),
  variant_id uuid not null references public.variants (id),
  sku text not null,
  blade_name text not null,
  quantity integer not null check (quantity > 0),
  stock_movement_id bigint not null unique references public.stock_movements (id),
  primary key (delivery_id, position),
  unique (delivery_id, variant_id)
);
create index staff_delivery_lines_variant_idx on public.staff_delivery_lines (variant_id);
create index compatibility_staff_delivery_code_idx on public.compatibility (code_normalised)
where code_kind in ('item_number', 'model') and not is_private and verification_state <> 'rejected';

create table private.staff_delivery_payloads (
  delivery_id uuid primary key references public.staff_deliveries (id),
  lines jsonb not null
);

alter table public.staff_deliveries enable row level security;
alter table public.staff_delivery_lines enable row level security;
alter table private.staff_delivery_payloads enable row level security;
revoke all on public.staff_deliveries, public.staff_delivery_lines, private.staff_delivery_payloads
from public, anon, authenticated, service_role;
grant select on public.staff_deliveries, public.staff_delivery_lines to authenticated;

create policy staff_deliveries_read on public.staff_deliveries for select to authenticated
  using ((select private.has_staff_role('warehouse', 'catalogue', 'finance')));
create policy staff_delivery_lines_read on public.staff_delivery_lines for select to authenticated
  using ((select private.has_staff_role('warehouse', 'catalogue', 'finance')));

create function private.record_staff_delivery_line_cost(
  p_movement public.stock_movements, p_unit_cost_pence numeric
)
returns void
language plpgsql set search_path = ''
as $$
declare
  cost record;
  previous_cost jsonb;
begin
  select * into strict cost from private.parse_staff_unit_cost(jsonb_build_object(
    'supplier_unit_minor', p_unit_cost_pence, 'currency', 'GBP', 'landed_unit_pence', p_unit_cost_pence
  ));

  select to_jsonb(r) - array['stock_movement_id', 'variant_id', 'received_quantity', 'actor_id', 'recorded_at']
    into previous_cost
  from public.staff_receipt_costs r where r.stock_movement_id = p_movement.id;
  if found then
    if previous_cost is distinct from to_jsonb(cost) then
      raise exception using errcode = '22023', message = 'staff_delivery_line_already_costed';
    end if;
    return;
  end if;

  insert into public.staff_receipt_costs (
    stock_movement_id, variant_id, received_quantity, supplier_unit_minor, currency, landed_unit_pence,
    exchange_rate, freight_unit_pence, duty_unit_pence, note, actor_id, recorded_at
  ) values (
    p_movement.id, p_movement.variant_id, p_movement.on_hand_delta, cost.supplier_unit_minor, cost.currency,
    cost.landed_unit_pence, cost.exchange_rate, cost.freight_unit_pence, cost.duty_unit_pence,
    cost.note, auth.uid(), clock_timestamp()
  );
end;
$$;

create function public.receive_staff_delivery(
  p_delivery_id uuid, p_reference text, p_received_on date, p_note text, p_lines jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  delivery_reference text := private.catalogue_trim(p_reference);
  delivery_note text := nullif(private.catalogue_trim(p_note), '');
  line jsonb;
  variant_ids uuid[] := '{}';
  variant_id uuid;
  units numeric;
  total_units bigint := 0;
  has_cost boolean := false;
  item record;
  movement public.stock_movements;
  inserted_count integer := 0;
begin
  if not private.has_staff_role('warehouse') then
    raise exception using errcode = '42501', message = 'warehouse_role_required';
  end if;
  if p_delivery_id is null or coalesce(length(delivery_reference), 0) not between 1 and 120
    or delivery_reference ~ '[[:cntrl:]]' or length(delivery_note) > 500
    or p_received_on is null or not isfinite(p_received_on)
    or p_received_on > (statement_timestamp() at time zone 'Europe/London')::date
    or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_staff_delivery';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_staff_delivery';
  end if;

  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'invalid_staff_delivery';
    end if;
    if line - array['variant_id', 'quantity', 'unit_cost_pence'] <> '{}'::jsonb
      or jsonb_typeof(line->'variant_id') is distinct from 'string'
      or line->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or not (line ? 'unit_cost_pence') then
      raise exception using errcode = '22023', message = 'invalid_staff_delivery';
    end if;
    units := (line->>'quantity')::numeric;
    if units < 1 or units > 2147483647 or units <> trunc(units) then
      raise exception using errcode = '22023', message = 'invalid_staff_delivery';
    end if;
    variant_id := (line->>'variant_id')::uuid;
    if variant_id = any(variant_ids) then
      raise exception using errcode = '22023', message = 'delivery_duplicate_variant';
    end if;
    variant_ids := array_append(variant_ids, variant_id);
    total_units := total_units + units::int;
    has_cost := has_cost or jsonb_typeof(line->'unit_cost_pence') <> 'null';
  end loop;

  if has_cost and not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;
  if has_cost and exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e->'unit_cost_pence') not in ('null', 'number')
  ) then
    raise exception using errcode = '22023', message = 'invalid_staff_cost';
  end if;

  insert into public.staff_deliveries (id, reference, received_on, note, actor_id, line_count, unit_count)
  values (p_delivery_id, delivery_reference, p_received_on, delivery_note, actor, cardinality(variant_ids), total_units)
  on conflict (id) do nothing;
  if not found then
    if not exists (
      select 1
      from public.staff_deliveries d join private.staff_delivery_payloads p on p.delivery_id = d.id
      where d.id = p_delivery_id and d.actor_id = actor and d.reference = delivery_reference
        and d.received_on = p_received_on and d.note is not distinct from delivery_note and p.lines = p_lines
    ) then
      raise exception using errcode = '22023', message = 'operation_key_conflict';
    end if;
    return p_delivery_id;
  end if;

  insert into private.staff_delivery_payloads (delivery_id, lines) values (p_delivery_id, p_lines);

  for item in
    select v.id, v.sku, concat_ws(' · ', p.name, nullif(v.option_label, '')) as blade_name, v.stock_on_hand, e.position,
      (e.value->>'quantity')::numeric::int as quantity, (e.value->>'unit_cost_pence')::numeric as unit_cost
    from jsonb_array_elements(p_lines) with ordinality e(value, position)
    join public.variants v on v.id = (e.value->>'variant_id')::uuid
    join public.products p on p.id = v.product_id
    where v.publication_status <> 'archived'
    order by v.id for no key update of v
  loop
    if item.stock_on_hand::bigint + item.quantity > 2147483647 then
      raise exception using errcode = '22023', message = 'delivery_stock_overflow';
    end if;
    movement := private.apply_stock_movement(
      'receive', 'staff-delivery:' || p_delivery_id || ':' || item.position, item.id, item.quantity, 0, null, null, actor
    );
    insert into public.staff_delivery_lines (delivery_id, position, variant_id, sku, blade_name, quantity, stock_movement_id)
    values (p_delivery_id, item.position, item.id, item.sku, item.blade_name, item.quantity, movement.id);
    if item.unit_cost is not null then
      perform private.record_staff_delivery_line_cost(movement, item.unit_cost);
    end if;
    inserted_count := inserted_count + 1;
  end loop;
  if inserted_count <> cardinality(variant_ids) then
    raise exception using errcode = '22023', message = 'delivery_variant_unavailable';
  end if;
  return p_delivery_id;
end;
$$;

create function public.add_staff_delivery_line_cost(p_delivery_id uuid, p_position integer, p_unit_cost_pence integer)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  movement public.stock_movements;
begin
  if not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;
  select m.* into movement
  from public.staff_delivery_lines l join public.stock_movements m on m.id = l.stock_movement_id
  where l.delivery_id = p_delivery_id and l.position = p_position;
  if not found then
    raise exception using errcode = '22023', message = 'staff_delivery_line_not_found';
  end if;

  perform 1 from public.variants where id = movement.variant_id for no key update;
  perform private.record_staff_delivery_line_cost(movement, p_unit_cost_pence);
  return movement.id;
end;
$$;

create function public.match_staff_delivery_codes(p_codes text[])
returns table (input_code text, variant_id uuid, sku text, blade_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_staff_role('warehouse') then
    raise exception using errcode = '42501', message = 'warehouse_role_required';
  end if;
  if p_codes is null or cardinality(p_codes) > 200 or array_ndims(p_codes) > 1 or exists (
    select 1 from unnest(p_codes) c
    where c is null or length(c) > 120 or c ~ '[[:cntrl:]]' or public.normalise_code(c) = ''
  ) then
    raise exception using errcode = '22023', message = 'invalid_staff_delivery_codes';
  end if;

  return query
  with input as (
    select c.code, min(c.position) as position, public.normalise_code(c.code) as key
    from unnest(p_codes) with ordinality c(code, position)
    group by c.code
  ), matches as (
    select i.code, i.position, v.id, v.sku, v.product_id, v.option_label, v.publication_status,
      count(*) over (partition by i.code) as total,
      count(*) filter (where v.publication_status <> 'archived') over (partition by i.code) as selectable,
      row_number() over (partition by i.code order by v.publication_status = 'archived', v.sku) as rank
    from input i
    left join public.variants sku_match on sku_match.sku_normalised = i.key
    join lateral (
      select sku_match.id where sku_match.id is not null
      union all
      select c.variant_id from public.compatibility c
      where sku_match.id is null and c.code_normalised = i.key and c.code_kind in ('item_number', 'model')
        and not c.is_private and c.verification_state <> 'rejected'
    ) candidate(id) on true
    join public.variants v on v.id = candidate.id
  )
  select m.code, m.id, m.sku, concat_ws(' · ', p.name, nullif(m.option_label, ''))
  from matches m
  join public.products p on p.id = m.product_id
  where m.publication_status <> 'archived' and (m.selectable > 1 or m.total = 1) and m.rank <= 4
  order by m.position, m.sku;
end;
$$;

revoke all on function private.record_staff_delivery_line_cost(public.stock_movements, numeric),
  public.receive_staff_delivery(uuid, text, date, text, jsonb),
  public.add_staff_delivery_line_cost(uuid, integer, integer), public.match_staff_delivery_codes(text[])
from public, anon, authenticated, service_role;
grant execute on function public.receive_staff_delivery(uuid, text, date, text, jsonb),
  public.add_staff_delivery_line_cost(uuid, integer, integer), public.match_staff_delivery_codes(text[])
to authenticated;
