import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureFonts } from "@/src/render/fonts";
import { TEAM_BY_ABBR } from "@/src/teams";
import type { RenderRequest } from "@/src/types";

const SIZE = 1080;
const BG = "#0F0F11";
const PURPLE = "#A020FE";
const LEMON = "#D9FC07"; // accent for highlights (team abbr, "IN RETURN")
const WHITE = "#FFFFFF";
const LABEL = "#E8E8EE"; // legible near-white for secondary text
const MUTED = "#9A9AA5";

// Font family helpers (fall back to generic families if not registered).
const HEAVY = "Barlow Condensed Black, Barlow Condensed, sans-serif";
const BOLD = "Barlow Condensed, sans-serif";
const MONO = "IBM Plex Mono, monospace";

/** Rasterize an SVG buffer to a PNG buffer at a target width. */
function rasterizeSvg(buf: Buffer, width: number): Buffer {
  const r = new Resvg(buf, { fitTo: { mode: "width", value: width } });
  return r.render().asPng();
}

async function loadImageSafe(src: string | Buffer): Promise<Image | null> {
  try {
    if (typeof src === "string" && /^https?:/i.test(src)) {
      const res = await fetch(src);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return await loadImage(buf);
    }
    return await loadImage(src);
  } catch {
    return null;
  }
}

/** Load a local asset file; SVGs are rasterized via resvg first. */
async function loadLocalImage(p: string, svgWidth = 512): Promise<Image | null> {
  try {
    const raw: Buffer = readFileSync(p);
    const buf = p.toLowerCase().endsWith(".svg") ? rasterizeSvg(raw, svgWidth) : raw;
    return await loadImage(buf);
  } catch {
    return null;
  }
}

function findAsset(dir: string, files: string[]): string | null {
  for (const file of files) {
    const p = path.join(dir, file);
    if (existsSync(p)) return p;
  }
  return null;
}

function loadLogo(abbr: string): Promise<Image | null> {
  const dir = path.join(process.cwd(), "public", "logos");
  // Prefer the dark-background variant; accept svg or png.
  const p = findAsset(dir, [
    `${abbr}_dark.svg`,
    `${abbr}_light.svg`,
    `${abbr}.svg`,
    `${abbr}_dark.png`,
    `${abbr}_light.png`,
    `${abbr}.png`,
  ]);
  return p ? loadLocalImage(p, 256) : Promise.resolve(null);
}

