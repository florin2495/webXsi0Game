// End-to-end test of the X și 0 API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /tictactoe]
// Rooms are named "e2e-test-…" and deleted at the end (leave as every member, then a DB delete of leftovers
// with the service key as a safety net: env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else .env.local).
// Never sends feedback.
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/tictactoe").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const BASE_PATH = new URL(BASE).pathname;
const VERCEL = "https://web-xsi0-game.vercel.app" + BASE_PATH;
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

async function http() {
  console.log("HTTP (pages, assets, version, PWA)");
  const get = (u) => fetch(u, { cache: "no-store", redirect: "manual" });
  const home = await get(`${BASE}`);
  const html = await home.text();
  check(home.status === 200 && html.includes("X și 0"), `home page 200 (${home.status})`);
  // The version (next to "Setări") is only on the room page: collect the chunks of both pages.
  const room = await get(`${BASE}/room/XXXXXX`);
  const roomHtml = await room.text();
  check(room.status === 200, `/room/XXXXXX 200 (${room.status}, the client shows the join form)`);
  const assetRe = new RegExp(`${BASE_PATH}/_next/static/[^"'\\\\ ]+\\.(?:js|css)`, "g");
  const assets = [...new Set((html + roomHtml).match(assetRe) ?? [])];
  const statuses = await Promise.all(assets.map(async (a) => (await get(ORIGIN + a)).status));
  check(assets.length > 0 && statuses.every((s) => s === 200), `${assets.length} /_next assets 200`);
  check(!/(src|href)="\/_next\//.test(html), "no un-prefixed /_next links");
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of assets.filter((x) => x.endsWith(".js"))) if ((await (await get(ORIGIN + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version}`);
  const man = await get(`${BASE}/manifest.webmanifest`);
  const manifest = await man.json().catch(() => null);
  check(man.status === 200 && manifest?.start_url === `${BASE_PATH}/`, `manifest 200, start_url ${manifest?.start_url}`);
  for (const icon of [...(manifest?.icons ?? []).map((i) => i.src), `${BASE_PATH}/pwa-icon/apple`, `${BASE_PATH}/favicon.ico`]) {
    const r = await get(ORIGIN + icon);
    check(r.status === 200 && /image/.test(r.headers.get("content-type") ?? ""), `icon ${icon} 200 (${r.status})`);
  }
  const v = await get(VERCEL);
  const vhtml = await v.text();
  const chunks = (h) => JSON.stringify([...new Set(h.match(new RegExp(`${BASE_PATH}/_next/static/[^"'\\\\ ]+\\.js`, "g")) ?? [])].sort());
  check(v.status === 200 && chunks(vhtml) === chunks(html), `${VERCEL} 200 and same build`);
  check((await call("/api/rooms/ZZZZZZ/state", { token: "x" })).status === 404, "unknown room = 404");
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await http();

  console.log("Create, list, join");
  const dev = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID() };
  const r = await call("/api/rooms", { body: { name: `e2e-test-${stamp}`, nickname: "Ana", password: "pw", deviceId: dev.A } });
  check(r.status === 200 && /^[A-Z2-9]{6}$/.test(r.data.code ?? ""), `create room (${r.status})`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana" };
  const join = (nickname, deviceId, password = "pw") => call(`/api/rooms/${code}/join`, { body: { nickname, password, deviceId } });
  check((await join("Bob", dev.B, "nope")).status === 403, "wrong password = 403");
  check((await join("Bob", dev.B, "")).status === 403, "missing password = 403");
  let st = await call(`/api/rooms/${code}/state`, { token: A.token });
  check(st.data.room?.status === "waiting" && st.data.me?.role === "X" && st.data.me?.isHost, "creator is host on X, waiting");
  const B = { ...(await join("Bob", dev.B)).data, name: "Bob" };
  check(Boolean(B.token), "Bob joins");
  const list = await call("/api/rooms");
  const item = list.data.rooms?.find((x) => x.code === code);
  check(item?.hasPassword === true && item.members === 2 && item.status === "playing" && item.seatFree === false, "room in public list (password, 2 members, playing)");
  check(!JSON.stringify(list.data).includes("password_hash") && !("password_hash" in (item ?? {})), "list leaks no hashes");
  const C = { ...(await join("Cris", dev.C)).data, name: "Cris" };
  const D = { ...(await join("Dan", dev.D)).data, name: "Dan" };
  check(Boolean(C.token && D.token), "2 spectators join");
  check((await join("bob", randomUUID())).status === 409, "nickname of a connected member from another device = 409");
  check((await join("", randomUUID())).status === 400, "empty nickname = 400");
  check((await join("x".repeat(11), randomUUID())).status === 400, "nickname > 10 = 400");

  console.log("Member cap: 2 players + 16 spectators");
  const extras = [];
  for (let i = 0; i < 14; i++) {
    const e = await join(`Sp${String(i).padStart(2, "0")}`, randomUUID());
    if (e.data.token) extras.push(e.data);
  }
  check(extras.length === 14, `14 more spectators join (${extras.length}), 18 members`);
  const full = await join("Ema", randomUUID());
  check(full.status === 409, `19th member refused (${full.status})`);
  let left = 0;
  for (const e of extras) if ((await call(`/api/rooms/${code}/leave`, { token: e.token, body: {} })).status === 200) left++;
  check(left === 14, `the 14 extra spectators leave (${left})`);

  console.log("State consistency");
  const sa = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  const sb = (await call(`/api/rooms/${code}/state`, { token: B.token })).data;
  const sc = (await call(`/api/rooms/${code}/state`, { token: C.token })).data;
  check(sa.room.status === "playing" && sa.room.turn === "X" && sa.room.board === ".........", "round 1 started, X on turn");
  check(sa.room.version === sb.room.version && sa.room.board === sc.room.board, "all members see the same room");
  check(sa.me.role === "X" && sb.me.role === "O" && sc.me.role === "spectator", "roles X / O / spectator");
  check(sa.players.map((p) => p.nickname).join() === "Ana,Bob,Cris,Dan", "player order X, O, spectators");
  const raw = JSON.stringify([sa, sb, sc]);
  check(!/token|device_hash|password/.test(raw.replace(/hasPassword/g, "")), "state leaks no token / device / password");

  console.log("Invalid requests");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "no token = 401");
  check((await call(`/api/rooms/${code}/state`, { token: "bad-token" })).status === 401, "bad token = 401");
  check((await call(`/api/rooms/${code}/move`, { token: B.token, body: { cell: 4 } })).status === 409, "O moves first = 409");
  check((await call(`/api/rooms/${code}/move`, { token: C.token, body: { cell: 4 } })).status === 403, "spectator move = 403");
  check((await call(`/api/rooms/${code}/move`, { token: A.token, body: { cell: 9 } })).status === 409, "cell 9 = rejected");
  check((await call(`/api/rooms/${code}/move`, { token: A.token, body: { cell: "x" } })).status === 409, "cell 'x' = rejected");
  check((await call(`/api/rooms/${code}/move`, { token: A.token, body: { cell: 1.5 } })).status === 409, "cell 1.5 = rejected");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: C.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 409, "new round while playing = 409");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [A.playerId, B.playerId, C.playerId, D.playerId] } })).status === 409, "reorder mid-round = 409");
  check((await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} })).data.queued === true, "spectator queues mid-round");
  check((await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} })).data.queued === false, "and un-queues");

  console.log("Rejoin with the saved device");
  const re = await join("Bob", dev.B);
  check(re.status === 200 && re.data.playerId === B.playerId, "Bob rejoins the same seat from the same device");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token no longer valid");
  B.token = re.data.token;
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).data.me?.role === "O", "Bob still O");

  console.log("Round 1: X wins");
  const move = (p, cell) => call(`/api/rooms/${code}/move`, { token: p.token, body: { cell } });
  check((await move(A, 0)).status === 200, "X 0");
  check((await move(A, 1)).status === 409, "X twice = 409");
  check((await move(B, 0)).status === 409, "occupied cell = 409");
  check((await move(B, 3)).status === 200, "O 3");
  const vb = (await call(`/api/rooms/${code}/state`, { token: D.token })).data;
  check(vb.room.board === "X..O....." && vb.room.turn === "X", "spectator sees the moves live");
  await move(A, 1);
  await move(B, 4);
  check((await move(A, 2)).status === 200, "X 2 completes the top row");
  let s = (await call(`/api/rooms/${code}/state`, { token: B.token })).data;
  check(s.room.status === "finished" && s.room.winner === "X" && JSON.stringify(s.room.winLine) === "[0,1,2]", "X wins, line 0-1-2");
  check(s.players.find((p) => p.id === A.playerId).wins === 1 && s.players.find((p) => p.id === B.playerId).wins === 0, "score Ana 1, Bob 0");
  check((await move(B, 8)).status === 409, "move after the end = 409");

  console.log("Host picks who starts (reorder)");
  const ids = [A.playerId, B.playerId, C.playerId, D.playerId];
  const reorder = (p, order) => call(`/api/rooms/${code}/reorder`, { token: p.token, body: { order } });
  check((await reorder(B, ids)).status === 403, "non-host reorder = 403");
  check((await reorder(A, ids.slice(1))).status === 400, "reorder missing a member = 400");
  check((await reorder(A, ids)).status === 200, "host puts Ana first");
  s = (await call(`/api/rooms/${code}/state`, { token: C.token })).data;
  check(s.room.starterPlayerId === A.playerId, "next starter = Ana (seen by a spectator)");
  check((await reorder(A, [B.playerId, A.playerId, D.playerId, C.playerId])).status === 200, "host puts Bob first again");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.starterPlayerId === B.playerId, "next starter = Bob");

  console.log("Round 2: draw");
  check((await call(`/api/rooms/${code}/new-round`, { token: C.token, body: {} })).status === 403, "spectator (not host) new round = 403");
  const [n1, n2] = await Promise.all([
    call(`/api/rooms/${code}/new-round`, { token: B.token, body: {} }),
    call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} }),
  ]);
  check([n1.status, n2.status].sort().join() === "200,409", `double new round: one wins (${n1.status}, ${n2.status})`);
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.round === 2 && s.room.xPlayerId === B.playerId && s.room.oPlayerId === A.playerId && s.room.status === "playing", "marks swapped: Bob is X");
  const seq = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  const played = [];
  for (let i = 0; i < seq.length; i++) {
    const m = await move(i % 2 === 0 ? B : A, seq[i]);
    played.push(m.status === 200 ? "200" : `${m.status} ${m.data.error ?? ""}`);
    if (m.status !== 200) break;
  }
  check(played.length === 9 && played.every((x) => x === "200"), `9 moves played (${played.join(", ")})`);
  s = (await call(`/api/rooms/${code}/state`, { token: C.token })).data;
  check(s.room.status === "finished" && s.room.winner === "draw" && s.room.draws === 1 && s.room.winLine === null, "draw counted");

  console.log("Round 3: concurrent moves, kick + Ignoră, leave = forfeit");
  await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} });
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.xPlayerId === A.playerId && s.room.round === 3, "Ana is X again");
  const both = await Promise.all([move(A, 4), move(A, 0)]);
  check(both.filter((x) => x.status === 200).length === 1, `two concurrent X moves: only one lands (${both.map((x) => x.status)})`);
  s = (await call(`/api/rooms/${code}/state`, { token: B.token })).data;
  check(s.room.board.split("").filter((c) => c === "X").length === 1, "board has exactly one X");
  const k = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: B.playerId } });
  check(k.data.pending === true, "kick of a seated player mid-round is pending");
  s = (await call(`/api/rooms/${code}/state`, { token: B.token })).data;
  check(s.me.kickRemainingMs > 0, "kicked player sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: C.token, body: {} })).status === 200 && (await call(`/api/rooms/${code}/state`, { token: B.token })).data.me.kickRemainingMs > 0, "someone else cannot cancel the kick");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: B.token, body: {} })).status === 200, "Ignoră");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).data.me.kickRemainingMs === null, "kick cleared");
  check((await call(`/api/rooms/${code}/leave`, { token: B.token, body: {} })).status === 200, "Bob leaves mid-round");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "finished" && s.room.winner === "X" && s.room.forfeit === true, "Ana wins by forfeit");
  check(s.me.wins === 2 && s.room.oPlayerId === null, "Ana 2 wins, O seat empty");

  console.log("Round 4: queued spectator takes the free seat, kick enforced after 10 s");
  check((await call(`/api/rooms/${code}/queue`, { token: A.token, body: {} })).status === 409, "seated player cannot queue = 409");
  const qd = await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} });
  const qc = await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} });
  check(qd.data.queued === true && qc.data.queued === true, "Dan then Cris queue for the next round");
  s = (await call(`/api/rooms/${code}/state`, { token: C.token })).data;
  check(s.me.queued && s.me.queuePosition === 2, `Cris is #2 in the queue (${s.me.queuePosition})`);
  check((await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} })).data.queued === false, "Dan leaves the queue");
  s = (await call(`/api/rooms/${code}/state`, { token: C.token })).data;
  check(s.me.queuePosition === 1 && s.players.find((p) => p.id === D.playerId).queued === false, "Cris moves up to #1");
  await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} });
  s = (await call(`/api/rooms/${code}/state`, { token: C.token })).data;
  check(s.room.status === "playing" && s.me.role === "X" && s.room.oPlayerId === A.playerId, "Cris (queued) is X, Ana O");
  check(s.me.queued === false && s.players.find((p) => p.id === D.playerId).role === "spectator", "Cris left the queue, Dan (not queued) still watches");
  await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: C.playerId } });
  await sleep(12_500);
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).status === 401, "kick enforced after 12 s");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "finished" && s.room.winner === "O" && s.room.forfeit && s.me.wins === 3, "Ana wins by forfeit");
  check((await join("Cris", dev.C)).status === 200, "kicked player can come back (no ban, by design)");

  console.log("Kick spectator, host handover, second room isolation");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  const cris2 = s.players.find((p) => p.nickname === "Cris");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } })).status === 200, "kick spectator");
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).status === 401, "kicked spectator out at once");
  const r2 = await call("/api/rooms", { body: { name: `e2e-test-${stamp}-2`, nickname: "Zed", deviceId: randomUUID() } });
  created.add(r2.data.code);
  check((await call(`/api/rooms/${r2.data.code}/state`, { token: A.token })).status === 401, "token of room 1 rejected in room 2");
  check((await call(`/api/rooms/${r2.data.code}/leave`, { token: r2.data.token, body: {} })).data.roomClosed === true, "room 2 closed");
  created.delete(r2.data.code);
  check((await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} })).data.roomClosed === false, "host leaves");
  const crisTok = (await join("Cris", dev.C)).data.token;
  s = (await call(`/api/rooms/${code}/state`, { token: crisTok })).data;
  check(s.room.hostPlayerId === cris2?.id && s.me.isHost, "host passed to Cris");

  console.log("Cleanup");
  const last = await call(`/api/rooms/${code}/leave`, { token: crisTok, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await join("X", randomUUID())).status === 404, "room gone");
  created.delete(code);
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    // GitHub Actions passes the repo secrets as env; locally fall back to .env.local. Never printed.
    const file = new URL("../.env.local", import.meta.url);
    const local = existsSync(file)
      ? Object.fromEntries(
          readFileSync(file, "utf8")
            .split(/\r?\n/)
            .filter((l) => l.includes("=") && !l.startsWith("#"))
            .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
        )
      : {};
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || local.SUPABASE_SERVICE_ROLE_KEY,
    };
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("no Supabase env");
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/xand0_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
