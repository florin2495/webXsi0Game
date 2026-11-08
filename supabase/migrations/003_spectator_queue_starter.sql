-- Spectator queue ("Intră la runda următoare") and host-chosen starter (reorder).
-- Additive and idempotent. Run it BEFORE deploying: the code reads both columns everywhere.
alter table public.xand0_players add column if not exists queued_at timestamptz;          -- spectator waiting for a seat; null = not queued
alter table public.xand0_rooms   add column if not exists starter_player_id uuid;         -- who gets X (moves first) in the next round
do $$ begin
  alter table public.xand0_rooms
    add constraint xand0_rooms_starter_fk foreign key (starter_player_id) references public.xand0_players (id) on delete set null;
exception when duplicate_object then null; end $$;
