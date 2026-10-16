"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { Changelog } from "@/src/rankings/engine";
import type { OutlookLog } from "@/src/rankings/outlook";
import type { RunDetail, RunSummary } from "@/src/rankings/store";

interface State {
  head: RunSummary | null;
  through: string | null;
  preview: RunDetail | null;
  runs: RunSummary[];
}

const when = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function List({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <details className="rk-detail">
      <summary>
        {title} <span className="rk-count">{items.length}</span>
      </summary>
      {items.length ? (
        <ul className="warn-list">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <div className="hint">{empty}</div>
      )}
    </details>
  );
}

function ChangelogView({ log }: { log: Changelog }) {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <div>
      <div className="rk-chips">
        <span>{log.startCount} → <strong>{log.endCount}</strong> players</span>
        <span><strong>{log.added.length}</strong> added</span>
        <span><strong>{log.removed.length}</strong> removed</span>
        <span><strong>{log.droppedCap.length}</strong> dropped (cap)</span>
        <span><strong>{log.injuryPenalties.length}</strong> new injury penalties</span>
      </div>

      <List
        title="New players added"
        items={log.added.map(
          (a) => `${a.player} (${a.team}) — ${a.signal}; stat rank ${a.statRank}, inserted at ${a.insertionRank}`,
        )}
        empty="No one qualified this run."
      />
      <List
        title="Corrected (stale team or misspelled name)"
        items={(log.corrections ?? []).map((c) => `${c.player}: ${c.field} ${c.from} → ${c.to}`)}
      />
      <List title="Removed" items={log.removed.map((r) => `${r.player} — ${r.reason}`)} />
      <List
        title="Biggest movers up"
        items={log.movers.up.map((m) => `${m.player}: ${m.from} → ${m.to} (${m.reason})`)}
      />
      <List
        title="Biggest movers down"
        items={log.movers.down.map((m) => `${m.player}: ${m.from} → ${m.to} (${m.reason})`)}
      />
      <List
        title="Injury penalties applied (one-time)"
        items={log.injuryPenalties.map(
          (p) => `${p.player}: −${pct(p.pct)} (return ${p.returnDate ?? "unknown"}, ${p.daysOut ?? "?"} days)`,
        )}
      />
      <div className="hint" style={{ margin: "6px 0 10px" }}>
        {log.injuryHeldUnchanged} held at their rank because the return date is unchanged · {log.injuryCleared} injuries cleared
      </div>
      <List
        title="Qualified but held by the 15-per-run cap"
        items={log.heldByCap.names.map((n) => n)}
        empty={undefined}
      />
      {log.heldByCap.count > 0 && (
        <div className="hint" style={{ margin: "0 0 10px" }}>
          {log.heldByCap.count} players qualified but were deferred to the next run&apos;s own evaluation
          (showing up to 20 above).
        </div>
      )}
      <List
        title="Held out: no RotoWire Stats ID could be found"
        items={log.heldNoId.map((h) => `${h.player} — ${h.signal}`)}
      />
      <List title="Dropped to stay at 350" items={log.droppedCap.map((d) => `${d.player} (was ${d.fellFrom})`)} />
      <List title="Worth a look: listed out but played" items={log.contradictions} />
      <List
        title="Production we could not match to a RotoWire id"
        items={log.unmatchedProduction.map((u) => `${u.name} (${u.team}) — ${u.games} game(s)`)}
      />
      <List title="Notes" items={log.notes} />
    </div>
  );
}

