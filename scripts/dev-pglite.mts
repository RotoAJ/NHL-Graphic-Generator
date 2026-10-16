// Dev-only launcher: runs the real Next app with an in-process Postgres (PGlite)
// standing in for Neon, so database-backed pages can be exercised locally.
//
//   npx tsx scripts/dev-pglite.mts          (serves http://localhost:3055)
//
// It lives under scripts/, not in the app, so no test scaffolding ships.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import next from "next";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.APP_PASSWORD = "dev-local"; // a throwaway local password, so the real sign-in path is exercised

const pg = new PGlite();
globalThis.__RK_SQL = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  let text = "";
  strings.forEach((s, i) => (text += s + (i < values.length ? `$${i + 1}` : "")));
  const r = await pg.query(text, values);
  return r.rows as Record<string, unknown>[];
};

const port = Number(process.env.PORT ?? 3055);
const app = next({ dev: true, port });
await app.prepare();
const handle = app.getRequestHandler();
createServer((req, res) => handle(req, res)).listen(port, () => {
  console.log(`ready on http://localhost:${port} (in-memory database)`);
});
