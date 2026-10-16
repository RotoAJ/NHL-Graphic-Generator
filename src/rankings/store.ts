// Run history for the rankings file.
//
// Every run is kept in full, which is what Google Drive could not give: its
// create-new-and-trash-old pattern meant an overwrite could not practically be
// undone (a run that inserted 130 players had to be restored from a cached
// copy). Here a bad run is one click to roll back.
//
// A run is either a PREVIEW (committed = false) or part of the history
// (committed = true). Only committing a run marks the games it counted as
// processed, so previewing is free to repeat and never double-counts.
import type { Changelog, RankRow } from "@/src/rankings/engine";
import type { CsvStyle } from "@/src/rankings/csv";
import { idsJson, num, sql, str } from "@/src/rankings/db";

export type RunKind = "baseline" | "run" | "restore";

export interface RunSummary {
  id: number;
  createdAt: string;
  kind: RunKind;
  committed: boolean;
  committedAt: string | null;
  baseRunId: number | null;
  windowFrom: string | null;
  windowTo: string | null;
  playerCount: number;
  note: string | null;
}

export interface RunDetail extends RunSummary {
  changelog: Changelog | null;
  style: CsvStyle | null;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : str(v));

function toSummary(r: Record<string, unknown>): RunSummary {
  return {
    id: num(r.id),
    createdAt: iso(r.created_at),
    kind: str(r.kind) as RunKind,
    committed: Boolean(r.committed),
    committedAt: r.committed_at ? iso(r.committed_at) : null,
    baseRunId: r.base_run_id === null || r.base_run_id === undefined ? null : num(r.base_run_id),
    windowFrom: r.window_from ? str(r.window_from) : null,
    windowTo: r.window_to ? str(r.window_to) : null,
    playerCount: num(r.player_count),
    note: r.note ? str(r.note) : null,
  };
}

const COLS = `id, created_at, kind, committed, committed_at, base_run_id,
  to_char(window_from, 'YYYY-MM-DD') AS window_from,
  to_char(window_to, 'YYYY-MM-DD') AS window_to,
  player_count, note`;

export async function insertRows(runId: number, rows: RankRow[]): Promise<void> {
  const q = await sql();
  const payload = rows.map((r, i) => ({
    rank: i + 1,
    stats_id: r.statsId,
    player: r.player,
    team: r.team,
    positions: r.positions,
    injury: r.injury,
  }));
  // One statement, however many rows: ~350 single inserts would be 350 round trips.
  await q`
    INSERT INTO rk_rows (run_id, rank, stats_id, player, team, positions, injury)
    SELECT ${runId}, x.rank, x.stats_id, x.player, x.team, x.positions, x.injury
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
        AS x(rank int, stats_id text, player text, team text, positions text, injury text)`;
}

export async function getRows(runId: number): Promise<RankRow[]> {
  const q = await sql();
  const rows = await q`SELECT stats_id, player, team, positions, injury FROM rk_rows WHERE run_id = ${runId} ORDER BY rank ASC`;
  return rows.map((r) => ({
    statsId: str(r.stats_id),
    player: str(r.player),
    team: str(r.team),
    positions: str(r.positions),
    injury: str(r.injury),
  }));
}

export interface NewRun {
  kind: RunKind;
  committed: boolean;
  baseRunId: number | null;
  windowFrom: string | null;
  windowTo: string | null;
  rows: RankRow[];
  changelog: Changelog | null;
  note?: string | null;
  style?: CsvStyle | null;
  gameIds?: number[];
}

export async function createRun(n: NewRun): Promise<number> {
  const q = await sql();
  const meta = JSON.stringify({ style: n.style ?? null });
  const made = await q`
    INSERT INTO rk_runs (kind, committed, committed_at, base_run_id, window_from, window_to,
                         player_count, note, changelog, meta)
    VALUES (${n.kind}, ${n.committed}, ${n.committed ? new Date().toISOString() : null}, ${n.baseRunId},
            ${n.windowFrom}, ${n.windowTo}, ${n.rows.length}, ${n.note ?? null},
            ${n.changelog ? JSON.stringify(n.changelog) : null}::jsonb, ${meta}::jsonb)
    RETURNING id`;
  const id = num(made[0].id);
  await insertRows(id, n.rows);
  if (n.gameIds?.length) {
    await q`
      INSERT INTO rk_run_games (run_id, game_id)
      SELECT ${id}, (g)::bigint FROM jsonb_array_elements_text(${idsJson(n.gameIds)}::jsonb) AS g`;
  }
  return id;
}

export async function getRun(id: number): Promise<RunDetail | null> {
  const q = await sql();
  const r = (await q`
    SELECT id, created_at, kind, committed, committed_at, base_run_id,
           to_char(window_from, 'YYYY-MM-DD') AS window_from,
           to_char(window_to, 'YYYY-MM-DD') AS window_to,
           player_count, note, changelog, meta
      FROM rk_runs WHERE id = ${id}`)[0];
  if (!r) return null;
  const meta = (typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta) as { style?: CsvStyle | null } | null;
  const cl = (typeof r.changelog === "string" ? JSON.parse(r.changelog) : r.changelog) as Changelog | null;
  return { ...toSummary(r), changelog: cl ?? null, style: meta?.style ?? null };
}

