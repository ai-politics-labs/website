-- Public community + private referral aggregates. Apply as the database owner.
-- One transaction closes the old "every authenticated user is an admin" boundary
-- before public signup is enabled. No personal legacy records are made public.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.site_admins from public, anon, authenticated;
alter table private.site_admins enable row level security;
-- This is the single operator independently verified before this migration.
insert into private.site_admins(user_id)
select id from auth.users
where id = 'bfc7ee84-daa3-4519-9316-cee48712f193'::uuid
  and email_confirmed_at is not null
on conflict do nothing;
do $$ begin
  if not exists (select 1 from private.site_admins where user_id = 'bfc7ee84-daa3-4519-9316-cee48712f193'::uuid) then
    raise exception 'The verified site operator must exist before enabling community signup';
  end if;
end $$;

create or replace function public.is_site_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from private.site_admins where user_id = auth.uid()) $$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to anon, authenticated;

-- Clients never choose the owner of legacy submissions. Existing rows remain
-- administrator-only. A signed-in form may read its INSERT ... RETURNING row.
create or replace function private.community_legacy_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  if tg_op = 'INSERT' then new.submitted_by := auth.uid();
  else new.submitted_by := old.submitted_by;
  end if;
  return new;
end $$;
revoke all on function private.community_legacy_owner() from public, anon, authenticated;

do $$
declare t text; p record;
begin
  foreach t in array array['founding_members','revote_signatures','revote_reports','revote_report_files','revote_consent_logs','revote_referrals','revote_audit_logs','revote_delete_requests','revote_legal_delegations'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I add column if not exists submitted_by uuid default auth.uid() references auth.users(id) on delete set null', t);
    execute format('drop trigger if exists community_legacy_owner on public.%I', t);
    execute format('create trigger community_legacy_owner before insert or update on public.%I for each row execute function private.community_legacy_owner()', t);
    -- Replace every old policy on these dedicated intake tables atomically.
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke truncate, trigger, references on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy community_admin_all on public.%I for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin())', t);
    -- Restrictive guards remain effective if a permissive policy is added later.
    execute format('create policy community_private_select on public.%I as restrictive for select to authenticated using (public.is_site_admin() or submitted_by = auth.uid())', t);
    execute format('create policy community_private_update on public.%I as restrictive for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin())', t);
    execute format('create policy community_private_delete on public.%I as restrictive for delete to authenticated using (public.is_site_admin())', t);
    execute format('create policy community_private_anon_select on public.%I as restrictive for select to anon using (false)', t);
    if t <> 'revote_audit_logs' then
      execute format('grant insert on public.%I to anon', t);
      execute format('create policy community_own_submission on public.%I for select to authenticated using (submitted_by = auth.uid())', t);
      if t = 'founding_members' then
        execute format('create policy community_public_insert on public.%I for insert to anon, authenticated with check (privacy_agreed = true and submitted_by is not distinct from auth.uid())', t);
      else
        execute format('create policy community_public_insert on public.%I for insert to anon, authenticated with check (submitted_by is not distinct from auth.uid())', t);
      end if;
    else
      execute format('revoke insert on public.%I from anon', t);
      execute format('create policy community_private_audit_insert on public.%I as restrictive for insert to authenticated with check (public.is_site_admin())', t);
    end if;
  end loop;
end $$;

-- Evidence stays private even after public accounts are introduced. Other
-- storage buckets/policies are left intact.
do $$ begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists revote_evidence_admin_read on storage.objects;
    drop policy if exists community_evidence_private on storage.objects;
    drop policy if exists community_evidence_anon_private on storage.objects;
    create policy revote_evidence_admin_read on storage.objects for select to authenticated
      using (bucket_id = 'revote-evidence' and public.is_site_admin());
    create policy community_evidence_private on storage.objects as restrictive for select to authenticated
      using (bucket_id <> 'revote-evidence' or public.is_site_admin());
    create policy community_evidence_anon_private on storage.objects as restrictive for select to anon
      using (bucket_id <> 'revote-evidence');
    revoke truncate, trigger, references on storage.objects from public, anon, authenticated;
  end if;
end $$;

