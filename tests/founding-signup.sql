\set ON_ERROR_STOP on
\set QUIET on
-- The prior suite bootstraps realistic Supabase roles/schema and rolls its test
-- accounts back. The additive migration is then tested independently below.
\ir community.sql
\ir ../db/2026-10-09_founding_signup.sql
\ir ../db/2026-10-09_founding_signup.sql
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if;
end $$;
create function pg_temp.expect_error(statement text,expected_state text,label text) returns void language plpgsql as $$
declare rejected boolean := false; begin
 begin execute statement;
 exception when others then
  if sqlstate <> expected_state then raise exception 'WRONG ERROR [%] expected %, got %: %',label,expected_state,sqlstate,sqlerrm; end if;
  rejected := true;
 end;
 if not rejected then raise exception 'EXPECTED ERROR MISSING: %',label; end if;
end $$;
create function pg_temp.founder() returns jsonb language sql as $$
 select jsonb_build_object('name','홍길동','address','서울특별시 중구 테스트로 1','birth_date','1990-01-01','gender','남',
 'occupation','직장인','phone_home',null,'phone_mobile','010-1234-5678','agreed_at',(now() at time zone 'Asia/Seoul')::date,
 'privacy_agreed',true,'public_consent',false,
 'signature_data','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+r/2kAAAAASUVORK5CYII=')
$$;

select pg_temp.assert(not has_table_privilege('anon','public.founding_members','INSERT'),'anonymous direct founder insert revoked');
select pg_temp.assert(not has_table_privilege('authenticated','public.founding_members','INSERT'),'authenticated direct founder insert revoked');
select pg_temp.assert((select count(*) = 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal),'one Auth signup trigger only');
select pg_temp.assert((select count(*) = 1 from public.founding_members),'existing legacy records retained');
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc7ee84-daa3-4519-9316-cee48712f193',true);
select pg_temp.assert((public.community_complete_profile('operator','Operator') ->> 'username') = 'operator','legacy operator can complete profile without founder consent');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select * from private.community_founding_signup_drafts','42501','draft PII private');
select pg_temp.expect_error('insert into public.founding_members(name,address,birth_date,gender,occupation,phone_mobile,signature_data,agreed_at,privacy_agreed) values(''Bypass'',''address'',''1990-01-01'',''남'',''test'',''01012345678'',''sig'',current_date,true)','42501','direct anonymous consent bypass denied');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''a@example.invalid'',''badprivacy'',''Bad'',pg_temp.founder() || ''{"privacy_agreed":false}''::jsonb)','22023','consent required');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''a@example.invalid'',''young'',''Young'',pg_temp.founder() || jsonb_build_object(''birth_date'',current_date))','22023','age18 enforced');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''a@example.invalid'',''baddate'',''Bad'',pg_temp.founder() || ''{"birth_date":"2000-02-31"}''::jsonb)','22023','real birth date enforced');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''a@example.invalid'',''badsign'',''Bad'',pg_temp.founder() || ''{"signature_data":"data:image/png;base64,aGVsbG8="}''::jsonb)','22023','PNG signature checked');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''a@example.invalid'',''oversized'',''Bad'',pg_temp.founder() || jsonb_build_object(''signature_data'',''data:image/png;base64,'' || repeat(''A'',409624)))','22023','signature byte cap');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''invalid-email'',''badmail'',''Bad'',pg_temp.founder())','22023','email validated');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''a@example.invalid'',''badphone'',''Bad'',pg_temp.founder() || ''{"phone_mobile":"abc"}''::jsonb)','22023','mobile validated');
select pg_temp.expect_error('select public.community_prepare_founding_signup(''a@example.invalid'',''badref'',''Bad'',pg_temp.founder(),''missing'')','22023','manual referrer validated');
select public.community_prepare_founding_signup('ALICE@EXAMPLE.INVALID','alice','Alice',pg_temp.founder()) ->> 'token' as alice_token \gset
select pg_temp.assert(:'alice_token' ~ '^[0-9a-f]{32}$','cryptographic 128-bit token format');
select pg_temp.assert(public.community_founding_signup_status(:'alice_token') = '{"completed":false}'::jsonb,'prepared status only false');
reset role;

