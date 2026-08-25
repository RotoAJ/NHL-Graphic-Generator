// 1200x1500 fantasy player card.
//
// Design approved from output/card-G-sleeper-bright.png. Split composition: brand
// info column on the left, full-bleed action photo on the right.
//
// Separate from poster.ts and matchup.ts; both are untouched.
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureFonts } from "@/src/render/fonts";
import type { Finalist, ThreadType } from "@/src/fantasy/types";

const W = 1200;
const H = 1500;

// --- RotoWire brand, sampled from public/brand/rotowire-logo-light.png ---
const CORAL = "#F22E45";
const NAVY = "#002248";
const NAVY_MID = "#001C3C";
const NAVY_DEEP = "#0A1220";
const WHITE = "#FFFFFF";

const HEAVY = "Barlow Condensed Black, Barlow Condensed, sans-serif";
const BOLD = "Barlow Condensed, sans-serif";

/** Photo grade — the "bright" setting chosen during design review. */
const GRADE = { gain: 1.14, lift: 14, tint: 0.07, edge: 0.88, bottom: 0.45 };

async function loadRemote(url: string): Promise<Image | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.nhl.com/" },
    });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

function loadLocal(file: string, svgWidth = 400): Image | Promise<Image | null> | null {
  try {
    const raw: Buffer = readFileSync(file);
    const buf = file.toLowerCase().endsWith(".svg")
      ? new Resvg(raw, { fitTo: { mode: "width", value: svgWidth } }).render().asPng()
      : raw;
    return loadImage(buf).catch(() => null);
  } catch {
    return null;
  }
}

