-- ============================================================================
-- 선거권 회복 100만 서명운동 (revote) — Supabase 스키마
-- aiparty.kr 와 동일한 Supabase 프로젝트에 적용합니다.
-- Supabase 대시보드 → SQL Editor 에서 통째로 실행하세요.
-- 모든 객체는 revote_ 접두사로 기존 founding_members 와 충돌하지 않습니다.
-- ============================================================================

-- 추천 코드 생성기 (혼동 문자 0,O,1,I 제외한 32진수 6자리)
create or replace function public.revote_gen_code()
returns text
language sql
volatile
set search_path = public
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 31) + 1)::int, 1),
    ''
  )
  from generate_series(1, 6)
$$;

-- 접수번호 시퀀스 (R-YYYYMMDD-000001)
create sequence if not exists public.revote_receipt_seq;

-- ----------------------------------------------------------------------------
-- 1) 서명 (signatures)
-- ----------------------------------------------------------------------------
create table if not exists public.revote_signatures (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  phone                  text not null,            -- 저장(Postgres at-rest 암호화). MVP 정책.
  phone_hash             text not null,            -- SHA-256(정규화 번호) 중복확인용
  email                  text,
  region_sido            text not null,
  region_sigungu         text,
  voted_region           text,
  age_range              text,
  referral_code          text not null default public.revote_gen_code(),  -- 본인 추천코드
  referred_by            text,                     -- 유입 추천코드
  wants_legal_updates    boolean not null default false,
  wants_campaign_updates boolean not null default false,
  third_party_consent    boolean not null default false,
  user_agent             text,
  status                 text not null default 'ACTIVE',   -- ACTIVE | DUPLICATE | DELETED
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

-- 중복 방지: 활성 서명 중 동일 phone_hash 1건만
create unique index if not exists revote_signatures_phone_hash_uniq
  on public.revote_signatures (phone_hash)
  where status <> 'DELETED';

create unique index if not exists revote_signatures_referral_code_uniq
  on public.revote_signatures (referral_code);

create index if not exists revote_signatures_created_at_idx
  on public.revote_signatures (created_at desc);

create index if not exists revote_signatures_sido_idx
  on public.revote_signatures (region_sido);

-- ----------------------------------------------------------------------------
-- 2) 피해 제보 (reports)
-- ----------------------------------------------------------------------------
create table if not exists public.revote_reports (
  id                        uuid primary key default gen_random_uuid(),
  receipt_no                text unique,
  reporter_name             text not null,
  phone                     text not null,
  phone_hash                text not null,
  email                     text,
  incident_date             date not null,
  sido                      text not null,
  sigungu                   text not null,
  polling_station_name      text not null,
  arrival_time              time,
  wait_time_minutes         integer,
  was_able_to_vote          boolean not null,
  gave_up_voting            boolean not null,
  incident_types            jsonb not null default '[]'::jsonb,
  official_guidance         text,
  description               text not null,
  witnesses                 boolean,
  witness_contact_available boolean,
  legal_contact_consent     boolean not null default false,
  evidence_use_consent      boolean not null default false,
  user_agent                text,
  status                    text not null default 'SUBMITTED',  -- 14.1 상태값
  legal_priority            text,                               -- LOW | MEDIUM | HIGH
  admin_note                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists revote_reports_status_idx on public.revote_reports (status);
create index if not exists revote_reports_sido_idx on public.revote_reports (sido);
create index if not exists revote_reports_created_at_idx on public.revote_reports (created_at desc);

-- 접수번호 자동 발급 트리거
create or replace function public.revote_set_receipt_no()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.receipt_no is null then
    new.receipt_no := 'R-' ||
      to_char((now() at time zone 'Asia/Seoul'), 'YYYYMMDD') || '-' ||
      lpad(nextval('public.revote_receipt_seq')::text, 6, '0');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists revote_reports_receipt_trg on public.revote_reports;
create trigger revote_reports_receipt_trg
  before insert or update on public.revote_reports
  for each row execute function public.revote_set_receipt_no();

-- ----------------------------------------------------------------------------
-- 3) 제보 첨부파일 (report files) — Storage 메타데이터
-- ----------------------------------------------------------------------------
create table if not exists public.revote_report_files (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.revote_reports(id) on delete cascade,
  storage_path       text not null,             -- revote-evidence 버킷 내 경로
  file_name_original text,
  file_type          text,
  file_size          integer,
  checksum           text,
  uploaded_at        timestamptz not null default now()
);

