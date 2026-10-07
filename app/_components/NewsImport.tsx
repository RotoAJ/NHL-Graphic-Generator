"use client";

import { useCallback, useEffect, useState } from "react";

interface Store {
  total: number;
  minId: number | null;
  maxId: number | null;
  lastCapturedAt: string | null;
}

interface ImportResult {
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/news/import");
      const j = await r.json();
      if (r.ok) setStore(j.store as Store);
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
        const r = await fetch("/api/news/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
        const j = (await r.json()) as ImportResult;
        if (!r.ok) throw new Error(j.error ?? `Import failed (${r.status})`);
        setResult(j);
        setStore(j.store.after);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
        e.target.value = "";
      }
    },
    [],
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
        {store?.lastCapturedAt && (
          <div className="hint">
            Last capture: {new Date(store.lastCapturedAt).toLocaleString()}
          </div>
        )}
      </div>

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
              <strong>{result.added.toLocaleString()} newly added</strong>
            </li>
            <li>{result.alreadyPresent.toLocaleString()} already present (skipped)</li>
            <li>
              Store went from {describe(result.store.before)} to{" "}
              {describe(result.store.after)}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
