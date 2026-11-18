// [media 담당] 한 프레임 그리기 — 미리보기·PNG·MP4·GIF 공용
//
// 원칙
// - 상태 없음: 같은 FrameState → 같은 그림 (가사 스크롤·움직임·대기 애니메이션 모두 f.time으로 계산)
// - 무거운 처리(사진 흐림·흑백)는 오프스크린 캐시로 한 번만
// - 테마는 f.u(= 짧은 변/1080) 단위로 그리고, kit 도구를 빌려 쓴다
import type { CoverSettings, FrameState, LyricLine, MotionState, MotionId, Palette, RenderKit, Rect, LyricStyle, VizStyle, VisualizerId } from './types';
import { getTheme } from './themes';
import { fontFamily, fontCss, MONO_FAMILY } from './fonts';
import { lineIndexAt } from './lyrics';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ───────────────────────── 움직임 ─────────────────────────

/** 움직임 변환. 결정적(같은 t → 같은 값). dx/dy는 1080 기준 단위.
 *  - sway: 아주 미세한 회전 + 수평 이동 (서로 다른 주기의 사인 합 → 기계적이지 않은 루프)
 *  - breathe: 5초 주기 줌인·줌아웃 (scale = 사진 안쪽 줌, 장면 전체엔 그 40%만)
 *  - kenburns: 24초 주기로 천천히 패닝+줌 (사진 안쪽에만 적용) */
export function motionAt(kind: MotionId, t: number, strength: number): MotionState {
  const s = clamp(isFinite(strength) ? strength : 0, 0, 1);
  if (!isFinite(t)) t = 0;
  if (kind === 'sway') {
    return {
      scale: 1,
      dx: (Math.sin((TAU * t) / 7) * 0.75 + Math.sin((TAU * t) / 3.5 + 1.3) * 0.25) * 14 * s,
      dy: Math.sin((TAU * t) / 5) * 3 * s,
      rot: (Math.sin((TAU * t) / 7 + 0.9) * 0.8 + Math.sin((TAU * t) / 4.2) * 0.2) * 0.012 * s,
    };
  }
  if (kind === 'breathe') {
    const p = 0.5 - 0.5 * Math.cos((TAU * t) / 5); // 0→1→0, 5초
    return { scale: 1 + easeInOut(p) * 0.05 * s, dx: 0, dy: 0, rot: 0 };
  }
  if (kind === 'kenburns') {
    const p = (TAU * t) / 24;
    return {
      scale: 1.08 + 0.07 * s * (0.5 - 0.5 * Math.cos(p)),
      dx: Math.sin(p) * 40 * s,
      dy: Math.sin(p * 2 + 0.7) * 26 * s,
      rot: 0,
    };
  }
  return { scale: 1, dx: 0, dy: 0, rot: 0 };
}

/** 장면(전경) 전체에 거는 breathe 배율 비율 — 사진 안쪽 줌보다 약하게 */
const SCENE_BREATHE = 0.4;

export interface FrameInput {
  settings: CoverSettings;
  width: number; height: number;
  time: number; duration: number; playing: boolean;
  image: CanvasImageSource | null; imageW: number; imageH: number;
  lyrics: LyricLine[];
  spectrum: Uint8Array | null; waveform: Uint8Array | null; level: number;
  palette: Palette;
}

export function makeFrame(i: FrameInput): FrameState {
  return { ...i, u: Math.max(1e-3, Math.min(i.width, i.height) / 1080) };
}

// ───────────────────────── 공용 도구 ─────────────────────────

