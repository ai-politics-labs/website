# Luma design system

User explicitly chose Refero Luma site400, then requested the entire site use a similar design system while preserving the AIP logo. This replaces the earlier monochrome reference lock. Keep all existing content and functional routes.

Authoritative rendered sources: Luma signup flow1840 screen6943d0a8-214f-4889-9d97-5b06472416dd (centered authentication card), event list3c6cf3f9-cab1-4875-96e6-943160507cf4 (date rail/translucent cards), calendar onboarding262cdedb-db1e-4210-bf77-b50de3a60b85 (compact intro card/panels). Full screenshots inspected through Refero. Luma style-search has no matching style record, so these user-selected screens are the visual authority.

Preserve: pale blue/lavender top wash and pale pink/peach auth wash, transparent compact navigation, system sans with Korean Pretendard fallback, understated gray copy, white translucent14px panels, centered820px content, 8px charcoal actions and inputs. Authentication card20px outer radius; login340px/signup consent form accommodates extra required fields. Source icon/card role stays functional; no fabricated event photos or metrics. The original public/favicon.svg flag/lambda logo and AIP wordmark remain.

Product requirements override literal Luma content: preserve founder statistics, original manifesto, actual calendar/vault content, privacy boundaries, one founder-consent/account flow, and recommendation/UTM metrics. Do not add fake Google/phone authentication or event booking controls.

Scope: homepage, founderform, declaration, atlas/vault, revote/campaign, admin, dashboard, account, auth, board. Shared tokens live in public/community/community.css loaded by base Layout. Page-specific layout remains local. Visual QA after each rendered iteration, with saved verdicts under .omx/state/*luma*/.
