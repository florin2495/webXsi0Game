"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref } from "@/lib/client/prefs";
import { Button, ErrorText } from "./ui";

const MAX = 1000;

export function FeedbackButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`shrink-0 whitespace-nowrap rounded-lg border border-zinc-300 font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-xs"
        }`}
      >
        <span aria-hidden>💬</span> Feedback
      </button>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const nickname = useStringPref(PREF_NICKNAME) ?? "";
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [sent, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Scrie câteva cuvinte înainte de a trimite.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/feedback", { body: { message, nickname: nickname.trim() || undefined, website } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        {sent ? (
          <p role="status" className="py-6 text-center text-lg font-semibold">
            Mulțumim! Mesajul a ajuns.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <h2 id="feedback-title" className="text-lg font-bold">
              Feedback
            </h2>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Ce problemă ai găsit sau ce am putea îmbunătăți?
              <textarea
                ref={area}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MAX}
                rows={5}
                required
                className="rounded-lg border border-zinc-300 bg-white p-3 text-base text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <span className="self-end text-xs font-normal text-zinc-500">
                {message.length}/{MAX}
              </span>
            </label>
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
            />
            <ErrorText>{error}</ErrorText>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={onClose}>
                Anulează
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Se trimite…" : "Trimite"}
              </Button>
            </div>
            <a
              href="https://hailatat.icu/feedback"
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            >
              Vezi tot feedback-ul →
            </a>
          </form>
        )}
      </div>
    </div>
  );
}