function roundRectPath(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, rad: number) {
  const r = Math.max(0, Math.min(rad, w / 2, h / 2));
  if (r <= 0) { ctx.rect(x, y, w, h); return; }
  if (typeof (ctx as CanvasRenderingContext2D).roundRect === 'function') {
    (ctx as CanvasRenderingContext2D).roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fmtTime(sec: number): string {
  const s = isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  // 이진 탐색 (긴 글자에서도 measureText 호출 수를 줄인다)
  const chars = Array.from(text);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(chars.slice(0, mid).join('').trimEnd() + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join('').trimEnd() + '…';
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  // ctx.letterSpacing은 크롬 계열만 — 없으면 무시
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** text를 maxW 안에서 최대 maxLines줄로 (공백 우선, 없으면 글자 단위). 넘치면 마지막 줄 … */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const t = text.trim();
  if (!t) return [''];
  if (ctx.measureText(t).width <= maxW) return [t];
  if (maxLines <= 1) return [fitText(ctx, t, maxW)];
  // 토큰: 공백 단위 단어. 한 단어가 너무 길면 글자 단위로 쪼갠다 (sp=뒤에 공백이 있던 토큰)
  const tokens: { s: string; sp: boolean }[] = [];
  for (const w of t.split(/\s+/)) {
    if (ctx.measureText(w).width <= maxW) { tokens.push({ s: w, sp: true }); continue; }
    let piece = '';
    const chars = Array.from(w);
    chars.forEach((ch, k) => {
      if (piece && ctx.measureText(piece + ch).width > maxW) { tokens.push({ s: piece, sp: false }); piece = ''; }
      piece += ch;
      if (k === chars.length - 1) tokens.push({ s: piece, sp: true });
    });
  }
  const lines: string[] = [];
  let cur = '';
  let i = 0;
  for (; i < tokens.length; i++) {
    const tk = tokens[i];
    const joiner = cur && i > 0 && tokens[i - 1].sp ? ' ' : '';
    const cand = cur + joiner + tk.s;
    if (!cur || ctx.measureText(cand).width <= maxW) { cur = cand; continue; }
    lines.push(cur);
    cur = tk.s;
    if (lines.length === maxLines - 1) { i++; break; }
  }
  // 마지막 줄 = 남은 전부 → 넘치면 …
  const rest = [cur, ...tokens.slice(i).map(x => x.s)].filter(Boolean).join(' ');
  if (rest) lines.push(fitText(ctx, rest, maxW));
  return lines.slice(0, maxLines);
}

// ───────────────────────── 사진 캐시 ─────────────────────────

type Canvasish = HTMLCanvasElement | OffscreenCanvas;
function makeCanvas(w: number, h: number): Canvasish {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const ctx2d = (c: Canvasish, read = false) => c.getContext('2d', read ? { willReadFrequently: true } : undefined) as Ctx2D | null;

let filterOk: boolean | null = null;
/** ctx.filter가 실제로 적용되는지 (사파리 일부 버전은 속성이 없거나 동작 안 함) */
export function canvasFilterSupported(): boolean {
  if (filterOk !== null) return filterOk;
  try {
    const w = typeof window !== 'undefined' ? (window as unknown as { __coverNoFilter?: boolean }) : null;
    if (w?.__coverNoFilter) return (filterOk = false); // 검증용: 사파리 경로 강제
    const c = makeCanvas(9, 9);
    const x = ctx2d(c, true);
    if (!x || !('filter' in x)) return (filterOk = false);
    x.fillStyle = '#000'; x.fillRect(0, 0, 9, 9);
    const src = makeCanvas(1, 1);
    const sx = ctx2d(src)!;
    sx.fillStyle = '#fff'; sx.fillRect(0, 0, 1, 1);
    x.filter = 'blur(2px)';
    x.drawImage(src as CanvasImageSource, 4, 4);
    x.filter = 'none';
    const d = x.getImageData(2, 4, 1, 1).data; // 가운데에서 2px 옆 — 흐려졌으면 0보다 밝다
    filterOk = d[0] > 0;
  } catch { filterOk = false; }
  return filterOk;
}

interface CacheEntry { key: string; canvas: Canvasish }
const photoCache = new WeakMap<object, CacheEntry[]>();
const CACHE_PER_IMAGE = 8;

/** 사진 캐시 비우기 (WeakMap이라 사진을 버리면 저절로 GC됨 — 보통 안 불러도 됨) */
export function clearPhotoCache(img?: object) {
  if (img) photoCache.delete(img);
}

/** 흐림·흑백 버전을 rect 비율로 미리 만들어 둔다. blur가 크면 해상도를 낮춰 빠르게(어차피 흐림) */
function processedPhoto(img: CanvasImageSource, iw: number, ih: number, w: number, h: number, blur: number, gray: boolean): Canvasish | null {
  const key0 = img as unknown as object;
  const ds = blur >= 24 ? 0.25 : blur >= 8 ? 0.5 : 1;
  // 크기는 8px 단위로 묶어 미세한 크기 변화(애니메이션)에도 재사용
  const cw = Math.max(8, Math.round((w * ds) / 8) * 8);
  const ch = Math.max(8, Math.round((h * ds) / 8) * 8);
  const b = Math.round(blur * ds * 2) / 2;
  const key = `${cw}x${ch}|${b}|${gray ? 1 : 0}`;
  let list = photoCache.get(key0);
  if (!list) { list = []; photoCache.set(key0, list); }
  const hit = list.find(e => e.key === key);
  if (hit) return hit.canvas;
  const c = makeCanvas(cw, ch);
  const x = ctx2d(c, gray);
  if (!x) return null;
  // rect 비율로 cover 자르기. 흐림이 있으면 가장자리가 투명하게 빠지지 않도록 살짝 크게 그린다
  const over = b > 0 ? 1 + (4 * b) / Math.min(cw, ch) : 1;
  const k = Math.max(cw / iw, ch / ih) * over;
  const dw = iw * k, dh = ih * k;
  const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  if (b > 0 && canvasFilterSupported()) {
    x.drawImage(img, dx, dy, dw, dh); // 바탕 (흐림 가장자리 투명 방지)
    x.filter = `blur(${b}px)`;
    x.drawImage(img, dx, dy, dw, dh);
    x.filter = 'none';
  } else if (b > 0) {
    // filter 미지원(사파리): 작게 줄였다가 키워서 흐림 흉내 (두 단계로 계단 현상 완화)
    const fct = Math.max(2, b * 0.9);
    const sw = Math.max(2, Math.round(cw / fct)), sh = Math.max(2, Math.round(ch / fct));
    const s1 = makeCanvas(sw * 2, sh * 2), s2 = makeCanvas(sw, sh);
    const x1 = ctx2d(s1)!, x2 = ctx2d(s2)!;
    x1.imageSmoothingQuality = 'high'; x2.imageSmoothingQuality = 'high';
    x1.drawImage(img, (dx / cw) * sw * 2, (dy / ch) * sh * 2, (dw / cw) * sw * 2, (dh / ch) * sh * 2);
    x2.drawImage(s1 as CanvasImageSource, 0, 0, sw, sh);
    x1.clearRect(0, 0, sw * 2, sh * 2);
    x1.drawImage(s2 as CanvasImageSource, 0, 0, sw * 2, sh * 2);
    x.drawImage(s1 as CanvasImageSource, 0, 0, cw, ch);
  } else {
    x.drawImage(img, dx, dy, dw, dh);
  }
  if (gray) {
    try {
      const d = x.getImageData(0, 0, cw, ch);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const l = p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722;
        p[i] = p[i + 1] = p[i + 2] = l;
      }
      x.putImageData(d, 0, 0);
    } catch { /* tainted — 흑백 생략 */ }
  }
  list.push({ key, canvas: c });
  if (list.length > CACHE_PER_IMAGE) list.shift();
  return c;
}

/** src(sw×sh)를 rect에 cover로, zoom배 + 패닝(넘치는 범위 안으로 제한 → 빈 가장자리 없음) */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, rect: Rect, zoom: number, panX: number, panY: number) {
  const k = Math.max(rect.w / sw, rect.h / sh) * Math.max(1, zoom);
  const w = sw * k, h = sh * k;
  const ovx = Math.max(0, (w - rect.w) / 2), ovy = Math.max(0, (h - rect.h) / 2);
  const x = rect.x + (rect.w - w) / 2 + clamp(panX, -ovx, ovx);
  const y = rect.y + (rect.h - h) / 2 + clamp(panY, -ovy, ovy);
  ctx.drawImage(src, x, y, w, h);
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, f: FrameState, rect: Rect, gray: boolean, blurred: boolean) {
  const p = f.palette;
  const a = gray ? '#8a8a8a' : p.accent, b = gray ? '#2b2b2b' : p.accentDeep;
  const g = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  // 살짝 밝고 어두운 대각 그늘 (팔레트가 단색이어도 입체감)
  const sh = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = sh;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const R = Math.min(rect.w, rect.h) / 2;
  if (blurred || R < 8) return;
  // 은은한 디스크 모티브 (홈 + 라벨 + 음표)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = Math.max(1, R * 0.006);
  ctx.beginPath();
  for (let r = R * 0.34; r < R * 0.78; r += R * 0.045) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.26, 0, TAU); ctx.fill();
  // 음표 (도형으로 — 폰트 없이)
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  const s = R * 0.12;
  ctx.beginPath(); ctx.ellipse(cx - s * 0.45, cy + s * 0.55, s * 0.4, s * 0.3, -0.4, 0, TAU); ctx.fill();
  ctx.fillRect(cx - s * 0.12, cy - s * 0.95, s * 0.12, s * 1.5);
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.95);
  ctx.quadraticCurveTo(cx + s * 0.6, cy - s * 0.7, cx + s * 0.5, cy - s * 0.15);
  ctx.quadraticCurveTo(cx + s * 0.4, cy - s * 0.55, cx, cy - s * 0.6);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ───────────────────────── 비주얼라이저 ─────────────────────────

/** 로그 주파수 축 범위. 내보내기 분석도 VIZ_MAX_BIN까지만 보관한다 (같은 그림) */
const VIZ_FMIN = 40, VIZ_FMAX = 11000, ASSUMED_NYQUIST = 22050;
/** 1024 bin 중 비주얼라이저가 실제로 읽는 범위 (≈ 11kHz, 48kHz 샘플레이트에서도 넉넉) */
export const VIZ_MAX_BIN = 560;
/** wave가 읽는 파형 앞쪽 샘플 수 */
export const VIZ_WAVE_SAMPLES = 1024;

/** 스펙트럼에서 로그 주파수 밴드 count개 (0~1). 오디오 없으면 시간 기반 대기 애니메이션 */
function bands(f: FrameState, count: number, out: Float32Array): Float32Array {
  const gain = clamp(f.settings.vizGain || 1, 0.25, 3);
  const spec = f.spectrum;
  if (!spec || !spec.length) {
    const t = f.time;
    for (let i = 0; i < count; i++) {
      const x = i / Math.max(1, count - 1);
      out[i] = clamp((0.1 + 0.06 * Math.sin(t * 1.7 + i * 0.42) + 0.04 * Math.sin(t * 2.9 - i * 0.77) + 0.03 * Math.sin(t * 0.6 + x * 9)) * (1 - 0.3 * x) * Math.sqrt(gain), 0.02, 1);
    }
    return out;
  }
  const n = spec.length;
  const binHz = ASSUMED_NYQUIST / n;
  const lmin = Math.log(VIZ_FMIN), lmax = Math.log(VIZ_FMAX);
  for (let i = 0; i < count; i++) {
    const f0 = Math.exp(lerp(lmin, lmax, i / count)), f1 = Math.exp(lerp(lmin, lmax, (i + 1) / count));
    const b0 = f0 / binHz, b1 = f1 / binHz;
    let v: number;
    if (b1 - b0 < 1) {
      // 밴드가 bin보다 좁음(저음) → 선형 보간
      const c = (b0 + b1) / 2, j = Math.floor(c), fr = c - j;
      v = lerp(spec[Math.min(n - 1, j)], spec[Math.min(n - 1, j + 1)], fr);
    } else {
      let m = 0, sum = 0, cnt = 0;
      for (let j = Math.floor(b0); j < Math.ceil(b1) && j < n; j++) { const s = spec[j]; sum += s; cnt++; if (s > m) m = s; }
      v = cnt ? m * 0.6 + (sum / cnt) * 0.4 : 0;
    }
    const x = i / count;
    let y = clamp((v / 255 - 0.1) / 0.9, 0, 1);
    y = Math.pow(y, 1.35) * (1 + 0.5 * x) * gain; // 대비 + 고음 보정
    out[i] = clamp(y, 0, 1);
  }
  return out;
}

const bandBuf = new Float32Array(512);

function linGrad(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, c1: string, c2?: string): CanvasGradient | string {
  if (!c2) return c1;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  return g;
}

/** 광채는 path 하나에 한 번만 (막대마다 shadowBlur 금지) */
function applyGlow(ctx: CanvasRenderingContext2D, st: VizStyle) {
  if (st.glow && st.glow > 0) { ctx.shadowColor = st.color; ctx.shadowBlur = st.glow; }
}

/** bars — 둥근 막대 스펙트럼 (로그 주파수, mirror면 가운데서 위아래로) */
function vizBars(ctx: CanvasRenderingContext2D, f: FrameState, r: Rect, st: VizStyle) {
  const count = clamp(Math.round(st.count ?? 48), 4, 256);
  const v = bands(f, count, bandBuf);
  const step = r.w / count;
  const bw = Math.max(1, step * 0.62);
  const path = new Path2D();
  for (let i = 0; i < count; i++) {
    const h = Math.max(bw, v[i] * r.h);
    const x = r.x + i * step + (step - bw) / 2;
    const y = st.mirror ? r.y + (r.h - h) / 2 : r.y + r.h - h;
    roundRectPath(path, x, y, bw, h, bw / 2);
  }
  if (st.mirror && st.color2) {
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, st.color2); g.addColorStop(0.5, st.color); g.addColorStop(1, st.color2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = linGrad(ctx, 0, r.y + r.h, 0, r.y, st.color, st.color2);
  }
  applyGlow(ctx, st);
  ctx.fill(path);
}

const wavePts = new Float32Array(256);
/** wave — 시간영역 파형 2겹 부드러운 곡선 */
function vizWave(ctx: CanvasRenderingContext2D, f: FrameState, r: Rect, st: VizStyle) {
  const N = 96;
  const gain = clamp(f.settings.vizGain || 1, 0.25, 3);
  const wf = f.waveform;
  const midY = r.y + r.h / 2;
  const amp = r.h / 2;
  // 앞쪽 1024샘플을 N구간 평균 → 부드러운 곡선(고주파 잡음 제거). 양 끝은 사인 창으로 가운데선에 붙임
  const fill = (phase: number, k: number) => {
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      const win = Math.sin(Math.PI * x);
      let val: number;
      if (wf && wf.length) {
        const L = Math.min(VIZ_WAVE_SAMPLES, wf.length);
        const seg = L / N;
        const s0 = Math.floor(i * seg + phase * L);
        const m = Math.max(1, Math.floor(seg));
        let sum = 0;
        for (let j = 0; j < m; j++) sum += wf[(s0 + j) % L];
        val = clamp(((sum / m - 128) / 128) * 2.4 * gain, -1, 1);
      } else {
        const t = f.time;
        val = 0.2 * Math.sin(x * 9 + t * 2.2 + phase * 6) + 0.1 * Math.sin(x * 17 - t * 3.1) + 0.05 * Math.sin(x * 31 + t * 1.3);
      }
      wavePts[i] = val * win * k;
    }
  };
  const stroke = (lw: number, style: string | CanvasGradient, alpha: number) => {
    ctx.beginPath();
    const dx = r.w / (N - 1);
    ctx.moveTo(r.x, midY - wavePts[0] * amp);
    for (let i = 1; i < N - 1; i++) {
      const x = r.x + i * dx, y = midY - wavePts[i] * amp;
      const xn = r.x + (i + 1) * dx, yn = midY - wavePts[i + 1] * amp;
      ctx.quadraticCurveTo(x, y, (x + xn) / 2, (y + yn) / 2);
    }
    ctx.lineTo(r.x + r.w, midY - wavePts[N - 1] * amp);
    ctx.lineWidth = lw; ctx.strokeStyle = style;
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * alpha;
    ctx.stroke();
    ctx.globalAlpha = ga;
  };
  const lw = st.thickness ?? Math.max(1.5, 4 * f.u);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // 뒤 곡선: 다른 위상·조금 큰 진폭, color2, 얇고 흐리게
  fill(0.37, 1.25);
  stroke(lw * 0.7, st.color2 ?? st.color, 0.45);
  fill(0, 1);
  applyGlow(ctx, st);
  stroke(lw, linGrad(ctx, r.x, 0, r.x + r.w, 0, st.color, st.color2), 1);
}