function OutlookView({ logs }: { logs: Partial<Record<7 | 14, OutlookLog>> | null }) {
  if (!logs || (!logs[7] && !logs[14])) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <div className="side-title">Schedule outlooks</div>
      {([7, 14] as const).map((w) => {
        const l = logs[w];
        if (!l) return null;
        const items = [
          `Window ${l.today} → ${l.windowEnd}; the league average is ${l.leagueAvgGames.toFixed(2)} games per team.`,
          `${l.basis.prior.length} team(s) on last season's goals for/against, ${l.basis.current.length} on this season's (switches at 10 games played).`,
          ...l.notes.filter((n) => !/Prior-season goals/.test(n)),
          ...(l.teamsWithoutSchedule.length ? [`No schedule found for: ${l.teamsWithoutSchedule.join(", ")}`] : []),
        ];
        return (
          <div key={w} style={{ marginBottom: 6 }}>
            <List title={`${w}-day outlook — notes`} items={items} />
            <List
              title={`${w}-day — left out (not back in time)`}
              items={l.excluded.map((x) => `${x.player} — returns ${x.returnDate}`)}
            />
            <List
              title={`${w}-day — biggest movers up`}
              items={l.movers.up.map((m) => `${m.player}: ${m.from} → ${m.to} (${m.reason})`)}
            />
            <List
              title={`${w}-day — biggest movers down`}
              items={l.movers.down.map((m) => `${m.player}: ${m.from} → ${m.to} (${m.reason})`)}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function RankingsTool() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [through, setThrough] = useState(yesterdayLocal());
  const [detail, setDetail] = useState<Record<number, RunDetail | "loading">>({});

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/rankings/state");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      setState(j as State);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const call = useCallback(
    async (label: string, url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> => {
      setBusy(label);
      setError(null);
      setInfo(null);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const json = (await r.json()) as Record<string, unknown>;
        if (!r.ok) throw new Error(String(json.error ?? `Failed (${r.status})`));
        return { ok: true, json };
      } catch (e) {
        setError((e as Error).message);
        return { ok: false, json: {} };
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const onBaseline = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const csv = await file.text();
      const r = await call("Uploading the file…", "/api/rankings/baseline", { csv, through });
      if (r.ok) {
        const w = (r.json.warnings as string[]) ?? [];
        setInfo(`Loaded ${r.json.players} players.${w.length ? ` Notes: ${w.join(" ")}` : ""}`);
        await refresh();
      }
    },
    [call, refresh, through],
  );

  const build = useCallback(async () => {
    const r = await call(
      "Building a preview… the first one loads this season's games and can take a minute.",
      "/api/rankings/run",
      {},
    );
    if (r.ok) await refresh();
  }, [call, refresh]);

  const act = useCallback(
    async (action: "commit" | "discard" | "restore", runId: number, confirmText?: string) => {
      if (confirmText && !window.confirm(confirmText)) return;
      const r = await call("Working…", "/api/rankings/commit", { runId, action });
      if (r.ok) {
        setInfo(action === "commit" ? "Committed. This is now the current file." : action === "restore" ? "Restored." : "Discarded.");
        await refresh();
      }
    },
    [call, refresh],
  );

  const toggle = useCallback(
    async (id: number) => {
      if (detail[id]) {
        setDetail((d) => {
          const n = { ...d };
          delete n[id];
          return n;
        });
        return;
      }
      setDetail((d) => ({ ...d, [id]: "loading" }));
      const r = await fetch(`/api/rankings/run?id=${id}`);
      const j = await r.json();
      setDetail((d) => ({ ...d, [id]: r.ok ? (j.run as RunDetail) : ("loading" as const) }));
    },
    [detail],
  );

  if (!state && !error) return <div className="panel" style={{ marginTop: 20 }}>Loading…</div>;

  const head = state?.head ?? null;
  const preview = state?.preview ?? null;

  return (
    <>
      {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
      {info && <div className="panel rk-info" style={{ marginTop: 16 }}>{info}</div>}
      {busy && <div className="panel rk-info" style={{ marginTop: 16 }}>{busy}</div>}

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="side-title">Current rankings file</div>
        {head ? (
          <>
            <div>
              <strong>{head.playerCount}</strong> players · from run #{head.id} ({head.kind}),{" "}
              {when(head.committedAt ?? head.createdAt)}
            </div>
            <div className="hint">Games through {state?.through ?? "—"} were already reflected in the starting file.</div>
            <div className="rk-row">
              <a className="download" href="/api/rankings/csv?run=latest">Download CSV</a>
              <a className="download" href="/api/rankings/outlook?window=7&run=latest">7-Day Outlook CSV</a>
              <a className="download" href="/api/rankings/outlook?window=14&run=latest">14-Day Outlook CSV</a>
            </div>
          </>
        ) : (
          <div className="hint">No file yet. Upload the current rankings file below to get started.</div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="side-title">{head ? "Replace the starting file" : "Upload the current rankings file"}</div>
        <div className="hint" style={{ marginBottom: 10 }}>
          Choose the CSV that the Cowork skill last produced (columns: Stats ID, Player, Team, Positions, Injury),
          and the last day whose games it already reflects. Games on or before that date are never counted again.
          If the last run happened on the morning of a given day, use the day before.
        </div>
        <label htmlFor="through">Games already reflected through</label>
        <input id="through" type="date" value={through} onChange={(e) => setThrough(e.target.value)} />
        <label htmlFor="rkfile" style={{ marginTop: 12 }}>Rankings file (.csv)</label>
        <input id="rkfile" type="file" accept=".csv,text/csv" onChange={onBaseline} disabled={!!busy} />
      </div>

      {head && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="side-title">Build a preview</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            Counts every game since the last run, applies the rules, and shows exactly what would change.
            Nothing is saved to the current file until you commit it.
          </div>
          <button className="generate" disabled={!!busy} onClick={build}>
            {preview ? "Rebuild preview" : "Build preview"}
          </button>
        </div>
      )}

      {preview && preview.changelog && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="side-title">Preview — not yet committed</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            Games {preview.windowFrom} to {preview.windowTo} · built {when(preview.createdAt)}
          </div>
          <ChangelogView log={preview.changelog} />
          <OutlookView logs={preview.outlook} />
          <div className="rk-row">
            <button
              className="copy-btn"
              disabled={!!busy}
              onClick={() =>
                act("commit", preview.id, "Commit this run? It becomes the current rankings file and counts these games as processed.")
              }
            >
              Commit this run
            </button>
            <button className="copy-btn" disabled={!!busy} onClick={() => act("discard", preview.id)}>
              Discard
            </button>
            <a className="download" href="/api/rankings/csv?run=preview">Download preview CSV</a>
            <a className="download" href="/api/rankings/outlook?window=7&run=preview">7-Day Outlook</a>
            <a className="download" href="/api/rankings/outlook?window=14&run=preview">14-Day Outlook</a>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="side-title">History</div>
        {!state?.runs.length ? (
          <div className="hint">No runs yet.</div>
        ) : (
          <table className="rk-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>When</th>
                <th>Type</th>
                <th>Players</th>
                <th>Games</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.runs.map((r) => {
                const isHead = head?.id === r.id;
                const d = detail[r.id];
                return (
                  <Fragment key={r.id}>
                    <tr className={isHead ? "rk-head" : ""}>
                      <td>#{r.id}{isHead ? " (current)" : ""}</td>
                      <td>{when(r.committedAt ?? r.createdAt)}</td>
                      <td>{r.committed ? r.kind : "preview"}</td>
                      <td>{r.playerCount}</td>
                      <td>{r.windowFrom && r.windowTo ? `${r.windowFrom} → ${r.windowTo}` : "—"}</td>
                      <td className="rk-actions">
                        <a href={`/api/rankings/csv?run=${r.id}`}>CSV</a>
                        <a href={`/api/rankings/outlook?window=7&run=${r.id}`}>7d</a>
                        <a href={`/api/rankings/outlook?window=14&run=${r.id}`}>14d</a>
                        {r.kind !== "baseline" && r.committed && (
                          <button type="button" className="rk-link" onClick={() => toggle(r.id)}>
                            {d ? "Hide" : "Details"}
                          </button>
                        )}
                        {r.committed && !isHead && (
                          <button
                            type="button"
                            className="rk-link"
                            disabled={!!busy}
                            onClick={() =>
                              act("restore", r.id, `Roll the rankings back to run #${r.id}? Games counted by later runs will be counted again next time.`)
                            }
                          >
                            Restore
                          </button>
                        )}
                      </td>
                    </tr>
                    {d && (
                      <tr>
                        <td colSpan={6}>
                          {d === "loading" ? (
                            <div className="hint">Loading…</div>
                          ) : d.changelog ? (
                            <>
                              <ChangelogView log={d.changelog} />
                              <OutlookView logs={d.outlook} />
                            </>
                          ) : (
                            <div className="hint">{d.note ?? "No details were kept for this run."}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
