import { applyMove, outcome } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { addWin, requireMember, requireStatus, roleOf } from "@/lib/server/room";

// POST /api/rooms/[code]/move  { cell: 0..8 } - only the seated player whose mark is on turn.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/move">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "playing");

    const role = roleOf(room, player.id);
    if (role === "spectator") fail(403, "Ești spectator. Poți juca de la runda următoare, dacă se eliberează un loc.");

    const body = await readJson(req);
    const move = applyMove(room.board, Number(body.cell), role);
    if (!move.ok) fail(409, move.reason);

    const result = outcome(move.board);
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      board: move.board,
      version: room.version + 1,
      updated_at: now,
      last_activity_at: now,
    };
    if (result) {
      Object.assign(update, { status: "finished", winner: result.winner, win_line: result.line });
      if (result.winner === "draw") update.draws = room.draws + 1;
    }

    // Version check: of two concurrent moves only one can win; the other gets a clean 409.
    const { data, error } = await db()
      .from("xo_rooms")
      .update(update)
      .eq("id", room.id)
      .eq("version", room.version)
      .eq("status", "playing")
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) fail(409, "Tabla s-a schimbat între timp. Mai încearcă.");

    if (result && result.winner !== "draw") await addWin(player.id);

    await notifyRoom(room.id, result ? "round_over" : "move");
    return { ok: true };
  });
}
