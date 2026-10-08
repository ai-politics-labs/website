\set ON_ERROR_STOP on
\set QUIET on
-- Real PostgreSQL fixtures emulate the project's public-role grants and old
-- permissive policies. The runner starts a fresh local cluster, never Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
 id uuid primary key, email text, email_confirmed_at timestamptz,
 raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema public,storage to anon,authenticated;
grant all on storage.objects to anon,authenticated;
\ir ../supabase/founding_members.sql
\ir ../db/2026-06-06_revote_schema.sql
\ir ../db/2026-06-07_revote_legal_delegation.sql
create policy "Allow authenticated full access" on public.founding_members for all to authenticated using(true) with check(true);
create policy "Allow anonymous insert" on public.founding_members for insert to anon with check(privacy_agreed = true);
-- Reproduce the project's broad defaults so privilege bypasses are tested.
grant all on all tables in schema public to anon,authenticated;
grant usage on all sequences in schema public to anon,authenticated;
create table public.instagram_untouched(id int);
alter table public.instagram_untouched enable row level security;
create policy keep_instagram_policy on public.instagram_untouched for select to authenticated using(true);
insert into auth.users(id,email,email_confirmed_at) values
 ('bfc7ee84-daa3-4519-9316-cee48712f193','operator@example.invalid',now());
insert into public.founding_members(name,address,birth_date,gender,occupation,phone_mobile,signature_data,agreed_at,privacy_agreed)
values('Private legacy person','private address','1990-01-01','other','private','private-phone','signature',current_date,true);
insert into storage.objects(bucket_id,name) values('revote-evidence','private-evidence');
insert into public.revote_signatures(id,name,phone,phone_hash,region_sido)
values('20000000-0000-0000-0000-000000000001','Legacy signer','private-phone','legacy-hash','서울');
insert into public.revote_reports(id,reporter_name,phone,phone_hash,incident_date,sido,sigungu,polling_station_name,was_able_to_vote,gave_up_voting,description)
values('20000000-0000-0000-0000-000000000002','Legacy reporter','private-phone','report-hash',current_date,'서울','구','장소',true,false,'Private report');
insert into public.revote_report_files(report_id,storage_path) values('20000000-0000-0000-0000-000000000002','private-evidence');
insert into public.revote_consent_logs(subject_type,subject_id,consent_type,consent_version,consented)
values('SIGNATURE','20000000-0000-0000-0000-000000000001','PRIVACY','test',true);
insert into public.revote_referrals(referral_code,visitor_id) values('private-code','private-visitor');
insert into public.revote_audit_logs(action,admin_email) values('VIEW','private-admin@example.invalid');
insert into public.revote_delete_requests(name,phone,request_type) values('Private request','private-phone','ALL');
insert into public.revote_legal_delegations(name,address,phone,signature_name) values('Private delegation','Private address','private-phone','Sensitive signature');
\ir ../db/2026-10-09_community.sql
-- Reapplication must preserve data and compile cleanly.
\ir ../db/2026-10-09_community.sql

begin;
create function pg_temp.assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text, label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
 begin execute statement;
 exception when others then
  if sqlstate <> expected_state then raise exception 'WRONG ERROR [%] expected %, got %: %', label, expected_state,sqlstate,sqlerrm; end if;
  rejected := true;
 end;
 if not rejected then raise exception 'EXPECTED ERROR MISSING: %',label; end if;
end $$;

select pg_temp.assert((select count(*) = 1 from private.site_admins),'only explicitly verified operator seeded');
select pg_temp.assert(exists(select 1 from pg_policies where tablename = 'instagram_untouched' and policyname = 'keep_instagram_policy'),'unrelated instagram policy untouched');
select pg_temp.assert(not has_table_privilege('authenticated','public.founding_members','TRUNCATE'),'truncate bypass revoked');
select pg_temp.assert(not has_table_privilege('anon','public.revote_audit_logs','INSERT'),'anonymous audit grant revoked');

