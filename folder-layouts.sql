-- ShipInsure Rep Hub — Brand Folders layouts (✎ Customize on a folder)
-- Project: shipinsure-calculators (oiljklutlmtztascnkpm). Run once in Supabase → SQL Editor. Safe to re-run.
--
-- What it adds
--   • merchants.layout — one folder's customized layout: block order, widths, colors, hidden
--     sections, and its custom Links / Text / Embed blocks. Every signed-in rep can already read and
--     edit every folder (merchant-folders-schema.sql), so the whole team sees the same layout.
--   The default layout for all folders lives in hub_settings (key 'folder_layout'), published by a
--   hub admin; it reuses the table and policies from hub-team-layout.sql.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.merchants add column if not exists layout jsonb;

notify pgrst, 'reload schema';
