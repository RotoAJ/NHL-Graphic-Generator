"use client";

import { useCallback, useEffect, useState } from "react";
import { TEAMS } from "@/src/teams";
import type { GoalieRef } from "@/src/goalies/types";

/** One team + goalie picker pair. */
function SidePicker({
  title,
  team,
  setTeam,
  goalieId,
  setGoalieId,
  goalies,
  loading,
  idPrefix,
}: {
  title: string;
  team: string;
  setTeam: (v: string) => void;
  goalieId: string;
  setGoalieId: (v: string) => void;
  goalies: GoalieRef[];
  loading: boolean;
  idPrefix: string;
}) {
  return (
    <div className="panel">
      <div className="side-title">{title}</div>

      <label htmlFor={`${idPrefix}Team`}>Team</label>
      <select
        id={`${idPrefix}Team`}
        value={team}
        onChange={(e) => setTeam(e.target.value)}
      >
        <option value="">Select team…</option>
        {TEAMS.map((t) => (
          <option key={t.abbr} value={t.abbr}>
            {t.abbr} — {t.name}
          </option>
        ))}
      </select>

      <label htmlFor={`${idPrefix}Goalie`}>Goalie</label>
      <select
        id={`${idPrefix}Goalie`}
        value={goalieId}
        onChange={(e) => setGoalieId(e.target.value)}
        disabled={!team || loading}
      >
        <option value="">
          {!team
            ? "Pick a team first…"
            : loading
              ? "Loading goalies…"
              : goalies.length
                ? "Select goalie…"
                : "No goalies found"}
        </option>
        {goalies.map((g) => (
          <option key={g.id} value={g.id}>
            {g.fullName}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function GoalieMatchup() {
  const [awayTeam, setAwayTeam] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayGoalieId, setAwayGoalieId] = useState("");
  const [homeGoalieId, setHomeGoalieId] = useState("");
  const [awayGoalies, setAwayGoalies] = useState<GoalieRef[]>([]);
  const [homeGoalies, setHomeGoalies] = useState<GoalieRef[]>([]);
  const [loadingAway, setLoadingAway] = useState(false);
  const [loadingHome, setLoadingHome] = useState(false);

  const [gameTime, setGameTime] = useState("");
  const [beforeDate, setBeforeDate] = useState("");

  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load a team's goalies whenever the team changes.
  const loadGoalies = useCallback(
    async (
      team: string,
      setGoalies: (g: GoalieRef[]) => void,
      setGoalieId: (v: string) => void,
      setLoading: (b: boolean) => void,
    ) => {
      setGoalieId("");
      setGoalies([]);
      if (!team) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/goalies/${team}`);
        const data = await res.json();
        setGoalies(data.goalies ?? []);
      } catch {
        setGoalies([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadGoalies(awayTeam, setAwayGoalies, setAwayGoalieId, setLoadingAway);
  }, [awayTeam, loadGoalies]);

  useEffect(() => {
    loadGoalies(homeTeam, setHomeGoalies, setHomeGoalieId, setLoadingHome);
  }, [homeTeam, loadGoalies]);

  const canGenerate =
    !!awayTeam &&
    !!homeTeam &&
    awayTeam !== homeTeam &&
    !!awayGoalieId &&
    !!homeGoalieId &&
    !rendering;

  const generate = useCallback(async () => {
    setRendering(true);
    setError(null);
    try {
      const res = await fetch("/api/render-matchup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          awayTeam,
          awayGoalieId,
          homeTeam,
          homeGoalieId,
          gameTime,
          beforeDate: beforeDate || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Render failed (${res.status})`);
      }
      const blob = await res.blob();
      if (pngUrl) URL.revokeObjectURL(pngUrl);
      setPngUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRendering(false);
    }
  }, [awayTeam, awayGoalieId, homeTeam, homeGoalieId, gameTime, beforeDate, pngUrl]);

  const downloadName =
    awayTeam && homeTeam
      ? `goalie-matchup-${awayTeam}-${homeTeam}.png`.toLowerCase()
      : "goalie-matchup.png";

  return (
    <>
      <div className="matchup-grid">
        <SidePicker
          title="Away"
          team={awayTeam}
          setTeam={setAwayTeam}
          goalieId={awayGoalieId}
          setGoalieId={setAwayGoalieId}
          goalies={awayGoalies}
          loading={loadingAway}
          idPrefix="away"
        />
        <SidePicker
          title="Home"
          team={homeTeam}
          setTeam={setHomeTeam}
          goalieId={homeGoalieId}
          setGoalieId={setHomeGoalieId}
          goalies={homeGoalies}
          loading={loadingHome}
          idPrefix="home"
        />
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="matchup-grid" style={{ marginTop: 0 }}>
          <div>
            <label htmlFor="gameTime">Game time (optional)</label>
            <input
              id="gameTime"
              placeholder="e.g. 7:00 PM ET"
              value={gameTime}
              onChange={(e) => setGameTime(e.target.value)}
            />
            <div className="hint">Shown under the header. Leave blank to omit.</div>
          </div>
          <div>
            <label htmlFor="beforeDate">Stats as of date (optional)</label>
            <input
              id="beforeDate"
              placeholder="YYYY-MM-DD"
              value={beforeDate}
              onChange={(e) => setBeforeDate(e.target.value)}
            />
            <div className="hint">
              Only counts games before this date — use it to replay a past game night.
            </div>
          </div>
        </div>

        <button className="generate" disabled={!canGenerate} onClick={generate}>
          {rendering ? "Generating…" : "Generate matchup graphic"}
        </button>
        {awayTeam && homeTeam && awayTeam === homeTeam && (
          <div className="error">Away and home teams must differ.</div>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="panel matchup-preview" style={{ marginTop: 20 }}>
        <label>Preview</label>
        {pngUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pngUrl} alt="Goalie matchup graphic preview" />
            <a className="download" href={pngUrl} download={downloadName}>
              Download PNG
            </a>
          </>
        ) : (
          <div className="empty">
            Your 1600×900 goalie matchup graphic will appear here after you generate it.
          </div>
        )}
      </div>
    </>
  );
}