-- Signup trigger validates atomically and snapshots immutable referral inputs.
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','alice@example.invalid',now(),'{"community_signup":true,"username":"alice","display_name":"Alice","privacy_version":"2026-10-09"}'),
 ('00000000-0000-0000-0000-000000000002','bob@example.invalid',now(),'{"community_signup":true,"username":"bob","display_name":"Bob","privacy_version":"2026-10-09"}'),
 ('00000000-0000-0000-0000-000000000003','unverified@example.invalid',null,'{"community_signup":true,"username":"unverified","display_name":"Unverified","privacy_version":"2026-10-09"}');
select pg_temp.expect_error($q$insert into auth.users values('00000000-0000-0000-0000-000000000091','invalid@example.invalid',now(),'{"community_signup":true,"username":"ADMIN","display_name":"Invalid","privacy_version":"2026-10-09"}')$q$,'22023','reserved username');
select pg_temp.expect_error($q$insert into auth.users values('00000000-0000-0000-0000-000000000092','duplicate@example.invalid',now(),'{"community_signup":true,"username":"Alice","display_name":"Duplicate","privacy_version":"2026-10-09"}')$q$,'23505','case-insensitive duplicate');
select pg_temp.expect_error($q$insert into auth.users values('00000000-0000-0000-0000-000000000093','badref@example.invalid',now(),'{"community_signup":true,"username":"badref","display_name":"Bad","privacy_version":"2026-10-09","referrer_username":"missing"}')$q$,'22023','invalid explicit referrer rejects signup');
select pg_temp.expect_error($q$insert into auth.users values('00000000-0000-0000-0000-000000000094','self@example.invalid',now(),'{"community_signup":true,"username":"myself","display_name":"Self","privacy_version":"2026-10-09","referrer_username":"myself"}')$q$,'22023','self referral rejects signup');
select pg_temp.expect_error($q$insert into auth.users values('00000000-0000-0000-0000-000000000095','noprivacy@example.invalid',now(),'{"community_signup":true,"username":"noprivacy","display_name":"No consent"}')$q$,'22023','privacy version required');
select pg_temp.assert(not exists(select 1 from auth.users where id::text like '%00000000009%'),'failed signup account creation rolls back');

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert(public.community_username_available('available'),'available username');
select pg_temp.assert(not public.community_username_available('ALICE'),'normalized unavailable username');
select pg_temp.assert(not public.community_username_available('a!'),'invalid username unavailable');
select pg_temp.assert(public.community_referrer_exists('Alice'),'verified referrer exists');
select pg_temp.assert(not public.community_referrer_exists('unverified'),'unverified referrer unavailable');
select pg_temp.assert((select count(*) = 0 from public.founding_members),'anonymous cannot read legacy PII');
select pg_temp.assert((select count(*) = 0 from storage.objects),'anonymous evidence inaccessible');
select pg_temp.expect_error('select * from public.community_profiles','42501','anonymous profiles unavailable');
select pg_temp.expect_error('select * from private.site_admins','42501','admin allowlist private');
select pg_temp.expect_error('select public.community_save_post(''test'',''body'')','42501','anonymous posting forbidden');
select pg_temp.expect_error('select public.community_my_referrals()','42501','anonymous stats forbidden');
select pg_temp.expect_error('insert into public.founding_members(name,address,birth_date,gender,occupation,phone_mobile,signature_data,agreed_at,privacy_agreed) values(''No consent'',''address'',''1990-01-01'',''other'',''test'',''phone'',''sig'',current_date,false)','42501','anonymous founder privacy consent required');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.expect_error('select public.community_save_post(''test'',''body'')','42501','unverified posting forbidden');
select pg_temp.expect_error('select public.community_create_link(''test'',''share'',''join'')','42501','unverified links forbidden');
select pg_temp.expect_error('select public.community_my_referrals()','42501','unverified stats forbidden');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert(not public.is_site_admin(),'ordinary member is not admin');
select pg_temp.assert((select count(*) = 1 from public.community_profiles),'only own profile visible');
select pg_temp.assert((select count(*) = 0 from public.founding_members),'member cannot read legacy PII');
do $$ declare t text; visible bigint; begin
 foreach t in array array['revote_signatures','revote_reports','revote_report_files','revote_consent_logs','revote_referrals','revote_audit_logs','revote_delete_requests','revote_legal_delegations'] loop
   execute format('select count(*) from public.%I',t) into visible;
   perform pg_temp.assert(visible = 0,'ordinary member cannot read ' || t);
   perform pg_temp.assert(not has_table_privilege('authenticated','public.' || t,'TRUNCATE'),'no truncate on ' || t);
 end loop;
