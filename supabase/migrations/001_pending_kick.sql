-- Pending kick: the host's kick during a running game starts a 10 s countdown instead of removing the player.
-- null = no pending kick. Run by hand in the Supabase SQL editor. Idempotent.
alter table public.xand0_players add column if not exists kick_requested_at timestamptz;
