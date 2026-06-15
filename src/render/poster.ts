// EXPERIMENTAL "poster" style renderer — full-bleed action photo, team-color
// theming, big stylized headline. Completely separate from the card renderer
// in ./index.ts (that one is untouched).
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureFonts } from "@/src/render/fonts";
import { TEAM_BY_ABBR } from "@/src/teams";
import type { RenderRequest } from "@/src/types";

const W = 1080;
const H = 1350;
const DARK = "#0B0B0D";
const WHITE = "#FFFFFF";
const LEMON = "#D9FC07";
const HEAVY = "Barlow Condensed Black, Barlow Condensed, sans-serif";
const BOLD = "Barlow Condensed, sans-serif";
const MONO = "IBM Plex Mono, monospace";

// ---- color helpers ----
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
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// ---- image helpers (self-contained) ----
function rasterizeSvg(buf: Buffer, width: number): Buffer {
  return new Resvg(buf, { fitTo: { mode: "width", value: width } }).render().asPng();
}
async function loadImageSafe(src: string | Buffer): Promise<Image | null> {
  try {
    if (typeof src === "string" && /^https?:/i.test(src)) {
      const res = await fetch(src);
      if (!res.ok) return null;
      return await loadImage(Buffer.from(await res.arrayBuffer()));
    }
    return await loadImage(src as Buffer);
  } catch {
    return null;
  }
}
async function loadLogo(abbr: string): Promise<Image | null> {
  const dir = path.join(process.cwd(), "public", "logos");
  for (const f of [`${abbr}_dark.svg`, `${abbr}_light.svg`, `${abbr}.svg`, `${abbr}_dark.png`, `${abbr}.png`]) {
    const p = path.join(dir, f);
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p);
        const buf = f.toLowerCase().endsWith(".svg") ? rasterizeSvg(raw, 320) : raw;
        return await loadImage(buf);
      } catch {
        return null;
      }
    }
  }
  return null;
}
function loadBrandWordmark(): Promise<Image | null> {
  const dir = path.join(process.cwd(), "public", "brand");
  for (const f of ["rotowire-logo-light.png", "rotowire-logo-light.svg", "rotowire-wordmark.png"]) {
    const p = path.join(dir, f);
    if (existsSync(p)) {
      const raw = readFileSync(p);
      const buf = f.toLowerCase().endsWith(".svg") ? rasterizeSvg(raw, 600) : raw;
      return loadImageSafe(buf);
    }
  }
  return Promise.resolve(null);
}
function drawCover(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height;
  const tr = w / h;
  let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (ir > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
  else { sh = img.width / tr; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
function drawContain(ctx: SKRSContext2D, img: Image, cx: number, cy: number, max: number) {
  const ir = img.width / img.height;
  let w = max, h = max;
  if (ir > 1) h = max / ir; else w = max * ir;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

/** Draw a square headshot with edges feathered to transparent so the mug's
 *  gray backdrop melts into the team-color background (no hard box). */
function drawFeatheredHeadshot(
  ctx: SKRSContext2D,
  img: Image,
  cx: number,
  cy: number,
  size: number,
) {
  const tmp = createCanvas(size, size);
  const tctx = tmp.getContext("2d");
  drawCover(tctx, img, 0, 0, size, size);
  // Radial alpha mask: opaque center, transparent toward the edges.
  tctx.globalCompositeOperation = "destination-in";
  const mask = tctx.createRadialGradient(
    size / 2, size * 0.46, size * 0.20,
    size / 2, size * 0.46, size * 0.52,
  );
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.72, "rgba(0,0,0,1)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  tctx.fillStyle = mask;
  tctx.fillRect(0, 0, size, size);
  ctx.drawImage(tmp, cx - size / 2, cy - size / 2);
}

/** Pull the NHL player id out of a headshot URL to build an action-shot URL. */
function actionShotUrl(headshotUrl: string | null): string | null {
  const m = headshotUrl?.match(/\/(\d+)\.png$/i);
  return m ? `https://assets.nhle.com/mugs/actionshots/1296x729/${m[1]}.jpg` : null;
}

function fitFont(ctx: SKRSContext2D, text: string, family: string, start: number, maxW: number, min = 40): number {
  let s = start;
  ctx.font = `${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > min) {
    s -= 3;
    ctx.font = `${s}px ${family}`;
  }
  return s;
}

export interface PosterOptions {
  /** "metallic" (white/silver) or "team" (team-color gradient) headline fill. */
  headlineStyle?: "metallic" | "team";
  /** Which photo to use. Defaults to the action shot, falling back to headshot. */
  photo?: "action" | "headshot";
  /** Optional custom image URL that overrides the NHL photo entirely. */
  photoUrl?: string | null;
}

export async function renderPoster(
  req: RenderRequest,
  opts: PosterOptions = {},
): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const team = TEAM_BY_ABBR[req.newTeamAbbr];
  const base = team?.color ?? "#22222B";

  // --- Background: bolder team-color gradient fading to a tinted dark ---
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, base);
  bg.addColorStop(0.5, mix(base, DARK, 0.45));
  bg.addColorStop(1, mix(base, DARK, 0.82));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // --- Hero photo: custom URL > action shot > headshot ---
  const photoH = 900;
  let hero: Image | null = null;
  if (opts.photoUrl) hero = await loadImageSafe(opts.photoUrl);
  if (!hero && opts.photo !== "headshot") {
    hero = await loadImageSafe(actionShotUrl(req.headshotUrl) ?? "");
  }
  if (hero) {
    // Landscape action/custom shot: fill the top region.
    drawCover(ctx, hero, 0, 0, W, photoH);
  } else {
    // Headshot mode (or action unavailable): centered square, edges feathered
    // into the team-color background.
    const hs = req.headshotUrl ? await loadImageSafe(req.headshotUrl) : null;
    if (hs) {
      drawFeatheredHeadshot(ctx, hs, W / 2, 470, 760);
    } else {
      ctx.fillStyle = mix(base, "#FFFFFF", 0.15);
      ctx.font = `40px ${MONO}`;
      ctx.textAlign = "center";
      ctx.fillText("NO PHOTO", W / 2, 480);
    }
  }

  // Scrim: blend the bottom of the photo into the dark gradient.
  const scrim = ctx.createLinearGradient(0, photoH - 420, 0, photoH + 40);
  scrim.addColorStop(0, "rgba(11,11,13,0)");
  scrim.addColorStop(1, DARK);
  ctx.fillStyle = scrim;
  ctx.fillRect(0, photoH - 420, W, 460);

  // Thin team-color accent at the very top.
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, 12);

  // --- Team logos: trade = old (TL) -> new (TR); signing = new (TR) ---
  const logoSize = 168;
  const drawLogoWithShadow = (img: Image | null, abbr: string, x: number, y: number) => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 4;
    if (img) {
      drawContain(ctx, img, x + logoSize / 2, y + logoSize / 2, logoSize);
    } else {
      ctx.fillStyle = TEAM_BY_ABBR[abbr]?.color ?? "#333";
      ctx.beginPath();
      ctx.arc(x + logoSize / 2, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  if (req.dealType === "TRADE") {
    const [oldLogo, newLogo] = await Promise.all([
      loadLogo(req.oldTeamAbbr),
      loadLogo(req.newTeamAbbr),
    ]);
    drawLogoWithShadow(oldLogo, req.oldTeamAbbr, 44, 40);
    drawLogoWithShadow(newLogo, req.newTeamAbbr, W - 44 - logoSize, 40);
  } else {
    const newLogo = await loadLogo(req.newTeamAbbr);
    drawLogoWithShadow(newLogo, req.newTeamAbbr, W - 44 - logoSize, 40);
  }

  // --- Player name (small caps line above the headline) ---
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = WHITE;
  const nameSize = fitFont(ctx, req.playerName.toUpperCase(), BOLD, 56, W - 120, 34);
  ctx.font = `${nameSize}px ${BOLD}`;
  ctx.fillText(req.playerName.toUpperCase(), W / 2, 930);

  // --- Headline: huge stylized TRADED / SIGNED ---
  const word = req.dealType === "TRADE" ? "TRADED" : "SIGNED";
  const hSize = fitFont(ctx, word, HEAVY, 180, W - 90, 90);
  ctx.font = `${hSize}px ${HEAVY}`;
  const hY = 1090;
  // headline fill: metallic (white/silver) or team-color gradient
  const grad = ctx.createLinearGradient(0, hY - hSize, 0, hY + 14);
  if (opts.headlineStyle === "metallic") {
    grad.addColorStop(0, "#FFFFFF");
    grad.addColorStop(1, "#C9C9CF");
  } else {
    // team-color gradient (default)
    grad.addColorStop(0, "#FFFFFF");
    grad.addColorStop(0.55, mix(base, "#FFFFFF", 0.35));
    grad.addColorStop(1, base);
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(word, W / 2, hY);
  ctx.restore();
  ctx.fillStyle = grad;
  ctx.fillText(word, W / 2, hY);

  // Team-color underline accent below the headline.
  const ulW = Math.min(W - 160, ctx.measureText(word).width + 40);
  ctx.fillStyle = base;
  ctx.fillRect((W - ulW) / 2, hY + 26, ulW, 8);

  // --- Deal details ---
  if (req.dealText.trim()) {
    ctx.fillStyle = WHITE;
    const fSize = 34;
    ctx.font = `${fSize}px ${MONO}`;
    ctx.textAlign = "center";
    const maxW = W - 140;
    const words = req.dealText.trim().split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, 1180 + i * 44));
  }

  // --- RotoWire logo, bottom-center ---
  const wordmark = await loadBrandWordmark();
  if (wordmark) {
    const wmH = 42;
    const wmW = (wordmark.width / wordmark.height) * wmH;
    ctx.drawImage(wordmark, (W - wmW) / 2, H - 36 - wmH, wmW, wmH);
  }
  // Bottom accent bar.
  ctx.fillStyle = base;
  ctx.fillRect(0, H - 10, W, 10);

  return canvas.encode("png");
}
