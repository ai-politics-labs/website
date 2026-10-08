-- Public dashboard aggregate. Run after supabase/founding_members.sql.
-- Repeatable and additive: no personal records or table permissions are changed.
begin;

create or replace function public.founding_member_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with regions (position, region, aliases) as (
    values
      (1, '서울', array['서울', '서울시', '서울특별시']),
      (2, '부산', array['부산', '부산시', '부산광역시']),
      (3, '대구', array['대구', '대구시', '대구광역시']),
      (4, '인천', array['인천', '인천시', '인천광역시']),
      (5, '광주', array['광주', '광주시', '광주광역시']),
      (6, '대전', array['대전', '대전시', '대전광역시']),
      (7, '울산', array['울산', '울산시', '울산광역시']),
      (8, '세종', array['세종', '세종시', '세종특별자치시']),
      (9, '경기', array['경기', '경기도']),
      (10, '강원', array['강원', '강원도', '강원특별자치도']),
      (11, '충북', array['충북', '충청북도']),
      (12, '충남', array['충남', '충청남도']),
      (13, '전북', array['전북', '전라북도', '전북특별자치도']),
      (14, '전남', array['전남', '전라남도']),
      (15, '경북', array['경북', '경상북도']),
      (16, '경남', array['경남', '경상남도']),
      (17, '제주', array['제주', '제주도', '제주특별자치도'])
  ), counts as (
    select coalesce(regions.region, '기타') as region, pg_catalog.count(*) as count
    from public.founding_members as members
    left join regions on
      (pg_catalog.regexp_match(members.address, '^[[:space:]]*([^[:space:]]+)'))[1]
      = any (regions.aliases)
    group by coalesce(regions.region, '기타')
  ), rows as (
    select regions.position, regions.region, coalesce(counts.count, 0) as count
    from regions
    left join counts using (region)
    union all
    select 18, counts.region, counts.count from counts where counts.region = '기타'
  )
  select pg_catalog.jsonb_build_object(
    'total', (select coalesce(pg_catalog.sum(counts.count), 0) from counts),
    'regions', pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('region', rows.region, 'count', rows.count)
      order by rows.position
    ),
    'updated_at', pg_catalog.statement_timestamp()
  )
  from rows;
$function$;

comment on function public.founding_member_stats() is
  'All founding-member submissions grouped by address province. Aggregate only; updated_at is the snapshot query time.';

revoke all on function public.founding_member_stats() from public;
grant execute on function public.founding_member_stats() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
