insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('enquiry-photos', 'enquiry-photos', false, 256000, array['image/jpeg']);

create policy enquiry_photos_server_only on storage.objects
as restrictive for all to anon, authenticated
using (bucket_id <> 'enquiry-photos')
with check (bucket_id <> 'enquiry-photos');

create table private.enquiry_photo_uploads (
  enquiry_id uuid primary key references public.enquiries (id) on delete cascade,
  storage_key uuid not null unique default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  photo_count smallint not null check (photo_count between 1 and 3),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  claimed boolean not null default false
);
alter table private.enquiry_photo_uploads enable row level security;
revoke all on private.enquiry_photo_uploads from public, anon, authenticated, service_role;

create function public.issue_enquiry_photo_upload(p_enquiry_id uuid, p_token_hash text, p_photo_count integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.enquiry_photo_uploads as upload (enquiry_id, token_hash, photo_count)
  select id, p_token_hash, p_photo_count from public.enquiries
  where id = p_enquiry_id and kind = 'compatibility'
    and created_at > now() - interval '15 minutes'
  on conflict (enquiry_id) do update
    set token_hash = excluded.token_hash, photo_count = excluded.photo_count, expires_at = excluded.expires_at
  where not upload.claimed;
  return found;
end;
$$;

create function public.claim_enquiry_photo_upload(p_token_hash text, p_photo_count integer)
returns uuid
language sql volatile security definer set search_path = ''
as $$
  update private.enquiry_photo_uploads set claimed = true
  where token_hash = p_token_hash and photo_count = p_photo_count and not claimed and expires_at > now()
  returning storage_key;
$$;

create function public.enquiry_photo_storage_key(p_enquiry_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select storage_key from private.enquiry_photo_uploads where enquiry_id = p_enquiry_id and claimed;
$$;

create function public.orphaned_enquiry_photos()
returns text[]
language sql stable security definer set search_path = ''
as $$
  select array(
    select object.name from storage.objects as object
    where object.bucket_id = 'enquiry-photos'
      and object.created_at < now() - interval '1 hour'
      and not exists (
        select 1 from private.enquiry_photo_uploads as upload
        where upload.storage_key = case
          when object.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-3]\.jpg$'
          then split_part(object.name, '/', 1)::uuid
        end
      )
    order by object.created_at, object.name
    limit 200
  );
$$;

revoke all on function public.issue_enquiry_photo_upload(uuid, text, integer),
  public.claim_enquiry_photo_upload(text, integer), public.enquiry_photo_storage_key(uuid), public.orphaned_enquiry_photos()
from public, anon, authenticated;
grant execute on function public.issue_enquiry_photo_upload(uuid, text, integer),
  public.claim_enquiry_photo_upload(text, integer), public.enquiry_photo_storage_key(uuid), public.orphaned_enquiry_photos()
to service_role;
