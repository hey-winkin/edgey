create table public.delivery_tracking_patterns (
  carrier text primary key check (
    carrier = btrim(carrier) and length(carrier) between 1 and 100 and carrier !~ '[[:cntrl:]]'
  ),
  url_pattern text not null check (
    length(url_pattern) <= 2000 and url_pattern ~ '^https://[^[:space:][:cntrl:]]+$'
    and length(url_pattern) - length(replace(url_pattern, '{tracking}', '')) = length('{tracking}')
  )
);

alter table public.delivery_tracking_patterns enable row level security;
revoke all on public.delivery_tracking_patterns from public, anon, authenticated, service_role;
grant select on public.delivery_tracking_patterns to service_role;

alter table public.order_outbox
  add column dispatch_lines jsonb check (
    dispatch_lines is null or (message_key = 'trial_dispatched' and jsonb_typeof(dispatch_lines) = 'array')
  ),
  drop constraint outbox_message_matches_source,
  add constraint outbox_message_matches_source check (
    (order_id is not null and message_key in ('order_confirmation', 'order_dispatched'))
    or (order_id is null and message_key in ('confirmation', 'staff_notification'))
    or (trial_request_id is not null and message_key in ('trial_approved', 'trial_declined', 'trial_dispatched'))
    or (enquiry_id is not null and
      message_key ~ '^enquiry_reply:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (trade_application_id is not null and message_key in ('trade_approved', 'trade_rejected'))
  );

create function private.enqueue_dispatch_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.carrier ~ '[[:cntrl:]]' or new.tracking_number ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'carrier_and_tracking_required';
  end if;
  insert into public.order_outbox (order_id, message_key)
  values (new.id, 'order_dispatched') on conflict (order_id, message_key) do nothing;
  return null;
end;
$$;

revoke all on function private.enqueue_dispatch_email() from public, anon, authenticated, service_role;

create trigger enqueue_dispatch_email
after update of fulfilment_status on public.orders
for each row when (old.fulfilment_status = 'picking' and new.fulfilment_status = 'dispatched')
execute function private.enqueue_dispatch_email();

create function public.admin_order_mail_status(p_order_id uuid)
returns table (message_key text, state public.order_message_state, delivery_uncertain boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_staff_role('warehouse') then
    raise exception using errcode = '42501', message = 'warehouse_role_required';
  end if;

  return query select mail.message_key, mail.state, mail.delivery_uncertain
  from public.order_outbox mail
  join public.orders orders on orders.id = mail.order_id
  where orders.id = p_order_id and orders.authorised_at is not null
    and mail.message_key in ('order_confirmation', 'order_dispatched');
end;
$$;

revoke all on function public.admin_order_mail_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_mail_status(uuid) to authenticated;

create or replace function public.claim_outbox_email(
  p_message_key text, p_replay_order_id uuid default null, p_expected_updated_at timestamptz default null
)
returns setof public.order_outbox
language plpgsql security definer set search_path = ''
as $$
declare
  target public.order_outbox;
  claimed_at timestamptz := clock_timestamp();
  uncertain boolean;
begin
  if p_message_key is null or p_message_key not in (
    'order_confirmation', 'order_dispatched', 'confirmation', 'staff_notification', 'request_follow_up'
  )
    or (p_replay_order_id is not null and p_message_key <> 'order_confirmation') then
    raise exception using errcode = '22023', message = 'invalid_outbox_email_queue';
  end if;
  perform private.prune_payment_rate_limits();

  if p_message_key = 'request_follow_up' then
    select * into target from public.order_outbox
    where state = 'pending'
      and (message_key in ('trial_approved', 'trial_declined', 'trial_dispatched', 'trade_approved', 'trade_rejected') or starts_with(message_key, 'enquiry_reply:'))
      and next_attempt_at <= claimed_at
      and (lease_until is null or lease_until <= claimed_at)
    order by next_attempt_at, created_at, id
    for update skip locked limit 1;
  else
    select * into target from public.order_outbox
    where message_key = p_message_key
      and (lease_until is null or lease_until <= claimed_at)
      and (
        (p_replay_order_id is null and state = 'pending' and next_attempt_at <= claimed_at)
        or (order_id = p_replay_order_id and state = 'failed'
          and (p_expected_updated_at is null or updated_at = p_expected_updated_at)
          and coalesce(last_error, '') not in ('delivery_unconfirmed', 'retry_window_expired'))
      )
    order by next_attempt_at, created_at, id
    for update skip locked limit 1;
  end if;
  if not found then
    return;
  end if;

  uncertain := target.delivery_uncertain or target.send_in_flight;
  if private.outbox_email_send_deadline(target.send_started_at) <= claimed_at then
    return query update public.order_outbox
    set state = 'failed', lease_token = null, lease_until = null, send_in_flight = false,
      delivery_uncertain = uncertain,
      last_error = case when uncertain then 'delivery_unconfirmed' else 'retry_window_expired' end
    where id = target.id returning *;
    return;
  end if;

  if p_replay_order_id is null and target.attempt_count >= 10 then
    return query update public.order_outbox
    set state = 'failed', lease_token = null, lease_until = null, send_in_flight = false,
      delivery_uncertain = uncertain,
      last_error = case when target.send_in_flight then 'provider_uncertain'
        else coalesce(target.last_error, 'provider_uncertain') end
    where id = target.id returning *;
    return;
  end if;

  return query update public.order_outbox
  set state = 'pending', next_attempt_at = claimed_at, lease_token = gen_random_uuid(),
    lease_until = claimed_at + interval '60 seconds', send_in_flight = false, delivery_uncertain = uncertain
  where id = target.id returning *;
end;
$$;

create or replace function public.dispatch_trial_fulfilment(
  p_trial_request_id uuid, p_actor_id uuid, p_tracking_number text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  fulfilment public.trial_fulfilments;
begin
  perform private.lock_trial_request(p_trial_request_id, p_actor_id);
  select * into strict fulfilment from public.trial_fulfilments where trial_request_id = p_trial_request_id;
  if p_tracking_number ~ '^[[:space:]]*$|[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'trial_tracking_required';
  end if;
  if fulfilment.state = 'dispatched' and fulfilment.tracking_number is distinct from btrim(p_tracking_number) then
    raise exception using errcode = '22023', message = 'trial_tracking_already_recorded';
  end if;
  perform private.finish_trial_fulfilment(p_trial_request_id, p_actor_id, 'dispatch', p_tracking_number);
  if fulfilment.state = 'allocated' then
    insert into public.order_outbox (trial_request_id, message_key, message_subject, message_body, dispatch_lines)
    select p_trial_request_id, 'trial_dispatched', 'Your Edgey trial pack has been dispatched',
      'Your trial pack has been dispatched. Tracking number: ' || btrim(p_tracking_number) || '.',
      jsonb_agg(jsonb_build_object('sku', v.sku, 'option_label', v.option_label, 'quantity', a.quantity) order by v.sku)
    from public.trial_allocations a
    join public.variants v on v.id = a.variant_id
    where a.trial_request_id = p_trial_request_id;
  end if;
  return p_trial_request_id;
end;
$$;