end $$;
select pg_temp.assert((select count(*) = 0 from storage.objects),'member cannot read evidence');
select pg_temp.expect_error('insert into private.site_admins(user_id) values(auth.uid())','42501','cannot elevate self');
select pg_temp.expect_error('update public.community_profiles set username = ''elevated''','42501','profile immutable');
select pg_temp.expect_error('truncate public.founding_members','42501','cannot bypass RLS with truncate');
select pg_temp.expect_error('insert into public.revote_audit_logs(action) values(''forged'')','42501','ordinary audit insertion rejected');
with inserted as (
 insert into public.founding_members(name,address,birth_date,gender,occupation,phone_mobile,signature_data,agreed_at,privacy_agreed,submitted_by)
 values('Own submission','own address','1990-01-01','other','test','own phone','sig',current_date,true,'00000000-0000-0000-0000-000000000002') returning submitted_by
) select pg_temp.assert((select submitted_by = auth.uid() from inserted),'owner trigger prevents forging and INSERT RETURNING works');
select pg_temp.assert((select count(*) = 1 from public.founding_members),'member reads only own submission');
with inserted as (
 insert into public.revote_legal_delegations(name,address,phone,signature_name)
 values('Own delegation','Own address','own-phone','Own signature') returning id,submitted_by
) select pg_temp.assert((select submitted_by = auth.uid() from inserted),'signed-in delegation INSERT RETURNING preserved');
select pg_temp.assert((select count(*) = 1 from public.revote_legal_delegations),'only own delegation visible');
with inserted as (
 insert into public.revote_signatures(name,phone,phone_hash,region_sido) values('Own signer','phone','own-signer-hash','서울') returning id,referral_code,submitted_by
) select pg_temp.assert((select submitted_by = auth.uid() and referral_code is not null from inserted),'signed-in signature INSERT RETURNING preserved');
with inserted as (
 insert into public.revote_reports(reporter_name,phone,phone_hash,incident_date,sido,sigungu,polling_station_name,was_able_to_vote,gave_up_voting,description)
 values('Own reporter','phone','own-report-hash',current_date,'서울','구','장소',true,false,'Own report') returning id,receipt_no,submitted_by
) select pg_temp.assert((select submitted_by = auth.uid() and receipt_no is not null from inserted),'signed-in report INSERT RETURNING preserved');
with changed as (update public.founding_members set name = 'tamper' returning id)
 select pg_temp.assert((select count(*) = 0 from changed),'ordinary legacy updates denied');
with removed as (delete from public.founding_members returning id)
 select pg_temp.assert((select count(*) = 0 from removed),'ordinary legacy deletes denied');