function loadBrandWordmark(): Promise<Image | null> {
  const dir = path.join(process.cwd(), "public", "brand");
  const p = findAsset(dir, [
    // Prefer the white-wordmark variant for the dark canvas.
    "rotowire-logo-light.png",
    "rotowire-logo-light.svg",
    "rotowire-wordmark.svg",
    "rotowire-wordmark.png",
    "wordmark.png",
    "wordmark.svg",
  ]);
  return p ? loadLocalImage(p, 600) : Promise.resolve(null);
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw an image scaled to "cover" a target box (center-cropped). */
function drawCover(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
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

/** Draw an image scaled to "contain" within a box, centered (for logos). */
function drawContain(ctx: SKRSContext2D, img: Image, cx: number, cy: number, max: number) {
  const ir = img.width / img.height;
  let w = max;
  let h = max;
  if (ir > 1) h = max / ir;
  else w = max * ir;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

function teamName(abbr: string): string {
  return TEAM_BY_ABBR[abbr]?.name ?? abbr;
}

/** Truncate text with an ellipsis so it fits within maxW at the current font. */
function ellipsize(ctx: SKRSContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/** Draw a circular, center-cropped headshot with a thin ring. */
async function drawCircleHeadshot(
  ctx: SKRSContext2D,
  url: string | null,
  cx: number,
  cy: number,
  d: number,
) {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "#1A1A1F";
  ctx.fillRect(cx - r, cy - r, d, d);
  const img = url ? await loadImageSafe(url) : null;
  if (img) drawCover(ctx, img, cx - r, cy - r, d, d);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.stroke();
}

/** Total width of text drawn with manual letter-spacing at the current font. */
function measureTracked(ctx: SKRSContext2D, text: string, spacing: number): number {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  return widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
}

/** Draw centered, letter-spaced text where segments can have different colors. */
function drawCenteredSegmentsTracked(
  ctx: SKRSContext2D,
  segments: Array<{ text: string; color: string }>,
  cx: number,
  y: number,
  spacing: number,
) {
  const chars: Array<{ ch: string; color: string }> = [];
  for (const s of segments) {
    for (const ch of [...s.text]) chars.push({ ch, color: s.color });
  }
  const widths = chars.map((c) => ctx.measureText(c.ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  ctx.textAlign = "left";
  let x = cx - total / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillStyle = chars[i].color;
    ctx.fillText(chars[i].ch, x, y);
    x += widths[i] + spacing;
  }
}

/** Draw centered text with manual letter-spacing (for the block-letter tag). */
function drawCenteredTracked(
  ctx: SKRSContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
) {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  ctx.textAlign = "left";
  let x = cx - total / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + spacing;
  }
}

export async function renderGraphic(req: RenderRequest): Promise<Buffer> {
  ensureFonts();

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  // --- Background ---
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle top accent bar.
  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, 0, SIZE, 10);

  // RotoWire logo is loaded here but drawn centered at the bottom (see below).
  const wordmark = await loadBrandWordmark();

  // --- Headline: "TRADED TO <ABBR>" / "SIGNS WITH <ABBR>" ---
  // Verb phrase in white; team abbreviation in the lemonade accent so it pops.
  const newAbbr = (req.newTeamAbbr ?? "").toUpperCase();
  const prefix = req.dealType === "TRADE" ? "TRADED TO " : "SIGNS WITH ";
  const headline = prefix + newAbbr;
  ctx.textBaseline = "alphabetic";
  // Auto-fit the headline to one line (long abbreviations shrink the font).
  let tagSize = 96;
  let tagSpacing = 8;
  const tagMaxW = SIZE - 90;
  for (;;) {
    ctx.font = `${tagSize}px ${HEAVY}`;
    tagSpacing = Math.max(2, Math.round(tagSize * 0.08));
    if (measureTracked(ctx, headline, tagSpacing) <= tagMaxW || tagSize <= 44) break;
    tagSize -= 3;
  }
  drawCenteredSegmentsTracked(
    ctx,
    [
      { text: prefix, color: WHITE },
      { text: newAbbr, color: LEMON },
    ],
    SIZE / 2,
    178,
    tagSpacing,
  );

  // Return players (trades only) drive a more compact layout.
  const returns = req.dealType === "TRADE" ? (req.returnPlayers ?? []).slice(0, 3) : [];
  const hasReturns = returns.length > 0;

  // --- Player headshot (rounded square, center-cropped) ---
  const photoSize = hasReturns ? 300 : 400;
  const photoX = (SIZE - photoSize) / 2;
  const photoY = hasReturns ? 190 : 208;
  ctx.save();
  roundRect(ctx, photoX, photoY, photoSize, photoSize, 28);
  ctx.clip();
  ctx.fillStyle = "#1A1A1F";
  ctx.fillRect(photoX, photoY, photoSize, photoSize);
  const headshot = req.headshotUrl ? await loadImageSafe(req.headshotUrl) : null;
  if (headshot) {
    drawCover(ctx, headshot, photoX, photoY, photoSize, photoSize);
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = `28px ${MONO}`;
    ctx.textAlign = "center";
    ctx.fillText("NO PHOTO", SIZE / 2, photoY + photoSize / 2);
  }
  ctx.restore();
  // Border around photo.
  roundRect(ctx, photoX, photoY, photoSize, photoSize, 28);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();

  // --- Player name ---
  ctx.fillStyle = WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let nameSize = hasReturns ? 76 : 96;
  ctx.font = `${nameSize}px ${HEAVY}`;
  const maxNameW = SIZE - 120;
  while (ctx.measureText(req.playerName.toUpperCase()).width > maxNameW && nameSize > 40) {
    nameSize -= 4;
    ctx.font = `${nameSize}px ${HEAVY}`;
  }
  const nameY = photoY + photoSize + (hasReturns ? 70 : 88);
  ctx.fillText(req.playerName.toUpperCase(), SIZE / 2, nameY);

  // --- Team band ---
  // TRADE: old logo + full name  ->  new logo + full name (with arrow).
  // SIGNING: just the new team logo + full name, centered, no arrow.
  const bandY = nameY + (hasReturns ? 54 : 64);
  const logoMax = hasReturns ? 84 : 110;

  // Full team name under the logo, auto-fit to one line within maxW.
  const drawTeam = (
    logo: Image | null,
    abbr: string,
    cx: number,
    labelMaxW: number,
  ) => {
    if (logo) {
      drawContain(ctx, logo, cx, bandY, logoMax);
    } else {
      ctx.fillStyle = TEAM_BY_ABBR[abbr]?.color ?? "#333";
      roundRect(ctx, cx - logoMax / 2, bandY - logoMax / 2, logoMax, logoMax, 16);
      ctx.fill();
    }
    const full = teamName(abbr);
    let s = 36;
    ctx.font = `${s}px ${MONO}`;
    while (ctx.measureText(full).width > labelMaxW && s > 16) {
      s -= 1;
      ctx.font = `${s}px ${MONO}`;
    }
    ctx.fillStyle = LABEL;
    ctx.textAlign = "center";
    // Extra air between the logo and its name (more in the roomier non-return layout).
    ctx.fillText(full, cx, bandY + logoMax / 2 + (hasReturns ? 44 : 58));
  };

  if (req.dealType === "TRADE") {
    // Push the two teams further apart so long full names don't crowd the center.
    const oldX = SIZE / 2 - 250;
    const newX = SIZE / 2 + 250;
    const [oldLogo, newLogo] = await Promise.all([
      loadLogo(req.oldTeamAbbr),
      loadLogo(req.newTeamAbbr),
    ]);
    drawTeam(oldLogo, req.oldTeamAbbr, oldX, 380);
    drawTeam(newLogo, req.newTeamAbbr, newX, 380);

    // Arrow between teams.
    ctx.strokeStyle = WHITE;
    ctx.fillStyle = WHITE;
    ctx.lineWidth = 8;
    const ax0 = SIZE / 2 - 60;
    const ax1 = SIZE / 2 + 60;
    ctx.beginPath();
    ctx.moveTo(ax0, bandY);
    ctx.lineTo(ax1 - 18, bandY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax1, bandY);
    ctx.lineTo(ax1 - 26, bandY - 18);
    ctx.lineTo(ax1 - 26, bandY + 18);
    ctx.closePath();
    ctx.fill();
  } else {
    // SIGNING: single centered new-team logo.
    const newLogo = await loadLogo(req.newTeamAbbr);
    drawTeam(newLogo, req.newTeamAbbr, SIZE / 2, 760);
  }

  // --- Return players (trades only): "IN RETURN" + circular headshots ---
  let dealStartY = bandY + logoMax / 2 + 120;
  if (hasReturns) {
    const labelY = bandY + logoMax / 2 + 84;
    ctx.fillStyle = LEMON;
    ctx.font = `30px ${MONO}`;
    ctx.textBaseline = "alphabetic";
    drawCenteredTracked(ctx, "IN RETURN", SIZE / 2, labelY, 6);

    const d = returns.length >= 3 ? 120 : 140;
    const gap = 44;
    const totalW = returns.length * d + (returns.length - 1) * gap;
    let cx = SIZE / 2 - totalW / 2 + d / 2;
    const cy = labelY + 36 + d / 2;
    for (const rp of returns) {
      await drawCircleHeadshot(ctx, rp.headshotUrl, cx, cy, d);
      ctx.fillStyle = WHITE;
      ctx.font = `26px ${MONO}`;
      ctx.textAlign = "center";
      const last = rp.name.trim().split(/\s+/).slice(-1)[0].toUpperCase();
      ctx.fillText(ellipsize(ctx, last, d + 24), cx, cy + d / 2 + 34);
      cx += d + gap;
    }
    dealStartY = cy + d / 2 + 74;
  }

  // --- Deal details (wrapped mono text) ---
  if (req.dealText.trim()) {
    const text = req.dealText.trim();
    const fontPx = hasReturns ? 30 : 38;
    const lineH = hasReturns ? 40 : 50;
    // Leave room for the centered logo at the bottom.
    const maxLines = hasReturns ? 1 : 2;
    ctx.fillStyle = WHITE;
    ctx.font = `${fontPx}px ${MONO}`;
    ctx.textAlign = "center";
    const maxW = SIZE - 160;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      shown[maxLines - 1] = ellipsize(ctx, shown[maxLines - 1] + " …", maxW);
    }
    shown.forEach((l, i) => ctx.fillText(l, SIZE / 2, dealStartY + i * lineH));
  }

  // --- RotoWire logo, centered at the bottom ---
  if (wordmark) {
    const wmH = 40;
    const wmW = (wordmark.width / wordmark.height) * wmH;
    ctx.drawImage(wordmark, (SIZE - wmW) / 2, SIZE - 40 - wmH, wmW, wmH);
  } else {
    ctx.font = `36px ${HEAVY}`;
    ctx.fillStyle = WHITE;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillText("ROTOWIRE", SIZE / 2, SIZE - 44);
  }

  // --- Footer accent ---
  ctx.fillStyle = PURPLE;
  ctx.fillRect(0, SIZE - 10, SIZE, 10);

  return canvas.encode("png");
}
