-- Read-only public-consent profile snapshot. Names are masked before returning.
-- Occupation is included at the site owner's explicit request. No contacts/IDs are returned.
with permitted as (
  select id, created_at, btrim(name) as n,
    coalesce(nullif(btrim(occupation), ''), '') as occupation
  from public.founding_members
  where public_consent is true
    and privacy_agreed is true
    and nullif(btrim(name), '') is not null
), masked as (
  select id, created_at, occupation, case
    when char_length(n) = 1 then '*'
    when char_length(n) = 2 then left(n, 1) || '*'
    else left(n, 1) || repeat('*', char_length(n) - 2) || right(n, 1)
  end as display_name
  from permitted
)
select jsonb_build_object(
  'count', count(*),
  'profiles', coalesce(jsonb_agg(
    jsonb_build_object('name', display_name, 'occupation', occupation)
    order by created_at, id
  ), '[]'::jsonb)
) as public_profiles
from masked;
