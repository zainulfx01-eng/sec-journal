-- Zainul FX Journal Stage 3 patch. Run once in the Supabase SQL editor AFTER supabase-setup.sql.
-- Safe to run more than once (every statement is idempotent).
-- Adds the column that holds the full trade record so every field round-trips between devices.

alter table public.trades add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.trades add column if not exists emotions text;
alter table public.trades add column if not exists screenshots jsonb default '[]'::jsonb;

-- The sync engine upserts on (user_id, local_id) and (user_id, entry_date). These indexes make that work.
create unique index if not exists trades_user_local on public.trades (user_id, local_id);
create unique index if not exists reflections_user_date on public.reflections (user_id, entry_date);
