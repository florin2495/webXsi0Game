@AGENTS.md

# webXsi0Game - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webXsi0Game`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- The user connects the repo to Vercel by hand. Target domain: `xsi0.hailatat.icu` (listed in the hub, `../000_Startup`).
- Every push to `main` deploys to production once Vercel is connected. Ask the user before pushing, unless they say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown next to "Setări".

## Database (same Supabase project as Bingo, `vgpcagpqbeiqplfidmwo`)
Tables are prefixed `xand0_`, the Realtime topic is `xand0:<roomId>`, so nothing collides with Bingo.
Migrations are run by hand in the Supabase SQL editor. **Update this table whenever the user confirms one ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-06, verified: service key reads, anon gets 42501) | `xand0_rooms`, `xand0_players` |

Rules: new migration = new numbered file in `supabase/migrations/`, additive when possible, also folded into
`supabase/schema.sql`. Verify by effect with the service key from `.env.local`. Never print or commit the keys.

## Testing
- `npm test` (Vitest, pure rules in `src/lib/game.ts`), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 4 members (create, join as O, join 2 spectators, a 5th is refused, moves,
  out-of-turn / spectator move refused, win, draw, new round swaps X/O, leave mid-round = forfeit, spectator takes
  the free seat next round, kick, host handover) against `npm run dev`. Delete the test rooms afterwards.
