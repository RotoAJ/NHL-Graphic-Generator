"use client";

import { useCallback, useState } from "react";
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

function ThreadBox({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="panel">
      <div className="side-title">{title}</div>
      <pre className="thread-text">{text}</pre>
      <button type="button" className="copy-btn" onClick={copy}>
        {copied ? "Copied ✓" : "Copy thread"}
      </button>
    </div>
  );
}

export default function FantasyTool() {
  const [date, setDate] = useState("2026-03-15");
  const [ignoreRecency, setIgnoreRecency] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GenerateResponse | null>(null);
  const [cards, setCards] = useState<CardMap>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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
  }, [date, ignoreRecency, renderCards]);

  const confirmSet = useCallback(async () => {
    if (!data) return;
    const players = [
      ...data.stars.map((p) => ({ ...p, threadType: "stars" as ThreadType })),
      ...data.sleepers.map((p) => ({ ...p, threadType: "sleepers" as ThreadType })),
    ].map((p) => ({
      playerId: p.playerId,
      fullName: p.fullName,
      position: p.position,
      threadType: p.threadType,
    }));
    try {
      const r = await fetch("/api/fantasy/featured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to save");
      setSaved(
        `Recorded ${j.added} players — excluded from the next 14 days.` +
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
            <ThreadBox title="Three Stars of the Week" text={data.threads.stars} />
            <ThreadBox title="Sleepers to Grab" text={data.threads.sleepers} />
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="side-title">Three Stars — cards</div>
            <CardGrid list={data.stars} type="stars" />
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="side-title">Sleepers — cards</div>
            <CardGrid list={data.sleepers} type="sleepers" />
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <button type="button" className="copy-btn" onClick={confirmSet}>
              Confirm set — exclude these players for 14 days
            </button>
            {saved && <div className="hint" style={{ marginTop: 10 }}>{saved}</div>}
          </div>
        </>
      )}
    </>
  );
}
