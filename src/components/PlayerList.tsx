"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { MAX_MEMBERS } from "@/lib/game";
import type { RoomState } from "@/lib/types";
import { Card, ErrorText } from "./ui";

/** Everyone in the room with their role. The host gets a "Scoate" (kick) button next to the others. */
export function PlayerList({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { players, me, room } = state;
  const canKick = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function kick(id: string, nickname: string, seated: boolean) {
    const midGame = seated && room.status === "playing" ? " Runda în curs o câștigă adversarul lui." : "";
    if (!window.confirm(`Scoți pe ${nickname} din cameră?${midGame}`)) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/kick`, { token, body: { playerId: id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-bold">
        În cameră{" "}
        <span className="font-normal text-zinc-500">
          ({players.length}/{MAX_MEMBERS})
        </span>
      </h2>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <RoleBadge role={p.role} />
              <span className="truncate">
                {p.nickname}
                {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
              </span>
              {p.isHost && (
                <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">
                  host
                </span>
              )}
            </span>
            {canKick && p.id !== me.id && (
              <button
                type="button"
                onClick={() => void kick(p.id, p.nickname, p.role !== "spectator")}
                disabled={busy !== null}
                className="min-h-8 shrink-0 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                aria-label={`Scoate pe ${p.nickname}`}
              >
                {busy === p.id ? "…" : "Scoate"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {players.length < MAX_MEMBERS && (
        <p className="mt-1 text-xs text-zinc-500">
          Mai pot intra {MAX_MEMBERS - players.length} cu codul <span className="font-mono font-bold">{room.code}</span>
          {room.xPlayerId && room.oPlayerId ? ", ca spectatori." : "."}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function RoleBadge({ role }: { role: "X" | "O" | "spectator" }) {
  if (role === "spectator") {
    return (
      <span className="w-20 shrink-0 whitespace-nowrap rounded bg-zinc-100 px-1 text-center text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-900">
        👀 privește
      </span>
    );
  }
  return (
    <span
      className={`w-20 shrink-0 rounded px-1 text-center text-sm font-black ${
        role === "X"
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
      }`}
    >
      {role === "X" ? "X" : "0"}
    </span>
  );
}