/** radial — rect 중심 원 둘레 방사형 막대 링 (좌우 대칭) */
function vizRadial(ctx: CanvasRenderingContext2D, f: FrameState, r: Rect, st: VizStyle) {
  const half = clamp(Math.round((st.count ?? 72) / 2), 8, 180);
  const v = bands(f, half, bandBuf);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const R = Math.min(r.w, r.h) / 2;
  const inner = R * clamp(st.innerRadius ?? 0.55, 0.05, 0.95);
  const total = half * 2;
  const lw = st.thickness ?? Math.max(1.5, ((TAU * inner) / total) * 0.5);
  const r0 = inner + lw * 0.5;
  const span = Math.max(1, R - r0 - lw * 0.5);
  ctx.beginPath();
  for (let i = 0; i < total; i++) {
    // 위쪽(저음)에서 시작해 양옆으로 고음, 아래에서 만남
    const bi = i < half ? i : total - 1 - i;
    const a = -Math.PI / 2 + ((i + 0.5) / total) * TAU;
    const len = Math.max(lw * 0.6, v[bi] * span);
    const c = Math.cos(a), s = Math.sin(a);
    ctx.moveTo(cx + c * r0, cy + s * r0);
    ctx.lineTo(cx + c * (r0 + len), cy + s * (r0 + len));
  }
  let style: string | CanvasGradient = st.color;
  if (st.color2) {
    const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, R);
    g.addColorStop(0, st.color); g.addColorStop(1, st.color2);
    style = g;
  }
  ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.lineCap = 'round';
  applyGlow(ctx, st);
  ctx.stroke();
  // 안쪽 고리 — 음량에 따라 살짝 두꺼워짐
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, inner - lw * 0.8), 0, TAU);
  ctx.lineWidth = Math.max(1, lw * (0.35 + clamp(f.level, 0, 1) * 0.9));
  ctx.strokeStyle = st.color;
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * 0.5;
  ctx.stroke();
  ctx.globalAlpha = ga;
}

