// 네온 — 어두운 벽돌 벽, 포인트색 네온관으로 쓴 제목과 사진 틀, 가끔 깜빡이는 불빛.
import type { AccentPalette, FrameState, ThemeDef, Tone } from '../types';
import { alpha, ensureContrast, mix, withLightness } from '../color';
import { shapeOf, titleOf, artistOf, rr, photoBackdrop, hash01, vignette, grain, setSpacing, isNative, surfaceOf, rgbOf } from './_paint';

/** 톤별 바탕 — 다크: 밤의 벽돌 벽 / 라이트: 낮의 파스텔 페인트 벽돌 */
const wallBg = (tone: Tone, p: AccentPalette) => (tone === 'dark' ? '#0b0a0e' : mix(p.accentSoft, '#f3efe8', 0.55));

const brickCache = new Map<string, HTMLCanvasElement>();
function brickTile(): HTMLCanvasElement | null {
  const hit = brickCache.get('b');
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 480; c.height = 240;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0a0e'; g.fillRect(0, 0, 480, 240);
  const bw = 120, bh = 40;
  for (let row = 0; row < 6; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
      const v = 22 + Math.floor(hash01(row * 13 + col) * 12);
      g.fillStyle = `rgb(${v + 4},${v},${v + 8})`;
      g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
    }
  }
  brickCache.set('b', c);
  return c;
}

/** 페인트 칠한 벽돌 — 흰 벽돌 + 회색 줄눈. 바탕색 위에 multiply로 얹어 어떤 색 벽이든 만든다 */
function paintedBrickTile(): HTMLCanvasElement | null {
  const hit = brickCache.get('p');
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 480; c.height = 240;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9c6c2'; g.fillRect(0, 0, 480, 240);
  const bw = 120, bh = 40;
  for (let row = 0; row < 6; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
      const v = 236 + Math.floor(hash01(row * 13 + col) * 19);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
      // 벽돌 아래쪽 얕은 그늘 (페인트 아래 요철)
      g.fillStyle = 'rgba(0,0,0,0.05)';
      g.fillRect(x + 3, y + bh - 9, bw - 6, 6);
    }
  }
  brickCache.set('p', c);
  return c;
}

/** 낮의 네온관 — 불은 약하게, 색 유리관 자체가 보이게 (벽 그림자 → 은은한 빛 → 유리관 → 하이라이트) */
function glassText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, tube: string, glow: string, on: number, u: number) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // 벽에 떨어진 관 그림자
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 8 * u; ctx.shadowOffsetY = 7 * u;
  ctx.fillStyle = tube;
  ctx.fillText(s, x, y);
  // 은은한 빛
  ctx.shadowOffsetY = 0;
  ctx.shadowColor = alpha(glow, 0.6 * on); ctx.shadowBlur = 22 * u * on;
  ctx.fillText(s, x, y);
  ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
  // 유리 하이라이트 — 관 위쪽에 밝은 결
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 1e5, y - 1e5, 2e5, 1e5 - 2 * u); ctx.clip();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(s, x, y);
  ctx.restore();
  ctx.restore();
}

function glassRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, tube: string, glow: string, on: number, u: number) {
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.lineWidth = 9 * u;
  ctx.strokeStyle = tube;
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 8 * u; ctx.shadowOffsetY = 7 * u;
  ctx.stroke();
  ctx.shadowOffsetY = 0;
  ctx.shadowColor = alpha(glow, 0.5 * on); ctx.shadowBlur = 20 * u * on;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = mix(tube, '#ffffff', 0.45); ctx.lineWidth = 2.5 * u;
  ctx.stroke();
  ctx.restore();
}

/** 네온 글자 — 넓은 번짐 → 좁은 번짐 → 하얀 심지 3겹 */
function neonText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, on: number, u: number) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.25 + 0.75 * on;
  ctx.shadowColor = color;
  ctx.shadowBlur = 40 * u * on;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.shadowBlur = 14 * u * on;
  ctx.fillText(s, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = mix(color, '#ffffff', 0.72 * on);
  ctx.fillText(s, x, y);
  ctx.restore();
}

function neonRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string, on: number, u: number) {
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.7 * on;
  rr(ctx, x, y, w, h, r);
  ctx.strokeStyle = color; ctx.lineWidth = 9 * u;
  ctx.shadowColor = color; ctx.shadowBlur = 36 * u * on;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = mix(color, '#ffffff', 0.7 * on); ctx.lineWidth = 3 * u;
  ctx.stroke();
  ctx.restore();
}

/** 깜빡임 — 대부분 켜져 있고, 몇 초에 한 번 짧게 떨린다 (결정적) */
function flickerOn(f: FrameState, seed: number): number {
  const b = Math.floor(f.time * 14);
  const burst = hash01(Math.floor(f.time / 3.7) + seed) > 0.72 && (f.time % 3.7) < 0.45;
  if (!burst) return 1;
  return hash01(b + seed * 31) > 0.5 ? 1 : 0.25;
}

