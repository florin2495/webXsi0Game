"use client";

// Tiny synthesized cues (Web Audio), no audio files to ship.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, startIn: number, duration: number, volume = 0.15) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = a.currentTime + startIn;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Short "your move" ping. */
export function playTurn() {
  tone(880, 0, 0.18);
}

/** Rising arpeggio for a win, a flat pair for a loss / draw. */
export function playEnd(kind: "win" | "lose" | "draw") {
  if (kind === "win") [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3));
  else if (kind === "lose") [392, 330].forEach((f, i) => tone(f, i * 0.18, 0.35));
  else [440, 440].forEach((f, i) => tone(f, i * 0.18, 0.25));
}
