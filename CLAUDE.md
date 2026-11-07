@AGENTS.md

# webXsi0Game - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webXsi0Game`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- The user connects the repo to Vercel by hand. Target domain: `tictactoe.hailatat.icu` (listed in the hub, `../000_Startup`).
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
| `supabase/migrations/001_pending_kick.sql` | **not yet applied** | `xand0_players.kick_requested_at timestamptz`; the code reads it everywhere (PLAYER_COLUMNS), so the app errors until it is applied. Run it BEFORE deploying. |

Rules: new migration = new numbered file in `supabase/migrations/`, additive when possible, also folded into
`supabase/schema.sql`. Verify by effect with the service key from `.env.local`. Never print or commit the keys.

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `tictactoe`);
this game must not be deployed before that table exists.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 4 members (create, join as O, join 2 spectators, a 5th is refused, moves,
  out-of-turn / spectator move refused, win, draw, new round swaps X/O, leave mid-round = forfeit, spectator takes
  the free seat next round, kick, host handover) against `npm run dev`. Delete the test rooms afterwards.
