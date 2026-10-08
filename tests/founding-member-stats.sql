-- Run only in a disposable, empty PostgreSQL database as its owner:
-- psql -X -v ON_ERROR_STOP=1 -f tests/founding-member-stats.sql DATABASE
-- This intentionally fails if a real founding_members table already exists.
\set ON_ERROR_STOP on

do $test$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$test$;

create table public.founding_members (address text);
alter table public.founding_members enable row level security;

-- Applying twice verifies that the additive migration is repeatable.
\ir ../db/2026-10-09_founding_member_stats.sql
\ir ../db/2026-10-09_founding_member_stats.sql

do $test$
declare
  stats jsonb := public.founding_member_stats();
begin
  assert (stats ->> 'total')::bigint = 0, 'empty total';
  assert pg_catalog.jsonb_array_length(stats -> 'regions') = 17, 'all zero regions';
  assert not exists (
    select from pg_catalog.jsonb_array_elements(stats -> 'regions') as item
    where (item ->> 'count')::bigint <> 0 or item ->> 'region' = '기타'
  ), 'no nonzero rows or 기타 for empty input';
  assert (stats ->> 'updated_at')::timestamptz is not null, 'snapshot timestamp';
  assert (select prosecdef and provolatile = 's' and proconfig = array['search_path=""']
    from pg_catalog.pg_proc where oid = 'public.founding_member_stats()'::regprocedure),
    'stable security definer with fixed empty search path';
  assert not exists (
    select from pg_catalog.pg_proc as proc,
      lateral pg_catalog.aclexplode(proc.proacl) as acl
    where proc.oid = 'public.founding_member_stats()'::regprocedure and acl.grantee = 0
  ), 'PUBLIC has no execution permission';
  assert pg_catalog.has_function_privilege('anon', 'public.founding_member_stats()', 'EXECUTE'), 'anon execute';
  assert pg_catalog.has_function_privilege('authenticated', 'public.founding_member_stats()', 'EXECUTE'), 'authenticated execute';
  assert not pg_catalog.has_table_privilege('anon', 'public.founding_members', 'SELECT'), 'no anon PII read';
  assert not pg_catalog.has_table_privilege('authenticated', 'public.founding_members', 'SELECT'), 'no authenticated PII read';
end;
$test$;

create temporary table fixtures (address text, region text);
insert into fixtures values
  ('서울', '서울'), ('서울시 강남구', '서울'), (E' \t서울특별시\t강남구', '서울'),
  ('부산', '부산'), ('부산시', '부산'), ('부산광역시 해운대구', '부산'),
  ('대구', '대구'), ('대구시', '대구'), ('대구광역시 중구', '대구'),
  ('인천', '인천'), ('인천시', '인천'), ('인천광역시 중구', '인천'),
  ('광주', '광주'), ('광주시', '광주'), ('광주광역시 북구', '광주'),
  ('대전', '대전'), ('대전시', '대전'), ('대전광역시 중구', '대전'),
  ('울산', '울산'), ('울산시', '울산'), ('울산광역시 중구', '울산'),
  ('세종', '세종'), ('세종시', '세종'), ('세종특별자치시 한솔동', '세종'),
  ('경기', '경기'), ('경기도 광주시', '경기'),
  ('강원', '강원'), ('강원도 춘천시', '강원'), ('강원특별자치도 원주시', '강원'),
  ('충북', '충북'), ('충청북도 청주시', '충북'),
  ('충남', '충남'), ('충청남도 천안시', '충남'),
  ('전북', '전북'), ('전라북도 전주시', '전북'), ('전북특별자치도 군산시', '전북'),
  ('전남', '전남'), ('전라남도 목포시', '전남'),
  ('경북', '경북'), ('경상북도 경주시', '경북'),
  ('경남', '경남'), ('경상남도 진주시', '경남'),
  ('제주', '제주'), ('제주도 제주시', '제주'), ('제주특별자치도 서귀포시', '제주'),
  (null, '기타'), ('', '기타'), (E' \t\n', '기타'), ('해외', '기타'),
  ('서울특별시<script>', '기타'), ('부산광역시evil', '기타'),
  ('서울;DROP TABLE public.founding_members;--', '기타'),
  ('<script>alert(1)</script>', '기타');

-- Exceeds the common 1,000-row REST limit; aggregation must include every row.
insert into fixtures select '서울특별시 강남구', '서울' from pg_catalog.generate_series(1, 1005);
insert into public.founding_members select address from fixtures;

do $test$
declare
  stats jsonb := public.founding_member_stats();
  item jsonb;
begin
  assert (stats ->> 'total')::bigint = (select count(*) from fixtures), 'all submissions counted';
  assert pg_catalog.jsonb_array_length(stats -> 'regions') = 18, '17 provinces plus 기타';
  assert (select sum((value ->> 'count')::bigint)
    from pg_catalog.jsonb_array_elements(stats -> 'regions')) = (stats ->> 'total')::bigint,
    'regions reconcile with total';
  for item in select value from pg_catalog.jsonb_array_elements(stats -> 'regions') loop
    assert (item ->> 'count')::bigint = (
      select count(*) from fixtures where region = item ->> 'region'
    ), 'alias count: ' || (item ->> 'region');
    assert (select count(*) from pg_catalog.jsonb_object_keys(item)) = 2, 'aggregate row has no PII';
  end loop;
  assert (select count(*) from pg_catalog.jsonb_object_keys(stats)) = 3, 'only public contract keys';
  assert stats #>> '{regions,0,region}' = '서울', 'stable regional ordering';
  assert stats #>> '{regions,17,region}' = '기타', 'unknown last';
end;
$test$;

-- Exercise the actual public role, with RLS on and without raw table read grants.
set role anon;
do $test$
begin
  assert (public.founding_member_stats() ->> 'total')::bigint > 1000, 'anon can read aggregate';
end;
$test$;
reset role;

set role authenticated;
do $test$
begin
  assert (public.founding_member_stats() ->> 'total')::bigint > 1000, 'authenticated can read aggregate';
end;
$test$;
reset role;

select 'founding_member_stats regression passed' as result;
