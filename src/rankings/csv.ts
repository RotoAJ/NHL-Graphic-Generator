// CSV in and out for the rankings file.
//
// The file's columns are: Stats ID, Player, Team, Positions, Injury. The Injury
// field holds "status,body part,return date" -- it contains commas, so it is a
// quoted field and a naive split would shred it. This is a small real parser
// (quotes, escaped quotes, CRLF, BOM) rather than split(",").
//
// The baseline's line-ending and quoting style are remembered and reproduced on
// output, so a file downloaded from the hub is shaped like the one it replaces.
import type { RankRow } from "@/src/rankings/engine";

export const HEADER = ["Stats ID", "Player", "Team", "Positions", "Injury"] as const;

export interface CsvStyle {
  eol: "\n" | "\r\n";
  /** True when the source quoted every field, not just the ones that need it. */
  quoteAll: boolean;
}

export const DEFAULT_STYLE: CsvStyle = { eol: "\n", quoteAll: false };

/** Split CSV text into rows of fields. */
function tokenize(text: string): { rows: string[][]; sawQuotedPlain: boolean } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;
  let quotedPlain = 0;
  let plainFields = 0;

  const endField = () => {
    if (fieldWasQuoted && !/[",\r\n]/.test(field)) quotedPlain++;
    plainFields++;
    row.push(field);
    field = "";
    fieldWasQuoted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (c === ",") endField();
    else if (c === "\r") {
      /* handled with the following \n */
    } else if (c === "\n") {
      endField();
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    endField();
    rows.push(row);
  }
  return { rows, sawQuotedPlain: plainFields > 0 && quotedPlain / plainFields > 0.5 };
}

export interface ParsedCsv {
  rows: RankRow[];
  style: CsvStyle;
  warnings: string[];
}

export function parseRankingsCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const { rows: raw, sawQuotedPlain } = tokenize(text);
  const warnings: string[] = [];
  if (!raw.length) throw new Error("The file is empty.");

  const header = raw[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    id: col("Stats ID"),
    player: col("Player"),
    team: col("Team"),
    pos: col("Positions"),
    inj: col("Injury"),
  };
  const missing = Object.entries({ "Stats ID": idx.id, Player: idx.player, Team: idx.team, Positions: idx.pos })
    .filter(([, v]) => v < 0)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Missing column(s): ${missing.join(", ")}. Expected a header of: ${HEADER.join(", ")}. Found: ${raw[0].join(", ")}`,
    );
  }

  const rows: RankRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (r.every((f) => f.trim() === "")) continue; // blank line
    const statsId = (r[idx.id] ?? "").trim();
    const player = (r[idx.player] ?? "").trim();
    if (!statsId || !player) {
      warnings.push(`Row ${i + 1} skipped: it has no ${!statsId ? "Stats ID" : "Player"}.`);
      continue;
    }
    if (seen.has(statsId)) {
      warnings.push(`Row ${i + 1} (${player}) repeats Stats ID ${statsId}; kept the first.`);
      continue;
    }
    seen.add(statsId);
    rows.push({
      statsId,
      player,
      team: (r[idx.team] ?? "").trim(),
      positions: (r[idx.pos] ?? "").trim(),
      injury: idx.inj >= 0 ? (r[idx.inj] ?? "").trim() : "",
    });
  }
  if (!rows.length) throw new Error("No player rows were found under the header.");

  return {
    rows,
    style: { eol: text.includes("\r\n") ? "\r\n" : "\n", quoteAll: sawQuotedPlain },
    warnings,
  };
}

function cell(v: string, quoteAll: boolean): string {
  return quoteAll || /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toRankingsCsv(rows: RankRow[], style: CsvStyle = DEFAULT_STYLE): string {
  const lines = [HEADER.map((h) => cell(h, style.quoteAll)).join(",")];
  for (const r of rows) {
    lines.push(
      [r.statsId, r.player, r.team, r.positions, r.injury].map((v) => cell(v, style.quoteAll)).join(","),
    );
  }
  return lines.join(style.eol) + style.eol;
}
