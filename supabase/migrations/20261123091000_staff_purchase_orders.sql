create table public.staff_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  contact_name text check (length(contact_name) <= 200),
  email text check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  phone text check (length(phone) <= 80),
  address text check (length(address) <= 1000),
  default_currency text check (default_currency in ('GBP', 'USD', 'EUR')),
  lead_time_days integer check (lead_time_days >= 0),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.staff_purchase_buyer_settings (
  id boolean primary key default true check (id),
  name text check (length(name) between 1 and 200),
  address text check (length(address) between 1 and 1000),
  email text check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  company_number text check (length(company_number) <= 80),
  vat_number text check (length(vat_number) <= 80)
);

create table private.staff_purchase_order_counter (
  id boolean primary key check (id),
  last_number bigint not null check (last_number >= 0)
);
insert into private.staff_purchase_order_counter values (true, 0);

create table public.staff_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  status text not null check (status in ('draft', 'sent', 'part_received', 'received', 'closed', 'cancelled')),
  ordered_on date not null check (isfinite(ordered_on)),
  expected_on date check (isfinite(expected_on)),
  revision integer not null check (revision >= 1),
  document_revision integer not null default 1 check (document_revision >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index staff_purchase_orders_ordered_idx on public.staff_purchase_orders (ordered_on desc, created_at desc, id);

create table public.staff_purchase_order_lines (
  purchase_order_id uuid not null references public.staff_purchase_orders (id),
  variant_id uuid not null references public.variants (id),
  position integer not null check (position between 1 and 200),
  sku text not null,
  blade_name text not null,
  option_label text,
  quantity integer not null check (quantity > 0),
  received_quantity bigint not null default 0 check (received_quantity >= 0),
  primary key (purchase_order_id, variant_id),
  unique (purchase_order_id, position) deferrable initially deferred
);
create index staff_purchase_order_lines_variant_idx on public.staff_purchase_order_lines (variant_id);

create table public.staff_purchase_order_costs (
  purchase_order_id uuid primary key references public.staff_purchase_orders (id),
  supplier_id uuid references public.staff_suppliers (id),
  currency text not null check (currency in ('GBP', 'USD', 'EUR')),
  exchange_rate numeric check (
    exchange_rate > 0 and exchange_rate <= 1000000 and scale(exchange_rate) <= 8
    and (currency <> 'GBP' or exchange_rate = 1)
  ),
  shipping_minor integer not null check (shipping_minor >= 0),
  duty_minor integer not null check (duty_minor >= 0),
  other_minor integer not null check (other_minor >= 0),
  import_vat_minor integer not null check (import_vat_minor >= 0),
  include_import_vat boolean,
  note text check (length(note) <= 2000)
);
create index staff_purchase_order_costs_supplier_currency_idx on public.staff_purchase_order_costs (supplier_id, currency);

create table public.staff_purchase_order_line_costs (
  purchase_order_id uuid not null,
  variant_id uuid not null,
  unit_price_minor integer check (unit_price_minor >= 0),
  supplier_part_number text check (length(supplier_part_number) <= 120),
  note text check (length(note) <= 500),
  base_unit_pence integer check (base_unit_pence >= 0),
  freight_unit_pence integer check (freight_unit_pence >= 0),
  duty_unit_pence integer check (duty_unit_pence >= 0),
  other_unit_pence integer check (other_unit_pence >= 0),
  vat_unit_pence integer check (vat_unit_pence >= 0),
  landed_unit_pence integer check (landed_unit_pence >= 0),
  primary key (purchase_order_id, variant_id),
  constraint purchase_order_line_costs_line_fkey foreign key (purchase_order_id, variant_id)
    references public.staff_purchase_order_lines (purchase_order_id, variant_id) on delete cascade
);

create table public.staff_purchase_order_events (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.staff_purchase_orders (id),
  kind text not null check (kind in ('created', 'draft_saved', 'amended', 'sent', 'receipt', 'closed', 'cancelled')),
  revision integer not null check (revision >= 1),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  unique (purchase_order_id, revision)
);

create table private.staff_purchase_order_amendments (
  event_id uuid primary key references public.staff_purchase_order_events (id),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null
);

alter table public.staff_purchase_orders enable row level security;
alter table public.staff_purchase_order_lines enable row level security;
alter table public.staff_purchase_order_events enable row level security;
alter table public.staff_suppliers enable row level security;
alter table public.staff_purchase_buyer_settings enable row level security;
alter table public.staff_purchase_order_costs enable row level security;
alter table public.staff_purchase_order_line_costs enable row level security;
alter table private.staff_purchase_order_counter enable row level security;
alter table private.staff_purchase_order_amendments enable row level security;

create view public.staff_purchase_order_outstanding with (security_invoker = true) as
  select o.id as purchase_order_id, o.number, l.variant_id, l.quantity - l.received_quantity as quantity, o.expected_on
  from public.staff_purchase_orders o
  join public.staff_purchase_order_lines l on l.purchase_order_id = o.id
  where o.status in ('sent', 'part_received') and l.quantity > l.received_quantity;

create view public.staff_purchase_order_stock with (security_invoker = true) as
  select variant_id, sum(quantity)::bigint as quantity, min(expected_on) as expected_on,
    bool_or(expected_on is null) as has_undated
  from public.staff_purchase_order_outstanding
  group by variant_id;

revoke all on public.staff_purchase_orders, public.staff_purchase_order_lines, public.staff_purchase_order_events,
  public.staff_suppliers, public.staff_purchase_buyer_settings, public.staff_purchase_order_costs,
  public.staff_purchase_order_line_costs, public.staff_purchase_order_outstanding, public.staff_purchase_order_stock,
  private.staff_purchase_order_counter, private.staff_purchase_order_amendments
from public, anon, authenticated, service_role;
grant select on public.staff_purchase_orders, public.staff_purchase_order_lines, public.staff_purchase_order_events,
  public.staff_suppliers, public.staff_purchase_buyer_settings, public.staff_purchase_order_costs,
  public.staff_purchase_order_line_costs, public.staff_purchase_order_outstanding, public.staff_purchase_order_stock
to authenticated;

create policy staff_purchase_orders_read on public.staff_purchase_orders for select to authenticated
  using ((select private.has_staff_role('catalogue', 'finance'))
    or (status <> 'draft' and (select private.has_staff_role('warehouse'))));
create policy staff_purchase_order_lines_read on public.staff_purchase_order_lines for select to authenticated
  using (exists (select 1 from public.staff_purchase_orders o where o.id = staff_purchase_order_lines.purchase_order_id));
create policy staff_purchase_order_events_read on public.staff_purchase_order_events for select to authenticated
  using (exists (select 1 from public.staff_purchase_orders o where o.id = staff_purchase_order_events.purchase_order_id));
create policy staff_suppliers_read on public.staff_suppliers for select to authenticated
  using ((select private.has_staff_role('catalogue', 'finance')));
create policy staff_purchase_buyer_settings_read on public.staff_purchase_buyer_settings for select to authenticated
  using ((select private.has_staff_role('catalogue', 'finance')));
create policy staff_purchase_order_costs_read on public.staff_purchase_order_costs for select to authenticated
  using ((select private.has_staff_role('catalogue', 'finance')));
create policy staff_purchase_order_line_costs_read on public.staff_purchase_order_line_costs for select to authenticated
  using ((select private.has_staff_role('catalogue', 'finance')));

create function private.staff_purchase_int(p_value jsonb, p_error text)
returns integer
language plpgsql immutable set search_path = ''
as $$
declare amount numeric;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' then
    raise exception using errcode = '22023', message = p_error;
  end if;
  amount := (p_value #>> '{}')::numeric;
  if amount < 0 or amount > 2147483647 or amount <> trunc(amount) then
    raise exception using errcode = '22023', message = p_error;
  end if;
  return amount::integer;
end;
$$;

create function private.staff_purchase_text(p_value jsonb, p_limit integer, p_error text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare value text;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception using errcode = '22023', message = p_error;
  end if;
  value := nullif(private.catalogue_trim(p_value #>> '{}'), '');
  if length(value) > p_limit then
    raise exception using errcode = '22023', message = p_error;
  end if;
  return value;
end;
$$;

create function private.staff_purchase_order_snapshot(p_id uuid)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'order', to_jsonb(o), 'costs', to_jsonb(c), 'lines', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object('costs', to_jsonb(lc)) order by l.position)
      from public.staff_purchase_order_lines l
      join public.staff_purchase_order_line_costs lc using (purchase_order_id, variant_id)
      where l.purchase_order_id = o.id
    ), '[]'::jsonb)
  )
  from public.staff_purchase_orders o join public.staff_purchase_order_costs c on c.purchase_order_id = o.id
  where o.id = p_id;
$$;

create function private.calculate_staff_purchase_costs(p_id uuid, p_required boolean)
returns void
language plpgsql set search_path = ''
as $$
declare
  costs public.staff_purchase_order_costs;
  goods numeric;
  has_unpriced_lines boolean;
begin
  select * into strict costs from public.staff_purchase_order_costs where purchase_order_id = p_id;
  select sum(l.quantity::numeric * c.unit_price_minor), coalesce(bool_or(c.unit_price_minor is null), false)
    into goods, has_unpriced_lines
  from public.staff_purchase_order_lines l
  join public.staff_purchase_order_line_costs c using (purchase_order_id, variant_id)
  where l.purchase_order_id = p_id;

  if goods is null or has_unpriced_lines or costs.exchange_rate is null
    or (costs.import_vat_minor > 0 and costs.include_import_vat is null)
    or (goods = 0 and greatest(costs.shipping_minor, costs.duty_minor, costs.other_minor, costs.import_vat_minor) > 0)
    or (p_required and costs.supplier_id is null) then
    if p_required then
      raise exception using errcode = '22023', message = 'staff_purchase_order_incomplete';
    end if;
    update public.staff_purchase_order_line_costs
    set base_unit_pence = null, freight_unit_pence = null, duty_unit_pence = null,
      other_unit_pence = null, vat_unit_pence = null, landed_unit_pence = null
    where purchase_order_id = p_id;
    return;
  end if;

  with converted as (
    select lc.variant_id, costs.exchange_rate * lc.unit_price_minor as unit_gbp
    from public.staff_purchase_order_line_costs lc
    where lc.purchase_order_id = p_id
  ), components as (
    select variant_id, round(unit_gbp) as base,
      coalesce(div(2 * unit_gbp * costs.shipping_minor + goods, nullif(2 * goods, 0)), 0) as freight,
      coalesce(div(2 * unit_gbp * costs.duty_minor + goods, nullif(2 * goods, 0)), 0) as duty,
      coalesce(div(2 * unit_gbp * costs.other_minor + goods, nullif(2 * goods, 0)), 0) as other,
      coalesce(div(2 * unit_gbp * costs.import_vat_minor + goods, nullif(2 * goods, 0)), 0) as vat,
      coalesce(div(2 * unit_gbp * (goods + costs.shipping_minor + costs.duty_minor + costs.other_minor
        + case when costs.include_import_vat then costs.import_vat_minor else 0 end) + goods,
        nullif(2 * goods, 0)), 0) as landed
    from converted
  )
  update public.staff_purchase_order_line_costs lc
  set base_unit_pence = c.base::integer, freight_unit_pence = c.freight::integer, duty_unit_pence = c.duty::integer,
    other_unit_pence = c.other::integer, vat_unit_pence = c.vat::integer,
    landed_unit_pence = c.landed::integer
  from components c
  where lc.purchase_order_id = p_id and lc.variant_id = c.variant_id;
exception when numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'staff_purchase_cost_overflow';
end;
$$;

create function public.save_staff_supplier(p_id uuid, p_supplier jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  invalid constant text := 'invalid_staff_supplier';
  supplier public.staff_suppliers;
begin
  if not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;
  if jsonb_typeof(p_supplier) is distinct from 'object'
    or p_supplier - array['name', 'contact_name', 'email', 'phone', 'address', 'default_currency',
      'lead_time_days', 'notes'] <> '{}'::jsonb then
    raise exception using errcode = '22023', message = invalid;
  end if;

  supplier.name := private.staff_purchase_text(p_supplier->'name', 200, invalid);
  supplier.contact_name := private.staff_purchase_text(p_supplier->'contact_name', 200, invalid);
  supplier.email := private.staff_purchase_text(p_supplier->'email', 254, invalid);
  supplier.phone := private.staff_purchase_text(p_supplier->'phone', 80, invalid);
  supplier.address := private.staff_purchase_text(p_supplier->'address', 1000, invalid);
  supplier.default_currency := private.staff_purchase_text(p_supplier->'default_currency', 3, invalid);
  supplier.lead_time_days := private.staff_purchase_int(p_supplier->'lead_time_days', invalid);
  supplier.notes := private.staff_purchase_text(p_supplier->'notes', 2000, invalid);
  if supplier.name is null or supplier.default_currency not in ('GBP', 'USD', 'EUR')
    or supplier.email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = invalid;
  end if;

  if p_id is null then
    insert into public.staff_suppliers (name, contact_name, email, phone, address, default_currency, lead_time_days, notes)
    values (supplier.name, supplier.contact_name, supplier.email, supplier.phone, supplier.address,
      supplier.default_currency, supplier.lead_time_days, supplier.notes)
    returning id into p_id;
  else
    update public.staff_suppliers
    set name = supplier.name, contact_name = supplier.contact_name, email = supplier.email, phone = supplier.phone,
      address = supplier.address, default_currency = supplier.default_currency, lead_time_days = supplier.lead_time_days,
      notes = supplier.notes, updated_at = clock_timestamp()
    where id = p_id;
    if not found then
      raise exception using errcode = '22023', message = 'staff_supplier_not_found';
    end if;
  end if;
  return p_id;
end;
$$;

create function public.save_staff_purchase_buyer_settings(p_settings jsonb)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  invalid constant text := 'invalid_staff_purchase_buyer_settings';
  settings public.staff_purchase_buyer_settings;
begin
  if not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object'
    or p_settings - array['name', 'address', 'email', 'company_number', 'vat_number'] <> '{}'::jsonb then
    raise exception using errcode = '22023', message = invalid;
  end if;

  settings.name := private.staff_purchase_text(p_settings->'name', 200, invalid);
  settings.address := private.staff_purchase_text(p_settings->'address', 1000, invalid);
  settings.email := private.staff_purchase_text(p_settings->'email', 254, invalid);
  settings.company_number := private.staff_purchase_text(p_settings->'company_number', 80, invalid);
  settings.vat_number := private.staff_purchase_text(p_settings->'vat_number', 80, invalid);
  if settings.email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = invalid;
  end if;

  insert into public.staff_purchase_buyer_settings (id, name, address, email, company_number, vat_number)
  values (true, settings.name, settings.address, settings.email, settings.company_number, settings.vat_number)
  on conflict (id) do update set name = excluded.name, address = excluded.address, email = excluded.email,
    company_number = excluded.company_number, vat_number = excluded.vat_number;
  return true;
end;
$$;

create function public.save_staff_purchase_order(p_id uuid, p_expected_revision integer, p_order jsonb, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  invalid constant text := 'invalid_staff_purchase_order';
  po public.staff_purchase_orders;
  costs public.staff_purchase_order_costs;
  previous_costs public.staff_purchase_order_costs;
  before_snapshot jsonb;
  event_id uuid;
  event_kind text;
  next_number text;
  ordered_date date;
  expected_date date;
  line jsonb;
  line_position integer;
  line_variant_id uuid;
  line_ids uuid[] := '{}';
  line_quantity integer;
  line_cost public.staff_purchase_order_line_costs;
begin
  if not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_order) is distinct from 'object' or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using errcode = '22023', message = invalid;
  end if;
  if p_order - array['supplier_id', 'ordered_on', 'expected_on', 'currency', 'exchange_rate', 'shipping_minor',
      'duty_minor', 'other_minor', 'import_vat_minor', 'include_import_vat', 'note'] <> '{}'::jsonb
    or jsonb_array_length(p_lines) > 200
    or coalesce(p_order->>'ordered_on' !~ '^\d{4}-\d{2}-\d{2}$', true)
    or p_order->>'expected_on' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_order->>'supplier_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(jsonb_typeof(p_order->'include_import_vat'), 'null') not in ('boolean', 'null')
    or (p_order->>'exchange_rate' is not null and (
      jsonb_typeof(p_order->'exchange_rate') <> 'string'
      or p_order->>'exchange_rate' !~ '^[0-9]{1,7}([.][0-9]{1,8})?$'
    )) then
    raise exception using errcode = '22023', message = invalid;
  end if;
  begin
    ordered_date := (p_order->>'ordered_on')::date;
    expected_date := (p_order->>'expected_on')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = '22023', message = invalid;
  end;

  costs.supplier_id := (p_order->>'supplier_id')::uuid;
  costs.currency := private.staff_purchase_text(p_order->'currency', 3, invalid);
  costs.exchange_rate := trim_scale((p_order->>'exchange_rate')::numeric);
  costs.shipping_minor := coalesce(private.staff_purchase_int(p_order->'shipping_minor', invalid), 0);
  costs.duty_minor := coalesce(private.staff_purchase_int(p_order->'duty_minor', invalid), 0);
  costs.other_minor := coalesce(private.staff_purchase_int(p_order->'other_minor', invalid), 0);
  costs.import_vat_minor := coalesce(private.staff_purchase_int(p_order->'import_vat_minor', invalid), 0);
  costs.include_import_vat := (p_order->>'include_import_vat')::boolean;
  costs.note := private.staff_purchase_text(p_order->'note', 2000, invalid);
  if costs.currency is null or costs.currency not in ('GBP', 'USD', 'EUR')
    or costs.exchange_rate <= 0 or costs.exchange_rate > 1000000
    or (costs.currency = 'GBP' and costs.exchange_rate <> 1) then
    raise exception using errcode = '22023', message = invalid;
  end if;
  if costs.currency = 'GBP' then
    costs.exchange_rate := 1;
  end if;
  if costs.supplier_id is not null and not exists (
    select 1 from public.staff_suppliers where id = costs.supplier_id
  ) then
    raise exception using errcode = '22023', message = 'staff_supplier_not_found';
  end if;

  if p_expected_revision = 0 then
    update private.staff_purchase_order_counter set last_number = last_number + 1
    where id returning last_number::text into strict next_number;
    insert into public.staff_purchase_orders (id, number, status, ordered_on, expected_on, revision)
    values (coalesce(p_id, gen_random_uuid()), 'PO-' || lpad(next_number, greatest(4, length(next_number)), '0'),
      'draft', ordered_date, expected_date, 1)
    on conflict (id) do nothing
    returning * into po;
    if not found then
      raise exception using errcode = '40001', message = 'staff_purchase_order_revision_conflict';
    end if;
    event_kind := 'created';
  else
    select * into po from public.staff_purchase_orders where id = p_id for update;
    if not found or po.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'staff_purchase_order_revision_conflict';
    end if;
    if po.status not in ('draft', 'sent', 'part_received') then
      raise exception using errcode = '22023', message = 'staff_purchase_order_not_editable';
    end if;
    if po.status = 'draft' then
      event_kind := 'draft_saved';
    else
      select * into strict previous_costs from public.staff_purchase_order_costs where purchase_order_id = po.id;
      if (costs.supplier_id, costs.currency) is distinct from (previous_costs.supplier_id, previous_costs.currency) then
        raise exception using errcode = '22023', message = 'staff_purchase_order_supplier_currency_locked';
      end if;
      before_snapshot := private.staff_purchase_order_snapshot(po.id);
      event_kind := 'amended';
    end if;
  end if;

  insert into public.staff_purchase_order_costs (purchase_order_id, supplier_id, currency, exchange_rate,
    shipping_minor, duty_minor, other_minor, import_vat_minor, include_import_vat, note)
  values (po.id, costs.supplier_id, costs.currency, costs.exchange_rate, costs.shipping_minor, costs.duty_minor,
    costs.other_minor, costs.import_vat_minor, costs.include_import_vat, costs.note)
  on conflict (purchase_order_id) do update set supplier_id = excluded.supplier_id, currency = excluded.currency,
    exchange_rate = excluded.exchange_rate, shipping_minor = excluded.shipping_minor, duty_minor = excluded.duty_minor,
    other_minor = excluded.other_minor, import_vat_minor = excluded.import_vat_minor,
    include_import_vat = excluded.include_import_vat, note = excluded.note;

  for line, line_position in select value, ordinality::integer from jsonb_array_elements(p_lines) with ordinality loop
    if jsonb_typeof(line) is distinct from 'object'
      or line - array['variant_id', 'quantity', 'unit_price_minor', 'supplier_part_number', 'note'] <> '{}'::jsonb
      or coalesce(line->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', true) then
      raise exception using errcode = '22023', message = invalid;
    end if;
    line_variant_id := (line->>'variant_id')::uuid;
    if line_variant_id = any(line_ids) then
      raise exception using errcode = '22023', message = 'staff_purchase_order_duplicate_variant';
    end if;
    line_ids := array_append(line_ids, line_variant_id);
    line_quantity := private.staff_purchase_int(line->'quantity', invalid);
    if line_quantity is null or line_quantity = 0 then
      raise exception using errcode = '22023', message = invalid;
    end if;
    line_cost.unit_price_minor := private.staff_purchase_int(line->'unit_price_minor', invalid);
    line_cost.supplier_part_number := private.staff_purchase_text(line->'supplier_part_number', 120, invalid);
    line_cost.note := private.staff_purchase_text(line->'note', 500, invalid);

    update public.staff_purchase_order_lines as l
    set position = line_position, quantity = line_quantity
    where l.purchase_order_id = po.id and l.variant_id = line_variant_id and l.received_quantity <= line_quantity;
    if not found then
      if exists (select 1 from public.staff_purchase_order_lines l
        where l.purchase_order_id = po.id and l.variant_id = line_variant_id) then
        raise exception using errcode = '22023', message = 'staff_purchase_order_below_received';
      end if;
      insert into public.staff_purchase_order_lines (purchase_order_id, variant_id, position, sku, blade_name, option_label, quantity)
      select po.id, v.id, line_position, v.sku, p.name, nullif(v.option_label, ''), line_quantity
      from public.variants v join public.products p on p.id = v.product_id
      where v.id = line_variant_id and v.publication_status <> 'archived';
      if not found then
        raise exception using errcode = '22023', message = 'staff_purchase_order_variant_unavailable';
      end if;
    end if;
    insert into public.staff_purchase_order_line_costs (purchase_order_id, variant_id, unit_price_minor, supplier_part_number, note)
    values (po.id, line_variant_id, line_cost.unit_price_minor, line_cost.supplier_part_number, line_cost.note)
    on conflict (purchase_order_id, variant_id) do update set unit_price_minor = excluded.unit_price_minor,
      supplier_part_number = excluded.supplier_part_number, note = excluded.note;
  end loop;

  if exists (
    select 1 from public.staff_purchase_order_lines l
    where l.purchase_order_id = po.id and l.received_quantity > 0 and l.variant_id <> all(line_ids)
  ) then
    raise exception using errcode = '22023', message = 'staff_purchase_order_below_received';
  end if;
  delete from public.staff_purchase_order_lines l where l.purchase_order_id = po.id and l.variant_id <> all(line_ids);
  perform private.calculate_staff_purchase_costs(po.id, po.status <> 'draft');

  if event_kind <> 'created' then
    if po.status = 'part_received' and not exists (
      select 1 from public.staff_purchase_order_lines l where l.purchase_order_id = po.id and l.quantity > l.received_quantity
    ) then
      po.status := 'received';
    end if;
    update public.staff_purchase_orders
    set ordered_on = ordered_date, expected_on = expected_date, status = po.status,
      document_revision = po.document_revision + case when event_kind = 'amended' then 1 else 0 end,
      revision = po.revision + 1, updated_at = clock_timestamp()
    where id = po.id returning * into po;
  end if;

  insert into public.staff_purchase_order_events (purchase_order_id, kind, revision, actor_id)
  values (po.id, event_kind, po.revision, auth.uid()) returning id into event_id;
  if event_kind = 'amended' then
    insert into private.staff_purchase_order_amendments (event_id, before_snapshot, after_snapshot)
    values (event_id, before_snapshot, private.staff_purchase_order_snapshot(po.id));
  end if;
  return po.id;
end;
$$;

create function public.transition_staff_purchase_order(p_id uuid, p_expected_revision integer, p_status text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare po public.staff_purchase_orders;
begin
  if not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;
  select * into po from public.staff_purchase_orders where id = p_id for update;
  if not found or po.revision is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'staff_purchase_order_revision_conflict';
  end if;

  if p_status = 'sent' and po.status = 'draft' then
    perform private.calculate_staff_purchase_costs(po.id, true);
  elsif p_status = 'closed' and po.status in ('sent', 'part_received', 'received') then
    null;
  elsif p_status = 'cancelled' and po.status in ('draft', 'sent') and not exists (
    select 1 from public.staff_purchase_order_lines l where l.purchase_order_id = po.id and l.received_quantity > 0
  ) then
    null;
  else
    raise exception using errcode = '22023', message = 'staff_purchase_order_invalid_transition';
  end if;

  update public.staff_purchase_orders set status = p_status, revision = po.revision + 1, updated_at = clock_timestamp()
  where id = po.id;
  insert into public.staff_purchase_order_events (purchase_order_id, kind, revision, actor_id)
  values (po.id, p_status, po.revision + 1, auth.uid());
  return po.id;
end;
$$;

revoke all on function private.staff_purchase_int(jsonb, text), private.staff_purchase_text(jsonb, integer, text),
  private.staff_purchase_order_snapshot(uuid), private.calculate_staff_purchase_costs(uuid, boolean),
  public.save_staff_supplier(uuid, jsonb), public.save_staff_purchase_buyer_settings(jsonb),
  public.save_staff_purchase_order(uuid, integer, jsonb, jsonb), public.transition_staff_purchase_order(uuid, integer, text)
from public, anon, authenticated, service_role;
grant execute on function public.save_staff_supplier(uuid, jsonb), public.save_staff_purchase_buyer_settings(jsonb),
  public.save_staff_purchase_order(uuid, integer, jsonb, jsonb), public.transition_staff_purchase_order(uuid, integer, text)
to authenticated;