export const neon: ThemeDef = {
  id: 'neon',
  name: '네온',
  desc: '벽돌 벽 위 포인트색 네온사인',
  suggestedAccent: '#ff3fa4',
  baseTone: 'dark',
  toneBg: wallBg,
  background(ctx, f, kit) {
    const W = f.width, H = f.height, p = f.palette;
    const light = p.tone === 'light';
    if (f.settings.photoLayout === 'background') {
      photoBackdrop(ctx, f, kit, 0.25);
    } else if (!p.bgCustom && !light) {
      const t = brickTile();
      const pat = t && ctx.createPattern(t, 'repeat');
      if (pat) {
        ctx.save(); const k = f.u * 1.2; ctx.scale(k, k); ctx.fillStyle = pat; ctx.fillRect(0, 0, W / k, H / k); ctx.restore();
      } else { ctx.fillStyle = '#0b0a0e'; ctx.fillRect(0, 0, W, H); }
    } else {
      // 칠한 벽돌 벽 — 바탕색(파스텔 또는 지정색) 위에 줄눈·요철을 multiply로
      ctx.fillStyle = surfaceOf(f, wallBg); ctx.fillRect(0, 0, W, H);
      const t = paintedBrickTile();
      const pat = t && ctx.createPattern(t, 'repeat');
      if (pat) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = light ? 0.4 : 0.9;
        const k = f.u * 1.2; ctx.scale(k, k); ctx.fillStyle = pat; ctx.fillRect(0, 0, W / k, H / k);
        ctx.restore();
      }
    }
    // 네온이 벽을 비추는 빛 (낮에는 은은하게)
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.65);
    g.addColorStop(0, alpha(p.accent, (light ? 0.08 : 0.22) * flickerOn(f, 1)));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (light) vignette(ctx, f, 0.14, f.settings.photoLayout === 'background' ? rgbOf(p.dim) : rgbOf(mix(surfaceOf(f, wallBg), '#3a2f28', 0.55)));
    else vignette(ctx, f, 0.75);
    grain(ctx, f, 0.05, 0);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings;
    const shape = shapeOf(f);
    const p = f.palette;
    const nat = isNative(f, 'dark');
    const day = p.tone === 'light';   // 낮: 색 유리관 + 은은한 빛
    const c1 = withLightness(p.accent, 0.62, 1.2);
    // 보조 네온색 — 포인트색의 맞은편(보색 쪽)으로 살짝
    const c2 = withLightness(mix(p.accent, '#30e0ff', 0.7), 0.7, 1.1);
    // 낮의 유리관 색 — 벽 위에서 읽히도록 진하게 (제목 ≥ 3, 작은 글자 ≥ 4.5)
    const wall = s.photoLayout === 'background' ? p.dim : surfaceOf(f, wallBg);
    const t1 = ensureContrast(withLightness(p.accent, 0.42, 1.15), wall, 3.2);
    const t2 = ensureContrast(withLightness(mix(p.accent, '#30e0ff', 0.7), 0.36, 1.1), wall, 4.6);
    const neonT = (str: string, x: number, y: number, font: string, which: 1 | 2, on: number, role: 'title' | 'artist') => {
      ctx.save(); ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const base = day ? (which === 1 ? t1 : t2) : (which === 1 ? c1 : c2);
      const ink = kit.textInk?.(ctx, role, str, x, y, base) ?? base;
      ctx.restore();
      if (day) glassText(ctx, str, x, y, font, ink, ink, on, u);
      else neonText(ctx, str, x, y, font, ink, on, u);
    };
    const on1 = flickerOn(f, 1), on2 = flickerOn(f, 2);
    const pad = 80 * u;
    let photo: { x: number; y: number; w: number } | null = null;
    let tx: number, ty: number, tw: number;
    let lr: { x: number; y: number; w: number; h: number };
    const coverMode = s.photoLayout === 'cover';
    if (shape === 'land') {
      const pw = H - pad * 2.6;
      if (coverMode) photo = { x: pad * 1.5, y: (H - pw) / 2, w: pw };
      const rx = coverMode ? pad * 1.5 + pw + pad * 1.2 : pad * 1.5;
      tw = W - rx - pad * 1.5; tx = rx + tw / 2; ty = pad * 1.9;
      lr = { x: rx, y: ty + 170 * u, w: tw, h: H - ty - 170 * u - pad * 1.6 };
    } else if (shape === 'square') {
      // 정사각: 제목은 위 가운데, 아래는 왼쪽 사진 + 오른쪽 가사
      tw = W - pad * 2; tx = W / 2; ty = pad * 1.5;
      const top = ty + (s.phrase ? 190 : 150) * u;
      const pw = coverMode ? 470 * u : 0;   // 사진이 작아 보이지 않게 (예전 400)
      if (coverMode) photo = { x: pad + 18 * u, y: top + 18 * u, w: pw };
      const lx = coverMode ? pad + pw + 80 * u : pad;
      lr = { x: lx, y: top, w: W - lx - pad, h: H - top - pad * 1.3 };
    } else {
      tw = W - pad * 2; tx = W / 2; ty = H * 0.12;
      const pw = coverMode ? Math.max(0, Math.min(W - pad * 3.4, H * 0.4, H - ty - 190 * u - 70 * u - pad * 2 - (s.visualizer !== 'none' && s.visualizer !== 'radial' ? 120 : 0) * u - 290 * u)) : 0;
      if (coverMode) photo = { x: (W - pw) / 2, y: ty + 190 * u, w: pw };
      const ly = coverMode ? ty + 190 * u + pw + 70 * u : ty + 260 * u;
      lr = { x: pad, y: ly, w: W - pad * 2, h: H - ly - pad * 2 };
    }
    // 제목 네온 — 너무 길면 크기를 줄인다
    let fs = (shape === 'tall' ? 96 : 84) * u;
    ctx.font = kit.font(fs, 700);
    const mw = ctx.measureText(titleOf(f)).width;
    if (mw > tw) fs *= Math.max(0.45, tw / mw);
    neonT(kit.fitText(ctx, titleOf(f), tw), tx, ty, kit.font(fs, 700), 1, on1, 'title');
    ctx.save(); setSpacing(ctx, 8 * u);
    neonT(artistOf(f).toUpperCase(), tx, ty + fs * 0.5 + 46 * u, kit.font(30 * u, 500), 2, on2, 'artist');
    ctx.restore();
    if (s.phrase) {
      ctx.save(); ctx.globalAlpha = nat ? 0.6 : 1;
      ctx.font = kit.font(24 * u, 400); ctx.textAlign = 'center';
      ctx.fillStyle = kit.textInk?.(ctx, 'phrase', s.phrase, tx, ty + fs * 0.5 + 96 * u, nat ? '#e8e6f0' : p.inkSoft, tw) ?? (nat ? '#e8e6f0' : p.inkSoft);
      ctx.fillText(kit.fitText(ctx, s.phrase, tw), tx, ty + fs * 0.5 + 96 * u);
      ctx.restore();
    }
    // 사진 + 네온 틀
    if (photo) {
      kit.drawPhoto(ctx, { x: photo.x, y: photo.y, w: photo.w, h: photo.w }, { radius: 26 * u, dim: 0.08 });
      if (s.visualizer === 'radial') {
        const m = photo.w * 0.2;
        kit.drawVisualizer(ctx, { x: photo.x + m, y: photo.y + m, w: photo.w - m * 2, h: photo.w - m * 2 }, { color: c1, color2: c2, innerRadius: 0.5, glow: 10 * u });
      }
      if (day) glassRect(ctx, photo.x - 18 * u, photo.y - 18 * u, photo.w + 36 * u, photo.w + 36 * u, 40 * u, t1, c1, on1, u);
      else neonRect(ctx, photo.x - 18 * u, photo.y - 18 * u, photo.w + 36 * u, photo.w + 36 * u, 40 * u, c1, on1, u);
    }
    // 비주얼라이저 + 가사
    let lh = lr.h;
    if (s.visualizer !== 'none' && !(photo && s.visualizer === 'radial')) {
      const vh = (photo ? 90 : 160) * u;
      kit.drawVisualizer(ctx, { x: lr.x, y: lr.y + lr.h - vh, w: lr.w, h: vh }, { color: day ? t1 : c1, color2: day ? t2 : c2, glow: (day ? 5 : 12) * u, count: 48, mirror: true, innerRadius: 0.35 });
      lh -= vh + 30 * u;
    }
    kit.drawLyrics(ctx, { x: lr.x, y: lr.y, w: lr.w, h: lh }, {
      align: shape === 'tall' ? 'center' : 'left', size: (shape === 'square' && coverMode ? 40 : 46) * u,
      color: nat ? '#ffffff' : p.ink, dimColor: day ? t2 : alpha(c2, 0.85),
      weight: 700, glow: day ? alpha(c1, 0.45) : c1, lineHeight: 1.45,
    });
    // 진행 — 아래 가는 네온 선
    if (s.showProgress) {
      const px = lr.x, pw = lr.w, py = H - pad * 0.9;
      ctx.save();
      ctx.fillStyle = nat ? 'rgba(255,255,255,0.12)' : alpha(p.ink, 0.14); ctx.fillRect(px, py, pw, 3 * u);
      ctx.shadowColor = c1; ctx.shadowBlur = (day ? 8 : 16) * u;
      ctx.fillStyle = day ? t1 : mix(c1, '#ffffff', 0.4); ctx.fillRect(px, py - 1 * u, pw * kit.progress, 5 * u);
      ctx.restore();
      ctx.save(); ctx.font = kit.font(20 * u, 400, kit.mono); ctx.fillStyle = nat ? 'rgba(255,255,255,0.55)' : p.inkSoft;
      ctx.fillText(kit.fmtTime(f.time), px, py - 16 * u);
      ctx.textAlign = 'right'; ctx.fillText(kit.fmtTime(f.duration), px + pw, py - 16 * u);
      ctx.restore();
    }
  },
};