select public.community_create_link('chat','share','join') as alice_link \gset
select (:'alice_link'::jsonb ->> 'slug') as alice_slug \gset
select public.community_save_post('A plain title','<script>plain text</script>') as alice_post \gset
select pg_temp.assert(public.community_track_visit('alice',:'alice_slug','10000000-0000-0000-0000-000000000001') = false,'self-visit skipped');
select pg_temp.assert(public.community_request_deletion(),'request deletion');
select pg_temp.assert(public.community_request_deletion(),'deletion request idempotent');
select pg_temp.expect_error('select public.community_admin_deletion_requests()','42501','member cannot list requests');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select public.community_create_link('social','share','join') as bob_link \gset
select (:'bob_link'::jsonb ->> 'slug') as bob_slug \gset
select pg_temp.assert((public.community_my_referrals() ->> 'visitors')::int = 0,'other member metrics isolated');
select pg_temp.expect_error(format('select public.community_save_post(''changed'',''body'',%L)',:'alice_post'),'42501','other member cannot edit');
select pg_temp.expect_error(format('select public.community_delete_post(%L)',:'alice_post'),'42501','other member cannot delete');
select pg_temp.assert((public.community_get_post(:'alice_post') ->> 'body') = '<script>plain text</script>','body stored as plain text');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert(public.community_track_visit('alice',:'alice_slug','10000000-0000-0000-0000-000000000001'),'anonymous visit');
select pg_temp.assert(public.community_track_visit('alice',:'alice_slug','10000000-0000-0000-0000-000000000001'),'duplicate call succeeds without double counting');
select pg_temp.assert(not public.community_track_visit('bob',:'alice_slug','10000000-0000-0000-0000-000000000002'),'link owner mismatch rejected');
select pg_temp.assert(public.community_track_visit('bob',:'bob_slug','10000000-0000-0000-0000-000000000001'),'later owner visit recorded');
select pg_temp.assert(public.community_track_visit('alice',null,'10000000-0000-0000-0000-000000000002'),'default profile referral supported');
select pg_temp.assert((public.community_list_posts() ->> 'total')::int = 1,'anonymous board list');
select pg_temp.assert((public.community_list_posts(1,'plain') ->> 'total')::int = 1,'board search');
select pg_temp.assert((public.community_list_posts(-1,'') ->> 'page')::int = 1,'page clamped');
select pg_temp.expect_error('select * from public.community_posts','42501','raw posts table not exposed');
reset role;

select pg_temp.assert((select count(*) = 3 from private.community_visits),'per-link visit dedupe');
select pg_temp.assert((select owner_id = '00000000-0000-0000-0000-000000000001' from private.community_first_touch where visitor_id = '10000000-0000-0000-0000-000000000001'),'later visit does not overwrite first-touch');
insert into auth.users values
 ('00000000-0000-0000-0000-000000000004','tracked@example.invalid',null,jsonb_build_object('community_signup',true,'username','tracked','display_name','Tracked','privacy_version','2026-10-09','visitor_id','10000000-0000-0000-0000-000000000001')),
 ('00000000-0000-0000-0000-000000000005','manual@example.invalid',now(),jsonb_build_object('community_signup',true,'username','manual','display_name','Manual','privacy_version','2026-10-09','visitor_id','10000000-0000-0000-0000-000000000001','referrer_username','bob'));
select pg_temp.assert((select referrer_id = '00000000-0000-0000-0000-000000000002' and link_id is null and attribution_method = 'manual' from private.community_referrals where signup_user_id = '00000000-0000-0000-0000-000000000005'),'explicit manual referrer overrides prior link');
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"referrer_username":"alice","username":"newname","is_admin":true}'::jsonb where id = '00000000-0000-0000-0000-000000000005';
select pg_temp.assert((select username = 'manual' from public.community_profiles where user_id = '00000000-0000-0000-0000-000000000005'),'metadata update cannot change profile snapshot');
select pg_temp.assert((select referrer_id = '00000000-0000-0000-0000-000000000002' from private.community_referrals where signup_user_id = '00000000-0000-0000-0000-000000000005'),'metadata update cannot change referral');
select pg_temp.assert((select count(*) = 1 from private.site_admins),'metadata cannot grant admin');
insert into auth.users values ('00000000-0000-0000-0000-000000000007','matching@example.invalid',now(),'{"community_signup":true,"username":"matching","display_name":"Matching","privacy_version":"2026-10-09","visitor_id":"10000000-0000-0000-0000-000000000001","referrer_username":"alice"}');
select pg_temp.assert((select link_id is not null and attribution_method = 'manual' from private.community_referrals where signup_user_id = '00000000-0000-0000-0000-000000000007'),'matching explicit referrer retains campaign');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((public.community_my_referrals() ->> 'visitors')::int = 2,'unique-browser overall counts');
select pg_temp.assert((public.community_my_referrals() ->> 'signups')::int = 1,'unverified signup excluded');
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((public.community_my_referrals() ->> 'signups')::int = 2,'verified signup counted once');
select pg_temp.assert((public.community_my_referrals() -> 'links' -> 0 ->> 'signups')::int = 2,'conversion linked to first-touch link');
select pg_temp.assert((public.community_my_referrals() -> 'links' -> 0 ->> 'visitors')::int = 1,'per-link browser count');
select pg_temp.assert(position('email' in public.community_my_referrals()::text) = 0,'stats return no emails');
select public.community_save_post('Edited own title','Edited own body',:'alice_post');
reset role;

