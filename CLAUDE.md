@AGENTS.md

# webXsi0Game - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webXsi0Game`, public). Never the work account.
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

## Abandoned rooms (120 s)
`GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
every room in ANY status (`waiting`, `playing`, `finished`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS`
(120 s, `game.ts`) and with no member (player or spectator, both `xand0_players` rows) `last_seen_at` within 120 s is
deleted (players cascade). Open room pages keep both fresh (`/state` polls every 15 s; `last_seen_at` touched every
10 s, `last_activity_at` every 20 s), so only rooms nobody has open disappear; the room page then shows
"Camera ... nu mai există" (404). The 10/30-minute idle expiry stays too.

Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `tictactoe`);
this game must not be deployed before that table exists.

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the **free tier** (public repo, standard `ubuntu-latest` runners only: never larger,
macOS or Windows runners, nothing billed), **never locally** (no `npm test`, `tsc`, `eslint`, `next build/dev`, Playwright,
`node scripts/e2e.mjs`), see `D:\_DEv\CLAUDE.md`. Every workflow is `workflow_dispatch` only (no automatic trigger):
nothing gates a push, and Vercel deploys `main` regardless. Start one with `gh workflow run <file> --ref main`, then
`gh run watch <id> --exit-status`, read failures with `gh run view <id> --log-failed`.
| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (also type-checks `tests/ui` and `playwright.config.ts`), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/game.test.ts`, `kick.test.ts`, `reconnect.test.ts`; pure logic, no DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/tictactoe`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit), 1 worker. Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (only for the cleanup safety net;
  the script falls back to `.env.local` when the env is missing). It checks that the deployed client JS contains the
  `package.json` version of the checked-out ref, so run it on `main` after the Vercel deploy of that version finished.
- What E2E does (production DB, 4+ members): HTTP checks (home, `room/XXXXXX`, `/_next` assets under `/tictactoe`, version,
  manifest `start_url`, icons, `web-xsi0-game.vercel.app/tictactoe` serves the same build), then create (password), wrong /
  missing password, join (the round starts as soon as O sits), nickname checks, 2 spectators, the 18-member cap (2 + 16,
  the 19th is refused), state consistency and no leaked secrets, 401s, out-of-turn / spectator / invalid / occupied moves,
  non-host kick, reorder mid-round refused, queue toggle, rejoin from the saved device (old token dead), a win, host
  reorder (who starts; non-host 403, bad order 400), concurrent new rounds (one wins), marks swapped + a draw, concurrent
  moves, pending kick + "Ignoră", leave mid-round = forfeit, the queue (seated player refused, order, un-queue) and the
  queued spectator taking the free seat, kick enforced after 10 s, spectator kick, room isolation, host handover, last one
  out closes the room. Rooms are named `e2e-test-…` and deleted at the end; it never calls `/api/feedback`.
- Rounds of rooms named `e2e-test-…` are never reported to the hub leaderboard (`isTestRoom`, `src/lib/server/leaderboard.ts`).
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 15 s, so this checks Realtime):
  - `game.e2e.ts` (both projects): two browser contexts (= two devices): create, join by link, round 1 every move live,
    X wins (status + score on both screens), the guest starts round 2 (marks swapped, Bob starts), a draw, both leave.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-game = spectator (banner, disabled cells), the
    players see them, they see every move and the end, queue (players see "coada #1"), a player leaves, the host's new round
    seats the queued spectator as X, they play, leave mid-round = forfeit.
  - `mobile.e2e.ts` (iPhone only): no horizontal scroll on home / waiting room / game, every cell and the leave button
    >= 44 px, a touch tap plays a move the other phone sees live.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- The UI tests find elements by `data-testid`: `home-submit` (Home), `join-submit`, `leave`, `room-status` (with
  `data-status` waiting/playing/finished) (RoomClient), `board`, `cell-0`..`cell-8` (with `data-mark` "X"/"O"/""),
  `status-line`, `score-X` / `score-O`, `new-round`, `change-starter`, `queue-toggle`, `spectator-banner` (Game),
  `player-list` with `li[data-nickname][data-role][data-queued]` (PlayerList). Renaming or removing one breaks `tests/ui`.