create table if not exists public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint community_username_format check (username ~ '^[a-z][a-z0-9_]{2,23}$'),
  constraint community_username_reserved check (username not in ('admin','administrator','aip','aiparty','support','system','official','moderator','root')),
  constraint community_display_name_length check (char_length(btrim(display_name)) between 1 and 40)
);
alter table public.community_profiles enable row level security;
revoke all on public.community_profiles from public, anon, authenticated;
grant select on public.community_profiles to authenticated;
drop policy if exists community_profile_self on public.community_profiles;
create policy community_profile_self on public.community_profiles for select to authenticated using (user_id = auth.uid());

create table if not exists private.community_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.community_profiles(user_id) on delete cascade,
  slug text not null unique,
  source text not null check(char_length(source) between 1 and 64),
  medium text not null check(char_length(medium) between 1 and 64),
  campaign text not null check(char_length(campaign) between 1 and 100),
  created_at timestamptz not null default now()
);
create index if not exists community_links_owner_idx on private.community_links(owner_id);
create table if not exists private.community_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null,
  owner_id uuid not null references public.community_profiles(user_id) on delete cascade,
  link_id uuid references private.community_links(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  unique nulls not distinct(visitor_id, owner_id, link_id)
);
create index if not exists community_visits_owner_idx on private.community_visits(owner_id);
create table if not exists private.community_first_touch (
  visitor_id uuid primary key,
  owner_id uuid not null references public.community_profiles(user_id) on delete cascade,
  link_id uuid references private.community_links(id) on delete cascade,
  touched_at timestamptz not null default now()
);
create table if not exists private.community_referrals (
  signup_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references public.community_profiles(user_id) on delete cascade,
  link_id uuid references private.community_links(id) on delete set null,
  attribution_method text not null check(attribution_method in ('manual','visit')),
  created_at timestamptz not null default now(),
  check(signup_user_id <> referrer_id)
);
create index if not exists community_referrals_owner_idx on private.community_referrals(referrer_id);
create table if not exists private.community_write_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists community_write_events_owner_time_idx on private.community_write_events(user_id, created_at);
-- Private schema is inaccessible even where a project has broad default grants.
revoke all on private.community_links, private.community_visits, private.community_first_touch, private.community_referrals, private.community_write_events from public, anon, authenticated;
alter table private.community_links enable row level security;
alter table private.community_visits enable row level security;
alter table private.community_first_touch enable row level security;
alter table private.community_referrals enable row level security;
alter table private.community_write_events enable row level security;

create or replace function private.community_username_valid(p_username text)
returns boolean language sql immutable set search_path = ''
as $$ select coalesce(lower(btrim(p_username)) ~ '^[a-z][a-z0-9_]{2,23}$' and lower(btrim(p_username)) not in ('admin','administrator','aip','aiparty','support','system','official','moderator','root'), false) $$;
revoke all on function private.community_username_valid(text) from public, anon, authenticated;

create or replace function public.community_username_available(p_username text)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.community_username_valid(p_username) and not exists(select 1 from public.community_profiles where username = lower(btrim(p_username))) $$;
revoke all on function public.community_username_available(text) from public;
grant execute on function public.community_username_available(text) to anon, authenticated;

create or replace function public.community_referrer_exists(p_username text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.community_profiles p join auth.users u on u.id = p.user_id where p.username = lower(btrim(p_username)) and u.email_confirmed_at is not null) $$;
revoke all on function public.community_referrer_exists(text) from public;
grant execute on function public.community_referrer_exists(text) to anon, authenticated;