-- Restrictive policy also closes residual column grants or future broad grants.
grant insert on public.founding_members to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc7ee84-daa3-4519-9316-cee48712f193',true);
select pg_temp.expect_error('insert into public.founding_members(name,address,birth_date,gender,occupation,phone_mobile,signature_data,agreed_at,privacy_agreed) values(''Bypass'',''address'',''1990-01-01'',''남'',''test'',''01012345678'',''sig'',current_date,true)','42501','restrictive RLS prevents direct insertion even with broad grants');
reset role;
revoke insert on public.founding_members from authenticated;

-- Direct old signup metadata cannot produce a community profile/account.
select pg_temp.expect_error($q$insert into auth.users values('00000000-0000-0000-0000-000000000090','bypass@example.invalid',now(),'{"community_signup":true,"username":"bypass","display_name":"Bypass","privacy_version":"2026-10-09"}')$q$,'22023','old standalone signup rejected');
select pg_temp.expect_error(format('insert into auth.users values(%L,%L,now(),%L::jsonb)','00000000-0000-0000-0000-000000000091','wrong@example.invalid',jsonb_build_object('community_signup',true,'founding_signup_token',:'alice_token','privacy_version','2026-10-09')::text),'22023','token email mismatch rolls back');
select pg_temp.assert(not exists(select 1 from auth.users where id = '00000000-0000-0000-0000-000000000091'),'email mismatch no Auth account');
select pg_temp.assert(not exists(select 1 from public.community_profiles where username = 'alice'),'email mismatch no profile');
select pg_temp.assert((select count(*) = 1 from public.founding_members),'email mismatch no founder');
insert into auth.users values('00000000-0000-0000-0000-000000000001','alice@example.invalid',now(),jsonb_build_object('community_signup',true,'founding_signup_token',:'alice_token','privacy_version','2026-10-09'));
select pg_temp.assert((select username = 'alice' from public.community_profiles where user_id = '00000000-0000-0000-0000-000000000001'),'draft creates profile');
select pg_temp.assert((select name = '홍길동' and privacy_agreed = true from public.founding_members where submitted_by = '00000000-0000-0000-0000-000000000001'),'Auth trigger uses new account owner rather than null request UID');
select pg_temp.assert((select not raw_user_meta_data ?| array['name','address','birth_date','phone_mobile','signature_data','password','founder'] from auth.users where id = '00000000-0000-0000-0000-000000000001'),'no founder PII/signature/password in Auth metadata');
select pg_temp.assert((select completed_at is not null and email is null and username is null and display_name is null and founder is null and visitor_id is null and referrer_username is null from private.community_founding_signup_drafts where token = :'alice_token'::uuid),'consumed draft immediately scrubbed');
select pg_temp.expect_error(format('insert into auth.users values(%L,%L,now(),%L::jsonb)','00000000-0000-0000-0000-000000000092','alice@example.invalid',jsonb_build_object('community_signup',true,'founding_signup_token',:'alice_token','privacy_version','2026-10-09')::text),'22023','token single use');
set local role anon;
select pg_temp.assert(public.community_founding_signup_status(:'alice_token') = '{"completed":true}'::jsonb,'consumed status exposes only completed');
select pg_temp.assert(public.community_founding_signup_status('invalid') = '{"completed":false}'::jsonb,'invalid status token reveals nothing');
select public.community_prepare_founding_signup('bob@example.invalid','bob','Bob',pg_temp.founder()) ->> 'token' as bob_token \gset
reset role;
insert into auth.users values('00000000-0000-0000-0000-000000000002','BOB@example.invalid',now(),jsonb_build_object('community_signup',true,'founding_signup_token',:'bob_token','privacy_version','2026-10-09'));

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.community_create_link('chat','share','founder') ->> 'slug' as alice_slug \gset
select pg_temp.assert((public.community_submit_founding_consent(pg_temp.founder()) ->> 'already_registered')::boolean,'signed-in consent retry idempotent');
select pg_temp.expect_error('insert into public.founding_members(name,address,birth_date,gender,occupation,phone_mobile,signature_data,agreed_at,privacy_agreed,submitted_by) values(''Bypass'',''address'',''1990-01-01'',''남'',''test'',''01012345678'',''sig'',current_date,true,''00000000-0000-0000-0000-000000000002'')','42501','member direct INSERT cannot forge owner');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.community_track_visit('alice',:'alice_slug','10000000-0000-0000-0000-000000000001');
select public.community_prepare_founding_signup('tracked@example.invalid','tracked','Tracked',pg_temp.founder(),null,'10000000-0000-0000-0000-000000000001') ->> 'token' as tracked_token \gset
select public.community_prepare_founding_signup('manual@example.invalid','manual','Manual',pg_temp.founder(),'bob','10000000-0000-0000-0000-000000000001') ->> 'token' as manual_token \gset
reset role;
-- Bogus metadata usernames/referrers are ignored: all snapshots came from draft.
insert into auth.users values('00000000-0000-0000-0000-000000000003','tracked@example.invalid',null,jsonb_build_object('community_signup',true,'founding_signup_token',:'tracked_token','privacy_version','2026-10-09','username','hijack','referrer_username','bob'));
insert into auth.users values('00000000-0000-0000-0000-000000000004','manual@example.invalid',now(),jsonb_build_object('community_signup',true,'founding_signup_token',:'manual_token','privacy_version','2026-10-09','referrer_username','alice'));
select pg_temp.assert((select username = 'tracked' from public.community_profiles where user_id = '00000000-0000-0000-0000-000000000003'),'profile uses draft not metadata');
select pg_temp.assert((select referrer_id = '00000000-0000-0000-0000-000000000001' and link_id is not null and attribution_method = 'visit' from private.community_referrals where signup_user_id = '00000000-0000-0000-0000-000000000003'),'first-touch attribution from server snapshot');
select pg_temp.assert((select referrer_id = '00000000-0000-0000-0000-000000000002' and link_id is null and attribution_method = 'manual' from private.community_referrals where signup_user_id = '00000000-0000-0000-0000-000000000004'),'manual override from draft');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((public.community_my_referrals() ->> 'signups')::int = 0,'unverified founder conversion excluded');
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.assert((public.community_my_referrals() ->> 'signups')::int = 1,'verified founder conversion counted');
reset role;

