-- ShipInsure Rep Hub — Info Lightboxes + SI Interactive Demos in Brand Folders (Preview Designer)
-- Project: shipinsure-calculators (oiljklutlmtztascnkpm). Run once in Supabase → SQL Editor. Safe to re-run.
--
-- What it does
--   • merchant_assets.kind gains 'lightbox' (Info Lightbox: the modal behind the widget's ⓘ) and
--     'demo' (SI Interactive Demo: which saves make up the merchant's shopper-journey demo).
--   • Keeps every existing kind, including 'onepager' and 'faq'.
--   • Nothing else changes: same table, same team-wide policies, same asset_get short links.
-- ────────────────────────────────────────────────────────────────────────────

-- Swap the kind check (whatever it's called) for one that includes the new kinds.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.merchant_assets'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.merchant_assets drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.merchant_assets
  add constraint merchant_assets_kind_check
  check (kind in ('checkout','email','claim','proposal','msa','mnda','onepager','faq','lightbox','demo'));

notify pgrst, 'reload schema';
