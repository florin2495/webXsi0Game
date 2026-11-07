"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { PREF_SOUND, useBoolPref } from "@/lib/client/prefs";
import { playEnd, playTurn } from "@/lib/client/sound";
import type { Mark } from "@/lib/game";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { OfflineBadge, PlayerList } from "./PlayerList";
import { Button, Card, ErrorText } from "./ui";

/** Internally the marks are "X" / "O"; in Romanian the game is "X și 0". */
const show = (m: Mark) => (m === "X" ? "X" : "0");
const markColor = (m: Mark) => (m === "X" ? "text-indigo-600 dark:text-indigo-400" : "text-rose-600 dark:text-rose-400");

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
}

export function Game({ state, token, refresh }: Props) {
  const { room, me, players } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Optimistic move, shown until the server state moves past the version it was made on.
  const [pending, setPending] = useState<{ cell: number; version: number } | null>(null);
  const [soundOn] = useBoolPref(PREF_SOUND, true);

  const byId = new Map(players.map((p) => [p.id, p]));
  const xPlayer = room.xPlayerId ? byId.get(room.xPlayerId) : undefined;
  const oPlayer = room.oPlayerId ? byId.get(room.oPlayerId) : undefined;
  const myMark: Mark | null = me.role === "spectator" ? null : me.role;
  const isHost = room.hostPlayerId === me.id;

  const livePending = pending && pending.version === room.version ? pending : null;
  const board =
    livePending && myMark
      ? room.board.slice(0, livePending.cell) + myMark + room.board.slice(livePending.cell + 1)
      : room.board;
  const myTurn = room.status === "playing" && myMark !== null && room.turn === myMark && !livePending;
  const winLine = new Set(room.winLine ?? []);

  // Sound cues: when the turn comes to me, and once when a round ends.
  const prev = useRef<{ myTurn: boolean; status: string; round: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { myTurn, status: room.status, round: room.round };
    if (!soundOn || !before) return;
    if (room.status === "finished" && (before.status !== "finished" || before.round !== room.round)) {
      if (room.winner === "draw" || !myMark) playEnd("draw");
      else playEnd(room.winner === myMark ? "win" : "lose");
    } else if (myTurn && !before.myTurn) {
      playTurn();
    }
  }, [myTurn, room.status, room.round, room.winner, myMark, soundOn]);

  async function play(cell: number) {
    if (!myTurn || busy || board[cell] !== ".") return;
    setBusy(true);
    setError("");
    setPending({ cell, version: room.version });
    try {
      await api(`/api/rooms/${room.code}/move`, { token, body: { cell } });
      await refresh();
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : "Eroare.");
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function newRound() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/new-round`, { token, body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Scoreboard x={xPlayer} o={oPlayer} draws={room.draws} turn={room.turn} meId={me.id} />

      <Card className={myTurn ? "border-indigo-400 ring-2 ring-indigo-400" : ""}>
        <StatusLine state={state} x={xPlayer} o={oPlayer} myTurn={myTurn} waitingForServer={Boolean(livePending)} />

        <div
          role="grid"
          aria-label="Tabla de joc"
          className="mx-auto mt-3 grid aspect-square w-full max-w-sm grid-cols-3 gap-2"
        >
          {Array.from(board).map((c, i) => {
            const mark = c === "." ? null : (c as Mark);
            const playable = myTurn && !mark && !busy;
            const inLine = winLine.has(i);
            return (
              <button
                key={i}
                type="button"
                role="gridcell"
                onClick={() => void play(i)}
                disabled={!playable}
                aria-label={`Rândul ${Math.floor(i / 3) + 1}, coloana ${(i % 3) + 1}: ${mark ? show(mark) : "liber"}`}
                className={`group flex aspect-square items-center justify-center rounded-xl border-2 text-6xl font-black transition-colors sm:text-7xl ${
                  inLine
                    ? "border-amber-400 bg-amber-100 dark:border-amber-500 dark:bg-amber-950"
                    : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                } ${playable ? "cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950" : ""} ${
                  livePending?.cell === i ? "opacity-60" : ""
                }`}
              >
                {mark && <span className={markColor(mark)}>{show(mark)}</span>}
                {!mark && playable && myMark && (
                  <span className={`opacity-0 transition-opacity group-hover:opacity-25 ${markColor(myMark)}`}>
                    {show(myMark)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {room.status === "finished" && (
          <div className="mt-4 flex flex-col gap-2">
            {myMark !== null || isHost ? (
              <Button onClick={() => void newRound()} disabled={busy}>
                {busy ? "Se pornește…" : "Rundă nouă"}
              </Button>
            ) : (
              <p className="text-center text-sm text-zinc-500">Aștepți ca unul dintre jucători să pornească runda nouă.</p>
            )}
            <p className="text-center text-xs text-zinc-500">
              La runda nouă jucătorii schimbă X cu 0, deci începe celălalt.
              {(!room.xPlayerId || !room.oPlayerId) && " Locul liber îl ia primul spectator."}
            </p>
          </div>
        )}
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>

      <PlayerList state={state} token={token} refresh={refresh} />
    </div>
  );
}

function Scoreboard({
  x,
  o,
  draws,
  turn,
  meId,
}: {
  x: PublicPlayer | undefined;
  o: PublicPlayer | undefined;
  draws: number;
  turn: Mark | null;
  meId: string;
}) {
  const side = (mark: Mark, p: PublicPlayer | undefined) => (
    <div
      className={`flex min-w-0 flex-1 flex-col items-center rounded-xl border-2 px-2 py-2 ${
        turn === mark
          ? mark === "X"
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
            : "border-rose-500 bg-rose-50 dark:bg-rose-950"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      }`}
    >
      <span className={`text-3xl font-black leading-none ${markColor(mark)}`}>{show(mark)}</span>
      <span className="mt-1 max-w-full truncate text-sm font-semibold">
        {p ? p.nickname : <span className="text-zinc-400">liber</span>}
        {p?.id === meId && <span className="font-normal text-zinc-500"> (tu)</span>}
      </span>
      <OfflineBadge connected={p?.connected} />
      <span className="text-2xl font-black tabular-nums">{p?.wins ?? 0}</span>
    </div>
  );

  return (
    <div className="flex items-stretch gap-2" aria-label="Scor">
      {side("X", x)}
      <div className="flex shrink-0 flex-col items-center justify-center px-1 text-center">
        <span className="text-[10px] font-semibold uppercase text-zinc-500">remize</span>
        <span className="text-lg font-bold tabular-nums text-zinc-500">{draws}</span>
      </div>
      {side("O", o)}
    </div>
  );
}

function StatusLine({
  state,
  x,
  o,
  myTurn,
  waitingForServer,
}: {
  state: RoomState;
  x: PublicPlayer | undefined;
  o: PublicPlayer | undefined;
  myTurn: boolean;
  waitingForServer: boolean;
}) {
  const { room, me } = state;
  const spectator = me.role === "spectator";
  const nameOf = (m: Mark) => (m === "X" ? x : o)?.nickname ?? show(m);

  let text: string;
  let tone = "text-zinc-700 dark:text-zinc-300";

  if (room.status === "waiting") {
    text = spectator
      ? "Se așteaptă al doilea jucător."
      : `Aștepți un adversar. Trimite-i codul ${room.code} sau apasă „Invită”.`;
  } else if (room.status === "playing" && room.turn) {
    if (waitingForServer) text = "Se trimite mutarea…";
    else if (myTurn) {
      text = `Tura ta: pui ${show(room.turn)}.`;
      tone = "text-indigo-600 dark:text-indigo-400";
    } else text = `Tura lui ${nameOf(room.turn)} (${show(room.turn)}).`;
  } else if (room.winner === "draw") {
    text = "🤝 Remiză!";
    tone = "text-zinc-900 dark:text-zinc-100";
  } else if (room.winner) {
    const mine = room.winner === me.role;
    const how = room.forfeit ? " Adversarul a părăsit jocul." : "";
    text = mine ? `🏆 Ai câștigat!${how}` : `🏆 ${nameOf(room.winner)} a câștigat (${show(room.winner)}).${how}`;
    tone = mine ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";
  } else {
    text = "";
  }

  return (
    <div className="flex flex-col gap-1">
      {spectator && (
        <p className="rounded-lg bg-zinc-100 px-3 py-1.5 text-center text-xs font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          👀 Ești spectator. Vezi jocul live. Dacă un jucător pleacă, îi iei locul la runda următoare.
        </p>
      )}
      <p role="status" aria-live="polite" className={`text-center text-lg font-bold ${tone}`}>
        {text}
      </p>
    </div>
  );
}
