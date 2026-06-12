"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEAMS } from "@/src/teams";
import type {
  DealType,
  PlayerDetail,
  PlayerSearchResult,
  ReturnPlayer,
} from "@/src/types";

const MAX_RETURN_PLAYERS = 3;

export default function Generator() {
  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Selected player / form state
  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [isFreeAgent, setIsFreeAgent] = useState(false);
  const [oldTeam, setOldTeam] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [dealType, setDealType] = useState<DealType>("SIGNING");
  const [dealText, setDealText] = useState("");

  // Optional return players (trades only)
  const [returnPlayers, setReturnPlayers] = useState<ReturnPlayer[]>([]);
  const [returnQuery, setReturnQuery] = useState("");
  const [returnResults, setReturnResults] = useState<PlayerSearchResult[]>([]);
  const [showReturnResults, setShowReturnResults] = useState(false);

  // Output state
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced player search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const selectPlayer = useCallback(async (r: PlayerSearchResult) => {
    setShowResults(false);
    setQuery(r.fullName);
    setError(null);
    setPngUrl(null);
    try {
      const res = await fetch(`/api/player/${r.id}`);
      const data = await res.json();
      const p: PlayerDetail | undefined = data.player;
      if (!p) {
        setError("Could not load player details.");
        return;
      }
      setPlayer(p);
      const fa = !p.teamAbbr;
      setIsFreeAgent(fa);
      // Old team defaults to current team; if FA, fall back to last known.
      setOldTeam(p.teamAbbr ?? r.lastTeamAbbr ?? "");
    } catch {
      setError("Could not load player details.");
    }
  }, []);

  const returnDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search for return players.
  useEffect(() => {
    if (returnDebounceRef.current) clearTimeout(returnDebounceRef.current);
    if (returnQuery.trim().length < 2) {
      setReturnResults([]);
      return;
    }
    returnDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(returnQuery)}`);
        const data = await res.json();
        setReturnResults(data.results ?? []);
        setShowReturnResults(true);
      } catch {
        setReturnResults([]);
      }
    }, 250);
    return () => {
      if (returnDebounceRef.current) clearTimeout(returnDebounceRef.current);
    };
  }, [returnQuery]);

  const addReturnPlayer = useCallback(
    async (r: PlayerSearchResult) => {
      setShowReturnResults(false);
      setReturnQuery("");
      if (returnPlayers.length >= MAX_RETURN_PLAYERS) return;
      // Fetch the headshot; fall back to name-only if it fails.
      let headshotUrl: string | null = null;
      try {
        const res = await fetch(`/api/player/${r.id}`);
        const data = await res.json();
        headshotUrl = data.player?.headshotUrl ?? null;
      } catch {
        headshotUrl = null;
      }
      setReturnPlayers((prev) =>
        prev.some((p) => p.name === r.fullName)
          ? prev
          : [...prev, { name: r.fullName, headshotUrl }],
      );
    },
    [returnPlayers],
  );

  const removeReturnPlayer = useCallback((idx: number) => {
    setReturnPlayers((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const canGenerate =
    !!player &&
    !!newTeam &&
    (dealType === "TRADE" ? !!oldTeam : true) &&
    !rendering;

  const generate = useCallback(async () => {
    if (!player) return;
    setRendering(true);
    setError(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: player.fullName,
          headshotUrl: player.headshotUrl,
          oldTeamAbbr: oldTeam,
          newTeamAbbr: newTeam,
          dealText,
          dealType,
          returnPlayers: dealType === "TRADE" ? returnPlayers : [],
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
  }, [player, oldTeam, newTeam, dealText, dealType, returnPlayers, pngUrl]);

  const downloadName = player
    ? `${player.fullName.replace(/\s+/g, "-").toLowerCase()}-${oldTeam}-${newTeam}.png`
    : "nhl-graphic.png";

  return (
    <div className="grid">
      {/* Left: form */}
      <div className="panel">
        <label htmlFor="search">Player</label>
        <input
          id="search"
          placeholder="Search NHL player…"
          value={query}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setShowResults(true)}
        />
        {searching && <div className="subtitle">Searching…</div>}
        {showResults && results.length > 0 && (
          <div className="results">
            {results.map((r) => (
              <div
                key={r.id}
                className="result"
                onClick={() => selectPlayer(r)}
              >
                <span>{r.fullName}</span>
                <span className="meta">
                  {r.teamAbbr ?? r.lastTeamAbbr ?? "FA"}
                  {r.positionCode ? ` · ${r.positionCode}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        <label>Type</label>
        <div className="toggle">
          <button
            type="button"
            className={dealType === "SIGNING" ? "active" : ""}
            onClick={() => setDealType("SIGNING")}
          >
            Signing
          </button>
          <button
            type="button"
            className={dealType === "TRADE" ? "active" : ""}
            onClick={() => setDealType("TRADE")}
          >
            Trade
          </button>
        </div>

        {dealType === "TRADE" && (
          <>
            <label htmlFor="oldTeam">
              Old team {isFreeAgent && "(editable — Free Agent)"}
            </label>
            <select
              id="oldTeam"
              value={oldTeam}
              onChange={(e) => setOldTeam(e.target.value)}
            >
              <option value="">Select team…</option>
              {TEAMS.map((t) => (
                <option key={t.abbr} value={t.abbr}>
                  {t.abbr} — {t.name}
                </option>
              ))}
            </select>
            {isFreeAgent && (
              <div className="fa-flag">
                This player is a Free Agent — pick their prior team above.
              </div>
            )}
          </>
        )}

        <label htmlFor="newTeam">New team</label>
        <select
          id="newTeam"
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
        >
          <option value="">Select team…</option>
          {TEAMS.map((t) => (
            <option key={t.abbr} value={t.abbr}>
              {t.abbr} — {t.name}
            </option>
          ))}
        </select>

        {dealType === "TRADE" && (
          <>
            <label htmlFor="returnSearch">
              Players in return (optional)
            </label>
            {returnPlayers.length > 0 && (
              <div className="chips">
                {returnPlayers.map((rp, i) => (
                  <span key={`${rp.name}-${i}`} className="chip">
                    {rp.headshotUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={rp.headshotUrl} alt="" className="chip-img" />
                    )}
                    {rp.name}
                    <button
                      type="button"
                      className="chip-x"
                      aria-label={`Remove ${rp.name}`}
                      onClick={() => removeReturnPlayer(i)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {returnPlayers.length < MAX_RETURN_PLAYERS && (
              <input
                id="returnSearch"
                placeholder="Search a player coming back…"
                value={returnQuery}
                autoComplete="off"
                onChange={(e) => setReturnQuery(e.target.value)}
                onFocus={() => returnResults.length && setShowReturnResults(true)}
              />
            )}
            {showReturnResults && returnResults.length > 0 && (
              <div className="results">
                {returnResults.map((r) => (
                  <div
                    key={r.id}
                    className="result"
                    onClick={() => addReturnPlayer(r)}
                  >
                    <span>{r.fullName}</span>
                    <span className="meta">
                      {r.teamAbbr ?? r.lastTeamAbbr ?? "FA"}
                      {r.positionCode ? ` · ${r.positionCode}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <label htmlFor="dealText">Deal details</label>
        <textarea
          id="dealText"
          placeholder={
            dealType === "TRADE"
              ? "e.g. Traded for a 2027 2nd-round pick"
              : "e.g. 3 yr / $21M"
          }
          value={dealText}
          onChange={(e) => setDealText(e.target.value)}
        />

        <button className="generate" disabled={!canGenerate} onClick={generate}>
          {rendering ? "Generating…" : "Generate graphic"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {/* Right: preview */}
      <div className="panel preview">
        <label>Preview</label>
        {pngUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pngUrl} alt="Generated graphic preview" />
            <a className="download" href={pngUrl} download={downloadName}>
              Download PNG
            </a>
          </>
        ) : (
          <div className="empty">
            Your 1080×1080 graphic will appear here after you generate it.
          </div>
        )}
      </div>
    </div>
  );
}
