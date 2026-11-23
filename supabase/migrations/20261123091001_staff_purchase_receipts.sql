alter table public.staff_deliveries
  add column purchase_order_id uuid references public.staff_purchase_orders (id);
create index staff_deliveries_purchase_order_idx on public.staff_deliveries (purchase_order_id)
  where purchase_order_id is not null;

create table public.staff_purchase_receipt_cost_breakdowns (
  stock_movement_id bigint primary key references public.staff_receipt_costs (stock_movement_id),
  base_unit_pence integer not null check (base_unit_pence >= 0),
  freight_unit_pence integer not null check (freight_unit_pence >= 0),
  duty_unit_pence integer not null check (duty_unit_pence >= 0),
  other_unit_pence integer not null check (other_unit_pence >= 0),
  vat_unit_pence integer not null check (vat_unit_pence >= 0),
  include_import_vat boolean
);
alter table public.staff_purchase_receipt_cost_breakdowns enable row level security;
revoke all on public.staff_purchase_receipt_cost_breakdowns from public, anon, authenticated, service_role;
grant select on public.staff_purchase_receipt_cost_breakdowns to authenticated;
create policy staff_purchase_receipt_cost_breakdowns_read
on public.staff_purchase_receipt_cost_breakdowns for select to authenticated
  using ((select private.has_staff_role('catalogue', 'finance')));

create function private.receive_staff_delivery(
  p_delivery_id uuid, p_reference text, p_received_on date, p_note text, p_lines jsonb,
  p_order_id uuid, p_expected_revision integer
)
returns uuid
language plpgsql set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  delivery_reference text := private.catalogue_trim(p_reference);
  delivery_note text := nullif(private.catalogue_trim(p_note), '');
  purchase_order public.staff_purchase_orders;
  line_keys text[] := array['variant_id', 'quantity'];
  line jsonb;
  variant_ids uuid[] := '{}';
  variant_id uuid;
  units numeric;
  total_units bigint := 0;
  has_cost boolean := false;
  item record;
  movement public.stock_movements;
  inserted_count integer := 0;
  new_revision integer;
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
  if p_order_id is null then
    line_keys := array_append(line_keys, 'unit_cost_pence');
  end if;

  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'invalid_staff_delivery';
    end if;
    if line - line_keys <> '{}'::jsonb
      or jsonb_typeof(line->'variant_id') is distinct from 'string'
      or line->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or (p_order_id is null and not (line ? 'unit_cost_pence')) then
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
    has_cost := has_cost or coalesce(jsonb_typeof(line->'unit_cost_pence') <> 'null', false);
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

  if p_order_id is not null then
    select * into purchase_order from public.staff_purchase_orders where id = p_order_id for update;
    if not found then
      raise exception using errcode = '22023', message = 'purchase_order_not_found';
    end if;
  end if;

  insert into public.staff_deliveries (id, reference, received_on, note, actor_id, line_count, unit_count, purchase_order_id)
  values (p_delivery_id, delivery_reference, p_received_on, delivery_note, actor, cardinality(variant_ids), total_units, p_order_id)
  on conflict (id) do nothing;
  if not found then
    if not exists (
      select 1
      from public.staff_deliveries d join private.staff_delivery_payloads p on p.delivery_id = d.id
      where d.id = p_delivery_id and d.actor_id = actor and d.reference = delivery_reference
        and d.received_on = p_received_on and d.note is not distinct from delivery_note and p.lines = p_lines
        and d.purchase_order_id is not distinct from p_order_id
    ) then
      raise exception using errcode = '22023', message = 'operation_key_conflict';
    end if;
    return p_delivery_id;
  end if;

  if p_order_id is not null then
    if p_expected_revision is distinct from purchase_order.revision then
      raise exception using errcode = '22023', message = 'purchase_order_stale';
    end if;
    if purchase_order.status not in ('sent', 'part_received') then
      raise exception using errcode = '22023', message = 'purchase_order_not_receivable';
    end if;
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

  if p_order_id is not null then
    with receipt_costs as (
      select d.stock_movement_id, d.variant_id, d.quantity,
        c.supplier_unit_minor, c.currency, c.landed_unit_pence, c.exchange_rate, c.freight_unit_pence, c.duty_unit_pence,
        lc.base_unit_pence, lc.other_unit_pence, lc.vat_unit_pence, o.include_import_vat
      from public.staff_delivery_lines d
      join public.staff_purchase_order_lines l on l.purchase_order_id = p_order_id and l.variant_id = d.variant_id
      left join public.staff_purchase_order_costs o on o.purchase_order_id = l.purchase_order_id
      left join public.staff_purchase_order_line_costs lc
        on lc.purchase_order_id = l.purchase_order_id and lc.variant_id = l.variant_id
      cross join lateral private.parse_staff_unit_cost(jsonb_build_object(
        'supplier_unit_minor', lc.unit_price_minor, 'currency', o.currency,
        'landed_unit_pence', lc.landed_unit_pence, 'exchange_rate', o.exchange_rate,
        'freight_unit_pence', lc.freight_unit_pence, 'duty_unit_pence', lc.duty_unit_pence
      )) c
      where d.delivery_id = p_delivery_id
    ), recorded_costs as (
      insert into public.staff_receipt_costs (
        stock_movement_id, variant_id, received_quantity, supplier_unit_minor, currency, landed_unit_pence,
        exchange_rate, freight_unit_pence, duty_unit_pence, actor_id, recorded_at
      )
      select rc.stock_movement_id, rc.variant_id, rc.quantity, rc.supplier_unit_minor, rc.currency,
        rc.landed_unit_pence, rc.exchange_rate, rc.freight_unit_pence, rc.duty_unit_pence, actor, clock_timestamp()
      from receipt_costs rc
      returning stock_movement_id
    )
    insert into public.staff_purchase_receipt_cost_breakdowns (
      stock_movement_id, base_unit_pence, freight_unit_pence, duty_unit_pence, other_unit_pence,
      vat_unit_pence, include_import_vat
    )
    select stock_movement_id, base_unit_pence, freight_unit_pence, duty_unit_pence, other_unit_pence,
      vat_unit_pence, include_import_vat
    from receipt_costs join recorded_costs using (stock_movement_id);

    update public.staff_purchase_order_lines l
    set received_quantity = l.received_quantity + d.quantity
    from public.staff_delivery_lines d
    where l.purchase_order_id = p_order_id and d.delivery_id = p_delivery_id and l.variant_id = d.variant_id;

    update public.staff_purchase_orders
    set status = case when exists (
        select 1 from public.staff_purchase_order_lines
        where purchase_order_id = p_order_id and received_quantity < quantity
      ) then 'part_received' else 'received' end,
      revision = revision + 1, updated_at = clock_timestamp()
    where id = p_order_id
    returning revision into new_revision;

    insert into public.staff_purchase_order_events (purchase_order_id, kind, revision, actor_id)
    values (p_order_id, 'receipt', new_revision, actor);
  end if;
  return p_delivery_id;