-- Expired server attribution cannot convert. A fresh visit can replace it.
update private.community_first_touch set touched_at = now() - interval '31 days' where visitor_id = '10000000-0000-0000-0000-000000000002';
insert into auth.users values ('00000000-0000-0000-0000-000000000006','expired@example.invalid',now(),'{"community_signup":true,"username":"expired","display_name":"Expired","privacy_version":"2026-10-09","visitor_id":"10000000-0000-0000-0000-000000000002"}');
select pg_temp.assert(not exists(select 1 from private.community_referrals where signup_user_id = '00000000-0000-0000-0000-000000000006'),'30-day attribution expiry');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.community_track_visit('bob',:'bob_slug','10000000-0000-0000-0000-000000000002');
reset role;
select pg_temp.assert((select owner_id = '00000000-0000-0000-0000-000000000002' from private.community_first_touch where visitor_id = '10000000-0000-0000-0000-000000000002'),'fresh visit replaces expired first-touch');

set local role authenticated;
select set_config('request.jwt.claim.sub','bfc7ee84-daa3-4519-9316-cee48712f193',true);
select pg_temp.assert(public.is_site_admin(),'operator allowlist respected');
select pg_temp.assert((select count(*) = 2 from public.founding_members),'operator legacy access retained');
select pg_temp.assert((select count(*) = 1 from storage.objects),'operator evidence access retained');
select pg_temp.assert((public.community_complete_profile('operator','Operator') ->> 'username') = 'operator','legacy profile completion');
select pg_temp.assert(jsonb_array_length(public.community_admin_deletion_requests()) = 1,'admin can review deletion queue');
select pg_temp.assert(public.community_delete_post(:'alice_post'),'admin moderation soft delete');
select pg_temp.assert(public.community_get_post(:'alice_post') is null,'soft-deleted post not public');
select pg_temp.assert((public.community_list_posts() ->> 'total')::int = 0,'soft-deleted post removed from list');
reset role;
select pg_temp.assert(exists(select 1 from public.community_posts where id = :'alice_post' and deleted_at is not null),'soft-deleted post retained');
select pg_temp.assert(not exists(select 1 from private.community_referrals where signup_user_id = 'bfc7ee84-daa3-4519-9316-cee48712f193'),'legacy profile completion never creates referrals');

-- Database rate limits are independent of client UI checks.
insert into private.community_write_events(user_id) select '00000000-0000-0000-0000-000000000002'::uuid from generate_series(1,10);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error('select public.community_save_post(''rate'',''body'')','22023','post rate limit');
reset role;
insert into private.community_links(owner_id,slug,source,medium,campaign,created_at)
select '00000000-0000-0000-0000-000000000002'::uuid,'limit-' || n,'test','test','test',now() - interval '2 hours' from generate_series(1,99) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error('select public.community_create_link(''test'',''test'',''test'')','22023','100 links hard limit');
reset role;
rollback;
\echo 'Community PostgreSQL tests passed: isolation, admin/PII/storage boundaries, signup snapshots, referrals, expiry, CRUD, soft delete, and rate limits.'
