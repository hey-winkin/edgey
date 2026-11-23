create table public.trial_follow_ups (
  id bigint generated always as identity primary key,
  trial_request_id uuid not null references public.trial_fulfilments (trial_request_id),
  followed_on date not null,
  outcome text not null check (outcome in ('ordered', 'follow_up_again', 'not_a_fit', 'no_reply')),
  note text check (length(btrim(note)) between 1 and 2000),
  next_on date,
  recorded_by uuid not null,
  constraint trial_follow_ups_next_date check (
    (outcome = 'follow_up_again' and next_on is not null and next_on > followed_on)
    or (outcome <> 'follow_up_again' and next_on is null)
  )
);

create index trial_follow_ups_history_idx on public.trial_follow_ups (trial_request_id, id desc);

alter table public.trial_follow_ups enable row level security;
revoke all on public.trial_follow_ups from public, anon, authenticated, service_role;
grant select on public.trial_follow_ups to authenticated;
create policy trial_follow_ups_read on public.trial_follow_ups for select to authenticated
  using ((select private.has_staff_role('warehouse', 'catalogue')));

create function public.admin_trial_follow_up_status(p_trial_request_id uuid default null)
returns table (
  trial_request_id uuid, company text, email text, dispatched_at timestamptz, dispatched_on date, converted boolean,
  due_on date, days_waiting integer, latest_id bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  initial_delay_days constant integer := 7;
  today date := (now() at time zone 'Europe/London')::date;
begin
  if not private.has_staff_role('warehouse', 'catalogue') then
    raise exception using errcode = '42501', message = 'requests_role_required';
  end if;

  return query
  select r.id, r.company, r.email::text, f.dispatched_at, dispatch.day,
    f.subsequent_order_id is not null, due.day, today - dispatch.day, latest.id
  from public.trial_fulfilments f
  join public.trial_requests r on r.id = f.trial_request_id
  cross join lateral (select (f.dispatched_at at time zone 'Europe/London')::date as day) dispatch
  left join lateral (
    select entry.id, entry.next_on from public.trial_follow_ups entry
    where entry.trial_request_id = r.id
    order by entry.id desc limit 1
  ) latest on true
  cross join lateral (
    select case
      when f.subsequent_order_id is not null then null::date
      when latest.id is null then dispatch.day + initial_delay_days
      else latest.next_on
    end as day
  ) due
  where f.state = 'dispatched'
    and case when p_trial_request_id is null then due.day <= today else r.id = p_trial_request_id end;
end;
$$;

create function public.record_trial_follow_up(
  p_trial_request_id uuid, p_followed_on date, p_outcome text, p_note text, p_next_on date, p_expected_id bigint
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'Europe/London')::date;
  fulfilment public.trial_fulfilments;
  latest_id bigint;
  entry_id bigint;
begin
  if not private.has_staff_role('warehouse', 'catalogue') then
    raise exception using errcode = '42501', message = 'requests_role_required';
  end if;

  perform 1 from public.trial_requests r where r.id = p_trial_request_id for update;
  select * into fulfilment from public.trial_fulfilments f where f.trial_request_id = p_trial_request_id;
  if fulfilment.state is distinct from 'dispatched' or fulfilment.subsequent_order_id is not null then
    raise exception using errcode = '22023', message = 'trial_follow_up_unavailable';
  end if;
  if p_followed_on is null or p_followed_on not between
    (fulfilment.dispatched_at at time zone 'Europe/London')::date and today then
    raise exception using errcode = '22023', message = 'invalid_trial_follow_up_date';
  end if;
  if p_outcome is null or p_outcome not in ('ordered', 'follow_up_again', 'not_a_fit', 'no_reply')
    or length(p_note) > 2000 then
    raise exception using errcode = '22023', message = 'invalid_trial_follow_up_details';
  end if;
  if (p_outcome = 'follow_up_again' and (p_next_on is null or p_next_on <= p_followed_on or not isfinite(p_next_on)))
    or (p_outcome <> 'follow_up_again' and p_next_on is not null) then
    raise exception using errcode = '22023', message = 'invalid_trial_follow_up_next_date';
  end if;
  if p_next_on > today + 365 then
    raise exception using errcode = '22023', message = 'trial_follow_up_next_date_too_far';
  end if;

  select max(entry.id) into latest_id from public.trial_follow_ups entry
    where entry.trial_request_id = p_trial_request_id;
  if latest_id is distinct from p_expected_id then
    raise exception using errcode = '22023', message = 'trial_follow_up_stale';
  end if;
  insert into public.trial_follow_ups (trial_request_id, followed_on, outcome, note, next_on, recorded_by)
  values (p_trial_request_id, p_followed_on, p_outcome, nullif(btrim(p_note), ''), p_next_on, auth.uid())
  returning id into entry_id;
  return entry_id;
end;
$$;

revoke all on function public.admin_trial_follow_up_status(uuid),
  public.record_trial_follow_up(uuid, date, text, text, date, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_trial_follow_up_status(uuid),
  public.record_trial_follow_up(uuid, date, text, text, date, bigint) to authenticated;