create or replace function private.community_require_verified()
returns uuid language plpgsql stable security definer set search_path = ''
as $$ declare v_user uuid := auth.uid(); begin
  if v_user is null or not exists(select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'COMMUNITY_VERIFIED_REQUIRED' using errcode = '42501';
  end if;
  return v_user;
end $$;
revoke all on function private.community_require_verified() from public, anon, authenticated;

create or replace function private.community_signup_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_username text; v_display text; v_referrer text; v_visitor uuid; v_owner uuid; v_link uuid; v_method text;
begin
  if new.raw_user_meta_data ->> 'community_signup' is distinct from 'true' then return new; end if;
  if new.raw_user_meta_data ->> 'privacy_version' is distinct from '2026-10-09' then
    raise exception 'COMMUNITY_PRIVACY_REQUIRED' using errcode = '22023';
  end if;
  v_username := lower(btrim(new.raw_user_meta_data ->> 'username'));
  v_display := btrim(new.raw_user_meta_data ->> 'display_name');
  if not private.community_username_valid(v_username) then raise exception 'COMMUNITY_USERNAME_INVALID' using errcode = '22023'; end if;
  if v_display is null or char_length(v_display) not between 1 and 40 then raise exception 'COMMUNITY_NAME_INVALID' using errcode = '22023'; end if;
  insert into public.community_profiles(user_id, username, display_name) values(new.id, v_username, v_display);
  v_referrer := nullif(lower(btrim(new.raw_user_meta_data ->> 'referrer_username')), '');
  begin v_visitor := nullif(new.raw_user_meta_data ->> 'visitor_id','')::uuid;
  exception when invalid_text_representation then v_visitor := null; end;
  if v_referrer is not null then
    if v_referrer = v_username then raise exception 'COMMUNITY_SELF_REFERRAL' using errcode = '22023'; end if;
    select p.user_id into v_owner from public.community_profiles p join auth.users u on u.id = p.user_id
    where p.username = v_referrer and u.email_confirmed_at is not null;
    if v_owner is null then raise exception 'COMMUNITY_REFERRER_INVALID' using errcode = '22023'; end if;
    -- Matching explicit IDs retain the campaign; another owner overrides it.
    select t.link_id into v_link from private.community_first_touch t
    where t.visitor_id = v_visitor and t.owner_id = v_owner and t.touched_at >= now() - interval '30 days';
    v_method := 'manual';
  else
    select t.owner_id, t.link_id into v_owner, v_link from private.community_first_touch t
      join auth.users u on u.id = t.owner_id and u.email_confirmed_at is not null
      where t.visitor_id = v_visitor and t.touched_at >= now() - interval '30 days';
    v_method := 'visit';
  end if;
  if v_owner = new.id then raise exception 'COMMUNITY_SELF_REFERRAL' using errcode = '22023'; end if;
  if v_owner is not null then
    insert into private.community_referrals(signup_user_id, referrer_id, link_id, attribution_method)
    values(new.id, v_owner, v_link, v_method);
  end if;
  return new;
end $$;
revoke all on function private.community_signup_profile() from public, anon, authenticated;
drop trigger if exists community_signup_profile on auth.users;
create trigger community_signup_profile after insert on auth.users for each row execute function private.community_signup_profile();

create or replace function public.community_complete_profile(p_username text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := private.community_require_verified(); v_profile public.community_profiles; begin
  select * into v_profile from public.community_profiles where user_id = v_user;
  if found then return to_jsonb(v_profile); end if;
  if not private.community_username_valid(p_username) then raise exception 'COMMUNITY_USERNAME_INVALID' using errcode = '22023'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40 then raise exception 'COMMUNITY_NAME_INVALID' using errcode = '22023'; end if;
  insert into public.community_profiles(user_id, username, display_name)
  values(v_user, lower(btrim(p_username)), btrim(p_display_name)) returning * into v_profile;
  -- Profile completion never attributes an existing account to a referrer.
  return to_jsonb(v_profile);
end $$;
revoke all on function public.community_complete_profile(text,text) from public;
grant execute on function public.community_complete_profile(text,text) to authenticated;

create or replace function public.community_create_link(p_source text, p_medium text, p_campaign text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := private.community_require_verified(); v_link private.community_links; begin
  if not exists(select 1 from public.community_profiles where user_id = v_user) then raise exception 'COMMUNITY_PROFILE_REQUIRED' using errcode = '22023'; end if;
  if p_source is null or p_medium is null or p_campaign is null
    or char_length(btrim(p_source)) not between 1 and 64
    or char_length(btrim(p_medium)) not between 1 and 64
    or char_length(btrim(p_campaign)) not between 1 and 100 then
    raise exception 'COMMUNITY_LINK_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 1));
  if (select count(*) from private.community_links where owner_id = v_user) >= 100 then raise exception 'COMMUNITY_LINK_LIMIT' using errcode = '22023'; end if;
  if (select count(*) from private.community_links where owner_id = v_user and created_at > now() - interval '1 hour') >= 10 then raise exception 'COMMUNITY_RATE_LIMIT' using errcode = '22023'; end if;
  insert into private.community_links(owner_id, slug, source, medium, campaign)
  values(v_user, replace(gen_random_uuid()::text, '-', ''), btrim(p_source), btrim(p_medium), btrim(p_campaign)) returning * into v_link;
  return jsonb_build_object('id',v_link.id,'slug',v_link.slug,'source',v_link.source,'medium',v_link.medium,'campaign',v_link.campaign,'created_at',v_link.created_at);
end $$;
revoke all on function public.community_create_link(text,text,text) from public;
grant execute on function public.community_create_link(text,text,text) to authenticated;

create or replace function public.community_track_visit(p_referrer text, p_link_slug text, p_visitor_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$ declare v_owner uuid; v_link uuid; begin
  if p_visitor_id is null or char_length(coalesce(p_referrer,'')) > 24 or char_length(coalesce(p_link_slug,'')) > 64 then return false; end if;
  select p.user_id into v_owner from public.community_profiles p join auth.users u on u.id = p.user_id
  where p.username = lower(btrim(p_referrer)) and u.email_confirmed_at is not null;
  if v_owner is null or v_owner = auth.uid() then return false; end if;
  if nullif(btrim(p_link_slug),'') is not null then
    select id into v_link from private.community_links where slug = p_link_slug and owner_id = v_owner;
    if v_link is null then return false; end if;
  end if;
  insert into private.community_visits(visitor_id, owner_id, link_id) values(p_visitor_id,v_owner,v_link) on conflict do nothing;
  insert into private.community_first_touch(visitor_id, owner_id, link_id) values(p_visitor_id,v_owner,v_link)
  on conflict(visitor_id) do update set owner_id = excluded.owner_id, link_id = excluded.link_id, touched_at = now()
  where private.community_first_touch.touched_at < now() - interval '30 days';
  return true;
end $$;
revoke all on function public.community_track_visit(text,text,uuid) from public;
grant execute on function public.community_track_visit(text,text,uuid) to anon, authenticated;

create or replace function public.community_my_referrals()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare v_user uuid := private.community_require_verified(); begin
  return jsonb_build_object(
    'visitors',(select count(distinct visitor_id) from private.community_visits where owner_id = v_user),
    'signups',(select count(*) from private.community_referrals r join auth.users u on u.id = r.signup_user_id where r.referrer_id = v_user and u.email_confirmed_at is not null),
    'manual_signups',(select count(*) from private.community_referrals r join auth.users u on u.id = r.signup_user_id where r.referrer_id = v_user and r.attribution_method = 'manual' and u.email_confirmed_at is not null),
    'links',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'slug',l.slug,'source',l.source,'medium',l.medium,'campaign',l.campaign,'created_at',l.created_at,
      'visitors',(select count(distinct visitor_id) from private.community_visits v where v.link_id = l.id),
      'signups',(select count(*) from private.community_referrals r join auth.users u on u.id = r.signup_user_id where r.link_id = l.id and u.email_confirmed_at is not null)
    ) order by l.created_at desc) from private.community_links l where l.owner_id = v_user),'[]'::jsonb)
  );
