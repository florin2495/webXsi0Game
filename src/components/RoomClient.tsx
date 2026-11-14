"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  api,
  ApiRequestError,
  clearSession,
  deviceId,
  parseSession,
  readSessionRaw,
  saveSession,
  subscribeSession,
} from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref, writePref } from "@/lib/client/prefs";
import { realtimeClient } from "@/lib/client/realtime";
import { minutesLabel, NICKNAME_MAX, ROOM_IDLE_MINUTES } from "@/lib/game";
import type { RoomState } from "@/lib/types";
import { FeedbackButton } from "./FeedbackButton";
import { Game } from "./Game";
import { KickModal } from "./KickCountdown";
import { SettingsPanel } from "./SettingsPanel";
import { Button, Card, ErrorText, Field } from "./ui";

const POLL_MS = 15_000;
/** Back after being hidden/offline this long: rebuild the Realtime channel (the socket is likely dead). */
const RECONNECT_AFTER_MS = 5_000;
/** Delay before rebuilding a channel that reported an error, so a broken socket does not spin. */
const CHANNEL_RETRY_MS = 3_000;
const removedKey = (code: string) => `xsi0:removed:${code}`;
const SERVER_SNAPSHOT = "__server__";

export function RoomClient({ code }: { code: string }) {
  const raw = useSyncExternalStore(
    subscribeSession,
    () => readSessionRaw(code),
    () => SERVER_SNAPSHOT,
  );
  const session = useMemo(() => (raw === SERVER_SNAPSHOT ? undefined : parseSession(raw)), [raw]);

  if (session === undefined) return <Loading />;
  if (session === null) return <JoinForm code={code} />;
  return <Room code={code} token={session.token} />;
}

function Loading() {
  return <p className="p-8 text-center text-zinc-500">Se încarcă…</p>;
}

function useRoomState(code: string, token: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const latest = useRef(0); // id of the last request started
  const applied = useRef(0); // id of the request (or local patch) the screen shows

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    try {
      const s = await api<RoomState>(`/api/rooms/${code}/state`, { token });
      // Show any answer newer than what is on screen. Waiting for the *latest* request instead made
      // every action wait for a second /state (broadcast refresh + post-action refresh).
      if (id <= applied.current) return;
      applied.current = id;
      setState(s);
      setError("");
    } catch (err) {
      if (id <= applied.current) return;
      if (err instanceof ApiRequestError && err.status === 401) {
        // Another tab may already hold a newer token for this room (seat reclaimed): keep that one.
        if (parseSession(readSessionRaw(code))?.token !== token) return;
        writePref(removedKey(code), "1"); // kicked, expired or taken over: explain it on the join form
        clearSession(code); // token no longer valid for this room -> show join form
      } else if (err instanceof ApiRequestError && err.status === 404) {
        setMissing(true);
      } else {
        setError(err instanceof Error ? err.message : "Eroare.");
      }
    }
  }, [code, token]);

  /**
   * Applies a change the server just confirmed (e.g. my own move) without a /state round trip.
   * Answers to /state requests started before it are older than the patch, so they are dropped.
   */
  const patch = useCallback((fn: (s: RoomState) => RoomState) => {
    applied.current = latest.current;
    setState((s) => (s ? fn(s) : s));
  }, []);

  // Bumping this tears the Realtime channel down and subscribes again (phones kill sockets in the background).
  const [reconnectKey, setReconnectKey] = useState(0);

  // Initial load, polling fallback, refresh when the page comes back (tab visible, bfcache restore, network).
  useEffect(() => {
    const kick = () => void refresh();
    const timer = window.setTimeout(kick, 0);
    const interval = window.setInterval(kick, POLL_MS);
    let awaySince: number | null = null;
    const away = () => {
      awaySince ??= Date.now();
    };
    const back = (forceReconnect = false) => {
      const longAway = awaySince !== null && Date.now() - awaySince > RECONNECT_AFTER_MS;
      awaySince = null;
      kick();
      if (forceReconnect || longAway) setReconnectKey((k) => k + 1);
    };
    const onVisibility = () => (document.visibilityState === "visible" ? back() : away());
    const onPageShow = (e: PageTransitionEvent) => e.persisted && back(true);
    const onOnline = () => back();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", away);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", away);
    };
  }, [refresh]);

  // Realtime: the server broadcasts a bare "refresh" signal; we re-fetch authenticated state.
  const roomId = state?.room.id;
  useEffect(() => {
    const client = realtimeClient();
    if (!roomId || !client) return;
    let disposed = false;
    let retry: number | undefined;
    const channel = client
      .channel(`xand0:${roomId}`)
      .on("broadcast", { event: "refresh" }, () => void refresh())
      .subscribe((status) => {
        if (disposed) return; // CLOSED from our own cleanup
        if (status === "SUBSCRIBED") void refresh(); // catch anything missed while connecting
        if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") && retry === undefined) {
          retry = window.setTimeout(() => setReconnectKey((k) => k + 1), CHANNEL_RETRY_MS);
        }
      });
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      void client.removeChannel(channel);
    };
  }, [roomId, refresh, reconnectKey]);

  return { state, error, missing, refresh, patch };
}

