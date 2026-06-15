"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEAMS } from "@/src/teams";
import type { DealType, PlayerDetail, PlayerSearchResult } from "@/src/types";

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

  // Photo options
  const [photoMode, setPhotoMode] = useState<"action" | "headshot">("action");
  const [customPhotoUrl, setCustomPhotoUrl] = useState("");

  // Output state
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a player is picked, so the resulting query change doesn't re-open
  // the dropdown with a fresh search.
  const skipSearchRef = useRef(false);

  // Debounced player search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      setShowResults(false);
      return;
    }
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
    skipSearchRef.current = true;
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
      const res = await fetch("/api/render-poster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: player.fullName,
          headshotUrl: player.headshotUrl,
          oldTeamAbbr: oldTeam,
          newTeamAbbr: newTeam,
          dealText,
          dealType,
          photo: photoMode,
          photoUrl: customPhotoUrl.trim() || null,
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
  }, [player, oldTeam, newTeam, dealText, dealType, photoMode, customPhotoUrl, pngUrl]);

  const downloadName = player
    ? `${player.fullName.replace(/\s+/g, "-").toLowerCase()}-${newTeam}.png`
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
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectPlayer(r);
                }}
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

        <label>Photo</label>
        <div className="toggle">
          <button
            type="button"
            className={photoMode === "action" ? "active" : ""}
            onClick={() => setPhotoMode("action")}
          >
            Action shot
          </button>
          <button
            type="button"
            className={photoMode === "headshot" ? "active" : ""}
            onClick={() => setPhotoMode("headshot")}
          >
            Headshot
          </button>
        </div>
        <label htmlFor="customPhoto">Custom image URL (optional)</label>
        <input
          id="customPhoto"
          placeholder="Paste an image URL to override the photo…"
          value={customPhotoUrl}
          autoComplete="off"
          onChange={(e) => setCustomPhotoUrl(e.target.value)}
        />

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
            Your 1080×1350 graphic will appear here after you generate it.
          </div>
        )}
      </div>
    </div>
  );
}
