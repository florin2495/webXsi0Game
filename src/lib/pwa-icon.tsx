import { ImageResponse } from "next/og";

// Opaque icon: indigo background, white X and amber 0, drawn with shapes only.
// `scale` shrinks the artwork (maskable icons keep it inside the central 80%).
export function renderIcon(size: number, scale = 1) {
  const art = size * 0.78 * scale; // artwork box
  const slot = art * 0.5; // each symbol's box
  const stroke = slot * 0.2;
  const bar = slot * 1.18;
  const barStyle = {
    position: "absolute" as const,
    left: (slot - bar) / 2,
    top: (slot - stroke) / 2,
    width: bar,
    height: stroke,
    borderRadius: stroke / 2,
    background: "#ffffff",
  };
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
        }}
      >
        <div style={{ display: "flex", width: art, height: slot }}>
          <div style={{ position: "relative", display: "flex", width: slot, height: slot }}>
            <div style={{ ...barStyle, transform: "rotate(45deg)" }} />
            <div style={{ ...barStyle, transform: "rotate(-45deg)" }} />
          </div>
          <div
            style={{
              display: "flex",
              width: slot,
              height: slot,
              boxSizing: "border-box",
              border: `${stroke}px solid #fbbf24`,
              borderRadius: slot,
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
