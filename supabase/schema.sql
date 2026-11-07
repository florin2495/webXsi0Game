-- X și 0 multiplayer - Supabase schema
-- Lives in the same Supabase project as Bingo; every object is prefixed with xand0_ so nothing collides.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Idempotent: re-running it drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- xand0_rooms: one row per room. The 3x3 board lives here as a 9-char string,
-- row-major, '.' = empty. X always moves first; who is X alternates per round.
-- ---------------------------------------------------------------------------
create table if not exists public.xand0_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null check (char_length(name) between 1 and 40),
  password_hash    text,                                   -- scrypt hash, null = no password
  status           text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  round            integer not null default 1 check (round >= 1),
  board            text not null default '.........' check (board ~ '^[.XO]{9}$'),
  x_player_id      uuid,
  o_player_id      uuid,
  winner           text check (winner in ('X', 'O', 'draw')),
  win_line         smallint[],                             -- the 3 winning cell indexes
  forfeit          boolean not null default false,         -- true when the round ended because a player left
  draws            integer not null default 0 check (draws >= 0),
  host_player_id   uuid,
  version          integer not null default 0,             -- optimistic concurrency for moves / seats
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists xand0_rooms_status_activity_idx on public.xand0_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- xand0_players: everyone in a room. The two seated ones are referenced by
-- xand0_rooms.x_player_id / o_player_id, everyone else is a spectator.
-- Identity = random browser token, only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.xand0_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.xand0_rooms (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  token_hash text not null unique,
  is_host    boolean not null default false,
  wins       integer not null default 0 check (wins >= 0),
  joined_at  timestamptz not null default now(),
  kick_requested_at timestamptz,                           -- pending kick (host kicked mid-round); null = none
  last_seen_at timestamptz not null default now(),         -- presence: disconnected after 45 s, see migrations/002
  device_hash  text                                        -- sha256 of the browser's device id, see migrations/002
);
-- Existing databases: the lines above only apply to a fresh table.
alter table public.xand0_players add column if not exists kick_requested_at timestamptz;
alter table public.xand0_players add column if not exists last_seen_at timestamptz not null default now();
alter table public.xand0_players add column if not exists device_hash text;
create unique index if not exists xand0_players_room_nickname_uq on public.xand0_players (room_id, lower(nickname));
create index if not exists xand0_players_room_idx on public.xand0_players (room_id);
create index if not exists xand0_players_room_seen_idx on public.xand0_players (room_id, last_seen_at);

do $$ begin
  alter table public.xand0_rooms
    add constraint xand0_rooms_host_fk foreign key (host_player_id) references public.xand0_players (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.xand0_rooms
    add constraint xand0_rooms_x_fk foreign key (x_player_id) references public.xand0_players (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.xand0_rooms
    add constraint xand0_rooms_o_fk foreign key (o_player_id) references public.xand0_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write
-- nothing. Only the service role (Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.xand0_rooms   enable row level security;
alter table public.xand0_players enable row level security;

revoke all on public.xand0_rooms, public.xand0_players from anon, authenticated;
