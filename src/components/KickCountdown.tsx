"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Button, ErrorText } from "./ui";

/**
 * Live countdown (whole seconds, rounded up) for a pending kick. `ms` is what /state reported; the local
 * clock only measures the time since it arrived, so client clock skew does not matter.
 * When it reaches 0 it asks for a refresh (the server then removes the player), and once more after the
 * server's 2 s network grace, because enforcement only kicks in after that.
 */
export function useKickSeconds(ms: number | null, refresh: () => Promise<void>): number | null {
  const [left, setLeft] = useState<number | null>(ms);
  useEffect(() => {
    if (ms === null) return;
    const end = Date.now() + ms;
    let fired = false;
    let late: number | undefined;
    const tick = () => {
      const remaining = Math.max(0, end - Date.now());
      setLeft(remaining);
      if (remaining === 0 && !fired) {
        fired = true;
        void refresh();
        late = window.setTimeout(() => void refresh(), 2500);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(late);
    };
  }, [ms, refresh]);
  return ms === null || left === null ? null : Math.ceil(left / 1000);
}

/** "iese în N s" badge next to a player whose kick is pending (shown to everyone but that player). */
export function KickBadge({ ms, refresh }: { ms: number; refresh: () => Promise<void> }) {
  const s = useKickSeconds(ms, refresh);
  return (
    <span className="shrink-0 whitespace-nowrap rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      iese în {s ?? Math.ceil(ms / 1000)} s
    </span>
  );
}

/** Blocking modal for the kicked player: only "Ignoră" closes it. */
export function KickModal({ ms, code, token, refresh }: { ms: number; code: string; token: string; refresh: () => Promise<void> }) {
  const s = useKickSeconds(ms, refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ignore() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${code}/kick/ignore`, { token, body: {} });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kick-title"
        aria-describedby="kick-text"
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 text-center text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <h2 id="kick-title" className="text-lg font-bold">
          Ai fost scos din joc
        </h2>
        <p id="kick-text" className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Gazda te-a scos din cameră. Apasă „Ignoră” în {s ?? Math.ceil(ms / 1000)} s ca să rămâi în joc.
        </p>
        <p className="my-3 text-5xl font-black tabular-nums text-rose-600 dark:text-rose-400" aria-hidden>
          {s ?? Math.ceil(ms / 1000)}
        </p>
        <Button className="w-full" onClick={() => void ignore()} disabled={busy}>
          Ignoră
        </Button>
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </div>
  );
}