function teamLogoPath(abbr: string): string | null {
  const dir = path.join(process.cwd(), "public", "logos");
  for (const f of [`${abbr}_dark.svg`, `${abbr}_light.svg`, `${abbr}.svg`, `${abbr}.png`]) {
    const p = path.join(dir, f);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Draw an image at its natural aspect ratio, scaled to fit inside maxW x maxH
 * and centred on (cx, cy).
 *
 * NHL team logos rasterize to 400x267 (1.5:1), so drawing them into a square
 * box compressed every one of them horizontally by a third.
 */
function drawContain(
  ctx: SKRSContext2D,
  img: Image,
  cx: number,
  cy: number,
  maxW: number,
  maxH: number,
) {
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

/**
 * Is this a rink photo? Rink shots contain a large bright, desaturated region
 * (the ice); studio/promo portraits do not.
 *
 * This matters because the two cases need opposite handling. A studio portrait
 * is centred by construction and must never be panned -- Sean Walker's promo
 * shot on a saturated red backdrop scored 1.31 on subject-detection and would
 * have been panned into pure background. Measured ice coverage separates them
 * cleanly: 1.4% for that portrait versus 34-85% for every rink photo sampled.
 */
function isRinkPhoto(img: Image): boolean {
  try {
    const dw = 120;
    const dh = Math.max(1, Math.round((img.height * dw) / img.width));
    const tmp = createCanvas(dw, dh);
    const t = tmp.getContext("2d");
    t.drawImage(img, 0, 0, dw, dh);
    const d = t.getImageData(0, 0, dw, dh).data;
    let ice = 0;
    let total = 0;
    for (let y = Math.floor(dh * 0.35); y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const i = (y * dw + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const bl = d[i + 2];
        const sat = (Math.max(r, g, bl) - Math.min(r, g, bl)) / 255;
        const lum = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
        if (lum > 0.68 && sat < 0.16) ice++;
        total++;
      }
    }
    return total > 0 && ice / total >= 0.12;
  } catch {
    return false; // unknown -> treat as studio, i.e. don't pan
  }
}

/**
 * Horizontal crop offset for a landscape action shot.
 *
 * The panel is tall and narrow, so only a slice of a 1296px-wide photo is shown
 * and a fixed centre silently failed whenever the subject was off to one side
 * (Bobby McMann rendered as empty ice; Mark Scheifele lost his head out of frame).
 *
 * Scoring uses only the ON-ICE band (34%-96% of height): including the top pulled
 * the window toward crowd faces, and a skin-tone detector failed for the same
 * reason -- the stands are full of faces. Studio photos skip panning entirely.
 */
const CROP_MARGIN = 1.12;

function bestCropX(img: Image, cropW: number): number {
  const centreX = Math.round((img.width - cropW) / 2);
  if (!isRinkPhoto(img)) return centreX;
  try {
    const dw = 160;
    const dh = Math.max(1, Math.round((img.height * dw) / img.width));
    const tmp = createCanvas(dw, dh);
    const t = tmp.getContext("2d");
    t.drawImage(img, 0, 0, dw, dh);
    const d = t.getImageData(0, 0, dw, dh).data;

    const col = new Array<number>(dw).fill(0);
    const yStart = Math.floor(dh * 0.34);
    const yEnd = Math.floor(dh * 0.96);
    for (let x = 0; x < dw; x++) {
      let sc = 0;
      for (let y = yStart; y < yEnd; y++) {
        const i = (y * dw + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const bl = d[i + 2];
        const sat = (Math.max(r, g, bl) - Math.min(r, g, bl)) / 255;
        const lum = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
        sc += sat * 0.9 + Math.max(0, 0.68 - lum) * 1.1;
      }
      col[x] = sc;
    }
    const sm = col.map((_, i) => {
      let acc = 0;
      let n = 0;
      for (let k = -6; k <= 6; k++) {
        const j = i + k;
        if (j >= 0 && j < dw) {
          acc += col[j];
          n++;
        }
      }
      return acc / n;
    });

    const win = Math.max(1, Math.round((cropW * dw) / img.width));
    const sumAt = (start: number) => {
      let v = 0;
      for (let i = start; i < start + win; i++) v += sm[i];
      return v;
    };
    const centreStart = Math.round((dw - win) / 2);
    const centreScore = sumAt(centreStart);
    let best = centreStart;
    let bestScore = -1;
    for (let st = 0; st + win <= dw; st++) {
      const v = sumAt(st);
      if (v > bestScore) {
        bestScore = v;
        best = st;
      }
    }
    if (centreScore > 0 && bestScore / centreScore >= CROP_MARGIN) {
      return Math.round((best * img.width) / dw);
    }
  } catch {
    /* fall through */
  }
  return centreX;
}

function fitText(
  ctx: SKRSContext2D,
  text: string,
  family: string,
  start: number,
  maxW: number,
  min = 26,
): number {
  let s = start;
  ctx.font = `${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > min) {
    s -= 2;
    ctx.font = `${s}px ${family}`;
  }
  return s;
}

function shadowText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  family: string,
  fill: string,
) {
  ctx.font = `${size}px ${family}`;
  ctx.textAlign = "left";
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export async function renderFantasyCard(
  f: Finalist,
  threadType: ThreadType,
): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const SPLIT = Math.round(W * 0.5);
  const PW = W - SPLIT;

  // ---------- right: player photo ----------
  ctx.save();
  ctx.beginPath();
  ctx.rect(SPLIT, 0, PW, H);
  ctx.clip();
  ctx.fillStyle = NAVY_MID;
  ctx.fillRect(SPLIT, 0, PW, H);

  // Action shot first (suits the full-bleed panel); headshot as fallback.
  let photo = f.actionShotUrl ? await loadRemote(f.actionShotUrl) : null;
  let isHeadshot = false;
  if (!photo && f.headshotUrl) {
    photo = await loadRemote(f.headshotUrl);
    isHeadshot = true;
  }

  if (photo) {
    if (isHeadshot) {
      // A head-and-shoulders mug can't fill a tall panel; sit it lower-centre.
      const iw = PW * 1.15;
      const ih = iw * (photo.height / photo.width);
      ctx.drawImage(photo, SPLIT + (PW - iw) / 2, H * 0.52 - ih / 2, iw, ih);
    } else {
      // Full bleed: cover the whole panel, panning horizontally to the subject.
      const tr = PW / H;
      const sw = Math.min(photo.width, Math.round(photo.height * tr));
      const sx = bestCropX(photo, sw);
      ctx.drawImage(photo, sx, 0, sw, photo.height, SPLIT, 0, PW, H);
    }

    // brightness lift ("bright" setting from the design review)
    const d = ctx.getImageData(SPLIT, 0, PW, H);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = Math.min(255, px[i] * GRADE.gain + GRADE.lift);
      px[i + 1] = Math.min(255, px[i + 1] * GRADE.gain + GRADE.lift);
      px[i + 2] = Math.min(255, px[i + 2] * GRADE.gain + GRADE.lift);
    }
    ctx.putImageData(d, SPLIT, 0);

    ctx.globalAlpha = GRADE.tint;
    ctx.fillStyle = NAVY;
    ctx.fillRect(SPLIT, 0, PW, H);
    ctx.globalAlpha = 1;

    const edge = ctx.createLinearGradient(SPLIT, 0, SPLIT + 200, 0);
    edge.addColorStop(0, `rgba(10,18,32,${GRADE.edge})`);
    edge.addColorStop(1, "rgba(10,18,32,0)");
    ctx.fillStyle = edge;
    ctx.fillRect(SPLIT, 0, 200, H);

    const bot = ctx.createLinearGradient(0, H - 300, 0, H);
    bot.addColorStop(0, "rgba(10,18,32,0)");
    bot.addColorStop(1, `rgba(10,18,32,${GRADE.bottom})`);
    ctx.fillStyle = bot;
    ctx.fillRect(SPLIT, H - 300, PW, 300);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `34px ${BOLD}`;
    ctx.textAlign = "center";
    ctx.fillText("NO PHOTO", SPLIT + PW / 2, H / 2);
  }
  ctx.restore();

  // ---------- left: brand info column ----------
  const lg = ctx.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, NAVY_DEEP);
  lg.addColorStop(0.58, NAVY_MID);
  lg.addColorStop(1, NAVY);
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, SPLIT, H);
  ctx.fillStyle = CORAL;
  ctx.fillRect(SPLIT - 4, 0, 4, H);

  const PAD = 64;
  const maxW = SPLIT - PAD * 2;

  const lp = teamLogoPath(f.teamAbbr);
  if (lp) {
    const logo = await loadLocal(lp);
    if (logo) {
      const TILE = 176;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(PAD, 50, TILE, TILE);
      // Aspect-preserving fit inside the tile, with a little breathing room.
      drawContain(
        ctx,
        logo as Image,
        PAD + TILE / 2,
        50 + TILE / 2,
        TILE - 28,
        TILE - 44,
      );
    }
  }

  ctx.textBaseline = "alphabetic";
  const first = f.firstName.toUpperCase();
  const last = f.lastName.toUpperCase();
  const nameSize = Math.min(
    fitText(ctx, first, HEAVY, 100, maxW),
    fitText(ctx, last, HEAVY, 100, maxW),
  );
  const nameY = 368;
  shadowText(ctx, first, PAD, nameY, nameSize, HEAVY, WHITE);
  shadowText(ctx, last, PAD, nameY + nameSize * 0.85, nameSize, HEAVY, WHITE);
  shadowText(ctx, f.positionLabel, PAD, nameY + nameSize * 0.85 + 54, 40, BOLD, WHITE);

  // coral label
  ctx.fillStyle = CORAL;
  ctx.font = `36px ${HEAVY}`;
  ctx.textAlign = "left";
  let ly = nameY + nameSize * 0.85 + 128;
  for (const line of ["LAST 7 DAYS", "FANTASY POINTS"]) {
    ctx.fillText(line, PAD, ly);
    ly += 40;
  }

  // hero number
  const heroY = ly + 188;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = CORAL;
  const heroTxt = f.fantasyPoints.toFixed(1);
  const heroSize = fitText(ctx, heroTxt, HEAVY, 226, maxW + 20, 120);
  ctx.font = `${heroSize}px ${HEAVY}`;
  ctx.fillText(heroTxt, PAD - 8, heroY);
  ctx.restore();

  // coral band: raw production
  const bandY = heroY + 42;
  ctx.fillStyle = CORAL;
  ctx.fillRect(0, bandY, SPLIT, 116);
  ctx.fillStyle = WHITE;
  const band =
    f.posGroup === "G"
      ? `${f.wins}W  ${f.saves}SV  ·  ${f.games} GP`
      : `${f.goals}G  ${f.assists}A  ·  ${f.games} GP`;
  const bandSize = fitText(ctx, band, HEAVY, 52, maxW, 30);
  ctx.font = `${bandSize}px ${HEAVY}`;
  ctx.fillText(band, PAD, bandY + 78);

  // secondary line
  ctx.fillStyle = WHITE;
  const secondary =
    threadType === "sleepers" && f.ownership !== null
      ? `${f.ownership}% ROSTERED`
      : threadType === "sleepers"
        ? "UNDER-ROSTERED"
        : "THREE STARS OF THE WEEK";
  const secSize = fitText(ctx, secondary, BOLD, 44, maxW, 26);
  ctx.font = `${secSize}px ${BOLD}`;
  ctx.fillText(secondary, PAD, bandY + 196);

  // RotoWire logo
  const brand = path.join(process.cwd(), "public", "brand", "rotowire-logo-light.png");
  if (existsSync(brand)) {
    const l = await loadLocal(brand);
    if (l) {
      const h = 44;
      const w = ((l as Image).width / (l as Image).height) * h;
      ctx.drawImage(l as Image, PAD, H - h - 48, w, h);
    }
  }

  return canvas.encode("png");
}
