-- Apply after founding_member_stats.sql, community.sql and founding_signup.sql.
-- Disable all browser-facing board APIs while retaining recoverable post data.
begin;
revoke all on function public.community_list_posts(integer,text) from public,anon,authenticated;
revoke all on function public.community_get_post(uuid) from public,anon,authenticated;
revoke all on function public.community_save_post(text,text,uuid) from public,anon,authenticated;
revoke all on function public.community_delete_post(uuid) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
