"use client";

import { useCallback, useEffect, useState } from "react";

interface Store {
  total: number;
  minId: number | null;
  maxId: number | null;
  lastCapturedAt: string | null;
}

interface LastRun {
  ranAt: string;
  fetched: number;
  added: number;
  maxId: number | null;
}

interface GapRange {
  from: number;
  to: number;
  count: number;
}
interface Gaps {
  ranges: GapRange[];
  missingTotal: number;
}

interface ImportResult {
  compareOnly?: boolean;
  missingFromHub?: number[];
  received: number;
  added: number;
  alreadyPresent: number;
  store: { before: Store; after: Store };
  error?: string;
}

function describe(s: Store | null): string {
  if (!s || s.total === 0) return "empty";
  return `${s.total.toLocaleString()} updates, ids ${s.minId}–${s.maxId}`;
}

export default function NewsImport() {
  const [store, setStore] = useState<Store | null>(null);
  const [gaps, setGaps] = useState<Gaps | null>(null);
  const [run, setRun] = useState<LastRun | null>(null);
  const [compareOnly, setCompareOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/news/import");
      const j = await r.json();
      if (r.ok) {
        setStore(j.store as Store);
        setGaps((j.gaps ?? null) as Gaps | null);
        setRun((j.lastRun ?? null) as LastRun | null);
      }
    } catch {
      /* status is a nicety */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const text = await file.text();
        // Parse here so a bad file is caught before anything is uploaded.
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("That file isn't valid JSON. Is it the snapshot log?");
        }
        const r = await fetch(`/api/news/import${compareOnly ? "?compare=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
        const j = (await r.json()) as ImportResult;
        if (!r.ok) throw new Error(j.error ?? `Import failed (${r.status})`);
        setResult(j);
        setStore(j.store.after);
        void refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
        e.target.value = "";
      }
    },
    [compareOnly, refresh],
  );

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div className="side-title">Snapshot log import</div>
      <div className="hint" style={{ marginBottom: 14 }}>
        Loads the history captured in Google Drive (&ldquo;RotoWire NHL Feed Snapshot
        Log.json&rdquo;) into the hub. Safe to run more than once — updates already
        stored are skipped, never overwritten.
      </div>

      <div style={{ marginBottom: 14 }}>
        <strong>Currently stored:</strong> {describe(store)}
        {run && (
          <div className="hint">
            Last run: {new Date(run.ranAt).toLocaleString()} — fetched {run.fetched},
            stored {run.added} new
          </div>
        )}
        {store?.lastCapturedAt && (
          <div className="hint">
            Newest item stored: {new Date(store.lastCapturedAt).toLocaleString()}
            {run && run.added === 0 && " (a later run found nothing new, which is normal)"}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <strong>Completeness check:</strong>{" "}
        {gaps === null ? (
          "…"
        ) : gaps.missingTotal === 0 ? (
          <span>no holes — every Id between the first and last is present</span>
        ) : (
          <span>
            {gaps.missingTotal} missing Id{gaps.missingTotal === 1 ? "" : "s"} in{" "}
            {gaps.ranges.length} run{gaps.ranges.length === 1 ? "" : "s"}
          </span>
        )}
        {gaps && gaps.ranges.length > 0 && (
          <ul className="warn-list">
            {gaps.ranges.slice(0, 12).map((g) => (
              <li key={g.from}>
                {g.from === g.to ? g.from : `${g.from}–${g.to}`} ({g.count})
              </li>
            ))}
          </ul>
        )}
        <div className="hint">
          The feed&apos;s Ids are gapless in reality, so no holes means nothing is
          missing. A hole is either a capture we missed or one of RotoWire&apos;s
          lost days — compare against the log below to tell those apart.
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={compareOnly}
          onChange={(e) => setCompareOnly(e.target.checked)}
        />
        <span>Compare only — report differences without importing</span>
      </label>

      <label htmlFor="logfile">Snapshot log file (.json)</label>
      <input id="logfile" type="file" accept="application/json,.json" onChange={onFile} disabled={busy} />
      {fileName && <div className="hint">Selected: {fileName}</div>}
      {busy && <div className="hint">Importing…</div>}
      {error && <div className="error">{error}</div>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="side-title">Done</div>
          <ul className="warn-list">
            <li>{result.received.toLocaleString()} records read from the file</li>
            <li>
              <strong>
                {result.added.toLocaleString()}{" "}
                {result.compareOnly ? "in the log but MISSING from the hub" : "newly added"}
              </strong>
              {result.compareOnly && result.added > 0 && result.missingFromHub && (
                <div className="hint">Ids: {result.missingFromHub.join(", ")}</div>
              )}
            </li>
            <li>{result.alreadyPresent.toLocaleString()} already present in the hub</li>
            {!result.compareOnly && (
              <li>
                Store went from {describe(result.store.before)} to{" "}
                {describe(result.store.after)}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