create index if not exists revote_report_files_report_idx
  on public.revote_report_files (report_id);

-- ----------------------------------------------------------------------------
-- 4) 동의 로그 (consent logs)
-- ----------------------------------------------------------------------------
create table if not exists public.revote_consent_logs (
  id              uuid primary key default gen_random_uuid(),
  subject_type    text not null,            -- SIGNATURE | REPORT
  subject_id      uuid not null,
  consent_type    text not null,            -- PRIVACY | THIRD_PARTY | EVIDENCE_USE | SENSITIVE_NOTICE | LEGAL_CONTACT
  consent_version text not null,
  consented       boolean not null,
  consented_at    timestamptz not null default now(),
  user_agent      text
);

create index if not exists revote_consent_logs_subject_idx
  on public.revote_consent_logs (subject_type, subject_id);

-- ----------------------------------------------------------------------------
-- 5) 추천 추적 (referrals)
-- ----------------------------------------------------------------------------
create table if not exists public.revote_referrals (
  id                     uuid primary key default gen_random_uuid(),
  referral_code          text not null,
  visitor_id             text,
  channel                text,                    -- kakao | link | x | facebook
  converted_signature_id uuid references public.revote_signatures(id),
  clicked_at             timestamptz not null default now(),
  converted_at           timestamptz
);

create index if not exists revote_referrals_code_idx
  on public.revote_referrals (referral_code);

-- ----------------------------------------------------------------------------
-- 6) 관리자 감사 로그 (audit logs)
-- ----------------------------------------------------------------------------
create table if not exists public.revote_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid,
  admin_email  text,
  action       text not null,            -- VIEW | UPDATE | EXPORT | DOWNLOAD | STATUS_CHANGE
  target_type  text,                     -- SIGNATURE | REPORT | FILE
  target_id    uuid,
  before_value jsonb,
  after_value  jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists revote_audit_logs_created_idx
  on public.revote_audit_logs (created_at desc);

-- ----------------------------------------------------------------------------
-- 7) 개인정보 삭제 요청 (delete requests) — PRD 13.4
-- ----------------------------------------------------------------------------
create table if not exists public.revote_delete_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text not null,
  request_type text not null,            -- SIGNATURE | REPORT | FILE | ALL
  contact      text,
  reason       text,
  status       text not null default 'PENDING',  -- PENDING | DONE | REJECTED
  created_at   timestamptz not null default now()
);

alter table public.revote_delete_requests enable row level security;

drop policy if exists revote_del_insert_anon on public.revote_delete_requests;
create policy revote_del_insert_anon on public.revote_delete_requests
  for insert to anon, authenticated with check (true);

drop policy if exists revote_del_admin_all on public.revote_delete_requests;
create policy revote_del_admin_all on public.revote_delete_requests
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 카운터 RPC — 익명 호출 가능, 집계값만 노출 (개별 행 비공개 유지)
-- ----------------------------------------------------------------------------
create or replace function public.revote_signature_count()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'total', (select count(*) from public.revote_signatures where status = 'ACTIVE'),
    'today', (select count(*) from public.revote_signatures
              where status = 'ACTIVE'
                and created_at >= date_trunc('day', now() at time zone 'Asia/Seoul')),
    'goal', 1000000
  )
$$;

grant execute on function public.revote_signature_count() to anon, authenticated;

