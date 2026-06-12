// Downloads the bundled fonts (Barlow Condensed + IBM Plex Mono) from the
// open-source google/fonts repo into public/fonts/.
// Run once after install:  npm run download-fonts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "fonts");
const GF = "https://raw.githubusercontent.com/google/fonts/main/ofl";

const FONTS: Array<{ url: string; file: string }> = [
  { url: `${GF}/barlowcondensed/BarlowCondensed-Black.ttf`, file: "BarlowCondensed-Black.ttf" },
  { url: `${GF}/barlowcondensed/BarlowCondensed-Bold.ttf`, file: "BarlowCondensed-Bold.ttf" },
  { url: `${GF}/barlowcondensed/BarlowCondensed-Regular.ttf`, file: "BarlowCondensed-Regular.ttf" },
  { url: `${GF}/ibmplexmono/IBMPlexMono-Regular.ttf`, file: "IBMPlexMono-Regular.ttf" },
  { url: `${GF}/ibmplexmono/IBMPlexMono-Medium.ttf`, file: "IBMPlexMono-Medium.ttf" },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of FONTS) {
    try {
      const res = await fetch(f.url);
      if (!res.ok) {
        console.warn(`✗ ${f.file} (${res.status})`);
        continue;
      }
      writeFileSync(path.join(OUT, f.file), Buffer.from(await res.arrayBuffer()));
      console.log(`✓ ${f.file}`);
    } catch (e) {
      console.warn(`✗ ${f.file} — ${(e as Error).message}`);
    }
  }
  console.log("\nDone.");
}

main();