end $$;
revoke all on function public.community_my_referrals() from public;
grant execute on function public.community_my_referrals() to authenticated;

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.community_profiles(user_id) on delete cascade,
  title text not null check(char_length(btrim(title)) between 1 and 120),
  body text not null check(char_length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists community_posts_published_idx on public.community_posts(created_at desc) where deleted_at is null;
alter table public.community_posts enable row level security;
revoke all on public.community_posts from public, anon, authenticated;

create or replace function public.community_list_posts(p_page int default 1, p_query text default '')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare v_page int := least(greatest(coalesce(p_page,1),1),10000); v_query text := left(btrim(coalesce(p_query,'')),100); begin
  return jsonb_build_object('page',v_page,
    'total',(select count(*) from public.community_posts p where p.deleted_at is null and (v_query = '' or strpos(lower(p.title || ' ' || p.body),lower(v_query)) > 0)),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc) from (
      select p.id,p.title,left(p.body,180) as excerpt,u.username as author_username,u.display_name as author_name,p.created_at,p.updated_at
      from public.community_posts p join public.community_profiles u on u.user_id = p.author_id
      where p.deleted_at is null and (v_query = '' or strpos(lower(p.title || ' ' || p.body),lower(v_query)) > 0)
      order by p.created_at desc,p.id desc limit 20 offset (v_page - 1) * 20
    ) x),'[]'::jsonb)
  );
