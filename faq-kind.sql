-- ShipInsure Rep Hub — FAQs in Brand Folders (Demo Design › FAQ)
-- Project: shipinsure-calculators (oiljklutlmtztascnkpm). Run once in Supabase → SQL Editor. Safe to re-run.
--
-- What it does
--   • merchant_assets.kind gains 'faq', so a rep can save an FAQ design (the merchant's FAQ page with
--     ShipInsure's shipping-protection Q&A added) into the merchant's Brand Folder.
--   • Keeps every existing kind, including 'onepager' (onepager-kind.sql).
--   • Nothing else changes: same table, same team-wide policies, same asset_get short links.
-- ────────────────────────────────────────────────────────────────────────────

-- Swap the kind check (whatever it's called) for one that includes 'faq'.
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
  check (kind in ('checkout','email','claim','proposal','msa','mnda','onepager','faq'));

notify pgrst, 'reload schema';
