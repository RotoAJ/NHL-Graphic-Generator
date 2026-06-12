import { GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import path from "node:path";

let registered = false;

/**
 * Register bundled fonts once per process. Falls back silently to system
 * fonts if the files are not present yet (run `npm run download-fonts`).
 */
export function ensureFonts(): void {
  if (registered) return;
  registered = true;

  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const fonts: Array<{ file: string; family: string }> = [
    { file: "BarlowCondensed-Black.ttf", family: "Barlow Condensed Black" },
    { file: "BarlowCondensed-Bold.ttf", family: "Barlow Condensed" },
    { file: "BarlowCondensed-Regular.ttf", family: "Barlow Condensed" },
    { file: "IBMPlexMono-Regular.ttf", family: "IBM Plex Mono" },
    { file: "IBMPlexMono-Medium.ttf", family: "IBM Plex Mono Medium" },
  ];

  for (const { file, family } of fonts) {
    const p = path.join(fontsDir, file);
    if (existsSync(p)) {
      try {
        GlobalFonts.registerFromPath(p, family);
      } catch {
        // ignore — fall back to default fonts
      }
    }
  }
}
