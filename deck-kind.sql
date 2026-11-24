-- ShipInsure Rep Hub — Custom Decks in Brand Folders (Preview Designer › Custom Deck)
-- Project: shipinsure-calculators (oiljklutlmtztascnkpm). Run once in Supabase → SQL Editor. Safe to re-run.
--
-- What it does
--   • merchant_assets.kind gains 'deck', so a rep can save a Custom Deck (the ShipInsure deck filled in
--     for the merchant) into the merchant's Brand Folder and share it as a short link.
--   • Keeps every existing kind (checkout, email, claim, proposal, msa, mnda, onepager, faq, lightbox, demo).
--   • Nothing else changes: same table, same team-wide policies, same asset_get short links.
-- ────────────────────────────────────────────────────────────────────────────

-- Swap the kind check (whatever it's called) for one that includes 'deck'.
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
  check (kind in ('checkout','email','claim','proposal','msa','mnda','onepager','faq','lightbox','demo','deck'));

notify pgrst, 'reload schema';