/** dots — 도트 매트릭스 이퀄라이저 (열마다 점 쌓기, 꺼진 점은 옅게) */
function vizDots(ctx: CanvasRenderingContext2D, f: FrameState, r: Rect, st: VizStyle) {
  const cols = clamp(Math.round(st.count ?? 24), 4, 128);
  const v = bands(f, cols, bandBuf);
  const cell = r.w / cols;
  const rows = Math.max(2, Math.floor(r.h / cell));
  const rad = cell * 0.34;
  const y0 = r.y + r.h - (r.h - rows * cell) / 2; // 세로 가운데 정렬
  const lit = new Path2D(), off = new Path2D();
  for (let i = 0; i < cols; i++) {
    const n = Math.max(1, Math.round(v[i] * rows));
    const x = r.x + (i + 0.5) * cell;
    for (let j = 0; j < rows; j++) {
      const y = y0 - (j + 0.5) * cell;
      const p = j < n ? lit : off;
      p.moveTo(x + rad, y);
      p.arc(x, y, rad, 0, TAU);
    }
  }
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * 0.13;
  ctx.fillStyle = st.color;
  ctx.fill(off);
  ctx.globalAlpha = ga;
  ctx.fillStyle = linGrad(ctx, 0, y0, 0, y0 - rows * cell, st.color, st.color2);
  applyGlow(ctx, st);
  ctx.fill(lit);
}

