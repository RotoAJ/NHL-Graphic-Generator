// 1600x900 goalie matchup renderer.
//
// Separate from src/render/poster.ts (the trade/signing graphic), which is
// intentionally left untouched. Shares the same visual language: team-color
// gradient, Barlow Condensed / IBM Plex Mono, RotoWire logo bottom-center.
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureFonts } from "@/src/render/fonts";
import { TEAM_BY_ABBR } from "@/src/teams";
import type { GoalieSide, LastStarts, MatchupData } from "@/src/goalies/types";

const W = 1600;
const H = 900;
const DARK = "#0B0B0D";
const WHITE = "#FFFFFF";
const MUTED = "#B9B9C4";
const LEMON = "#D9FC07";

const HEAVY = "Barlow Condensed Black, Barlow Condensed, sans-serif";
const BOLD = "Barlow Condensed, sans-serif";
const MONO = "IBM Plex Mono, monospace";

// Vertical rhythm
const HEADSHOT_CY = 272;
const HEADSHOT_D = 300;
const NAME_Y = 452;
const TEAM_Y = 498;
const L5_LABEL_Y = 552;
const STAT_NUM_Y = 614;
const STAT_LABEL_Y = 646;
const FOOTER_TOP = 686;
const FOOTER_H = 108;

// ---------- color helpers ----------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)}, ${Math.round(
    g1 + (g2 - g1) * t,
  )}, ${Math.round(b1 + (b2 - b1) * t)})`;
}

// ---------- image helpers ----------
function rasterizeSvg(buf: Buffer, width: number): Buffer {
  return new Resvg(buf, { fitTo: { mode: "width", value: width } }).render().asPng();
}
async function loadRemote(url: string): Promise<Image | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
async function loadLocal(file: string, svgWidth = 320): Promise<Image | null> {
  try {
    const raw: Buffer = readFileSync(file);
    const buf = file.toLowerCase().endsWith(".svg") ? rasterizeSvg(raw, svgWidth) : raw;
    return await loadImage(buf);
  } catch {
    return null;
  }
}
function findAsset(dir: string, names: string[]): string | null {
  for (const n of names) {
    const p = path.join(dir, n);
    if (existsSync(p)) return p;
  }
  return null;
}
function loadLogo(abbr: string): Promise<Image | null> {
  const p = findAsset(path.join(process.cwd(), "public", "logos"), [
    `${abbr}_dark.svg`,
    `${abbr}_light.svg`,
    `${abbr}.svg`,
    `${abbr}_dark.png`,
    `${abbr}.png`,
  ]);
  return p ? loadLocal(p, 256) : Promise.resolve(null);
}
function loadWordmark(): Promise<Image | null> {
  const p = findAsset(path.join(process.cwd(), "public", "brand"), [
    "rotowire-logo-light.png",
    "rotowire-logo-light.svg",
    "rotowire-wordmark.png",
  ]);
  return p ? loadLocal(p, 600) : Promise.resolve(null);
}

function drawCover(
  ctx: SKRSContext2D,
  img: Image,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ir = img.width / img.height;
  const tr = w / h;
  let sw = img.width;
  let sh = img.height;
  let sx = 0;
  let sy = 0;
  if (ir > tr) {
    sw = img.height * tr;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / tr;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
function drawContain(ctx: SKRSContext2D, img: Image, cx: number, cy: number, max: number) {
  const ir = img.width / img.height;
  let w = max;
  let h = max;
  if (ir > 1) h = max / ir;
  else w = max * ir;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

/** Headshot with edges feathered to transparent so the mug's studio backdrop
 *  melts into the team color instead of showing a hard box. */
function drawFeathered(ctx: SKRSContext2D, img: Image, cx: number, cy: number, d: number) {
  const tmp = createCanvas(d, d);
  const t = tmp.getContext("2d");
  drawCover(t, img, 0, 0, d, d);
  t.globalCompositeOperation = "destination-in";
  const mask = t.createRadialGradient(d / 2, d * 0.46, d * 0.2, d / 2, d * 0.46, d * 0.52);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.7, "rgba(0,0,0,1)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  t.fillStyle = mask;
  t.fillRect(0, 0, d, d);
  ctx.drawImage(tmp, cx - d / 2, cy - d / 2);
}

function fit(
  ctx: SKRSContext2D,
  text: string,
  family: string,
  start: number,
  maxW: number,
  min = 22,
): number {
  let s = start;
  ctx.font = `${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > min) {
    s -= 2;
    ctx.font = `${s}px ${family}`;
  }
  return s;
}

