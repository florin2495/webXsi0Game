import { renderIcon } from "@/lib/pwa-icon";

// Apple touch icon. Not the `app/apple-icon.tsx` file convention: with basePath, Next 16 (Turbopack)
// emits that link without the base path. Linked explicitly from metadata.icons in layout.tsx.
export function GET() {
  return renderIcon(180);
}