-- 추천 전환 연결 RPC (서명 생성 후 referred_by 가 있으면 referrals 갱신)
create or replace function public.revote_link_referral(
  p_code text,
  p_signature_id uuid,
  p_channel text default 'link'
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.revote_referrals
     set converted_signature_id = p_signature_id,
         converted_at = now()
   where referral_code = p_code
     and converted_signature_id is null
     and clicked_at = (
       select max(clicked_at) from public.revote_referrals
       where referral_code = p_code and converted_signature_id is null
     );
$$;

grant execute on function public.revote_link_referral(text, uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- RLS (Row Level Security)
-- 원칙: 익명(anon)은 INSERT 만, 개별 행 SELECT 불가(집계는 RPC).
--       로그인 관리자(authenticated)는 전체 SELECT/UPDATE.
-- ----------------------------------------------------------------------------
alter table public.revote_signatures   enable row level security;
alter table public.revote_reports       enable row level security;
alter table public.revote_report_files  enable row level security;
alter table public.revote_consent_logs  enable row level security;
alter table public.revote_referrals     enable row level security;
alter table public.revote_audit_logs    enable row level security;

-- signatures
drop policy if exists revote_sig_insert_anon on public.revote_signatures;
create policy revote_sig_insert_anon on public.revote_signatures
  for insert to anon, authenticated with check (true);

drop policy if exists revote_sig_admin_all on public.revote_signatures;
create policy revote_sig_admin_all on public.revote_signatures
  for all to authenticated using (true) with check (true);

-- reports
drop policy if exists revote_rep_insert_anon on public.revote_reports;
create policy revote_rep_insert_anon on public.revote_reports
  for insert to anon, authenticated with check (true);

drop policy if exists revote_rep_admin_all on public.revote_reports;
create policy revote_rep_admin_all on public.revote_reports
  for all to authenticated using (true) with check (true);

-- report_files
drop policy if exists revote_file_insert_anon on public.revote_report_files;
create policy revote_file_insert_anon on public.revote_report_files
  for insert to anon, authenticated with check (true);

drop policy if exists revote_file_admin_all on public.revote_report_files;
create policy revote_file_admin_all on public.revote_report_files
  for all to authenticated using (true) with check (true);

-- consent_logs (insert only for anon; admin read)
drop policy if exists revote_consent_insert_anon on public.revote_consent_logs;
create policy revote_consent_insert_anon on public.revote_consent_logs
  for insert to anon, authenticated with check (true);

drop policy if exists revote_consent_admin_read on public.revote_consent_logs;
create policy revote_consent_admin_read on public.revote_consent_logs
  for select to authenticated using (true);

-- referrals (anon insert for visit tracking; admin read)
drop policy if exists revote_ref_insert_anon on public.revote_referrals;
create policy revote_ref_insert_anon on public.revote_referrals
  for insert to anon, authenticated with check (true);

drop policy if exists revote_ref_admin_read on public.revote_referrals;
create policy revote_ref_admin_read on public.revote_referrals
  for select to authenticated using (true);

-- audit_logs (admin only)
drop policy if exists revote_audit_admin_all on public.revote_audit_logs;
create policy revote_audit_admin_all on public.revote_audit_logs
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Storage 버킷: revote-evidence (비공개)
-- 정책: 익명 업로드 허용(제보 시점), 다운로드/조회는 로그인 관리자만.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('revote-evidence', 'revote-evidence', false)
on conflict (id) do nothing;

drop policy if exists revote_evidence_upload on storage.objects;
create policy revote_evidence_upload on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'revote-evidence');

drop policy if exists revote_evidence_admin_read on storage.objects;
create policy revote_evidence_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'revote-evidence');

-- ============================================================================
-- 관리자 계정: Supabase 대시보드 → Authentication → Users 에서 생성하세요.
-- (founding_members admin 과 동일 Auth 사용)
-- ============================================================================