function tracked(
  ctx: SKRSContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  ctx.textAlign = "left";
  let x = cx - total / 2;
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = "center";
}

// ---------- stat formatting ----------
function fmtGaa(v: number | null): string {
  return v === null ? "--" : v.toFixed(2);
}
function fmtSvPct(v: number | null): string {
  return v === null ? "--" : v.toFixed(3).replace(/^0/, "");
}
function fmtRecord(s: LastStarts): string {
  return `${s.wins}-${s.losses}-${s.otLosses}`;
}
function l5Label(s: LastStarts): string {
  if (s.count === 0) return "NO NHL STARTS";
  const base = s.count < 5 ? `LAST ${s.count} START${s.count === 1 ? "" : "S"}` : "LAST 5 STARTS";
  return s.fromPriorSeason ? `${base} · INCL. PREV. SEASON` : base;
}

function ordinalDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${months[m - 1]} ${d}, ${y}`;
}

// ---------- main ----------
export async function renderMatchup(data: MatchupData): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const awayColor = TEAM_BY_ABBR[data.away.goalie.teamAbbr]?.color ?? "#2A2A33";
  const homeColor = TEAM_BY_ABBR[data.home.goalie.teamAbbr]?.color ?? "#2A2A33";

  // Background: away color on the left bleeding into home color on the right,
  // both darkened so text stays legible.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, mix(awayColor, DARK, 0.42));
  bg.addColorStop(0.5, mix(DARK, "#000000", 0.25));
  bg.addColorStop(1, mix(homeColor, DARK, 0.42));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Top / bottom accent bars in each team's color.
  ctx.fillStyle = awayColor;
  ctx.fillRect(0, 0, W / 2, 10);
  ctx.fillStyle = homeColor;
  ctx.fillRect(W / 2, 0, W / 2, 10);
  ctx.fillStyle = awayColor;
  ctx.fillRect(0, H - 10, W / 2, 10);
  ctx.fillStyle = homeColor;
  ctx.fillRect(W / 2, H - 10, W / 2, 10);

  // ---- header ----
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = WHITE;
  ctx.font = `54px ${HEAVY}`;
  tracked(ctx, "CONFIRMED STARTERS", W / 2, 78, 6);

  if (data.gameTime) {
    ctx.fillStyle = LEMON;
    ctx.font = `28px ${MONO}`;
    ctx.fillText(data.gameTime, W / 2, 116);
  }

  // ---- one side ----
  const drawSide = async (side: GoalieSide, cx: number, accent: string) => {
    const { goalie, lastStarts } = side;

    // headshot
    const shot = goalie.headshotUrl ? await loadRemote(goalie.headshotUrl) : null;
    if (shot) {
      drawFeathered(ctx, shot, cx, HEADSHOT_CY, HEADSHOT_D);
    } else {
      ctx.fillStyle = mix(accent, "#FFFFFF", 0.12);
      ctx.beginPath();
      ctx.arc(cx, HEADSHOT_CY, HEADSHOT_D / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = MUTED;
      ctx.font = `24px ${MONO}`;
      ctx.textAlign = "center";
      ctx.fillText("NO PHOTO", cx, HEADSHOT_CY + 8);
    }

    // name
    ctx.fillStyle = WHITE;
    ctx.textAlign = "center";
    const nameSize = fit(ctx, goalie.fullName.toUpperCase(), HEAVY, 62, 600, 30);
    ctx.font = `${nameSize}px ${HEAVY}`;
    ctx.fillText(goalie.fullName.toUpperCase(), cx, NAME_Y);

    // team logo + full name
    const logo = await loadLogo(goalie.teamAbbr);
    const teamName = TEAM_BY_ABBR[goalie.teamAbbr]?.name ?? goalie.teamAbbr;
    ctx.font = `26px ${MONO}`;
    const tw = ctx.measureText(teamName).width;
    const logoSize = 54;
    const groupW = logoSize + 14 + tw;
    const startX = cx - groupW / 2;
    if (logo) drawContain(ctx, logo, startX + logoSize / 2, TEAM_Y - 10, logoSize);
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.fillText(teamName, startX + logoSize + 14, TEAM_Y);
    ctx.textAlign = "center";

    // "LAST 5 STARTS" label
    ctx.fillStyle = accent === DARK ? LEMON : LEMON;
    ctx.font = `22px ${MONO}`;
    tracked(ctx, l5Label(lastStarts), cx, L5_LABEL_Y, 3);

    // stat trio
    if (lastStarts.count === 0) {
      ctx.fillStyle = WHITE;
      ctx.font = `40px ${HEAVY}`;
      ctx.fillText("NHL DEBUT", cx, STAT_NUM_Y);
    } else {
      const cols: Array<[string, string]> = [
        [fmtRecord(lastStarts), "RECORD"],
        [fmtGaa(lastStarts.gaa), "GAA"],
        [fmtSvPct(lastStarts.savePct), "SV%"],
      ];
      const dx = 168;
      cols.forEach(([value, label], i) => {
        const x = cx + (i - 1) * dx;
        ctx.fillStyle = WHITE;
        ctx.font = `56px ${HEAVY}`;
        ctx.fillText(value, x, STAT_NUM_Y);
        ctx.fillStyle = MUTED;
        ctx.font = `20px ${MONO}`;
        ctx.fillText(label, x, STAT_LABEL_Y);
      });
    }
  };

  await drawSide(data.away, 396, awayColor);
  await drawSide(data.home, W - 396, homeColor);

  // ---- center VS divider ----
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, 148);
  ctx.lineTo(W / 2, HEADSHOT_CY - 60);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2, HEADSHOT_CY + 60);
  ctx.lineTo(W / 2, STAT_LABEL_Y);
  ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.font = `68px ${HEAVY}`;
  ctx.textAlign = "center";
  ctx.fillText("VS", W / 2, HEADSHOT_CY + 20);

  // ---- footer: last meeting ----
  const panelX = 150;
  const panelW = W - panelX * 2;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(panelX, FOOTER_TOP, panelW, FOOTER_H);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(panelX, FOOTER_TOP, panelW, 2);

  ctx.fillStyle = LEMON;
  ctx.font = `20px ${MONO}`;
  const m = data.lastMeeting;
  tracked(
    ctx,
    m
      ? m.fromPriorSeason
        ? "LAST MEETING · PREVIOUS SEASON"
        : "LAST MEETING"
      : "FIRST MEETING",
    W / 2,
    FOOTER_TOP + 34,
    3,
  );

  ctx.textAlign = "center";
  if (m) {
    const ot = m.periodType && m.periodType !== "REG" ? ` (${m.periodType})` : "";
    const score = `${ordinalDate(m.date)}   ·   ${m.awayAbbr} ${m.awayScore}  @  ${m.homeAbbr} ${m.homeScore}${ot}`;
    ctx.fillStyle = WHITE;
    const s = fit(ctx, score, MONO, 30, panelW - 80, 18);
    ctx.font = `${s}px ${MONO}`;
    ctx.fillText(score, W / 2, FOOTER_TOP + 76);

    // each goalie's line in that game, tucked under their own side
    const lineFor = (side: GoalieSide, cx: number) => {
      const l = side.lastMeetingLine;
      const txt = l
        ? `${l.decision ?? "-"} · ${l.saves}/${l.shotsAgainst} SV`
        : "DID NOT PLAY";
      ctx.fillStyle = MUTED;
      ctx.font = `19px ${MONO}`;
      ctx.fillText(txt, cx, FOOTER_TOP + 76);
    };
    lineFor(data.away, panelX + 120);
    lineFor(data.home, W - panelX - 120);
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = `26px ${MONO}`;
    ctx.fillText("First meeting between these teams", W / 2, FOOTER_TOP + 76);
  }

  // ---- RotoWire logo, bottom center ----
  const wm = await loadWordmark();
  if (wm) {
    const h = 38;
    const w = (wm.width / wm.height) * h;
    ctx.drawImage(wm, (W - w) / 2, H - 30 - h, w, h);
  } else {
    ctx.fillStyle = WHITE;
    ctx.font = `32px ${HEAVY}`;
    ctx.textAlign = "center";
    ctx.fillText("ROTOWIRE", W / 2, H - 32);
  }

  return canvas.encode("png");
}
