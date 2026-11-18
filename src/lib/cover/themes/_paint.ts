// 테마 공용 그리기 도구 — 질감(그레인·종이·벽돌)·레이아웃 판정·글자 배치.
// 질감은 매 프레임 새로 만들지 않고 오프스크린 캔버스로 한 번만 만들어 패턴으로 재사용한다.
// 모든 애니메이션은 f.time 기반(결정적) — 같은 시각이면 같은 그림 → 내보내기 프레임이 미리보기와 같다.
import type { FrameState, RenderKit, Rect } from '../types';

export type Shape = 'tall' | 'square' | 'land';
/** 화면 모양 — 9:16·4:5 = tall, 1:1 = square, 16:9 = land */
export function shapeOf(f: FrameState): Shape {
  const r = f.width / f.height;
  if (r > 1.25) return 'land';
  if (r < 0.9) return 'tall';
  return 'square';
}

export const TITLE_FALLBACK = '노래 제목';
export const ARTIST_FALLBACK = '아티스트';
export const titleOf = (f: FrameState) => f.settings.title.trim() || TITLE_FALLBACK;
export const artistOf = (f: FrameState) => f.settings.artist.trim() || ARTIST_FALLBACK;

/** 결정적 의사난수 (0~1) */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/* ---------- 캐시된 질감 ---------- */

const texCache = new Map<string, HTMLCanvasElement>();
function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** 단색 노이즈 타일 (256px) — mono: 회색 노이즈 */
function noiseTile(seed: number): HTMLCanvasElement | null {
  const key = `noise:${seed}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(256, 256);
  if (!c) return null;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 9301 + 49297) % 233280;
    const v = (s / 233280) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  texCache.set(key, c);
  return c;
}

/** 필름 그레인 — 시간마다 타일 위치를 바꿔 살아 있는 느낌 (fps: 그레인이 바뀌는 속도) */
export function grain(ctx: CanvasRenderingContext2D, f: FrameState, amount: number, fps = 12, rect?: Rect) {
  const t = noiseTile(1);
  if (!t || amount <= 0) return;
  const r = rect ?? { x: 0, y: 0, w: f.width, h: f.height };
  const step = Math.floor(f.time * fps);
  const ox = Math.floor(hash01(step) * 256), oy = Math.floor(hash01(step + 7.3) * 256);
  const pat = ctx.createPattern(t, 'repeat');
  if (!pat) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.globalAlpha = amount;
  ctx.globalCompositeOperation = 'overlay';
  ctx.translate(-ox, -oy);
  // 노이즈 입자가 해상도에 비례하도록 (1080 기준 1.4px 입자)
  const k = Math.max(1, f.u * 1.4);
  ctx.scale(k, k);
  ctx.fillStyle = pat;
  ctx.fillRect((r.x + ox) / k, (r.y + oy) / k, r.w / k + 256, r.h / k + 256);
  ctx.restore();
}

/** 종이 질감 — 바탕색 위에 섬유 노이즈 (정적) */
export function paper(ctx: CanvasRenderingContext2D, f: FrameState, rect: Rect, base: string, amount = 0.22) {
  ctx.fillStyle = base;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const key = 'fiber';
  let c = texCache.get(key) ?? null;
  if (!c) {
    c = makeCanvas(512, 512);
    if (!c) return;
    const g = c.getContext('2d')!;
    g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const x = hash01(i) * 512, y = hash01(i + 0.5) * 512;
      const len = 3 + hash01(i + 0.2) * 14, a = hash01(i + 0.9) * Math.PI;
      g.strokeStyle = hash01(i + 0.3) > 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.28)';
      g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    texCache.set(key, c);
  }
  const pat = ctx.createPattern(c, 'repeat');
  if (!pat) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  ctx.globalAlpha = amount;
  ctx.globalCompositeOperation = 'soft-light';
  const k = Math.max(0.5, f.u);
  ctx.scale(k, k);
  ctx.fillStyle = pat;
  ctx.fillRect(rect.x / k, rect.y / k, rect.w / k, rect.h / k);
  ctx.restore();
  grain(ctx, { ...f, time: 0 }, amount * 0.5, 1, rect);
}

/** 가장자리 어둡게 */
export function vignette(ctx: CanvasRenderingContext2D, f: FrameState, strength = 0.55, color = '0,0,0') {
  const W = f.width, H = f.height;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  g.addColorStop(0, `rgba(${color},0)`);
  g.addColorStop(1, `rgba(${color},${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** 배경 사진 깔기 — photoLayout이 background일 때 테마들이 공통으로 쓴다 */
export function photoBackdrop(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, extraDim = 0) {
  const s = f.settings;
  kit.drawPhoto(ctx, { x: 0, y: 0, w: f.width, h: f.height }, {
    blur: s.bgBlur * 36 * f.u,
    dim: Math.min(0.92, s.bgDim + extraDim),
  });
}

/** 글자 한 줄 — maxW 넘으면 … */
export function text(
  ctx: CanvasRenderingContext2D, kit: RenderKit, s: string, x: number, y: number,
  o: { font: string; color: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; maxW?: number; alpha?: number; spacing?: number },
) {
  ctx.save();
  ctx.font = o.font;
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  if (o.spacing) setSpacing(ctx, o.spacing);
  ctx.fillText(o.maxW ? kit.fitText(ctx, s, o.maxW) : s, x, y);
  ctx.restore();
}

export function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

/** 진행 막대 — 트랙 + 채움 + 손잡이 */
export function progressBar(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: number,
  o: { track: string; fill: string; knob?: string; knobR?: number },
) {
  rr(ctx, x, y - h / 2, w, h, h / 2);
  ctx.fillStyle = o.track; ctx.fill();
  if (p > 0) { rr(ctx, x, y - h / 2, Math.max(h, w * p), h, h / 2); ctx.fillStyle = o.fill; ctx.fill(); }
  if (o.knob) {
    ctx.beginPath(); ctx.arc(x + w * p, y, o.knobR ?? h * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = o.knob; ctx.fill();
  }
}

/** 재생 컨트롤 아이콘 (이전 / 재생·일시정지 / 다음) — 선 아이콘이 아닌 면 아이콘 */
export function transport(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, playing: boolean, gap = 2.4) {
  ctx.save();
  ctx.fillStyle = color;
  const s = size;
  // 재생/정지
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  if (playing) {
    ctx.fillRect(cx - s * 0.32, cy - s * 0.36, s * 0.2, s * 0.72);
    ctx.fillRect(cx + s * 0.12, cy - s * 0.36, s * 0.2, s * 0.72);
  } else {
    ctx.beginPath(); ctx.moveTo(cx - s * 0.26, cy - s * 0.4); ctx.lineTo(cx + s * 0.42, cy); ctx.lineTo(cx - s * 0.26, cy + s * 0.4); ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const skip = (dir: number) => {
    const x = cx + dir * s * gap;
    ctx.beginPath();
    ctx.moveTo(x - dir * s * 0.32, cy - s * 0.34); ctx.lineTo(x + dir * s * 0.22, cy); ctx.lineTo(x - dir * s * 0.32, cy + s * 0.34); ctx.closePath(); ctx.fill();
    ctx.fillRect(dir > 0 ? x + s * 0.22 : x - s * 0.32, cy - s * 0.34, s * 0.1, s * 0.68);
  };
  skip(-1); skip(1);
  ctx.restore();
}

/** 부드러운 그림자를 깔고 도형 그리기 (큰 물체 하나에만 — 성능) */
export function withShadow(ctx: CanvasRenderingContext2D, blur: number, oy: number, color: string, draw: () => void) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = oy;
  draw();
  ctx.restore();
}