// ───────────────────────── 가사 ─────────────────────────

/** 줄 전환 애니메이션 길이(초) */
const LYRIC_TRANSITION = 0.36;

/** 연속 가사 위치 — 정수 = 그 줄이 정확히 가운데. -1 = 첫 줄 전 (첫 줄은 다음 줄처럼 흐리게) */
export function lyricPosition(lines: LyricLine[], time: number): number {
  const idx = lineIndexAt(lines, time);
  if (idx < 0) return -1;
  const e = clamp((time - lines[idx].time) / LYRIC_TRANSITION, 0, 1);
  return idx - 1 + easeOutCubic(e);
}

function drawLyricsImpl(ctx: CanvasRenderingContext2D, f: FrameState, family: string, rect: Rect, st: LyricStyle) {
  const s = f.settings;
  const lines = f.lyrics;
  if (!s.showLyrics || !lines.length || rect.w <= 0 || rect.h <= 0 || !(st.size > 0)) return;
  const size = st.size;
  const cs = st.contextScale ?? 0.72;
  const lh = size * (st.lineHeight ?? 1.5);
  const weight = st.weight ?? 700;
  const ctxWeight = Math.min(weight, 500);
  const maxWrap = Math.max(1, Math.round(st.maxWrap ?? 2));
  const n = s.lyricContext ? clamp(Math.round(s.lyricContextLines || 1), 1, 3) : 0;
  const synced = isFinite(lines[0].time);
  const x = st.align === 'left' ? rect.x : st.align === 'right' ? rect.x + rect.w : rect.x + rect.w / 2;

  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  ctx.textAlign = st.align;
  ctx.textBaseline = 'middle';
  setLetterSpacing(ctx, st.letterSpacing ?? 0);
  const fontCur = fontCss(s.font, size, weight);

  const wrapCache = new Map<number, string[]>();
  const wrapped = (i: number): string[] => {
    let w = wrapCache.get(i);
    if (!w) {
      ctx.font = fontCur; // 늘 현재 줄 크기로 줄바꿈 → 전환 중 줄바꿈이 바뀌어 튀지 않음 (앞뒤 줄은 축소해서 그림)
      w = wrapText(ctx, lines[i].text, rect.w, maxWrap);
      wrapCache.set(i, w);
    }
    return w;
  };

  const drawLine = (i: number, cy: number, sc: number, emph: number, alpha: number) => {
    if (alpha <= 0.003) return;
    const ws = wrapped(i);
    const total = ws.length * lh;
    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(sc, sc);
    ctx.font = fontCss(s.font, size, emph > 0.5 ? weight : ctxWeight);
    if (emph > 0.5 && st.glow) { ctx.shadowColor = st.glow; ctx.shadowBlur = size * 0.45 * emph * sc; }
    else if (st.shadow) { ctx.shadowColor = st.shadow; ctx.shadowBlur = size * 0.18 * sc; ctx.shadowOffsetY = size * 0.06 * sc; }
    const paint = (color: string, a: number) => {
      if (a <= 0.003) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      for (let k = 0; k < ws.length; k++) ctx.fillText(ws[k], 0, -total / 2 + lh * (k + 0.5));
    };
    if (st.dimColor && emph < 1) {
      // 흐린 색 ↔ 강조 색 교차 페이드
      paint(st.dimColor, alpha * (1 - emph));
      paint(st.color, alpha * emph);
    } else {
      paint(st.color, alpha);
    }
    ctx.restore();
  };

  if (!synced) {
    // 시간 없는 txt — 앞 몇 줄을 정적으로 (첫 줄 강조)
    const k = Math.min(lines.length, n ? 1 + 2 * n : 1);
    const hs: number[] = [];
    for (let i = 0; i < k; i++) hs.push(wrapped(i).length * lh * (i === 0 ? 1 : cs));
    const totalH = hs.reduce((a, b) => a + b, 0);
    let y = rect.y + rect.h / 2 - totalH / 2;
    for (let i = 0; i < k; i++) {
      const a = i === 0 ? 1 : Math.max(0.12, 0.5 * Math.pow(0.72, i - 1));
      drawLine(i, y + hs[i] / 2, i === 0 ? 1 : cs, i === 0 ? 1 : 0, a);
      y += hs[i];
    }
    ctx.restore();
    return;
  }

  const pos = lyricPosition(lines, f.time);
  const base = Math.floor(pos), frac = pos - base;
  const reach = n + 1;
  const lo = base - reach, hi = base + reach + 1;
  // 각 줄(범위 밖은 높이만 가진 가상 줄)의 배율·높이
  const info: { i: number; sc: number; h: number; emph: number; dist: number }[] = [];
  for (let i = lo; i <= hi; i++) {
    const ad = Math.abs(i - pos);
    const emph = clamp(1 - ad, 0, 1);
    const ctxSc = cs * Math.max(0.78, 1 - 0.08 * Math.max(0, ad - 1)); // 멀수록 더 작게
    const sc = lerp(ctxSc, 1, emph);
    const nLines = i >= 0 && i < lines.length ? wrapped(i).length : 1;
    info.push({ i, sc, h: nLines * lh * sc, emph, dist: ad });
  }
  // base 줄을 가운데에 두고 위아래로 쌓은 뒤, frac만큼 다음 줄 쪽으로 이동 (연속)
  const bi = base - lo;
  const ys = new Array<number>(info.length);
  ys[bi] = 0;
  for (let j = bi + 1; j < info.length; j++) ys[j] = ys[j - 1] + info[j - 1].h / 2 + info[j].h / 2;
  for (let j = bi - 1; j >= 0; j--) ys[j] = ys[j + 1] - info[j + 1].h / 2 - info[j].h / 2;
  const shift = frac * (ys[bi + 1] - ys[bi]);
  const cy = rect.y + rect.h / 2;
  for (let j = 0; j < info.length; j++) {
    const it = info[j];
    if (it.i < 0 || it.i >= lines.length) continue;
    const d = it.dist;
    // 알파: 현재 1 → 바로 옆 0.42 → 멀수록 0.6배씩
    let a = d <= 1 ? lerp(n ? 0.42 : 0, 1, it.emph) : 0.42 * Math.pow(0.6, d - 1);
    if (d > n) a *= clamp(n + 1 - d, 0, 1); // n줄 바깥은 사라지기
    drawLine(it.i, cy + ys[j] - shift, it.sc, it.emph, a);
  }
  ctx.restore();
}

