-- ShipInsure Rep Hub — Brand kit per merchant folder
-- Project: shipinsure-calculators (oiljklutlmtztascnkpm). Run once in Supabase → SQL Editor. Safe to re-run.
--
-- What it adds
--   • merchants.brand — the merchant's reusable images, as public URLs in the existing 'logos' bucket:
--       { secondary, hero, favicon, banner, lock }   (the main logo stays in merchants.logo_path)
--     lock = a custom ShipInsure lock built with the Lock builder (the merchant's logo inside the SI lock).
--   Every signed-in rep can already read and edit every folder (merchant-folders-schema.sql), so the
--   whole team shares one brand kit per merchant. Tools copy the image URLs into their saves, so
--   merchant-facing links never need to read this column.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.merchants add column if not exists brand jsonb;

notify pgrst, 'reload schema';