function Room({ code, token }: { code: string; token: string }) {
  const { state, error, missing, refresh, patch } = useRoomState(code, token);

  if (missing) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-12 text-center">
        <p className="text-lg font-semibold">Camera {code} nu mai există.</p>
        <p className="text-sm text-zinc-500">
          Camerele se închid automat după {minutesLabel(ROOM_IDLE_MINUTES)} în care nimeni nu le are deschise.
        </p>
        <Link href="/" className="font-semibold text-indigo-600 underline">
          Înapoi la început
        </Link>
      </main>
    );
  }
  if (!state) {
    return error ? (
      <main className="mx-auto max-w-md px-4 py-12 text-center">
        <ErrorText>{error}</ErrorText>
        <Button className="mt-4" onClick={() => void refresh()}>
          Reîncearcă
        </Button>
      </main>
    ) : (
      <Loading />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-4">
      <RoomHeader state={state} />
      {error && <ErrorText>Conexiune instabilă: {error}</ErrorText>}
      <Game state={state} token={token} refresh={refresh} patch={patch} />
      <SettingsPanel />
      <LeaveButton state={state} token={token} />
      {state.me.kickRemainingMs !== null && (
        <KickModal ms={state.me.kickRemainingMs} code={state.room.code} token={token} refresh={refresh} />
      )}
    </main>
  );
}

function LeaveButton({ state, token }: { state: RoomState; token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { room, me, players } = state;
  const isHost = room.hostPlayerId === me.id;
  const alone = players.length <= 1;
  const seated = me.role !== "spectator";

  async function leave() {
    const warning = alone
      ? "Ești singur în cameră. Dacă pleci, camera se închide. Continui?"
      : seated && room.status === "playing"
        ? "Runda e în desfășurare. Dacă pleci, adversarul câștigă runda. Continui?"
        : isHost
          ? "Ești host. Dacă pleci, următorul din cameră devine host. Continui?"
          : "Sigur vrei să părăsești camera?";
    if (!window.confirm(warning)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/leave`, { token, body: {} });
    } catch (err) {
      // 401/404: we are already out of the room - leaving locally is still correct.
      if (!(err instanceof ApiRequestError && (err.status === 401 || err.status === 404))) {
        setError(err instanceof Error ? err.message : "Eroare.");
        setBusy(false);
        return;
      }
    }
    router.push("/");
    clearSession(room.code);
  }

  return (
    <div className="pb-6 pt-2 text-center">
      <Button variant="danger" className="w-full" onClick={() => void leave()} disabled={busy} data-testid="leave">
        {busy ? "Se iese…" : seated && room.status === "playing" ? "Părăsește jocul" : "Părăsește camera"}
      </Button>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

function RoomHeader({ state }: { state: RoomState }) {
  const { room } = state;
  const [copied, setCopied] = useState(false);

  async function invite() {
    const url = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/room/${room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `X și 0: ${room.name}`, text: `Intră în camera ${room.code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // user cancelled share / clipboard blocked
    }
  }

  const statusLabel = { waiting: "Așteaptă adversar", playing: "În desfășurare", finished: "Rundă terminată" }[room.status];

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Link href="/" className="text-xs font-semibold text-zinc-500">
          ← X și 0
        </Link>
        <h1 className="truncate text-xl font-black">{room.name}</h1>
        <p className="text-xs text-zinc-500" data-testid="room-status" data-status={room.status}>
          runda {room.round} · {statusLabel}
          {state.me.role === "spectator" && " · tu ești spectator"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <button
        onClick={() => void invite()}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-center dark:border-zinc-700"
        aria-label="Invită prieteni"
      >
        <span className="block font-mono text-lg font-bold tracking-widest">{room.code}</span>
        <span className="block text-[10px] font-semibold uppercase text-zinc-500">
          {copied ? "Link copiat" : "Invită"}
        </span>
        </button>
        <FeedbackButton compact />
      </div>
    </header>
  );
}

function JoinForm({ code }: { code: string }) {
  const stored = useStringPref(PREF_NICKNAME);
  const [typed, setNickname] = useState<string | null>(null);
  const nickname = typed ?? stored ?? "";
  const [password, setPassword] = useState("");
  const removed = useStringPref(removedKey(code)) === "1";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    writePref(PREF_NICKNAME, nickname.trim());
    try {
      const res = await api<{ code: string; playerId: string; token: string }>(`/api/rooms/${code}/join`, {
        body: { nickname, password, deviceId: deviceId() },
      });
      writePref(removedKey(code), "0");
      saveSession(res.code, { playerId: res.playerId, token: res.token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <h1 className="text-center text-2xl font-black">
        Intră în camera <span className="font-mono tracking-widest">{code}</span>
      </h1>
      {removed && (
        <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Nu mai ești în cameră: ai fost scos de host, sesiunea ta a expirat sau a fost preluată pe alt dispozitiv. Dacă
          locul tău mai există, intră cu același nickname ca să îl reiei. Altfel, dacă nu e niciun loc liber, intri ca
          spectator.
        </p>
      )}
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Nickname-ul tău" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={NICKNAME_MAX} required />
          <Field
            label="Parolă (dacă are camera)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} data-testid="join-submit">
            {busy ? "Se încarcă…" : "Intră"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