-- Auth-only accounts do not get profiles or application write access. They can
-- submit consent once and then complete a verified profile without referral.
insert into auth.users values('00000000-0000-0000-0000-000000000005','authonly@example.invalid',now(),'{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select pg_temp.expect_error('select public.community_complete_profile(''bypassprofile'',''Bypass'')','42501','no standalone completion bypass');
select pg_temp.expect_error('select public.community_save_post(''bypass'',''body'')','42501','auth-only cannot post');
select pg_temp.expect_error('select public.community_create_link(''a'',''b'',''c'')','42501','auth-only cannot create links');
select pg_temp.assert((public.community_submit_founding_consent(pg_temp.founder()) ->> 'already_registered')::boolean = false,'signed-in existing user submits founder consent');
select pg_temp.assert((public.community_submit_founding_consent(pg_temp.founder()) ->> 'already_registered')::boolean,'repeated signed-in consent does not duplicate');
select pg_temp.assert((public.community_complete_profile('existingfounder','Existing') ->> 'username') = 'existingfounder','linked founder can complete profile');
reset role;
select pg_temp.assert((select count(*) = 1 from public.founding_members where submitted_by = '00000000-0000-0000-0000-000000000005'),'one founder per account');
select pg_temp.assert(not exists(select 1 from private.community_referrals where signup_user_id = '00000000-0000-0000-0000-000000000005'),'existing account consent not newly attributed');

-- Username races roll the whole Auth/profile/founder/referral transaction back.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.community_prepare_founding_signup('race1@example.invalid','racer','Racer',pg_temp.founder()) ->> 'token' as race1_token \gset
select public.community_prepare_founding_signup('race2@example.invalid','racer','Racer',pg_temp.founder()) ->> 'token' as race2_token \gset
select public.community_prepare_founding_signup('expire@example.invalid','expire','Expired',pg_temp.founder()) ->> 'token' as expired_token \gset
reset role;
insert into auth.users values('00000000-0000-0000-0000-000000000006','race1@example.invalid',now(),jsonb_build_object('community_signup',true,'founding_signup_token',:'race1_token','privacy_version','2026-10-09'));
select pg_temp.expect_error(format('insert into auth.users values(%L,%L,now(),%L::jsonb)','00000000-0000-0000-0000-000000000007','race2@example.invalid',jsonb_build_object('community_signup',true,'founding_signup_token',:'race2_token','privacy_version','2026-10-09')::text),'23505','duplicate username race rejects atomically');
select pg_temp.assert(not exists(select 1 from auth.users where id = '00000000-0000-0000-0000-000000000007'),'failed race leaves no Auth account');
select pg_temp.assert(not exists(select 1 from public.founding_members where submitted_by = '00000000-0000-0000-0000-000000000007'),'failed race leaves no founder');
select pg_temp.assert((select completed_at is null and founder is not null from private.community_founding_signup_drafts where token = :'race2_token'::uuid),'failed transaction does not consume draft');
update private.community_founding_signup_drafts set expires_at = now() - interval '1 second' where token = :'expired_token'::uuid;
select pg_temp.expect_error(format('insert into auth.users values(%L,%L,now(),%L::jsonb)','00000000-0000-0000-0000-000000000008','expire@example.invalid',jsonb_build_object('community_signup',true,'founding_signup_token',:'expired_token','privacy_version','2026-10-09')::text),'22023','expired token rejected');
set local role anon;
select public.community_prepare_founding_signup('cleanup@example.invalid','cleanup','Cleanup',pg_temp.founder());
reset role;
select pg_temp.assert(not exists(select 1 from private.community_founding_signup_drafts where token = :'expired_token'::uuid),'prepare prunes expired unconsumed PII');

-- A late referral failure must also undo a founder already inserted in trigger.
set local role anon;
select public.community_prepare_founding_signup('latefail@example.invalid','latefail','Late fail',pg_temp.founder(),'bob') ->> 'token' as late_token \gset
reset role;
update auth.users set email_confirmed_at = null where id = '00000000-0000-0000-0000-000000000002';
select pg_temp.expect_error(format('insert into auth.users values(%L,%L,now(),%L::jsonb)','00000000-0000-0000-0000-000000000009','latefail@example.invalid',jsonb_build_object('community_signup',true,'founding_signup_token',:'late_token','privacy_version','2026-10-09')::text),'22023','late invalid referrer rollback');
select pg_temp.assert(not exists(select 1 from public.founding_members where submitted_by = '00000000-0000-0000-0000-000000000009'),'late failure no founder');
select pg_temp.assert(not exists(select 1 from public.community_profiles where username = 'latefail'),'late failure no profile');
select pg_temp.assert((select completed_at is null from private.community_founding_signup_drafts where token = :'late_token'::uuid),'late failure token reusable');

set local role anon;
do $$ begin
 for n in 1..10 loop perform public.community_prepare_founding_signup('limited@example.invalid','ratelimited','Limited',pg_temp.founder()); end loop;
end $$;
select pg_temp.expect_error('select public.community_prepare_founding_signup(''limited@example.invalid'',''ratelimited'',''Limited'',pg_temp.founder())','22023','ten drafts per email per15minutes');
reset role;
select pg_temp.assert((select count(*) = 1 from private.site_admins),'no new account becomes admin');
insert into auth.users values('00000000-0000-0000-0000-000000000010','oldprofile@example.invalid',now(),'{}');
insert into public.community_profiles(user_id,username,display_name) values('00000000-0000-0000-0000-000000000010','oldprofile','Old profile');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
select pg_temp.expect_error('select public.community_complete_profile(''oldprofile'',''Old profile'')','42501','old standalone profile does not bypass founding gate');
select pg_temp.expect_error('select public.community_save_post(''bypass'',''body'')','42501','old standalone profile cannot post');
select pg_temp.expect_error('select public.community_create_link(''a'',''b'',''c'')','42501','old standalone profile cannot create links');
reset role;
insert into private.community_founding_signup_drafts(email,username,display_name,founder)
select 'cap' || n || '@example.invalid','cap' || n,'Cap','{}'::jsonb from generate_series(1,1000) n;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select public.community_prepare_founding_signup(''globalcap@example.invalid'',''globalcap'',''Capped'',pg_temp.founder())','22023','global1000 active draft cap');
reset role;
rollback;
\echo 'Founding-signup PostgreSQL tests passed: draft privacy, token binding/expiry/reuse, atomic registration, profile gates, referrals, idempotency, and rate caps.'
