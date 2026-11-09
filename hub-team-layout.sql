-- ShipInsure Rep Hub — team default tab layout (published by a hub admin)
-- Project: shipinsure-calculators (oiljklutlmtztascnkpm). Same auth as the calculators + Folders.
-- Run in Supabase → SQL Editor → New query → Run. Safe to re-run (idempotent).
--
-- What it adds
--   • hub_admins — who may publish the team layout (by sign-in email). Add yourself with the
--     insert at the bottom; it is left commented so no address lives in this public repo.
--   • hub_is_admin() — true for the signed-in rep when they're a hub admin (the Rep Hub shows the
--     "Publish to all reps" box only then; the policies below are what actually enforce it).
--   • hub_settings — one row per hub-wide setting. key 'tab_layout' = the admin's ⚙ Customize tabs
--     layout (order, sub tabs, on/off, names, icons, logos, colors, custom tabs). `version` goes up on
--     every publish; each rep's hub adopts a version newer than the one it last took.
--
-- Security model
--   • Signed-in reps (signups are disabled, so every user is ShipInsure staff) can read it.
--   • Only hub admins can create or change it. Signed-out visitors can read just the published tab
--     layout, through hub_team_layout() (section 3), never the table itself.
-- ────────────────────────────────────────────────────────────────────────────

-- 1) ADMINS
create table if not exists public.hub_admins (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.hub_admins enable row level security;
revoke all on public.hub_admins from anon, authenticated;   -- read only through hub_is_admin()

create or replace function public.hub_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.hub_admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.hub_is_admin() from public, anon;
grant execute on function public.hub_is_admin() to authenticated;

-- 2) HUB SETTINGS (the published team layout)
create table if not exists public.hub_settings (
  key              text primary key,
  value            jsonb not null,
  version          bigint not null default 1,
  updated_by_email text default (auth.jwt() ->> 'email'),
  updated_at       timestamptz not null default now()
);

-- Every publish bumps the version and stamps who/when.
create or replace function public.hub_settings_touch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then new.version := old.version + 1; else new.version := 1; end if;
  new.updated_at := now();
  new.updated_by_email := coalesce(auth.jwt() ->> 'email', new.updated_by_email);
  return new;
end;
$$;
drop trigger if exists hub_settings_touch on public.hub_settings;
create trigger hub_settings_touch before insert or update on public.hub_settings
  for each row execute function public.hub_settings_touch();

alter table public.hub_settings enable row level security;
revoke all on public.hub_settings from anon;
grant select, insert, update on public.hub_settings to authenticated;

drop policy if exists hub_settings_team_read    on public.hub_settings;
drop policy if exists hub_settings_admin_insert on public.hub_settings;
drop policy if exists hub_settings_admin_update on public.hub_settings;
create policy hub_settings_team_read    on public.hub_settings for select to authenticated using (true);
create policy hub_settings_admin_insert on public.hub_settings for insert to authenticated with check (public.hub_is_admin());
create policy hub_settings_admin_update on public.hub_settings for update to authenticated using (public.hub_is_admin()) with check (public.hub_is_admin());

-- 3) TEAM LAYOUT FOR EVERYONE — the published tab layout only (no other settings), readable without
--    signing in, so a rep who isn't signed in still gets the team's tabs. The Rep Hub page itself is
--    public, so its tab list isn't secret; the tools behind the tabs keep their own sign-in.
create or replace function public.hub_team_layout()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('value', value, 'version', version, 'updated_at', updated_at)
  from public.hub_settings where key = 'tab_layout';
$$;
revoke all on function public.hub_team_layout() from public;
grant execute on function public.hub_team_layout() to anon, authenticated;

-- 4) ADD AN ADMIN (the email they sign in to the Rep Hub with), then run just this line:
-- insert into public.hub_admins (email) values ('you@shipinsure.io') on conflict do nothing;