end $$;
revoke all on function public.community_list_posts(int,text) from public;
grant execute on function public.community_list_posts(int,text) to anon, authenticated;

create or replace function public.community_get_post(p_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('id',p.id,'author_id',p.author_id,'title',p.title,'body',p.body,'author_username',u.username,'author_name',u.display_name,'created_at',p.created_at,'updated_at',p.updated_at)
from public.community_posts p join public.community_profiles u on u.user_id = p.author_id where p.id = p_id and p.deleted_at is null $$;
revoke all on function public.community_get_post(uuid) from public;
grant execute on function public.community_get_post(uuid) to anon, authenticated;

create or replace function private.community_post_rate(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 2));
  if (select count(*) from private.community_write_events where user_id = p_user and created_at > now() - interval '1 minute') >= 10
    or (select count(*) from private.community_write_events where user_id = p_user and created_at > now() - interval '1 day') >= 100 then
    raise exception 'COMMUNITY_RATE_LIMIT' using errcode = '22023';
  end if;
  insert into private.community_write_events(user_id) values(p_user);
end $$;
revoke all on function private.community_post_rate(uuid) from public, anon, authenticated;

create or replace function public.community_save_post(p_title text, p_body text, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := private.community_require_verified(); v_id uuid; begin
  if not exists(select 1 from public.community_profiles where user_id = v_user) then raise exception 'COMMUNITY_PROFILE_REQUIRED' using errcode = '22023'; end if;
  if p_title is null or p_body is null or char_length(btrim(p_title)) not between 1 and 120 or char_length(btrim(p_body)) not between 1 and 10000 then
    raise exception 'COMMUNITY_POST_INVALID' using errcode = '22023';
  end if;
  perform private.community_post_rate(v_user);
  if p_id is null then
    insert into public.community_posts(author_id,title,body) values(v_user,btrim(p_title),btrim(p_body)) returning id into v_id;
  else
    update public.community_posts set title = btrim(p_title), body = btrim(p_body), updated_at = now()
    where id = p_id and deleted_at is null and (author_id = v_user or public.is_site_admin()) returning id into v_id;
    if v_id is null then raise exception 'COMMUNITY_POST_FORBIDDEN' using errcode = '42501'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.community_save_post(text,text,uuid) from public;
grant execute on function public.community_save_post(text,text,uuid) to authenticated;

create or replace function public.community_delete_post(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := private.community_require_verified(); v_id uuid; begin
  perform private.community_post_rate(v_user);
  update public.community_posts set deleted_at = now(), updated_at = now()
  where id = p_id and deleted_at is null and (author_id = v_user or public.is_site_admin()) returning id into v_id;
  if v_id is null then raise exception 'COMMUNITY_POST_FORBIDDEN' using errcode = '42501'; end if;
  return true;
end $$;
revoke all on function public.community_delete_post(uuid) from public;
grant execute on function public.community_delete_post(uuid) to authenticated;

create table if not exists private.community_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table private.community_deletion_requests enable row level security;
revoke all on private.community_deletion_requests from public, anon, authenticated;

create or replace function public.community_request_deletion()
returns boolean language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := private.community_require_verified(); begin
  insert into private.community_deletion_requests(user_id) values(v_user) on conflict do nothing;
  return true;
end $$;
revoke all on function public.community_request_deletion() from public;
grant execute on function public.community_request_deletion() to authenticated;

create or replace function public.community_admin_deletion_requests()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin
  if not public.is_site_admin() then raise exception 'COMMUNITY_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.requested_at) from private.community_deletion_requests r), '[]'::jsonb);
end $$;
revoke all on function public.community_admin_deletion_requests() from public;
grant execute on function public.community_admin_deletion_requests() to authenticated;

notify pgrst, 'reload schema';
commit;
