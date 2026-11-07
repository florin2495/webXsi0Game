@AGENTS.md

# webXsi0Game - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webXsi0Game`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- The user connects the repo to Vercel by hand. Served at `games.hailatat.icu/tictactoe` via a multi-zones rewrite in the hub (`../000_Startup`) to `web-xsi0-game.vercel.app/tictactoe`; `basePath` is `/tictactoe`, so client `fetch`/share URLs must add `NEXT_PUBLIC_BASE_PATH`.
- Every push to `main` deploys to production once Vercel is connected. Ask the user before pushing, unless they say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown next to "Setări".
- Functions run in `fra1` (Frankfurt, `vercel.json` `{ "regions": ["fra1"] }`), next to the Supabase DB. Never remove it: the Vercel default `iad1` (Washington) makes every DB query cross the Atlantic (1-2 s per request instead of ~0.3 s).

## Database (same Supabase project as Bingo, `vgpcagpqbeiqplfidmwo`)
Tables are prefixed `xand0_`, the Realtime topic is `xand0:<roomId>`, so nothing collides with Bingo.
Migrations are run by hand in the Supabase SQL editor. **Update this table whenever the user confirms one ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-06, verified: service key reads, anon gets 42501) | `xand0_rooms`, `xand0_players` |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `xand0_players.kick_requested_at timestamptz`; the code reads it everywhere (PLAYER_COLUMNS), so the app errors until it is applied. Run it BEFORE deploying. |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `xand0_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Read via PLAYER_COLUMNS, so run it BEFORE deploying. |

Rules: new migration = new numbered file in `supabase/migrations/`, additive when possible, also folded into
`supabase/schema.sql`. Verify by effect with the service key from `.env.local`. Never print or commit the keys.

Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (≤ every 10 s);
re-joining with a nickname already in the room reclaims that member (same player id, so same X/O seat or spectator
place and wins, new token) from the same device (`device_hash`) or once it has been unseen for 45 s, also mid-round.
`/state` exposes only a derived `connected` flag; never add `token_hash` / `device_hash` to PLAYER_COLUMNS.

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `tictactoe`);
this game must not be deployed before that table exists.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 4 members (create, join as O, join 2 spectators, a 5th is refused, moves,
  out-of-turn / spectator move refused, win, draw, new round swaps X/O, leave mid-round = forfeit, spectator takes
  the free seat next round, kick, host handover) against `npm run dev`. Delete the test rooms afterwards.
