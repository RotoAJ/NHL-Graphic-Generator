// Downloads all 32 NHL team logos into public/logos/.
// Run once after install:  npm run download-logos
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TEAMS } from "../src/teams";

const OUT = path.join(process.cwd(), "public", "logos");
const BASE = "https://assets.nhle.com/logos/nhl/svg";

async function grab(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let ok = 0;
  for (const t of TEAMS) {
    // Download both variants; the renderer prefers _dark on the dark canvas.
    const dark = await grab(`${BASE}/${t.abbr}_dark.svg`, path.join(OUT, `${t.abbr}_dark.svg`));
    const light = await grab(`${BASE}/${t.abbr}_light.svg`, path.join(OUT, `${t.abbr}_light.svg`));
    if (dark || light) {
      ok++;
      console.log(`✓ ${t.abbr}`);
    } else {
      console.warn(`✗ ${t.abbr} — no logo downloaded (check abbreviation)`);
    }
  }
  console.log(`\nDone. ${ok}/${TEAMS.length} teams have at least one logo.`);
}

main();
