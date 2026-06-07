-- ============================================================================
-- 선거권 회복 100만 서명운동 — 법률대응 위임장 마이그레이션
-- 기존 스키마 적용 후 Supabase SQL Editor 에서 실행하세요.
-- 서명 완료 후 2단계(법률대응 참여)에서 작성하는 위임장을 저장합니다.
-- ============================================================================

create table if not exists public.revote_legal_delegations (
  id                  uuid primary key default gen_random_uuid(),
  signature_id        uuid references public.revote_signatures(id),
  name                text not null,                 -- 위임인 성명
  birth_date          text,                          -- 생년월일
  address             text not null,                 -- 주소
  phone               text not null,                 -- 연락처
  phone_hash          text,                          -- SHA-256(정규화 번호)
  email               text,
  electoral_district  text,                          -- 해당 선거구
  polling_station     text,                          -- 투표소명(선택)
  damage_types        jsonb not null default '[]'::jsonb,   -- 피해 유형
  damage_detail       text,                          -- 피해 상세
  special_authorities jsonb not null default '[]'::jsonb,   -- 특별수권사항
  consent_items       jsonb not null default '{}'::jsonb,   -- 동의사항 (key→bool)
  signature_name      text not null,                 -- 서명(자필 성명)
  signed_date         date not null default ((now() at time zone 'Asia/Seoul')::date),
  user_agent          text,
  status              text not null default 'ACTIVE', -- ACTIVE | DELETED
  created_at          timestamptz not null default now()
);

create index if not exists revote_legal_delegations_signature_idx
  on public.revote_legal_delegations (signature_id);

create index if not exists revote_legal_delegations_created_idx
  on public.revote_legal_delegations (created_at desc);

create index if not exists revote_legal_delegations_phone_hash_idx
  on public.revote_legal_delegations (phone_hash);

-- RLS: 익명은 INSERT 만, 관리자(authenticated)는 전체 접근
alter table public.revote_legal_delegations enable row level security;

drop policy if exists revote_deleg_insert_anon on public.revote_legal_delegations;
create policy revote_deleg_insert_anon on public.revote_legal_delegations
  for insert to anon, authenticated with check (true);

drop policy if exists revote_deleg_admin_all on public.revote_legal_delegations;
create policy revote_deleg_admin_all on public.revote_legal_delegations
  for all to authenticated using (true) with check (true);
