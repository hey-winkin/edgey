create function public.save_staff_purchase_order_with_supplier_parts(
  p_id uuid, p_expected_revision integer, p_order jsonb, p_lines jsonb, p_remember jsonb
)
returns uuid
language plpgsql set search_path = ''
as $$
declare
  order_id uuid;
  choice record;
begin
  if jsonb_typeof(p_remember) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_staff_purchase_supplier_choices';
  end if;
  if jsonb_array_length(p_remember) not between 1 and 200 or exists (
    select 1 from jsonb_array_elements(p_remember) as requested(item)
    where case when jsonb_typeof(requested.item) = 'object' then
      requested.item - array['variant_id', 'expected_association_updated_at'] <> '{}'::jsonb
      or jsonb_typeof(requested.item->'variant_id') is distinct from 'string'
      or coalesce(jsonb_typeof(requested.item->'expected_association_updated_at'), '') not in ('null', 'string')
      else true end
  ) then
    raise exception using errcode = '22023', message = 'invalid_staff_purchase_supplier_choices';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_remember) as requested(variant_id uuid)
    group by requested.variant_id having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'invalid_staff_purchase_supplier_choices';
  end if;

  order_id := public.save_staff_purchase_order(p_id, p_expected_revision, p_order, p_lines);
  for choice in
    select * from jsonb_to_recordset(p_remember) as requested(variant_id uuid, expected_association_updated_at timestamptz)
    order by requested.variant_id
  loop
    perform public.remember_staff_purchase_supplier_part(
      order_id, choice.variant_id, p_expected_revision + 1, choice.expected_association_updated_at
    );
  end loop;
  return order_id;
end;
$$;

revoke all on function public.save_staff_purchase_order_with_supplier_parts(uuid, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_staff_purchase_order_with_supplier_parts(uuid, integer, jsonb, jsonb, jsonb)
  to authenticated;