end;
$$;

create or replace function public.receive_staff_delivery(
  p_delivery_id uuid, p_reference text, p_received_on date, p_note text, p_lines jsonb
)
returns uuid
language sql security definer set search_path = ''
as $$
  select private.receive_staff_delivery(p_delivery_id, p_reference, p_received_on, p_note, p_lines, null, null);
$$;

create function public.receive_staff_purchase_order(
  p_order_id uuid, p_expected_revision integer, p_delivery_id uuid,
  p_reference text, p_received_on date, p_note text, p_lines jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_staff_role('warehouse') then
    raise exception using errcode = '42501', message = 'warehouse_role_required';
  end if;
  if p_order_id is null then
    raise exception using errcode = '22023', message = 'purchase_order_not_found';
  end if;
  return private.receive_staff_delivery(p_delivery_id, p_reference, p_received_on, p_note, p_lines, p_order_id, p_expected_revision);
end;
$$;

create function public.last_staff_purchase_price(p_supplier_id uuid, p_variant_id uuid, p_currency text)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  price integer;
begin
  if not private.has_staff_role('catalogue', 'finance') then
    raise exception using errcode = '42501', message = 'staff_cost_role_required';
  end if;
  select coalesce(original.supplier_unit_minor, lc.unit_price_minor) into price
  from public.staff_purchase_order_lines l
  join public.staff_purchase_orders o on o.id = l.purchase_order_id
  join public.staff_purchase_order_costs c on c.purchase_order_id = o.id
  join public.staff_purchase_order_line_costs lc
    on lc.purchase_order_id = l.purchase_order_id and lc.variant_id = l.variant_id
  left join lateral (
    select r.supplier_unit_minor
    from public.staff_deliveries d
    join public.staff_delivery_lines dl on dl.delivery_id = d.id
    join public.staff_receipt_costs r on r.stock_movement_id = dl.stock_movement_id
    where d.purchase_order_id = l.purchase_order_id and dl.variant_id = l.variant_id and r.currency = p_currency
    order by r.stock_movement_id desc
    limit 1
  ) original on true
  where l.variant_id = p_variant_id and l.received_quantity > 0
    and c.supplier_id = p_supplier_id and c.currency = p_currency
  order by o.ordered_on desc, o.created_at desc, o.id desc
  limit 1;
  return price;
end;
$$;

revoke all on function private.receive_staff_delivery(uuid, text, date, text, jsonb, uuid, integer),
  public.receive_staff_purchase_order(uuid, integer, uuid, text, date, text, jsonb),
  public.last_staff_purchase_price(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.receive_staff_purchase_order(uuid, integer, uuid, text, date, text, jsonb),
  public.last_staff_purchase_price(uuid, uuid, text)
to authenticated;