export async function latestCommitted(): Promise<RunSummary | null> {
  const q = await sql();
  const r = (await q`SELECT id, created_at, kind, committed, committed_at, base_run_id,
      to_char(window_from, 'YYYY-MM-DD') AS window_from, to_char(window_to, 'YYYY-MM-DD') AS window_to,
      player_count, note FROM rk_runs WHERE committed = TRUE ORDER BY id DESC LIMIT 1`)[0];
  return r ? toSummary(r) : null;
}

export async function latestPreview(): Promise<RunSummary | null> {
  const q = await sql();
  const r = (await q`SELECT id, created_at, kind, committed, committed_at, base_run_id,
      to_char(window_from, 'YYYY-MM-DD') AS window_from, to_char(window_to, 'YYYY-MM-DD') AS window_to,
      player_count, note FROM rk_runs WHERE committed = FALSE ORDER BY id DESC LIMIT 1`)[0];
  return r ? toSummary(r) : null;
}

export async function listRuns(limit = 30): Promise<RunSummary[]> {
  const q = await sql();
  const rows = await q`SELECT id, created_at, kind, committed, committed_at, base_run_id,
      to_char(window_from, 'YYYY-MM-DD') AS window_from, to_char(window_to, 'YYYY-MM-DD') AS window_to,
      player_count, note FROM rk_runs ORDER BY id DESC LIMIT ${limit}`;
  return rows.map(toSummary);
}

/** The date the baseline file already reflects: games on or before it are not counted again. */
export async function baselineThrough(): Promise<string | null> {
  const q = await sql();
  const r = (await q`SELECT to_char(window_to, 'YYYY-MM-DD') AS d FROM rk_runs
                      WHERE kind = 'baseline' ORDER BY id DESC LIMIT 1`)[0];
  return r?.d ? str(r.d) : null;
}

export async function discardPreviews(): Promise<number> {
  const q = await sql();
  const r = await q`DELETE FROM rk_runs WHERE committed = FALSE RETURNING id`;
  return r.length;
}

export async function discardRun(id: number): Promise<boolean> {
  const q = await sql();
  const r = await q`DELETE FROM rk_runs WHERE id = ${id} AND committed = FALSE RETURNING id`;
  return r.length > 0;
}

/**
 * Make a preview part of the history and mark the games it counted as processed.
 *
 * Refuses if the history has moved on since the preview was built (some other run
 * was committed in between): its numbers were computed against a file that is no
 * longer the current one, so committing it would silently discard that run.
 */
export async function commitRun(id: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const q = await sql();
  const run = await getRun(id);
  if (!run) return { ok: false, reason: "That run no longer exists." };
  if (run.committed) return { ok: false, reason: "That run is already committed." };
  const head = await latestCommitted();
  if (!head || head.id !== run.baseRunId) {
    return {
      ok: false,
      reason: "The rankings changed after this preview was built. Discard it and build a fresh one.",
    };
  }
  await q`UPDATE rk_runs SET committed = TRUE, committed_at = NOW() WHERE id = ${id}`;
  await q`UPDATE rk_games SET processed_run = ${id}
           WHERE game_id IN (SELECT game_id FROM rk_run_games WHERE run_id = ${id})`;
  // any other previews were built against the old head and are now stale
  await q`DELETE FROM rk_runs WHERE committed = FALSE AND id <> ${id}`;
  return { ok: true };
}

/**
 * Roll back to an earlier run: the file goes back to how it was, and every game
 * counted by a later run becomes unprocessed again so the next run recounts it.
 * Nothing is deleted -- the rolled-back runs stay in the history.
 */
export async function restoreRun(id: number): Promise<{ ok: true; newRunId: number } | { ok: false; reason: string }> {
  const q = await sql();
  const target = await getRun(id);
  if (!target || !target.committed) return { ok: false, reason: "Only a committed run can be restored." };
  const head = await latestCommitted();
  if (!head) return { ok: false, reason: "There is no history to restore into." };
  const rows = await getRows(id);
  await q`UPDATE rk_games SET processed_run = NULL WHERE processed_run > ${id}`;
  await q`DELETE FROM rk_runs WHERE committed = FALSE`;
  const newId = await createRun({
    kind: "restore",
    committed: true,
    baseRunId: head.id,
    windowFrom: target.windowFrom,
    windowTo: target.windowTo,
    rows,
    changelog: null,
    note: `Restored run #${id} (${target.committedAt?.slice(0, 10) ?? target.createdAt.slice(0, 10)})`,
    style: target.style,
  });
  return { ok: true, newRunId: newId };
}
