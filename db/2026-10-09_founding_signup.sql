-- Additive follow-up to 2026-10-09_community.sql. Apply this file last.
-- Founding consent is the registration event. Auth metadata carries a single
-- opaque draft token, never the consent form, signature, or password.
begin;

create table if not exists private.community_founding_signup_drafts (
  token uuid primary key default gen_random_uuid(),
  email text,
  username text,
  display_name text,
  founder jsonb,
  referrer_username text,
  visitor_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  completed_at timestamptz,
  check(completed_at is null or (email is null and username is null and display_name is null and founder is null and referrer_username is null and visitor_id is null))
);
create index if not exists community_founding_drafts_expiry_idx on private.community_founding_signup_drafts(expires_at) where completed_at is null;
create table if not exists private.community_founding_signup_rates (
  email_key bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists community_founding_rates_idx on private.community_founding_signup_rates(email_key,created_at);
alter table private.community_founding_signup_drafts enable row level security;
alter table private.community_founding_signup_rates enable row level security;
revoke all on private.community_founding_signup_drafts,private.community_founding_signup_rates from public,anon,authenticated;

-- No direct client INSERT may bypass consent validation or manufacture a link
-- to an Auth account. Definer RPCs/trigger below explicitly assign the owner.
revoke insert on public.founding_members from public,anon,authenticated;
drop policy if exists community_public_insert on public.founding_members;
drop policy if exists community_founder_rpc_only on public.founding_members;
create policy community_founder_rpc_only on public.founding_members as restrictive for insert to anon,authenticated with check(false);
do $$ begin
  if exists(select 1 from public.founding_members where submitted_by is not null group by submitted_by having count(*) > 1) then
    raise exception 'Duplicate linked founding submissions need operator review before migration';
  end if;
end $$;
create unique index if not exists community_founder_one_account_idx on public.founding_members(submitted_by) where submitted_by is not null;
drop trigger if exists community_legacy_owner on public.founding_members;
create trigger community_legacy_owner before update on public.founding_members
for each row execute function private.community_legacy_owner();

create or replace function private.community_validate_founder(p_founder jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_birth date; v_signature text; v_png bytea; v_mobile text; v_home text; v_field text; v_width bigint; v_height bigint;
begin
  if p_founder is null or jsonb_typeof(p_founder) <> 'object' or octet_length(p_founder::text) > 420000
    or p_founder -> 'privacy_agreed' is distinct from 'true'::jsonb then
    raise exception 'COMMUNITY_FOUNDER_INVALID' using errcode = '22023';
  end if;
  foreach v_field in array array['name','address','birth_date','gender','occupation','phone_mobile','signature_data','agreed_at'] loop
    if jsonb_typeof(p_founder -> v_field) is distinct from 'string' then raise exception 'COMMUNITY_FOUNDER_INVALID' using errcode = '22023'; end if;
  end loop;
  if p_founder ? 'phone_home' and jsonb_typeof(p_founder -> 'phone_home') not in ('string','null') then
    raise exception 'COMMUNITY_FOUNDER_INVALID' using errcode = '22023';
  end if;
  if coalesce(char_length(btrim(p_founder ->> 'name')),0) not between 2 and 80
    or coalesce(char_length(btrim(p_founder ->> 'address')),0) not between 5 and 500
    or coalesce(char_length(btrim(p_founder ->> 'occupation')),0) not between 1 and 120
    or coalesce(p_founder ->> 'gender','') not in ('남','여') then
    raise exception 'COMMUNITY_FOUNDER_INVALID' using errcode = '22023';
  end if;
  if coalesce(p_founder ->> 'birth_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'COMMUNITY_FOUNDER_BIRTH_INVALID' using errcode = '22023';
  end if;
  begin v_birth := (p_founder ->> 'birth_date')::date;
  exception when others then raise exception 'COMMUNITY_FOUNDER_BIRTH_INVALID' using errcode = '22023'; end;
  if v_birth > (v_today - interval '18 years')::date then
    raise exception 'COMMUNITY_FOUNDER_AGE_REQUIRED' using errcode = '22023';
  end if;
  v_mobile := btrim(p_founder ->> 'phone_mobile');
  v_home := nullif(btrim(p_founder ->> 'phone_home'),'');
  if v_mobile is null or char_length(v_mobile) > 32
    or v_mobile !~ '^[0-9+()[:space:]-]+$'
    or regexp_replace(v_mobile,'[^0-9]','','g') !~ '^01[016789][0-9]{7,8}$'
    or (v_home is not null and (char_length(v_home) > 32 or v_home !~ '^[0-9+()[:space:]-]{6,32}$')) then
    raise exception 'COMMUNITY_FOUNDER_PHONE_INVALID' using errcode = '22023';
  end if;
  if p_founder ? 'public_consent' and jsonb_typeof(p_founder -> 'public_consent') <> 'boolean' then
    raise exception 'COMMUNITY_FOUNDER_INVALID' using errcode = '22023';
  end if;
  if coalesce(p_founder ->> 'agreed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'COMMUNITY_FOUNDER_DATE_INVALID' using errcode = '22023';
  end if;
  begin
    if abs((p_founder ->> 'agreed_at')::date - v_today) > 1 then
      raise exception 'COMMUNITY_FOUNDER_DATE_INVALID' using errcode = '22023';
    end if;
  exception when others then raise exception 'COMMUNITY_FOUNDER_DATE_INVALID' using errcode = '22023'; end;
  v_signature := p_founder ->> 'signature_data';
  if v_signature is null or char_length(v_signature) > 409622
    or v_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'COMMUNITY_FOUNDER_SIGNATURE_INVALID' using errcode = '22023';
  end if;
  begin v_png := decode(substr(v_signature,23),'base64');
  exception when others then raise exception 'COMMUNITY_FOUNDER_SIGNATURE_INVALID' using errcode = '22023'; end;
  if octet_length(v_png) not between 33 and 307200
    or substring(v_png from 1 for 8) <> decode('89504e470d0a1a0a','hex')
    or substring(v_png from 9 for 8) <> decode('0000000d49484452','hex')
    or substring(v_png from octet_length(v_png) - 11 for 12) <> decode('0000000049454e44ae426082','hex') then
    raise exception 'COMMUNITY_FOUNDER_SIGNATURE_INVALID' using errcode = '22023';
  end if;
  v_width := get_byte(v_png,16)::bigint * 16777216 + get_byte(v_png,17) * 65536 + get_byte(v_png,18) * 256 + get_byte(v_png,19);
  v_height := get_byte(v_png,20)::bigint * 16777216 + get_byte(v_png,21) * 65536 + get_byte(v_png,22) * 256 + get_byte(v_png,23);
  if v_width not between 1 and 4096 or v_height not between 1 and 4096 then
    raise exception 'COMMUNITY_FOUNDER_SIGNATURE_INVALID' using errcode = '22023';
  end if;
  -- Whitelist fields; discard caller-supplied ids, ownership, status and extras.
  return jsonb_build_object('name',btrim(p_founder ->> 'name'),'address',btrim(p_founder ->> 'address'),
    'birth_date',v_birth,'gender',p_founder ->> 'gender','occupation',btrim(p_founder ->> 'occupation'),
    'phone_home',v_home,'phone_mobile',v_mobile,'signature_data',v_signature,'agreed_at',v_today,
    'privacy_agreed',true,'public_consent',coalesce((p_founder ->> 'public_consent')::boolean,false));
end $$;
revoke all on function private.community_validate_founder(jsonb) from public,anon,authenticated;

create or replace function private.community_insert_founder(p_user uuid,p_founder jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$ declare v_id uuid; begin
  insert into public.founding_members(name,address,birth_date,gender,occupation,phone_home,phone_mobile,
    signature_data,agreed_at,privacy_agreed,public_consent,submitted_by)
  values(p_founder ->> 'name',p_founder ->> 'address',(p_founder ->> 'birth_date')::date,p_founder ->> 'gender',
    p_founder ->> 'occupation',p_founder ->> 'phone_home',p_founder ->> 'phone_mobile',p_founder ->> 'signature_data',
    (p_founder ->> 'agreed_at')::date,true,(p_founder ->> 'public_consent')::boolean,p_user) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.community_insert_founder(uuid,jsonb) from public,anon,authenticated;

create or replace function public.community_prepare_founding_signup(
  p_email text,p_username text,p_display_name text,p_founder jsonb,
  p_referrer_username text default null,p_visitor_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare v_email text := lower(btrim(p_email)); v_username text := lower(btrim(p_username));
  v_referrer text := nullif(lower(btrim(p_referrer_username)),''); v_founder jsonb; v_token uuid;
begin
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'COMMUNITY_EMAIL_INVALID' using errcode = '22023';
  end if;
  if not public.community_username_available(v_username) then raise exception 'COMMUNITY_USERNAME_UNAVAILABLE' using errcode = '22023'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40 then raise exception 'COMMUNITY_NAME_INVALID' using errcode = '22023'; end if;
  if v_referrer = v_username then raise exception 'COMMUNITY_SELF_REFERRAL' using errcode = '22023'; end if;
  if v_referrer is not null and not public.community_referrer_exists(v_referrer) then raise exception 'COMMUNITY_REFERRER_INVALID' using errcode = '22023'; end if;
  v_founder := private.community_validate_founder(p_founder);
  -- Serialize the small bounded queue so parallel requests cannot evade caps.
  perform pg_advisory_xact_lock(hashtextextended('community-founding-draft-queue',9));
  delete from private.community_founding_signup_drafts where (completed_at is null and expires_at <= now()) or completed_at < now() - interval '30 days';
  delete from private.community_founding_signup_rates where created_at <= now() - interval '15 minutes';
  if (select count(*) from private.community_founding_signup_rates where email_key = hashtextextended(v_email,19)) >= 10
    or (select count(*) from private.community_founding_signup_rates) >= 10000
    or (select count(*) from private.community_founding_signup_drafts where completed_at is null) >= 1000 then
    raise exception 'COMMUNITY_RATE_LIMIT' using errcode = '22023';
  end if;
  insert into private.community_founding_signup_rates(email_key) values(hashtextextended(v_email,19));
  insert into private.community_founding_signup_drafts(email,username,display_name,founder,referrer_username,visitor_id)
  values(v_email,v_username,btrim(p_display_name),v_founder,v_referrer,p_visitor_id) returning token into v_token;
  return jsonb_build_object('token',replace(v_token::text,'-',''));
end $$;
revoke all on function public.community_prepare_founding_signup(text,text,text,jsonb,text,uuid) from public;
grant execute on function public.community_prepare_founding_signup(text,text,text,jsonb,text,uuid) to anon,authenticated;

create or replace function private.community_signup_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$ declare v_token uuid; v_draft private.community_founding_signup_drafts;
  v_owner uuid; v_link uuid; v_method text;
begin
  if new.raw_user_meta_data ->> 'community_signup' is distinct from 'true' then return new; end if;
  if new.raw_user_meta_data ->> 'privacy_version' is distinct from '2026-10-09' then
    raise exception 'COMMUNITY_PRIVACY_REQUIRED' using errcode = '22023';
  end if;
  begin v_token := nullif(new.raw_user_meta_data ->> 'founding_signup_token','')::uuid;
  exception when invalid_text_representation then v_token := null; end;
  select * into v_draft from private.community_founding_signup_drafts
  where token = v_token and completed_at is null and expires_at > now() for update;
  if not found or lower(btrim(new.email)) is distinct from v_draft.email then
    raise exception 'COMMUNITY_FOUNDING_TOKEN_INVALID' using errcode = '22023';
  end if;
  insert into public.community_profiles(user_id,username,display_name) values(new.id,v_draft.username,v_draft.display_name);
  perform private.community_insert_founder(new.id,v_draft.founder);
  if v_draft.referrer_username is not null then
    if v_draft.referrer_username = v_draft.username then raise exception 'COMMUNITY_SELF_REFERRAL' using errcode = '22023'; end if;
    select p.user_id into v_owner from public.community_profiles p join auth.users u on u.id = p.user_id
      where p.username = v_draft.referrer_username and u.email_confirmed_at is not null;
    if v_owner is null then raise exception 'COMMUNITY_REFERRER_INVALID' using errcode = '22023'; end if;
    select t.link_id into v_link from private.community_first_touch t where t.visitor_id = v_draft.visitor_id
      and t.owner_id = v_owner and t.touched_at >= now() - interval '30 days';
    v_method := 'manual';
  else
    select t.owner_id,t.link_id into v_owner,v_link from private.community_first_touch t
      join auth.users u on u.id = t.owner_id and u.email_confirmed_at is not null
      where t.visitor_id = v_draft.visitor_id and t.touched_at >= now() - interval '30 days';
    v_method := 'visit';
  end if;
  if v_owner = new.id then raise exception 'COMMUNITY_SELF_REFERRAL' using errcode = '22023'; end if;
  if v_owner is not null then
    insert into private.community_referrals(signup_user_id,referrer_id,link_id,attribution_method)
    values(new.id,v_owner,v_link,v_method);
  end if;
  update private.community_founding_signup_drafts set email = null,username = null,display_name = null,
    founder = null,referrer_username = null,visitor_id = null,completed_at = now() where token = v_token;
  return new;
end $$;
revoke all on function private.community_signup_profile() from public,anon,authenticated;
-- Existing Auth trigger points to this replaced function; do not add a second.

create or replace function private.community_require_verified()
returns uuid language plpgsql stable security definer set search_path = ''
as $$ declare v_user uuid := auth.uid(); begin
  if v_user is null or not exists(select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'COMMUNITY_VERIFIED_REQUIRED' using errcode = '42501';
  end if;
  if not public.is_site_admin() and not exists(select 1 from public.founding_members where submitted_by = v_user and privacy_agreed = true) then
    raise exception 'COMMUNITY_FOUNDING_REQUIRED' using errcode = '42501';
  end if;
  return v_user;
end $$;
revoke all on function private.community_require_verified() from public,anon,authenticated;

create or replace function public.community_complete_profile(p_username text,p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := private.community_require_verified(); v_profile public.community_profiles; begin
  select * into v_profile from public.community_profiles where user_id = v_user;
  if found then return to_jsonb(v_profile); end if;
  if not private.community_username_valid(p_username) then raise exception 'COMMUNITY_USERNAME_INVALID' using errcode = '22023'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40 then raise exception 'COMMUNITY_NAME_INVALID' using errcode = '22023'; end if;
  insert into public.community_profiles(user_id,username,display_name) values(v_user,lower(btrim(p_username)),btrim(p_display_name)) returning * into v_profile;
  return to_jsonb(v_profile);
end $$;
revoke all on function public.community_complete_profile(text,text) from public;
grant execute on function public.community_complete_profile(text,text) to authenticated;

create or replace function public.community_submit_founding_consent(p_founder jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := auth.uid(); v_id uuid; v_founder jsonb; begin
  if v_user is null or not exists(select 1 from auth.users where id = v_user and email is not null and btrim(email) <> '') then
    raise exception 'COMMUNITY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,29));
  select id into v_id from public.founding_members where submitted_by = v_user and privacy_agreed = true order by created_at,id limit 1;
  if found then return jsonb_build_object('id',v_id,'already_registered',true); end if;
  v_founder := private.community_validate_founder(p_founder);
  v_id := private.community_insert_founder(v_user,v_founder);
  return jsonb_build_object('id',v_id,'already_registered',false);
end $$;
revoke all on function public.community_submit_founding_consent(jsonb) from public;
grant execute on function public.community_submit_founding_consent(jsonb) to authenticated;

create or replace function public.community_founding_signup_status(p_token text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare v_token uuid; begin
  begin v_token := nullif(p_token,'')::uuid;
  exception when invalid_text_representation then return jsonb_build_object('completed',false); end;
  return jsonb_build_object('completed',exists(select 1 from private.community_founding_signup_drafts where token = v_token and completed_at is not null));
end $$;
revoke all on function public.community_founding_signup_status(text) from public;
grant execute on function public.community_founding_signup_status(text) to anon,authenticated;

notify pgrst, 'reload schema';
commit;
