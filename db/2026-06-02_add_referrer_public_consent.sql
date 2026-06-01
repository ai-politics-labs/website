-- 발기인 양식: 추천인(referrer) + 전체 공개 동의(public_consent) 컬럼 추가
-- Supabase 대시보드 → SQL Editor 에서 실행하세요.

alter table public.founding_members
  add column if not exists referrer text,
  add column if not exists public_consent boolean not null default false;
