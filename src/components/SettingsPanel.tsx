"use client";

import { PREF_SOUND, useBoolPref } from "@/lib/client/prefs";
import { Card, Toggle } from "./ui";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

/** Per-device settings, collapsed by default. */
export function SettingsPanel() {
  const [soundOn, setSoundOn] = useBoolPref(PREF_SOUND, true);

  return (
    <Card className="py-2">
      <details className="group">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-bold">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>
            Setări
          </span>
          <span className="font-mono text-xs text-zinc-500">v{VERSION}</span>
        </summary>
        <div className="pb-1 pt-1">
          <Toggle
            label="Sunete"
            hint="Un semnal scurt când vine tura ta și la finalul rundei."
            checked={soundOn}
            onChange={setSoundOn}
          />
        </div>
      </details>
    </Card>
  );
}
