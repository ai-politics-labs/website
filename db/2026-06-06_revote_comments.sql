-- ============================================================================
-- 선거권 회복 100만 서명운동 — 서명 의견(멘트) 추가 마이그레이션
-- 기존 스키마 적용 후 추가로 Supabase SQL Editor 에서 실행하세요.
-- ============================================================================

-- 1) 서명 테이블에 의견 컬럼 추가 (최대 300자, 디폴트 '동의합니다')
alter table public.revote_signatures
  add column if not exists comment text;

-- 길이 제한(300자) — 이미 있으면 무시
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'revote_signatures_comment_len'
  ) then
    alter table public.revote_signatures
      add constraint revote_signatures_comment_len
      check (comment is null or char_length(comment) <= 300);
  end if;
end $$;

-- 2) 공개 의견 목록 RPC — 익명 호출 가능, 이름은 마스킹(예: 박OO)만 노출
create or replace function public.revote_recent_comments(p_limit int default 20)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'total', (
      select count(*) from public.revote_signatures
       where status = 'ACTIVE'
         and comment is not null
         and char_length(btrim(comment)) > 0
    ),
    'items', coalesce((
      select json_agg(t) from (
        select substr(name, 1, 1) || 'OO' as name,
               comment,
               created_at
          from public.revote_signatures
         where status = 'ACTIVE'
           and comment is not null
           and char_length(btrim(comment)) > 0
         order by created_at desc
         limit greatest(1, least(p_limit, 50))
      ) t
    ), '[]'::json)
  )
$$;

grant execute on function public.revote_recent_comments(int) to anon, authenticated;
