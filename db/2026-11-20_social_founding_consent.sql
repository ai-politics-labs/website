-- Additive follow-up to 2026-10-09_founding_signup.sql.
-- Kakao and Google sign-in create the Auth account before the consent form is
-- submitted, so the referral that the email signup trigger used to record at
-- account creation is recorded here, together with the founding consent.
begin;

create or replace function public.community_submit_founding_consent_referred(
  p_founder jsonb,p_referrer_username text default null,p_visitor_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare v_user uuid := auth.uid(); v_id uuid; v_founder jsonb;
  v_referrer text := nullif(lower(btrim(p_referrer_username)),''); v_owner uuid; v_link uuid; v_method text;
begin
  if v_user is null or not exists(select 1 from auth.users where id = v_user and email is not null and btrim(email) <> '' and email_confirmed_at is not null) then
    raise exception 'COMMUNITY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,29));
  select id into v_id from public.founding_members where submitted_by = v_user and privacy_agreed = true order by created_at,id limit 1;
  if found then return jsonb_build_object('id',v_id,'already_registered',true); end if;
  v_founder := private.community_validate_founder(p_founder);
  v_id := private.community_insert_founder(v_user,v_founder);

  if v_referrer is not null then
    select p.user_id into v_owner from public.community_profiles p join auth.users u on u.id = p.user_id
      where p.username = v_referrer and u.email_confirmed_at is not null;
    if v_owner is null then raise exception 'COMMUNITY_REFERRER_INVALID' using errcode = '22023'; end if;
    if v_owner = v_user then raise exception 'COMMUNITY_SELF_REFERRAL' using errcode = '22023'; end if;
    select t.link_id into v_link from private.community_first_touch t where t.visitor_id = p_visitor_id
      and t.owner_id = v_owner and t.touched_at >= now() - interval '30 days';
    v_method := 'manual';
  elsif p_visitor_id is not null then
    select t.owner_id,t.link_id into v_owner,v_link from private.community_first_touch t
      join auth.users u on u.id = t.owner_id and u.email_confirmed_at is not null
      where t.visitor_id = p_visitor_id and t.touched_at >= now() - interval '30 days';
    v_method := 'visit';
    -- Opening your own invitation link is not a referral and must not block consent.
    if v_owner = v_user then v_owner := null; end if;
  end if;
  if v_owner is not null then
    insert into private.community_referrals(signup_user_id,referrer_id,link_id,attribution_method)
    values(v_user,v_owner,v_link,v_method) on conflict (signup_user_id) do nothing;
  end if;
  return jsonb_build_object('id',v_id,'already_registered',false);
end $$;
revoke all on function public.community_submit_founding_consent_referred(jsonb,text,uuid) from public,anon;
grant execute on function public.community_submit_founding_consent_referred(jsonb,text,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
