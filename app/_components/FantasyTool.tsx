"use client";

import { useCallback, useState } from "react";
import CopyBox from "@/app/_components/CopyBox";
import type { Finalist, ThreadType } from "@/src/fantasy/types";

interface GenerateResponse {
  window: { from: string; to: string };
  warnings: string[];
  stars: Finalist[];
  sleepers: Finalist[];
  threads: { stars: string; sleepers: string };
  error?: string;
}

type CardMap = Record<string, string>; // `${threadType}:${playerId}` -> blob url

export default function FantasyTool() {
  const [date, setDate] = useState("2026-03-15");
  const [ignoreRecency, setIgnoreRecency] = useState(false);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GenerateResponse | null>(null);
  const [cards, setCards] = useState<CardMap>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [permalink, setPermalink] = useState<string | null>(null);

  const renderCards = useCallback(async (res: GenerateResponse) => {
    const jobs: Array<[ThreadType, Finalist]> = [
      ...res.stars.map((p) => ["stars", p] as [ThreadType, Finalist]),
      ...res.sleepers.map((p) => ["sleepers", p] as [ThreadType, Finalist]),
    ];
    const out: CardMap = {};
    await Promise.all(
      jobs.map(async ([threadType, player]) => {
        try {
          const r = await fetch("/api/fantasy/card", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player, threadType }),
          });
          if (!r.ok) return;
          out[`${threadType}:${player.playerId}`] = URL.createObjectURL(await r.blob());
        } catch {
          /* leave the card missing rather than failing the run */
        }
      }),
    );
    setCards(out);
  }, []);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(null);
    setCards({});
    setData(null);
    try {
      const qs = new URLSearchParams({ date });
      if (ignoreRecency) qs.set("ignoreRecency", "1");
      if (preview) qs.set("preview", "1");
      const res = await fetch(`/api/fantasy/generate?${qs}`);
      const json = (await res.json()) as GenerateResponse;
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setData(json);
      await renderCards(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [date, ignoreRecency, preview, renderCards]);

  const confirmSet = useCallback(async () => {
    if (!data) return;
    try {
      const r = await fetch("/api/fantasy/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekEnd: data.window.to,
          window: data.window,
          stars: data.stars,
          sleepers: data.sleepers,
          threads: data.threads,
          warnings: data.warnings,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to save");
      setPermalink(j.permalink);
      setSaved(
        `Saved. ${j.recorded} players excluded for the next 14 days.` +
          (j.persistent ? "" : " (dev store: not persistent on Vercel)"),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [data]);

  const CardGrid = ({ list, type }: { list: Finalist[]; type: ThreadType }) => (
    <div className="card-grid">
      {list.map((p) => {
        const url = cards[`${type}:${p.playerId}`];
        return (
          <div key={p.playerId} className="card-item">
            {url ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`${p.fullName} card`} />
                <a
                  className="download"
                  href={url}
                  download={`${type}-${p.lastName.toLowerCase()}.png`}
                >
                  Download
                </a>
              </>
            ) : (
              <div className="card-pending">Rendering {p.fullName}…</div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="matchup-grid" style={{ marginTop: 0 }}>
          <div>
            <label htmlFor="date">Week ending</label>
            <input id="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="hint">
              Uses the 7 days ending on this date. It&apos;s the offseason, so pick a date
              inside last season (e.g. 2026-03-15) to see real data.
            </div>
          </div>
          <div>
            <label>Options</label>
            <label className="check">
              <input
                type="checkbox"
                checked={ignoreRecency}
                onChange={(e) => setIgnoreRecency(e.target.checked)}
              />
              <span>Ignore the 14-day repeat filter</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={preview}
                onChange={(e) => setPreview(e.target.checked)}
              />
              <span>Preview Sleepers with placeholder ownership (do not publish)</span>
            </label>
          </div>
        </div>
        <button className="generate" disabled={loading} onClick={generate}>
          {loading ? "Building threads…" : "Generate threads + cards"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {data && (
        <>
          {data.warnings.length > 0 && (
            <div className="panel warn-panel">
              <div className="side-title">Notes</div>
              <ul className="warn-list">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="matchup-grid">
            <CopyBox title="Three Stars of the Week" text={data.threads.stars} />
            {data.sleepers.length > 0 ? (
              <CopyBox title="Sleepers to Grab" text={data.threads.sleepers} />
            ) : (
              <div className="panel">
                <div className="side-title">Sleepers to Grab</div>
                <div className="hint">
                  Withheld until real ownership data is available (Yahoo Fantasy API access
                  pending). Tick “Preview Sleepers” above to see the format with placeholder
                  numbers — those are not publishable.
                </div>
              </div>
            )}
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="side-title">Three Stars — cards</div>
            <CardGrid list={data.stars} type="stars" />
          </div>

          {data.sleepers.length > 0 && (
            <div className="panel" style={{ marginTop: 20 }}>
              <div className="side-title">Sleepers — cards</div>
              <CardGrid list={data.sleepers} type="sleepers" />
            </div>
          )}

          <div className="panel" style={{ marginTop: 20 }}>
            <button type="button" className="copy-btn" onClick={confirmSet}>
              Confirm set — save permalink + exclude for 14 days
            </button>
            {saved && <div className="hint" style={{ marginTop: 10 }}>{saved}</div>}
            {permalink && (
              <a className="download" href={permalink} style={{ marginTop: 12 }}>
                Open this week&apos;s permalink
              </a>
            )}
          </div>
        </>
      )}
    </>
  );
}
