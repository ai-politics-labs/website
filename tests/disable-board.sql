\set ON_ERROR_STOP on
\set QUIET on
-- Run existing real-PostgreSQL suites, then preserve a known post across disable.
\ir founding-signup.sql
\ir ../db/2026-10-09_founding_member_stats.sql
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if;
end $$;
create function pg_temp.expect_denied(statement text,label text) returns void language plpgsql as $$
declare rejected boolean := false; begin
 begin execute statement;
 exception when insufficient_privilege then rejected := true;
 end;
 if not rejected then raise exception 'EXPECTED PERMISSION DENIAL: %',label; end if;
end $$;
insert into public.community_profiles(user_id,username,display_name)
values('bfc7ee84-daa3-4519-9316-cee48712f193','operator','Operator');
insert into public.community_posts(id,author_id,title,body)
values('30000000-0000-0000-0000-000000000001','bfc7ee84-daa3-4519-9316-cee48712f193','Retained title','Retained body');
create temp table board_before as select * from public.community_posts;
create temp table board_other_grants_before as
select role_name,fn,has_function_privilege(role_name,fn,'EXECUTE') as can_execute
from (values('anon'),('authenticated')) roles(role_name)
cross join (values('public.founding_member_stats()'),('public.community_my_referrals()'),
 ('public.community_create_link(text,text,text)'),('public.community_track_visit(text,text,uuid)'),
 ('public.community_complete_profile(text,text)'),('public.community_submit_founding_consent(jsonb)'),
 ('public.community_prepare_founding_signup(text,text,text,jsonb,text,uuid)'),
 ('public.community_founding_signup_status(text)')) functions(fn);
\ir ../db/2026-10-09_disable_board.sql
\ir ../db/2026-10-09_disable_board.sql
select pg_temp.assert(not exists((select * from public.community_posts except select * from board_before)
 union all (select * from board_before except select * from public.community_posts)),'all post data retained byte-for-byte');
select pg_temp.assert(not exists(select 1 from board_other_grants_before where can_execute is distinct from has_function_privilege(role_name,fn,'EXECUTE')),'aggregate/account/referral permissions unchanged');

do $$ declare r text; fn text; begin
 foreach r in array array['anon','authenticated'] loop
  foreach fn in array array['public.community_list_posts(integer,text)','public.community_get_post(uuid)',
   'public.community_save_post(text,text,uuid)','public.community_delete_post(uuid)'] loop
   perform pg_temp.assert(not has_function_privilege(r,fn,'EXECUTE'),r || ' cannot execute ' || fn);
  end loop;
 end loop;
end $$;

set role anon;
select set_config('request.jwt.claim.sub','',false);
select pg_temp.expect_denied('select public.community_list_posts()','anonymous list');
select pg_temp.expect_denied('select public.community_get_post(''30000000-0000-0000-0000-000000000001'')','anonymous view');
select pg_temp.expect_denied('select public.community_save_post(''title'',''body'')','anonymous save');
select pg_temp.expect_denied('select public.community_delete_post(''30000000-0000-0000-0000-000000000001'')','anonymous delete');
select pg_temp.expect_denied('select * from public.community_posts','anonymous direct table');
select pg_temp.assert(public.founding_member_stats() ? 'total','anonymous dashboard still works');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','bfc7ee84-daa3-4519-9316-cee48712f193',false);
select pg_temp.expect_denied('select public.community_list_posts()','authenticated list');
select pg_temp.expect_denied('select public.community_get_post(''30000000-0000-0000-0000-000000000001'')','authenticated view');
select pg_temp.expect_denied('select public.community_save_post(''title'',''body'')','authenticated save');
select pg_temp.expect_denied('select public.community_delete_post(''30000000-0000-0000-0000-000000000001'')','authenticated delete');
select pg_temp.expect_denied('select * from public.community_posts','authenticated direct table');
select pg_temp.assert(public.founding_member_stats() ? 'total','authenticated dashboard still works');
select pg_temp.assert(public.community_my_referrals() ? 'visitors','personal referral metrics still work');
select pg_temp.assert(public.community_create_link('test','share','disableboard') ? 'slug','personal referral link creation still works');
reset role;
select pg_temp.assert(not exists((select * from public.community_posts except select * from board_before)
 union all (select * from board_before except select * from public.community_posts)),'denied calls leave all posts unchanged');
\echo 'Disable-board PostgreSQL tests passed: four RPCs denied to anonymous/authenticated, posts retained, table private, dashboard/accounts/referrals untouched.'