// ───────────────────────── kit ─────────────────────────

/** 테마에 빌려주는 도구 묶음 (검증·커스텀 레이아웃에서 직접 써도 된다) */
export function buildKit(f: FrameState): RenderKit {
  const family = fontFamily(f.settings.font);
  const motion = motionAt(f.settings.motion, f.time, f.settings.motionStrength);
  const kind = f.settings.motion;

  const drawPhoto: RenderKit['drawPhoto'] = (ctx, rect, opts = {}) => {
    if (rect.w <= 0 || rect.h <= 0) return;
    const blur = Math.max(0, opts.blur ?? 0);
    const gray = !!opts.grayscale;
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, opts.radius ?? 0);
    ctx.clip();
    if (f.image && f.imageW > 0 && f.imageH > 0) {
      // 사진 안쪽 움직임: 켄번즈(줌+패닝), 브리딩(줌)
      const zoom = kind === 'kenburns' || kind === 'breathe' ? motion.scale : 1;
      // 패닝량(1080 단위)은 rect 크기에 비례 → 작은 사진 칸에서도 같은 느낌. 넘치는 범위 안으로 제한
      const pk = (Math.min(rect.w, rect.h) / 1080) * 2;
      const px = kind === 'kenburns' ? motion.dx * pk : 0, py = kind === 'kenburns' ? motion.dy * pk : 0;
      if (blur > 0 || gray) {
        const c = processedPhoto(f.image, f.imageW, f.imageH, rect.w, rect.h, blur, gray);
        // 흐린 사진은 살짝 크게(1.06) 그려 흐림 가장자리를 숨긴다
        if (c) drawCover(ctx, c as CanvasImageSource, c.width, c.height, rect, zoom * (blur > 0 ? 1.06 : 1), px, py);
      } else {
        drawCover(ctx, f.image, f.imageW, f.imageH, rect, zoom, px, py);
      }
    } else {
      drawPlaceholder(ctx, f, rect, gray, blur > 0);
    }
    if (opts.dim && opts.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${clamp(opts.dim, 0, 1)})`;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
  };

  const drawLyrics: RenderKit['drawLyrics'] = (ctx, rect, st) => drawLyricsImpl(ctx, f, family, rect, st);

  const drawVisualizer: RenderKit['drawVisualizer'] = (ctx, rect, st) => {
    const k: VisualizerId = st.kind ?? f.settings.visualizer;
    if (k === 'none' || rect.w <= 0 || rect.h <= 0) return;
    ctx.save();
    ctx.globalAlpha *= st.alpha ?? 1;
    if (k === 'bars') vizBars(ctx, f, rect, st);
    else if (k === 'wave') vizWave(ctx, f, rect, st);
    else if (k === 'radial') vizRadial(ctx, f, rect, st);
    else if (k === 'dots') vizDots(ctx, f, rect, st);
    ctx.restore();
  };

  return {
    family, mono: MONO_FAMILY,
    font: (px, w = 400, fam = family) => (fam === family ? fontCss(f.settings.font, px, w) : `${w} ${px}px ${fam}`),
    motion, drawPhoto, drawLyrics, drawVisualizer, fitText,
    progress: f.duration > 0 ? clamp(f.time / f.duration, 0, 1) : 0,
    fmtTime,
  };
}

/** ctx 크기 = f.width × f.height 로 맞춰진 상태에서 호출 */
export function renderFrame(ctx: CanvasRenderingContext2D, f: FrameState): void {
  const theme = getTheme(f.settings.theme);
  const kit = buildKit(f);
  ctx.save();
  theme.background(ctx, f, kit);
  ctx.restore();
  ctx.save();
  const m = kit.motion;
  const kind = f.settings.motion;
  if (kind === 'sway' || kind === 'breathe') {
    // 배경은 변환 밖에서 화면을 채우므로 가장자리가 비지 않는다
    ctx.translate(f.width / 2 + m.dx * f.u, f.height / 2 + m.dy * f.u);
    if (m.rot) ctx.rotate(m.rot);
    const sc = kind === 'breathe' ? 1 + (m.scale - 1) * SCENE_BREATHE : 1;
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.translate(-f.width / 2, -f.height / 2);
  }
  theme.foreground(ctx, f, kit);
  ctx.restore();
}
