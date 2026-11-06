import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
// Node.js runtime is the default; `runtime` segment config is not allowed with cacheComponents.

const GAME = "tictactoe";
const MESSAGE_MAX = 1000;
const NICKNAME_LIMIT = 40;

// POST /api/feedback - stores a short player message in the hub's shared `hub_feedback` table.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    // Honeypot: bots fill the hidden field; pretend success without storing anything.
    if (typeof body.website === "string" && body.website.trim() !== "") return { ok: true };

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 1 || message.length > MESSAGE_MAX) {
      fail(400, `Mesajul trebuie să aibă 1-${MESSAGE_MAX} caractere.`);
    }
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    if (nickname.length > NICKNAME_LIMIT) fail(400, `Nickname-ul poate avea cel mult ${NICKNAME_LIMIT} de caractere.`);

    const { error } = await db()
      .from("hub_feedback")
      .insert({
        game: GAME,
        message,
        nickname: nickname || null,
        app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
      });
    if (error) throw error;
    return { ok: true };
  });
}
