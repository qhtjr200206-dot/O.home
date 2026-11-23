// Pure pixel-avatar rasterizer (no DOM, no React): usable from the browser,
// Node scripts and the village game. Every part is drawn natively on a
// 128 × 128 grid from high-resolution shapes (ellipses, polygons, tapered
// bezier strokes), then each layer gets a 1px self-coloured outline and
// top-left lit cel shading. Nothing is an upscale of the old 32 × 40 sprite.
// All art is original to this repository (see docs/pixel-avatar-research.md).

export interface PixelAvatarData {
  hair: number;
  face: number;
  body: number;
  hairColor: string;
  skinColor: string;
  bodyColor: string;
  eyeColor?: string;
}

export const PIXEL_AVATAR_SIZE = 128;
export const PIXEL_STYLE_COUNT = 24;
export const DEFAULT_EYE_COLOR = '#5a3d6e';
export const DEFAULT_PIXEL_AVATAR: PixelAvatarData = {
  hair: 0, face: 0, body: 0,
  hairColor: '#554050', skinColor: '#edbd9f', bodyColor: '#647a9a',
};

export const HAIR_STYLE_NAMES = [
  '숏컷', '보브', '롱 스트레이트', '트윈테일', '포니테일', '똥머리', '곱슬', '삐침머리',
  '웨이브 장발', '투블럭', '양갈래 땋은머리', '히메컷', '울프컷', '올백', '사이드테일', '더벅머리',
  '고양이귀', '반묶음', '드레드', '아프로', '베레모', '리본 롱', '바가지', '모히칸',
] as const;
export const FACE_STYLE_NAMES = [
  '기본 미소', '웃음 ^^', '놀람', '화남', '울음', '윙크', '졸림', '무표정',
  '부끄러움', '메롱', '고양이입', '결의', '걱정', '반짝눈', '실눈', '하트눈',
  '식은땀', '시무룩', '득의양양', '멍함', '째려봄', '하품', '안경', '반창고',
] as const;
export const BODY_STYLE_NAMES = [
  '티셔츠', '후드티', '세일러 교복', '정장', '원피스', '한복', '갑옷', '마법사 로브',
  '우주복', '멜빵', '앞치마', '트렌치코트', '체육복', '터틀넥 스웨터', '셔츠+조끼', '드레스',
  '파일럿 재킷', '의사 가운', '탱크톱', '망토', '군복', '파자마', '점프수트', '스카프+재킷',
] as const;

/** '#RGB' / '#RRGGBB' (any case) → '#rrggbb'; anything else → null. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^#[\da-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
  return null;
}

/** Legacy-safe style index: integers (or integer strings) 0..23, else 0. */
export function normalizeStyleIndex(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < PIXEL_STYLE_COUNT ? n : 0;
}

export function normalizePixelAvatar(value: unknown): Required<PixelAvatarData> {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof PixelAvatarData, unknown>>;
  return {
    hair: normalizeStyleIndex(v.hair),
    face: normalizeStyleIndex(v.face),
    body: normalizeStyleIndex(v.body),
    hairColor: normalizeHexColor(v.hairColor) ?? DEFAULT_PIXEL_AVATAR.hairColor,
    skinColor: normalizeHexColor(v.skinColor) ?? DEFAULT_PIXEL_AVATAR.skinColor,
    bodyColor: normalizeHexColor(v.bodyColor) ?? DEFAULT_PIXEL_AVATAR.bodyColor,
    eyeColor: normalizeHexColor(v.eyeColor) ?? DEFAULT_EYE_COLOR,
  };
}

/* ------------------------------------------------------------------ colour */

const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
const hex = (h: string) => rgba(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));

function toHsl(c: number): [number, number, number] {
  const r = (c >>> 24) / 255, g = ((c >>> 16) & 255) / 255, b = ((c >>> 8) & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgba(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}
const hueToward = (h: number, target: number, amt: number) => {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amt);
};
function mix(a: number, b: number, t: number) {
  const ch = (s: number) => Math.round(((a >>> s) & 255) * (1 - t) + ((b >>> s) & 255) * t);
  return rgba(ch(24), ch(16), ch(8));
}

/** Ramp indices: 1 highlight, 2 base, 3 shadow, 4 deep shadow, 5 outline. */
type Ramp = number[];
/** Builds a 5-step ramp in HSL. Lightness is clamped so even pure black or
 * white keeps visible highlight/shadow/outline steps; shadows hue-shift cool,
 * highlights warm. */
function makeRamp(color: string, soft = 1): Ramp {
  const base = hex(color);
  const [h, s, l] = toHsl(base);
  const L = Math.max(0.17, Math.min(0.86, l));
  const mid = L === l ? base : fromHsl(h, s, L);
  const out = Math.max(0.035, Math.min(0.3, L * 0.4));
  return [0,
    fromHsl(hueToward(h, 55, 8), s * 0.95, Math.min(0.96, L + 0.13)),
    mid,
    fromHsl(hueToward(h, 255, 9 * soft), Math.min(1, s * (soft < 1 ? 0.95 : 1.05) + 0.04 * soft), Math.max(L * 0.62, L - 0.14 * soft)),
    fromHsl(hueToward(h, 255, 15), Math.min(1, s * 1.1 + 0.06), Math.max(L * 0.38, L - 0.27)),
    fromHsl(hueToward(h, 255, 18), Math.min(1, s * 1.1 + 0.08), Math.min(out, Math.max(L * 0.38, L - 0.27) - 0.05)),
  ];
}
const accentOf = (color: string) => {
  const [h, s] = toHsl(hex(color));
  const c = fromHsl(h + 150, Math.max(0.45, Math.min(0.7, s)), 0.58);
  return '#' + (c >>> 8).toString(16).padStart(6, '0');
};
const darkerOf = (color: string) => {
  const [h, s, l] = toHsl(hex(color));
  const c = fromHsl(h, s * 0.8, Math.max(0.2, l - 0.2));
  return '#' + (c >>> 8).toString(16).padStart(6, '0');
};

/* ------------------------------------------------------------------ shapes */

const W = PIXEL_AVATAR_SIZE, NPX = W * W;
type Plot = (x: number, y: number) => void;
type Shape = (p: Plot) => void;

/** Ellipse sampled at pixel centres. */
const E = (cx: number, cy: number, rx: number, ry: number): Shape => p => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry, q = 1 - dy * dy;
    if (q < 0) continue;
    const hw = rx * Math.sqrt(q);
    for (let x = Math.ceil(cx - hw - 0.5); x + 0.5 <= cx + hw; x++) p(x, y);
  }
};
const R = (x0: number, y0: number, w: number, h: number): Shape => p => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p(x, y);
};
/** Polygon from flat x,y list, even-odd fill at pixel centres. */
const P = (...c: number[]): Shape => p => {
  const n = c.length / 2;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, c[2 * i + 1]); y1 = Math.max(y1, c[2 * i + 1]); }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const sy = y + 0.5, xs: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = c[2 * i], yi = c[2 * i + 1], xj = c[2 * j], yj = c[2 * j + 1];
      if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x + 0.5 <= xs[k + 1]; x++) p(x, y);
  }
};
/** Tapered capsule (thick line) from radius r1 to r2. */
const C = (x1: number, y1: number, x2: number, y2: number, r1: number, r2 = r1): Shape => p => {
  const m = Math.max(r1, r2), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1e-9;
  for (let y = Math.floor(Math.min(y1, y2) - m); y <= Math.ceil(Math.max(y1, y2) + m); y++) {
    for (let x = Math.floor(Math.min(x1, x2) - m); x <= Math.ceil(Math.max(x1, x2) + m); x++) {
      const px = x + 0.5 - x1, py = y + 0.5 - y1;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
      const ex = px - t * dx, ey = py - t * dy, r = r1 + (r2 - r1) * t;
      if (ex * ex + ey * ey <= r * r) p(x, y);
    }
  }
};
/** Tapered bezier stroke through control points (flat x,y list, any degree). */
const B = (pts: number[], r1: number, r2 = r1, steps = 14): Shape => p => {
  const n = pts.length / 2, at = (t: number) => {
    const q = pts.slice();
    for (let k = n - 1; k > 0; k--) for (let i = 0; i < k; i++) {
      q[2 * i] += (q[2 * i + 2] - q[2 * i]) * t; q[2 * i + 1] += (q[2 * i + 3] - q[2 * i + 1]) * t;
    }
    return [q[0], q[1]];
  };
  let prev = at(0);
  for (let s = 1; s <= steps; s++) {
    const cur = at(s / steps);
    C(prev[0], prev[1], cur[0], cur[1], r1 + ((r2 - r1) * (s - 1)) / steps, r1 + ((r2 - r1) * s) / steps)(p);
    prev = cur;
  }
};
const U = (...s: Shape[]): Shape => p => { for (const sh of s) sh(p); };
/** Mirror across the vertical centre line (between pixel 63 and 64). */
const Mi = (s: Shape): Shape => p => s((x, y) => p(W - 1 - x, y));
const both = (s: Shape): Shape => U(s, Mi(s));
const clipY = (s: Shape, y0: number, y1: number): Shape => p => s((x, y) => { if (y >= y0 && y < y1) p(x, y); });
const clipX = (s: Shape, x0: number, x1: number): Shape => p => s((x, y) => { if (x >= x0 && x < x1) p(x, y); });
const toSet = (s: Shape) => { const m = new Uint8Array(NPX); s((x, y) => { if (x >= 0 && y >= 0 && x < W && y < W) m[y * W + x] = 1; }); return m; };
const diff = (a: Shape, b: Shape): Shape => p => { const m = toSet(b); a((x, y) => { if (!(x >= 0 && y >= 0 && x < W && y < W && m[y * W + x])) p(x, y); }); };
const inter = (a: Shape, b: Shape): Shape => p => { const m = toSet(b); a((x, y) => { if (x >= 0 && y >= 0 && x < W && y < W && m[y * W + x]) p(x, y); }); };
const ring = (cx: number, cy: number, rx: number, ry: number, th: number) => diff(E(cx, cy, rx, ry), E(cx, cy, rx - th, ry - th));
const dots = (pts: number[], r: number): Shape => U(...Array.from({ length: pts.length / 2 }, (_, i) => E(pts[2 * i], pts[2 * i + 1], r, r)));
/** One-pixel polyline (Bresenham), for crisp seams and glyphs. */
const Ln = (...c: number[]): Shape => p => {
  for (let i = 0; i + 3 < c.length; i += 2) {
    let x0 = Math.round(c[i]), y0 = Math.round(c[i + 1]);
    const x1 = Math.round(c[i + 2]), y1 = Math.round(c[i + 3]);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      p(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
};
const star = (cx: number, cy: number, r: number, r2 = r * 0.42, n = 5, rot = -90) => P(...Array.from({ length: n * 2 }, (_, i) => {
  const a = ((rot + (i * 180) / n) * Math.PI) / 180, rr = i % 2 ? r2 : r;
  return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
}).flat());
const heart = (cx: number, cy: number, s: number) => U(E(cx - s * 0.5, cy - s * 0.25, s * 0.58, s * 0.55), E(cx + s * 0.5, cy - s * 0.25, s * 0.58, s * 0.55), P(cx - s * 1.05, cy - s * 0.05, cx + s * 1.05, cy - s * 0.05, cx, cy + s * 1.05));

/* ------------------------------------------------------------------ layers */

interface LayerOpt { outline?: boolean; shadow?: [number, number] | null; light?: [number, number] | null }
class Layer {
  m = new Uint8Array(NPX);
  t = new Uint16Array(NPX);
  casts: [Layer, number, number, number][] = [];
  constructor(readonly ramp: Ramp, readonly o: LayerOpt) {}
  private run(s: Shape, f: (i: number) => void) { s((x, y) => { if (x >= 0 && y >= 0 && x < W && y < W) f(y * W + x); }); }
  add(...s: Shape[]) { for (const sh of s) this.run(sh, i => { this.m[i] = 1; }); return this; }
  cut(...s: Shape[]) { for (const sh of s) this.run(sh, i => { this.m[i] = 0; this.t[i] = 0; }); return this; }
  keep(s: Shape) { const k = toSet(s); for (let i = 0; i < NPX; i++) if (!k[i]) { this.m[i] = 0; this.t[i] = 0; } return this; }
  /** Recolour pixels already in the layer (level 1–5 ramp step, or a colour code). */
  tone(l: number, ...s: Shape[]) { for (const sh of s) this.run(sh, i => { if (this.m[i]) this.t[i] = l; }); return this; }
  /** Add pixels with a fixed tone. */
  paint(l: number, ...s: Shape[]) { for (const sh of s) this.run(sh, i => { this.m[i] = 1; this.t[i] = l; }); return this; }
  cast(from: Layer, dx: number, dy: number, l = 3) { this.casts.push([from, dx, dy, l]); return this; }
}

const STAGES = ['back', 'legs', 'feet', 'neck', 'torso', 'over', 'arms', 'hands', 'head', 'face', 'hair', 'hat', 'top'] as const;
type Stage = typeof STAGES[number];

const FIX = {
  white: '#f4f0e8', dark: '#3f4459', leather: '#8d5e3c', metal: '#b5bfcd', gold: '#e8b94a',
  red: '#d4524f', jeans: '#4d6e9e', pink: '#f07c9c', mint: '#6cc4a4',
};

class Ctx {
  layers: Record<Stage, Layer[]> = Object.fromEntries(STAGES.map(s => [s, []])) as unknown as Record<Stage, Layer[]>;
  colors: number[] = [];
  H: Ramp; S: Ramp; Cl: Ramp; Ey: Ramp; Wt: Ramp; Dk: Ramp; Lt: Ramp; Mt: Ramp; Gd: Ramp; Rd: Ramp; Jn: Ramp; Pk: Ramp; Ac: Ramp; C2: Ramp; Mn: Ramp;
  head!: Layer;
  ink: number; white: number; mouth: number; tongue: number; blush: number; tear: number; tearHi: number; brow: number;
  constructor(v: Required<PixelAvatarData>) {
    this.H = makeRamp(v.hairColor); this.S = makeRamp(v.skinColor, 0.72); this.Cl = makeRamp(v.bodyColor); this.Ey = makeRamp(v.eyeColor);
    this.Wt = makeRamp(FIX.white); this.Dk = makeRamp(FIX.dark); this.Lt = makeRamp(FIX.leather); this.Mt = makeRamp(FIX.metal);
    this.Gd = makeRamp(FIX.gold); this.Rd = makeRamp(FIX.red); this.Jn = makeRamp(FIX.jeans); this.Pk = makeRamp(FIX.pink); this.Mn = makeRamp(FIX.mint);
    this.Ac = makeRamp(accentOf(v.bodyColor)); this.C2 = makeRamp(darkerOf(v.bodyColor));
    this.ink = this.c(hex('#2a2131')); this.white = this.c(hex('#fffbf6')); this.mouth = this.c(hex('#6e2c3a'));
    this.tongue = this.c(hex('#ec7484')); this.blush = this.c(mix(this.S[2], hex('#ff5d7a'), 0.38));
    this.tear = this.c(hex('#78c6f2')); this.tearHi = this.c(hex('#e2f6ff')); this.brow = this.c(this.H[4]);
  }
  /** Colour code usable as a tone level. */
  c(rgbaValue: number) { let i = this.colors.indexOf(rgbaValue); if (i < 0) { i = this.colors.length; this.colors.push(rgbaValue); } return 16 + i; }
  r(ramp: Ramp, level: number) { return this.c(ramp[level]); }
  L(stage: Stage, ramp: Ramp, o: LayerOpt = {}) { const l = new Layer(ramp, o); this.layers[stage].push(l); return l; }
  /** Flat, unshaded, un-outlined detail layer (facial features, prints). */
  F(stage: Stage) { return this.L(stage, this.S, { outline: false, shadow: null }); }

  render(): Uint32Array {
    const out = new Uint32Array(NPX);
    for (const st of STAGES) for (const L of this.layers[st]) {
      const { m, t, ramp, o } = L;
      for (const [from, dx, dy, lv] of L.casts) {
        for (let i = 0; i < NPX; i++) {
          if (!m[i] || t[i]) continue;
          const x = (i & (W - 1)) - dx, y = (i >> 7) - dy;
          if (x >= 0 && y >= 0 && x < W && y < W && from.m[y * W + x]) t[i] = lv;
        }
      }
      const outline = o.outline !== false, sh = o.shadow === undefined ? [2, 3] : o.shadow, li = o.light ?? null;
      const inM = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < W && m[y * W + x] === 1;
      for (let i = 0; i < NPX; i++) {
        if (!m[i]) continue;
        const x = i & (W - 1), y = i >> 7;
        let lv = t[i];
        const l = inM(x - 1, y), r = inM(x + 1, y), u = inM(x, y - 1), d = inM(x, y + 1);
        // Selective outline: edges facing the top-left light use the softer deep-shadow step.
        if (outline && !(l && r && u && d)) lv = r && d ? 4 : 5;
        else if (!lv) {
          lv = 2;
          if (sh && !inM(x + sh[0], y + sh[1])) lv = 3;
          else if (li && !inM(x - li[0], y - li[1])) lv = 1;
        }
        out[i] = lv >= 16 ? this.colors[lv - 16] : ramp[lv];
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------- anatomy */
// Shared anchors: head centre (64, 45), chin y 69, neck x 58–69, shoulders
// y 76, waist y 100, feet y 116–124. Head + hair ≈ 52% of the 110px figure.

const HEAD = U(E(64, 43, 27, 24), E(64, 51, 24, 20));
const TORSO = P(49, 72, 79, 72, 86, 76, 88, 84, 86, 106, 42, 106, 40, 84, 42, 76);
const CAP = E(64, 40, 30.5, 26.5);

function drawHead(k: Ctx) {
  const neck = k.L('neck', k.S).add(R(59, 63, 10, 13));
  const ears = k.L('head', k.S, { shadow: [1, 1] }).add(both(E(39.5, 51, 4.2, 5.8)));
  ears.tone(3, both(E(40.5, 51.5, 1.4, 3)));
  const head = k.L('head', k.S, { shadow: [2, 1] }).add(HEAD);
  neck.cast(head, 0, 5, 3);
  k.head = head;
  return head;
}

type Sleeve = 'long' | 'short' | 'none' | 'wide' | 'puff' | 'bulky';
type Lower = 'pants' | 'shorts' | 'skirt' | 'long' | 'none' | 'slacks';
interface BaseOpt { top: Ramp; sleeve: Sleeve; sl?: Ramp; lower: Lower; lo?: Ramp; shoe?: Ramp; sock?: Ramp; torso?: Shape; hem?: number; pose?: 'akimbo' | 'wave' }

/** Standard body build; returns layers for detailing. */
function base(k: Ctx, o: BaseOpt) {
  const lo = o.lo ?? k.Dk, sl = o.sl ?? o.top;
  // Legs
  const skinLegs = o.lower === 'shorts' || o.lower === 'skirt' || o.lower === 'none';
  if (skinLegs) {
    k.L('legs', k.S).add(both(C(56, 104, 55.5, 116, 5, 4.6)));
    if (o.sock) k.L('legs', o.sock).add(both(C(55.8, 110, 55.5, 116.5, 5.2, 4.9)));
  }
  let legs: Layer | null = null;
  if (o.lower === 'pants' || o.lower === 'slacks') {
    legs = k.L('legs', lo).add(R(44, 99, 40, 8), both(C(56, 105, 55.5, 116, 7, 6.2)));
    legs.tone(3, R(63, 106, 2, 10));
    if (o.lower === 'slacks') legs.tone(4, both(Ln(56, 109, 56, 117)));
  }
  if (o.lower === 'shorts') {
    legs = k.L('legs', lo).add(R(44, 99, 40, 8), both(C(56, 104, 56.5, 109, 7.6, 7.4)));
    legs.tone(3, R(63, 106, 2, 6));
  }
  // Shoes
  const shoes = k.L('feet', o.shoe ?? k.Lt, { shadow: [1, 2], light: [2, 2] }).add(both(U(E(54.5, 120, 7.8, 4.2), R(48, 116, 13, 4))));
  shoes.tone(4, both(R(47, 123, 15, 1)));
  // Torso
  const torso = k.L('torso', o.top, { light: [3, 3] }).add(o.torso ?? TORSO);
  if (o.hem) torso.add(R(42, 100, 44, o.hem - 100), P(42, 100, 86, 100, 87, o.hem, 41, o.hem));
  let skirt: Layer | null = null;
  if (o.lower === 'skirt') skirt = k.L('torso', lo, { light: [3, 3] }).add(P(46, 96, 82, 96, 91, 113, 37, 113));
  if (o.lower === 'long') skirt = k.L('torso', lo, { light: [3, 3] }).add(P(45, 94, 83, 94, 95, 120, 33, 120));
  // Arms + hands
  let arms: Layer;
  if (o.sleeve === 'none' || o.sleeve === 'short' || o.sleeve === 'puff') {
    k.L('arms', k.S).add(both(C(44, 79, 40, 97, 4.6, 4)));
  }
  if (o.sleeve === 'long') arms = k.L('arms', sl, { light: [2, 2] }).add(both(C(44.5, 79, 40.2, 96.5, 5.6, 5.1)));
  else if (o.sleeve === 'short') arms = k.L('arms', sl, { light: [2, 2] }).add(both(C(44.5, 79, 42.5, 87, 6.4, 5.8)));
  else if (o.sleeve === 'puff') arms = k.L('arms', sl, { light: [2, 2] }).add(both(E(43, 81, 7.2, 6.4)));
  else if (o.sleeve === 'wide') arms = k.L('arms', sl, { light: [2, 2] }).add(both(P(41, 75, 49, 79, 47, 92, 47, 101, 28, 103, 33, 85)));
  else if (o.sleeve === 'bulky') arms = k.L('arms', sl, { light: [2, 2] }).add(both(C(43.5, 79, 38.5, 95, 7.6, 7)));
  else arms = k.L('arms', sl).add(R(0, 0, 0, 0));
  const hands = k.L('hands', k.S, { shadow: [1, 2] }).add(both(E(40, 100.5, 4.6, 4.6)));
  if (o.sleeve === 'wide') hands.cut(R(0, 0, 128, 128)).add(both(E(39, 102.5, 3.8, 3.8)));
  // Outfit-specific gestures replace one arm without moving the other layers.
  if (o.pose === 'akimbo') {
    arms.cut(R(0, 70, 48, 38)).add(C(43, 79, 31, 88, 5.5, 5), C(31, 88, 40, 96, 5, 4));
    hands.cut(R(0, 90, 48, 20)).add(E(41, 96, 4.5, 4.5));
  } else if (o.pose === 'wave') {
    arms.cut(R(0, 70, 48, 38)).add(C(43, 79, 32, 83, 5.5, 5), C(32, 83, 27, 71, 5, 4.5));
    hands.cut(R(0, 90, 48, 20)).add(E(27, 68, 4.7, 5));
    if (legs && (o.lower === 'pants' || o.lower === 'slacks')) {
      legs.cut(R(0, 105, 64, 20)).add(C(55, 104, 51, 116, 7, 6.2));
      shoes.cut(R(0, 112, 64, 16)).add(E(49.5, 120, 7.8, 4.2), R(43, 116, 13, 4));
    }
  }
  return { torso, arms, skirt, legs, shoes, hands };
}

/* ------------------------------------------------------------------ hair */

const SHEEN = (cy = 29, rx = 23, ry = 12) => clipY(ring(64, cy, rx, ry, 2.2), 0, cy - 1);

/** Front hair: crown cap + tapered fringe strands to each tip + optional side locks. */
function front(k: Ctx, tips: number[], o: { capY?: number; sides?: Shape[]; bend?: number; root?: number; width?: number; sheen?: boolean; ramp?: Ramp } = {}) {
  const L = k.L('hair', o.ramp ?? k.H, { shadow: [2, 3] });
  L.add(clipY(CAP, 0, o.capY ?? 32));
  const rootY = o.root ?? 21, w = o.width ?? 6.4, bend = o.bend ?? 0;
  const n = tips.length / 2;
  for (let i = 0; i < n; i++) {
    const tx = tips[2 * i], ty = tips[2 * i + 1], rx = 64 + (tx - 64) * 0.6;
    L.add(B([rx, rootY, tx + (tx - 64) * 0.15 + bend, (rootY + ty) / 2, tx, ty], w, 0.6));
  }
  for (const s of o.sides ?? []) L.add(s);
  if (o.sheen !== false) L.tone(1, SHEEN());
  for (let i = 0; i + 1 < n; i++) {
    const mx = (tips[2 * i] + tips[2 * i + 2]) / 2, my = Math.min(tips[2 * i + 1], tips[2 * i + 3]) - 2;
    L.tone(3, B([64 + (mx - 64) * 0.55, rootY + 3, mx + bend * 0.5, (rootY + my) / 2, mx, my], 0.55));
  }
  return L;
}
const lock = (x0: number, y1: number, r = 5.5, out = -3) => both(B([x0, 30, x0 + out, (30 + y1) / 2, x0 + 1, y1], r, 1.6));
const back = (k: Ctx, ...s: Shape[]) => k.L('back', k.H, { shadow: [3, 3] }).add(...s);

/** Triangular spikes rooted inside an ellipse, pointing outward at the given angles (deg). */
const spikes = (cx: number, cy: number, rx: number, ry: number, list: number[][], spread = 0.3): Shape => U(...list.map(([deg, len, w = spread]) => {
  const a = (deg * Math.PI) / 180;
  const at = (t: number, r: number) => [cx + Math.cos(t) * rx * r, cy + Math.sin(t) * ry * r];
  const [x1, y1] = at(a - w, 0.86), [x2, y2] = at(a + w, 0.86);
  return P(x1, y1, cx + Math.cos(a) * (rx + len), cy + Math.sin(a) * (ry + len), x2, y2, cx, cy);
}));

const HAIRS: ((k: Ctx) => void)[] = [
  // 0 숏컷 — side-swept short cut, ears half covered
  k => {
    back(k, E(64, 43, 31.5, 27));
    front(k, [41, 44, 48, 41, 56, 43, 64, 39, 72, 42, 80, 38, 88, 41], { bend: 3, sides: [lock(37, 56, 5.2, -2)] });
  },
  // 1 보브 — blunt fringe, jaw-length rounded frame curling inward
  k => {
    back(k, U(E(64, 44, 34, 28), R(30, 44, 68, 22), both(E(37, 64, 7, 6))));
    const f = front(k, [38, 41, 44, 40, 50, 41, 56, 40, 62, 41, 68, 40, 74, 41, 80, 40, 86, 41, 90, 40], { width: 5, capY: 36, sides: [both(P(33, 34, 46, 34, 46, 60, 43, 67, 36, 69, 31, 62))] });
    f.tone(3, both(Ln(40, 44, 41, 64)));
  },
  // 2 롱 스트레이트 — centre parting, long curtain falling past the shoulders
  k => {
    const b = back(k, U(E(64, 42, 32, 28), P(32, 42, 96, 42, 99, 104, 29, 104), both(P(29, 100, 41, 100, 36, 108))));
    b.tone(3, both(U(Ln(36, 60, 35, 102), Ln(42, 76, 42, 100))));
    const f = front(k, [44, 46, 51, 41, 58, 34, 70, 34, 77, 41, 84, 46], { sides: [both(B([37, 34, 33, 60, 36, 100], 6, 3.5))] });
    f.cut(P(62, 27, 66, 27, 65.5, 34, 62.5, 34)).tone(3, both(Ln(37, 50, 35, 94)));
  },
  // 3 트윈테일 — two long tails with ties
  k => {
    back(k, E(64, 43, 31, 27), both(B([33, 32, 12, 48, 22, 80, 16, 102], 9, 2.5, 18)));
    k.layers.back[0].tone(3, both(B([28, 40, 16, 58, 20, 84, 16, 98], 0.6)));
    front(k, [41, 43, 48, 40, 56, 44, 64, 40, 72, 44, 80, 40, 87, 43], { sides: [lock(38, 54, 4.6, -2)] });
    const tie = k.L('hat', k.Pk, { light: [1, 1] }).add(both(E(31, 33, 4.5, 4.5)));
    tie.tone(3, both(E(32, 34, 1.5, 1.5)));
  },
  // 4 포니테일 — high tail swinging out to the right
  k => {
    back(k, E(64, 42, 31, 27), B([86, 20, 108, 26, 112, 60, 100, 92], 9.5, 2.5, 18));
    k.layers.back[0].tone(3, B([92, 24, 106, 34, 106, 62, 98, 86], 0.6));
    front(k, [40, 40, 47, 43, 55, 39, 63, 43, 72, 38, 80, 42, 88, 38], { bend: -2, sides: [lock(38, 52, 4.4, -2)] });
    k.L('hat', k.Pk).add(E(87, 21, 4, 5));
  },
  // 5 똥머리 — big top bun with short fringe
  k => {
    const bun = back(k, E(64, 43, 31, 27), E(64, 11, 14, 11));
    bun.tone(3, B([55, 8, 64, 16, 74, 10], 0.6), B([54, 15, 64, 20, 75, 14], 0.6));
    front(k, [42, 42, 50, 39, 58, 42, 64, 36, 70, 42, 78, 39, 86, 42], { sides: [lock(38, 58, 3.6, -2)] });
    k.L('back', k.Pk, { light: [1, 1] }).add(E(64, 21.5, 9, 3));
  },
  // 6 곱슬 — bubbly curl silhouette built from rings of curls
  k => {
    const curls: Shape[] = [];
    for (let a = 0; a < 15; a++) {
      const t = Math.PI * (0.92 + (a / 14) * 1.16);
      curls.push(E(64 + Math.cos(t) * 31, 44 + Math.sin(t) * 28, 7.5, 7.5));
    }
    const b = back(k, E(64, 44, 31, 28), ...curls, both(E(34, 68, 7, 7)), both(E(39, 75, 6.5, 6.5)));
    b.tone(3, both(U(ring(34, 68, 4, 4, 1), ring(39, 75, 3.5, 3.5, 1))));
    const f = k.L('hair', k.H).add(clipY(CAP, 0, 30));
    for (const x of [40, 49, 58, 68, 78, 88]) f.add(E(x, 33 + (x % 3), 6.2, 6));
    for (const x of [40, 49, 58, 68, 78, 88]) f.tone(3, ring(x + 1, 34 + (x % 3), 3.6, 3.4, 1));
    f.tone(1, U(...[[50, 20], [64, 17], [78, 20]].map(([x, y]) => E(x, y, 3, 2))));
    f.add(both(E(37, 46, 5, 7)), both(E(36, 57, 5, 6)));
  },
  // 7 삐침머리 — spiky radiating spikes
  k => {
    const spikes: Shape[] = [];
    const sp = [[-150, 18], [-128, 21], [-105, 22], [-80, 22], [-55, 21], [-32, 18], [-12, 14], [-168, 14]];
    for (const [deg, len] of sp) {
      const a = (deg * Math.PI) / 180, b1 = a - 0.32, b2 = a + 0.32;
      spikes.push(P(64 + Math.cos(b1) * 24, 40 + Math.sin(b1) * 22, 64 + Math.cos(a) * (28 + len), 40 + Math.sin(a) * (24 + len), 64 + Math.cos(b2) * 24, 40 + Math.sin(b2) * 22));
    }
    back(k, E(64, 41, 30, 26), ...spikes);
    k.layers.back[0].tone(3, U(...sp.map(([deg]) => { const a = (deg * Math.PI) / 180; return C(64 + Math.cos(a) * 26, 40 + Math.sin(a) * 24, 64 + Math.cos(a) * 40, 40 + Math.sin(a) * 36, 0.6); })));
    front(k, [38, 46, 45, 40, 52, 46, 60, 39, 68, 45, 76, 38, 84, 45, 91, 40], { width: 5.5, sides: [both(P(34, 34, 42, 36, 36, 60))] });
  },
  // 8 웨이브 장발 — long hair with rippling scalloped edges
  k => {
    const waves: Shape[] = [];
    for (let i = 0; i < 6; i++) waves.push(both(E(32 + (i % 2) * 3.5, 50 + i * 10, 6.5, 6.5)));
    const b = back(k, E(64, 42, 32, 28), R(32, 44, 64, 58), ...waves, both(E(41, 104, 7, 5)), E(64, 102, 18, 6));
    for (let i = 0; i < 6; i++) b.tone(3, both(B([35 + (i % 2) * 3, 46 + i * 10, 30 + (i % 2) * 3, 50 + i * 10, 34 + (i % 2) * 3, 55 + i * 10], 0.6)));
    const f = front(k, [42, 44, 47, 38, 54, 44, 60, 38, 68, 42, 76, 36, 84, 42, 89, 46], { bend: 4 });
    f.add(both(B([38, 32, 31, 48, 39, 64, 33, 84, 38, 100], 5.5, 3, 20)));
    f.tone(3, both(B([38, 40, 33, 52, 39, 66, 34, 84, 37, 96], 0.6, 0.6, 20)));
  },
  // 9 투블럭 — shaved sides, voluminous top swept to one side
  k => {
    const sides = k.L('hair', k.H, { shadow: null }).add(both(P(34, 30, 44, 29, 45, 49, 38, 55, 34, 48)));
    sides.tone(3, both(P(35, 37, 44, 35, 44, 48, 37, 52))).tone(4, both(U(Ln(36, 41, 43, 38), Ln(36, 45, 43, 42), Ln(37, 49, 43, 46))));
    const f = k.L('hair', k.H, { light: [2, 2] }).add(E(62, 25, 29, 14), P(34, 29, 37, 19, 50, 12, 69, 10, 85, 15, 94, 25, 92, 34, 83, 32, 78, 39, 71, 35, 64, 39, 57, 36, 48, 40, 43, 36, 35, 39));
    f.tone(1, B([42, 23, 57, 14, 77, 16, 87, 22], 1.5));
    f.tone(3, B([40, 29, 54, 22, 72, 24, 83, 30], 1), B([45, 34, 59, 27, 72, 28, 78, 35], 0.9));
  },
  // 10 양갈래 땋은머리 — two plaits resting on the shoulders
  k => {
    back(k, E(64, 43, 31, 27));
    const br = k.L('over', k.H, { shadow: [1, 2] });
    for (let i = 0; i < 7; i++) br.add(both(E(37 + (i % 2 ? 1.5 : -1.5), 64 + i * 5.6, 5.5 - i * 0.2, 4)));
    for (let i = 0; i < 7; i++) br.tone(3, both(B([33 + (i % 2) * 3, 61 + i * 5.6, 37, 66 + i * 5.6, 41 - (i % 2) * 3, 64 + i * 5.6], 0.6)));
    br.add(both(P(33, 101, 41, 101, 43, 111, 37, 107, 31, 111)));
    k.L('over', k.Pk).add(both(R(32, 98, 10, 4)));
    front(k, [42, 44, 49, 40, 57, 36, 71, 36, 79, 40, 86, 44], { sides: [both(B([37, 34, 33, 48, 37, 64], 5.4, 4.6))] }).cut(P(62, 27, 66, 27, 65.5, 36, 62.5, 36));
  },
  // 11 히메컷 — straight blunt bangs, cheek-length cut side locks, long back
  k => {
    const b = back(k, E(64, 42, 32, 28), P(33, 44, 95, 44, 94, 106, 34, 106));
    b.tone(3, both(U(Ln(38, 70, 38, 104), Ln(44, 74, 44, 104)))).tone(1, both(Ln(36, 72, 36, 100)));
    const f = k.L('hair', k.H).add(clipY(CAP, 0, 41), both(P(33, 30, 46, 30, 46, 66, 34, 66)));
    f.tone(1, SHEEN(28, 22, 10));
    f.tone(3, U(...[44, 51, 58, 70, 77, 84].map(x => Ln(x, 31, x, 40))), both(Ln(40, 44, 40, 64)));
  },
  // 12 울프컷 — choppy layers flaring at the nape
  k => {
    const b = back(k, E(64, 42, 31, 27));
    for (const [x, y, ex, ey] of [[34, 56, 24, 80], [40, 62, 32, 88], [46, 66, 42, 86]]) b.add(both(P(x - 6, y - 10, x + 5, y - 6, ex, ey)));
    b.tone(3, both(U(Ln(34, 58, 26, 76), Ln(41, 64, 34, 84))));
    const f = front(k, [38, 44, 44, 36, 50, 46, 57, 38, 64, 44, 71, 37, 78, 46, 84, 37, 90, 44], { width: 5.6, sides: [both(P(33, 32, 42, 34, 36, 58, 30, 50))] });
    f.add(P(60, 16, 66, 3, 70, 18));
  },
  // 13 올백 — slicked back, forehead fully visible
  k => {
    back(k, E(64, 40, 31, 26));
    const f = k.L('hair', k.H).add(E(64, 25, 29, 15), both(P(35, 25, 48, 27, 45, 35, 41, 47, 35, 51, 32, 39)), P(43, 31, 48, 28, 56, 31, 64, 29, 72, 31, 80, 28, 85, 31, 82, 35, 72, 33, 64, 35, 56, 33, 46, 35));
    f.tone(1, B([42, 23, 50, 15, 63, 13, 72, 14], 1.4));
    f.tone(3, B([42, 32, 48, 22, 54, 16], 1), B([52, 31, 57, 22, 61, 15], 1), B([64, 31, 64, 21, 65, 14], 1), B([76, 31, 71, 21, 69, 15], 1), B([85, 32, 80, 22, 74, 16], 1));
  },
  // 14 사이드테일 — single tail on the left, fringe swept right
  k => {
    back(k, E(64, 43, 31, 27), B([32, 34, 10, 46, 22, 86, 12, 104], 9, 2.5, 18)).tone(3, B([26, 42, 15, 58, 20, 86, 14, 98], 0.6));
    front(k, [40, 38, 48, 40, 56, 38, 64, 42, 72, 40, 80, 44, 88, 46], { bend: 5, sides: [both(B([37, 34, 34, 48, 38, 58], 4.6, 1.6))] });
    k.L('hat', k.Pk, { light: [1, 1] }).add(E(31, 35, 4, 5.5), P(26, 31, 22, 26, 29, 33), P(29, 39, 23, 43, 27, 37));
  },
  // 15 더벅머리 — messy shaggy mop covering the brows
  k => {
    const b = back(k, E(64, 40, 32, 28), spikes(64, 42, 31, 27, [[150, 7], [165, 6], [185, 7], [205, 6], [228, 7], [250, 6], [272, 7], [295, 6], [318, 7], [340, 6], [-5, 7], [15, 6], [30, 7]], 0.13));
    b.tone(3, U(Ln(36, 60, 30, 66), Ln(92, 60, 98, 66)));
    const f = front(k, [37, 48, 42, 42, 47, 48, 53, 44, 58, 49, 64, 43, 70, 49, 75, 44, 81, 48, 86, 42, 91, 48], { width: 5, sides: [both(B([35, 32, 32, 50, 36, 64], 5.5, 2))] });
    f.tone(1, U(E(50, 20, 2, 1.5), E(75, 19, 2.5, 1.5)));
  },
  // 16 고양이귀 — cat-ear tufts on a soft medium cut
  k => {
    back(k, E(64, 43, 32, 28), R(32, 44, 64, 20));
    const ears = k.L('back', k.H).add(both(P(33, 26, 38, 2, 54, 18)));
    ears.tone(k.r(k.Pk, 2), both(P(38, 22, 40, 9, 49, 18))).tone(k.r(k.Pk, 3), both(Ln(40, 11, 41, 20)));
    front(k, [41, 44, 48, 40, 56, 44, 64, 40, 72, 44, 80, 40, 87, 44], { sides: [lock(37, 64, 5, -2)] });
  },
  // 17 반묶음 — long hair with a small half-up topknot
  k => {
    back(k, E(64, 42, 32, 28), P(33, 42, 95, 42, 96, 96, 32, 96), both(P(32, 90, 44, 90, 38, 100))).tone(3, both(Ln(38, 62, 37, 94)));
    back(k, E(64, 12, 9, 7), P(60, 14, 70, 14, 76, 2, 66, 6)).tone(3, Ln(64, 7, 66, 16));
    front(k, [42, 43, 50, 39, 58, 43, 66, 38, 74, 43, 82, 39, 88, 43], { sides: [lock(37, 66, 5.2, -2)] });
    k.L('hat', k.Pk).add(R(57, 17, 14, 3));
  },
  // 18 드레드 — individually outlined rope locks, no headband
  k => {
    back(k, E(64, 39, 31, 27));
    for (let i = 0; i < 5; i++) {
      const x = 31 + i * 5, end = 24 + i * 5, y = 83 + (i % 3) * 7;
      const rope = k.L('back', k.H, { shadow: [1, 2] }).add(both(B([x + 4, 28, x - 3, 47, end + 5, 63, end, y], 4.1, 3.1, 16)));
      rope.tone(1, both(B([x + 2, 34, x, 50, end + 3, 66, end - 1, y - 3], 0.8, 0.8, 16)));
      rope.tone(3, both(U(C(end - 3, y - 9, end + 3, y - 12, 0.8), C(end - 3, y - 19, end + 3, y - 22, 0.8))));
    }
    const crown = k.L('hair', k.H).add(clipY(CAP, 0, 29));
    crown.tone(1, SHEEN(26, 22, 10));
    for (let i = 0; i < 7; i++) {
      const x = 40 + i * 8;
      const rope = k.L('hair', k.H, { shadow: [1, 2] }).add(B([x, 23, x - 2, 31, x + (i % 2 ? 2 : -2), 41 + (i % 3) * 2], 4.2, 3.1));
      rope.tone(1, C(x - 1, 26, x - 1, 35, 0.8));
    }
  },
  // 19 아프로 — huge round curly volume
  k => {
    const curls: Shape[] = [];
    for (let a = 0; a < 20; a++) { const t = (a / 20) * Math.PI * 2; curls.push(E(64 + Math.cos(t) * 37, 40 + Math.sin(t) * 31, 7, 7)); }
    const b = back(k, E(64, 40, 39, 33), ...curls);
    for (let a = 0; a < 20; a++) { const t = (a / 20) * Math.PI * 2 + 0.16; b.tone(3, ring(64 + Math.cos(t) * 33, 40 + Math.sin(t) * 27, 3, 3, 1)); }
    b.tone(1, U(E(48, 14, 4, 2), E(36, 24, 3, 2)));
    const f = k.L('hair', k.H).add(clipY(CAP, 0, 30));
    for (const x of [40, 48, 56, 64, 72, 80, 88]) f.add(E(x, 31 + (x % 16 ? 1 : 0), 5, 4.5));
    for (const x of [44, 60, 76]) f.tone(3, ring(x, 22, 3, 3, 1));
  },
  // 20 베레모 — chin-length hair with a tilted beret
  k => {
    back(k, E(64, 44, 32, 27), R(32, 44, 64, 18));
    front(k, [41, 44, 50, 42, 58, 44, 66, 41, 74, 44, 82, 42, 88, 44], { capY: 34, sides: [lock(37, 62, 5.2, -1)] });
    const beret = k.L('hat', k.Rd, { light: [2, 2] }).add(E(58, 19, 32, 11), C(58, 8, 59, 4, 1.6));
    beret.tone(3, R(26, 27, 64, 4)).tone(4, B([32, 25, 58, 29, 88, 22], 0.6));
  },
  // 21 리본 롱 — long hair with curled ends and a big bow
  k => {
    back(k, E(64, 42, 32, 28), P(32, 42, 96, 42, 96, 92, 32, 92), both(E(34, 96, 8, 8)), both(E(44, 98, 5, 6))).tone(3, both(ring(34, 97, 4.5, 4.5, 1)));
    front(k, [41, 43, 48, 39, 56, 43, 64, 39, 72, 43, 80, 39, 87, 43], { sides: [both(B([37, 32, 33, 56, 37, 82], 5.6, 2.6))] });
    const bow = k.L('hat', k.Pk, { light: [1, 1] }).add(P(64, 14, 42, 3, 40, 22), P(64, 14, 86, 3, 88, 22), E(64, 14, 5, 5), P(60, 16, 54, 30, 59, 28), P(68, 16, 74, 30, 69, 28));
    bow.tone(3, Ln(46, 8, 59, 14), Ln(82, 8, 69, 14));
  },
  // 22 바가지 — perfect bowl cut covering the ears
  k => {
    const f = k.L('hair', k.H).add(clipY(E(64, 42, 32.5, 29), 0, 48)).cut(P(38, 40, 90, 40, 89, 48, 39, 48));
    f.tone(1, SHEEN(28, 24, 12)).tone(3, U(...[38, 46, 54, 62, 70, 78, 86].map(x => Ln(x + 2, 24, x + (x - 64) * 0.2, 39))));
    f.tone(4, R(30, 46, 68, 2));
  },
  // 23 모히칸 — central crest, buzzed sides
  k => {
    const buzz = k.L('hair', k.H, { shadow: null, outline: false }).add(inter(HEAD, clipY(E(64, 42, 27, 25), 0, 40)));
    buzz.t.fill(3);
    for (let i = 0; i < NPX; i++) if (((i & 127) + (i >> 7)) % 3 === 0) buzz.t[i] = 4;
    const crest = k.L('hair', k.H, { light: [2, 2] }).add(P(57, 34, 55, 18, 56, 6, 60, 12, 64, 0, 68, 12, 72, 6, 73, 18, 71, 34, 64, 31));
    crest.tone(3, U(Ln(64, 4, 64, 30), Ln(60, 14, 60, 30), Ln(68, 14, 68, 30)));
  },
];

/* ------------------------------------------------------------------ face */

const EX = 52.5;
type Side = -1 | 1; // -1 = viewer-left eye, drawn natively; +1 mirrored
const side = (s: Side, sh: Shape) => (s < 0 ? sh : Mi(sh));

interface EyeOpt { dx?: number; dy?: number; irx?: number; iry?: number; hi?: 'dot' | 'star' | 'flame' | 'none'; pupil?: 'round' | 'slit' | 'tiny' | 'none'; white?: number }
function eyeOpen(k: Ctx, f: Layer, s: Side, o: EyeOpt = {}) {
  const dx = (o.dx ?? 0) * -s * -1, dy = o.dy ?? 0, irx = o.irx ?? 5.3, iry = o.iry ?? 6.4, ex = EX;
  const S = (sh: Shape) => side(s, sh);
  f.paint(k.white, S(E(ex, 52.5, 6.5 + (o.white ?? 0), 7.2 + (o.white ?? 0))));
  const iris = E(ex + 0.4 + dx, 53 + dy, irx, iry);
  f.paint(k.r(k.Ey, 2), S(iris));
  f.paint(k.r(k.Ey, 4), S(inter(iris, R(0, 0, 128, 50 + dy))));
  f.paint(k.r(k.Ey, 1), S(inter(iris, R(0, Math.round(56 + dy), 128, 10))));
  const pu = o.pupil ?? 'round';
  if (pu === 'round') f.paint(k.r(k.Ey, 5), S(E(ex + 0.4 + dx, 53.5 + dy, 1.9, 2.6)));
  if (pu === 'slit') f.paint(k.r(k.Ey, 5), S(E(ex + 0.4 + dx, 53 + dy, 0.9, 4.2)));
  if (pu === 'tiny') f.paint(k.r(k.Ey, 5), S(E(ex + 0.4 + dx, 53 + dy, 1.2, 1.5)));
  f.paint(k.r(k.Ey, 5), S(ring(ex + 0.4 + dx, 53 + dy, irx, iry, 0.9)));
  const hi = o.hi ?? 'dot';
  if (hi === 'dot') f.paint(k.white, S(E(ex - 2 + dx, 50 + dy, 1.8, 2.1)), S(E(ex + 2.5 + dx, 56 + dy, 0.9, 0.9)));
  if (hi === 'star') f.paint(k.white, S(star(ex + 0.4 + dx, 52 + dy, 3.6, 1.2, 4, 0)), S(R(Math.round(ex + 2.5), 56, 1, 1)));
  if (hi === 'flame') f.paint(k.c(hex('#ff9a3c')), S(P(ex - 2, 57, ex + 3, 57, ex + 2, 52, ex + 0.5, 54, ex - 1, 49)));
  // lid line with outer flick, light lower lash
  f.paint(k.ink, S(B([ex - 6.6, 49.8, ex - 1.5, 44.3, ex + 6.2, 47.6], 1.45, 1.05)), S(C(ex - 6.3, 49.4, ex - 8.6, 51.2, 1)));
  f.paint(k.r(k.S, 5), S(C(ex - 2, 59.2, ex + 3, 59, 0.55)));
}
const brow = (k: Ctx, f: Layer, s: Side, pts: number[], r = 0.85) => f.paint(k.brow, side(s, B(pts, r)));
const brows = (k: Ctx, f: Layer, pts: number[], r?: number) => { brow(k, f, -1, pts, r); brow(k, f, 1, pts, r); };
const eyes = (k: Ctx, f: Layer, o?: EyeOpt) => { eyeOpen(k, f, -1, o); eyeOpen(k, f, 1, o); };
/** Skin-coloured lid shapes cover part of an open eye. */
const lid = (k: Ctx, f: Layer, s: Side, cover: Shape, line: Shape) => { f.paint(k.r(k.S, 2), side(s, cover)); f.paint(k.ink, side(s, line)); };
const happy = (k: Ctx, f: Layer, s: Side) => f.paint(k.ink, side(s, B([EX - 5.5, 54.5, EX, 47, EX + 5.5, 54.5], 1.3)));
const smile = (k: Ctx, f: Layer) => { f.paint(k.mouth, B([58.5, 62, 64, 67, 69.5, 62], 1.15)); };
const blush = (k: Ctx, f: Layer, big = false) => f.paint(k.blush, both(E(44.5, 60, big ? 5 : 3.6, big ? 2.4 : 1.7)));
const laugh = (k: Ctx, f: Layer, w = 5.2, h = 4.6) => {
  f.paint(k.mouth, inter(E(64, 61.4, w, h), R(0, 61, 128, 20)));
  f.paint(k.tongue, inter(E(64, 65.6, w * 0.6, 2), E(64, 61.4, w - 1, h - 1)));
};
const sweat = (k: Ctx, f: Layer, x: number, y: number, s = 1) => {
  f.paint(k.tear, U(E(x, y + 3 * s, 2.6 * s, 3 * s), P(x - 2.2 * s, y + 2 * s, x + 2.2 * s, y + 2 * s, x, y - 3 * s)));
  f.paint(k.tearHi, R(Math.round(x - s), Math.round(y + 2 * s), 1, 2));
};

const FACES: ((k: Ctx, f: Layer, top: Layer) => void)[] = [
  // 0 기본 미소
  (k, f) => { eyes(k, f); brows(k, f, [EX - 5, 42.5, EX, 40.8, EX + 5, 42]); smile(k, f); },
  // 1 웃음 ^^
  (k, f) => { happy(k, f, -1); happy(k, f, 1); brows(k, f, [EX - 5, 41.5, EX, 39.5, EX + 5, 41]); laugh(k, f); blush(k, f, true); },
  // 2 놀람 — big whites, tiny irises, raised brows, "o" mouth
  (k, f) => {
    eyes(k, f, { irx: 2.8, iry: 3.4, white: 1, pupil: 'tiny' });
    brows(k, f, [EX - 5, 39.5, EX, 37, EX + 5, 39]);
    f.paint(k.mouth, E(64, 63.5, 3.2, 4)); f.paint(k.tongue, E(64, 65.5, 1.8, 1.2));
  },
  // 3 화남 — slanted lids & brows, frown, anger mark
  (k, f, top) => {
    eyes(k, f, { iry: 5 });
    for (const s of [-1, 1] as Side[]) lid(k, f, s, P(EX - 8, 42, EX + 8, 42, EX + 8, 51.5, EX - 8, 46), C(EX - 6.5, 46.5, EX + 6.5, 51, 1.3));
    brows(k, f, [EX - 6, 39.5, EX + 6, 45], 1.2);
    f.paint(k.mouth, B([59, 64.5, 64, 61.5, 69, 64.5], 0.8));
    top.paint(k.r(k.Rd, 2), U(B([84, 22, 86, 26, 90, 25], 0.8), B([92, 22, 91, 26, 94, 29], 0.8), B([84, 31, 88, 30, 89, 34], 0.8), B([94, 32, 91, 32, 92, 36], 0.8)));
  },
  // 4 울음 — screwed-shut eyes, streaming tears, wailing mouth
  (k, f) => {
    for (const s of [-1, 1] as Side[]) f.paint(k.ink, side(s, U(B([EX - 5.5, 48.5, EX - 1, 51.5, EX + 5, 51.5], 1.2), B([EX - 5, 55, EX - 1, 52.5, EX + 5, 52.5], 1.1))));
    brows(k, f, [EX - 5, 43, EX + 1, 40.5, EX + 5, 40], 0.9);
    f.paint(k.tear, both(U(B([EX - 2, 55, EX - 4, 62, EX - 3, 72], 2, 3), E(EX - 3, 73, 3, 2.4))));
    f.paint(k.tearHi, both(B([EX - 2, 57, EX - 3.5, 63, EX - 3, 69], 0.5)));
    f.paint(k.mouth, B([58, 66, 61, 60.5, 67, 60.5, 70, 66], 2.4, 2.4, 20)); f.paint(k.tongue, E(64, 64.6, 3, 1.4));
  },
  // 5 윙크 — one eye open, one closed, cheeky smile and sparkle
  (k, f, top) => {
    eyeOpen(k, f, -1);
    f.paint(k.ink, Mi(U(B([EX - 6, 51, EX - 1, 53.5, EX + 5, 52.5], 1.3), B([EX + 5, 52.5, EX + 7, 49], 1))));
    brows(k, f, [EX - 5, 42, EX, 40, EX + 5, 41.5]);
    f.paint(k.mouth, B([59, 61.4, 64, 65, 69.5, 60.4], 0.8)); blush(k, f);
    top.paint(k.r(k.Gd, 1), star(95, 46, 4.5, 1.4, 4, 0));
  },
  // 6 졸림 — heavy half lids, drool-free tiny mouth, Zzz
  (k, f, top) => {
    eyes(k, f, { dy: 1.5 });
    for (const s of [-1, 1] as Side[]) lid(k, f, s, R(EX - 8, 42, 16, 11), C(EX - 6.5, 53, EX + 6.5, 53, 1.3));
    brows(k, f, [EX - 5, 44, EX, 43, EX + 5, 44]);
    f.paint(k.mouth, E(64, 63, 1.7, 1.7));
    const z = (x: number, y: number, s: number) => Ln(x, y, x + s, y, x, y + s, x + s, y + s);
    top.paint(k.c(hex('#7f8fc8')), U(z(90, 30, 5), z(97, 22, 6), z(105, 13, 7)));
  },
  // 7 무표정 — solid oval eyes, straight mouth
  (k, f) => {
    f.paint(k.ink, both(E(EX + 0.5, 52.5, 3, 4.8))); f.paint(k.white, both(R(51, 50, 2, 2)));
    brows(k, f, [EX - 4, 44, EX + 4, 44], 0.9);
    f.paint(k.mouth, R(59, 63, 10, 2));
  },
  // 8 부끄러움 — eyes looking aside, hatched big blush, wobbly mouth, small sweat
  (k, f, top) => {
    eyes(k, f, { dx: -1.4, dy: 0.6 });
    brows(k, f, [EX - 5, 41, EX, 41, EX + 5, 39.5], 0.8);
    blush(k, f, true);
    f.paint(k.c(mix(k.S[2], hex('#e0405e'), 0.6)), both(U(Ln(41, 61, 43, 58), Ln(44, 61, 46, 58), Ln(47, 61, 49, 58))));
    f.paint(k.mouth, Ln(59, 63, 61, 62, 63, 63, 65, 62, 67, 63, 69, 62));
    sweat(k, top, 90, 38, 1);
  },
  // 9 메롱 — >< squeezed eyes and tongue out
  (k, f) => {
    f.paint(k.ink, B([EX - 5, 48, EX + 4, 52.5, EX - 5, 57], 1.2, 1.2, 8), Mi(B([EX - 5, 48, EX + 4, 52.5, EX - 5, 57], 1.2, 1.2, 8)));
    brows(k, f, [EX - 5, 42, EX, 40, EX + 5, 41.5]);
    f.paint(k.mouth, R(58, 61, 12, 2));
    f.paint(k.tongue, U(E(64.5, 66, 4, 4.4), R(61, 62, 7, 3)));
    f.paint(k.c(mix(hex('#ec7484'), hex('#6e2c3a'), 0.35)), Ln(64, 63, 64, 68));
  },
  // 10 고양이입 — slit pupils, ω mouth, whiskers
  (k, f) => {
    eyes(k, f, { pupil: 'slit', hi: 'dot', dy: 1 });
    for (const s of [-1, 1] as Side[]) lid(k, f, s, R(EX - 8, 42, 16, 7.5), B([EX - 7, 48, EX, 49.5, EX + 6.5, 48.5], 1.3));
    brows(k, f, [EX - 5, 42, EX, 40.5, EX + 5, 41]);
    f.paint(k.c(hex('#e0707e')), P(62, 58.5, 66, 58.5, 64, 60.5));
    f.paint(k.mouth, B([58, 61, 60.5, 64.5, 64, 61.5], 0.7), B([64, 61.5, 67.5, 64.5, 70, 61], 0.7), Ln(64, 60, 64, 61));
    f.paint(k.white, P(66, 62.5, 68, 62.5, 67, 64.5));
    f.paint(k.r(k.S, 4), both(U(Ln(36, 56, 44, 58), Ln(35, 60, 44, 60), Ln(36, 64, 44, 62))));
  },
  // 11 결의 — narrowed eyes with fire highlights, straight hard brows, set jaw
  (k, f) => {
    eyes(k, f, { hi: 'flame' });
    for (const s of [-1, 1] as Side[]) lid(k, f, s, P(EX - 8, 42, EX + 8, 42, EX + 8, 48.5, EX - 8, 47), C(EX - 6.5, 47.5, EX + 6.5, 48.5, 1.4));
    brows(k, f, [EX - 6, 42, EX + 6, 44.5], 1.4);
    f.paint(k.mouth, R(59, 62, 10, 2)); f.paint(k.white, R(60, 62, 8, 1));
  },
  // 12 걱정 — brows up in the middle, sad lids, wavy mouth, sweat
  (k, f, top) => {
    eyes(k, f, { iry: 5.2, dy: 0.5 });
    for (const s of [-1, 1] as Side[]) lid(k, f, s, P(EX - 8, 42, EX + 8, 42, EX + 8, 46, EX - 8, 50), C(EX - 6.5, 49.5, EX + 6.5, 46.5, 1.2));
    brows(k, f, [EX - 6, 44, EX + 1, 41, EX + 6, 37.5], 1.35);
    f.paint(k.mouth, B([58, 65, 61, 61.5, 64, 64, 67, 61.5, 70, 65], 1.2, 1.2, 20));
    sweat(k, top, 37, 37, 1.5);
  },
  // 13 반짝눈 — huge star-lit irises and sparkles
  (k, f, top) => {
    eyes(k, f, { irx: 5.2, iry: 6.4, white: 0.6, hi: 'star', pupil: 'none' });
    brows(k, f, [EX - 5, 40.5, EX, 38.8, EX + 5, 40.5]);
    laugh(k, f, 3.6, 3.4);
    top.paint(k.r(k.Gd, 1), star(29, 46, 5, 1.5, 4, 0), star(99, 40, 4, 1.2, 4, 0), star(95, 60, 3, 1, 4, 0));
  },
  // 14 실눈 — gentle long closed arcs, calm cat smile
  (k, f) => {
    f.paint(k.ink, both(B([EX - 7, 50.5, EX, 55, EX + 7, 50.5], 1.05)), both(C(EX - 7, 50.5, EX - 8.5, 49, 0.8)));
    brows(k, f, [EX - 6, 42, EX, 39.5, EX + 6, 42]);
    f.paint(k.blush, both(E(45, 59.5, 3, 1.2)));
    f.paint(k.mouth, B([59, 62, 61.5, 64, 64, 62.5], 0.65), B([64, 62.5, 66.5, 64, 69, 62], 0.65));
  },
  // 15 하트눈 — heart irises, open smile, blush
  (k, f) => {
    f.paint(k.c(hex('#f04a6c')), both(heart(EX + 0.2, 52, 5.2)));
    f.paint(k.c(hex('#ff9db1')), both(E(EX - 2.4, 49.6, 1.4, 1.2)));
    f.paint(k.c(hex('#9c1f3e')), both(Ln(EX + 1, 57, EX + 4, 53)));
    brows(k, f, [EX - 5, 41, EX, 39, EX + 5, 40.5]);
    laugh(k, f, 4.6, 4.2); blush(k, f);
  },
  // 16 식은땀 — shrunken pupils, wobble mouth, big sweat drops
  (k, f, top) => {
    eyes(k, f, { irx: 2.5, iry: 3, white: 0.8, pupil: 'tiny', hi: 'none' });
    brows(k, f, [EX - 5, 41, EX + 5, 39], 0.8);
    f.paint(k.mouth, Ln(58, 64, 60, 62, 62, 64, 64, 62, 66, 64, 68, 62, 70, 64));
    sweat(k, top, 91, 32, 1.7); sweat(k, top, 36, 40, 1.1); sweat(k, top, 96, 50, 1);
    f.paint(k.c(hex('#8aa0d8')), U(...[44, 48, 52, 76, 80, 84].map(x => Ln(x, 34, x, 41))));
  },
  // 17 시무룩 — downcast eyes, sulky pout
  (k, f) => {
    eyes(k, f, { dy: 2, iry: 4.8 });
    for (const s of [-1, 1] as Side[]) lid(k, f, s, R(EX - 8, 42, 16, 11), B([EX - 6.5, 53, EX, 52, EX + 6.5, 53], 1.7));
    brows(k, f, [EX - 6, 44, EX, 42, EX + 6, 41.5], 1.2);
    f.paint(k.mouth, E(64, 64, 3.6, 2.5));
    f.paint(k.r(k.S, 3), both(E(46, 60, 3, 1.5)));
  },
  // 18 득의양양 — smug half-lids, cocked brow, crooked grin with teeth
  (k, f, top) => {
    eyes(k, f, { dx: 1, dy: 1 });
    lid(k, f, -1, R(EX - 8, 42, 16, 9), C(EX - 6.5, 50.5, EX + 6.5, 50.5, 1.3));
    lid(k, f, 1, R(EX - 8, 42, 16, 7), C(EX - 6.5, 48.5, EX + 6.5, 49.5, 1.3));
    brow(k, f, -1, [EX - 6, 44, EX + 6, 42.5]); brow(k, f, 1, [EX - 5, 40, EX, 37.5, EX + 5, 39.5]);
    f.paint(k.mouth, P(58, 61, 71, 59, 69, 64, 60, 63.5)); f.paint(k.white, P(59.5, 61, 70, 59.5, 69, 61.3, 60, 62.3));
    top.paint(k.r(k.Gd, 1), star(30, 40, 4, 1.2, 4, 0));
  },
  // 19 멍함 — hollow ring eyes, open mouth, drifting thought dots
  (k, f, top) => {
    f.paint(k.white, both(E(EX, 52.5, 5, 5.5)));
    f.paint(k.ink, both(ring(EX, 52.5, 5, 5.5, 1.2)));
    f.paint(k.ink, both(R(52, 52, 2, 2)));
    f.paint(k.mouth, E(64, 63.5, 2.5, 2));
    top.paint(k.c(hex('#9aa4c8')), dots([92, 34, 99, 28, 106, 20], 1.6));
  },
  // 20 째려봄 — slit glare, sideways irises, gloom lines
  (k, f) => {
    eyes(k, f, { dx: 2.2, iry: 4.2 });
    for (const s of [-1, 1] as Side[]) {
      lid(k, f, s, P(EX - 8, 42, EX + 8, 42, EX + 8, 50.5, EX - 8, 49), C(EX - 6.5, 49.2, EX + 6.5, 50.5, 1.3));
      f.paint(k.r(k.S, 2), side(s, R(EX - 8, 56, 16, 6))); f.paint(k.ink, side(s, C(EX - 5, 56, EX + 5, 55.5, 0.9)));
    }
    brows(k, f, [EX - 6, 42, EX + 6, 46.5], 1.2);
    f.paint(k.mouth, B([59, 63, 64, 62.5, 69, 64.5], 0.7));
    f.paint(k.c(mix(k.S[2], hex('#4a3a7a'), 0.45)), U(...[44, 47, 50, 53, 75, 78, 81, 84].map(x => Ln(x, 36, x, 42 - (x % 2) * 2))));
  },
  // 21 하품 — squeezed eyes with tear, tall open mouth
  (k, f) => {
    for (const s of [-1, 1] as Side[]) f.paint(k.ink, side(s, B([EX - 5.5, 50, EX, 53.5, EX + 5.5, 50], 1.2)));
    f.paint(k.tear, both(E(EX - 7, 54.5, 1.6, 2))); f.paint(k.tearHi, both(R(Math.round(EX - 8), 54, 1, 1)));
    brows(k, f, [EX - 5, 43, EX, 40.5, EX + 5, 42]);
    f.paint(k.mouth, E(64, 63.5, 4.6, 5.6)); f.paint(k.tongue, inter(E(64, 67, 3.4, 2.2), E(64, 63.5, 3.6, 4.6)));
  },
  // 22 안경 — round glasses with lens glare
  (k, f, top) => {
    eyes(k, f, { irx: 3.8, iry: 4.8 });
    brows(k, f, [EX - 5, 41.5, EX, 40, EX + 5, 41.5]);
    smile(k, f);
    top.paint(k.c(hex('#e8f0ff')), both(Ln(EX - 4, 56, EX + 2, 50)));
    top.paint(k.c(hex('#3a3346')), both(ring(EX, 53, 8, 7.5, 1.3)), R(60, 51, 8, 2), both(Ln(EX - 8, 51, 39, 49)));
  },
  // 23 반창고 — bandage on cheek and nose, toothy grin
  (k, f, top) => {
    eyes(k, f, { dx: 0.8 });
    for (const s of [-1, 1] as Side[]) lid(k, f, s, R(EX - 8, 42, 16, 5), B([EX - 7, 47.5, EX, 46.5, EX + 6.5, 47.5], 1.3));
    brows(k, f, [EX - 6, 42.5, EX, 40, EX + 6, 41.5], 1.1);
    f.paint(k.mouth, P(58, 60.5, 70, 60.5, 68, 64, 60, 64)); f.paint(k.white, P(59.5, 61, 68.5, 61, 68, 62.2, 60, 62.2), P(66, 62, 68, 62, 67, 63.5));
    const band = k.c(hex('#f2cf9a')), pad = k.c(hex('#e2b47c')), hole = k.c(hex('#c79660'));
    top.paint(band, P(75, 58, 89, 54, 91, 60, 77, 64), P(58, 56.5, 70, 56.5, 70, 59.5, 58, 59.5)); top.paint(pad, P(80, 57, 85, 55.5, 87, 61, 82, 62.5), R(62, 56, 4, 4)); top.paint(hole, dots([82, 59, 85, 58], 0.5));
    top.paint(k.c(hex('#d9ac70')), U(Ln(58, 56, 69, 56), Ln(75, 58, 89, 54)));
    top.paint(k.c(mix(k.S[2], hex('#d24848'), 0.5)), Ln(41, 58, 44, 61), Ln(44, 58, 41, 61));
  },
];

/* ------------------------------------------------------------------ bodies */

const buttons = (L: Layer, code: number, x: number, ys: number[]) => L.paint(code, ...ys.map(y => R(x, y, 2, 2)));

const BODIES: ((k: Ctx) => void)[] = [
  // 0 티셔츠 — crew neck tee with star print, jeans, sneakers
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'short', lower: 'pants', lo: k.Jn, shoe: k.Wt });
    b.torso.cut(E(64, 70.5, 7, 4)).tone(3, inter(ring(64, 70.5, 9.5, 6.5, 2.5), R(0, 72, 128, 6)));
    b.torso.tone(k.r(k.Wt, 2), star(64, 90, 7, 3)).tone(k.r(k.Ac, 2), star(64, 90, 3.4, 1.4));
    b.shoes.tone(k.r(k.Rd, 2), both(R(47, 121, 15, 2)));
  },
  // 1 후드티 — hood around the head, drawstrings, kangaroo pocket
  k => {
    k.L('back', k.Cl).add(clipY(U(E(64, 52, 34, 24), E(64, 68, 26, 9)), 40, 80)).tone(3, clipY(E(64, 54, 30, 20), 40, 80));
    const b = base(k, { top: k.Cl, sleeve: 'long', lower: 'pants', lo: k.Dk, shoe: k.Wt, hem: 108 });
    b.torso.tone(3, P(49, 92, 79, 92, 82, 104, 46, 104)).tone(4, U(Ln(49, 92, 79, 92), Ln(49, 92, 46, 104), Ln(79, 92, 82, 104)));
    b.torso.tone(4, R(42, 105, 44, 1)).tone(k.r(k.Wt, 2), C(59, 74, 58, 87, 0.9), C(69, 74, 70, 87, 0.9));
    b.torso.tone(k.r(k.Wt, 3), E(58, 88, 1.4, 1.4), E(70, 88, 1.4, 1.4));
    b.arms.tone(4, both(R(36, 93, 10, 1)));
  },
  // 2 세일러 교복 — sailor collar, red scarf, pleated skirt
  k => {
    const b = base(k, { top: k.Wt, sleeve: 'short', sl: k.Wt, lower: 'skirt', lo: k.Cl, shoe: k.Dk, sock: k.Wt });
    b.torso.cut(P(58, 70, 70, 70, 64, 80));
    const col = k.L('over', k.Cl, { light: [2, 2] }).add(both(P(48, 72, 59, 72, 64, 88, 60, 88, 40, 82, 40, 76)));
    col.tone(k.r(k.Wt, 2), both(Ln(43, 79, 60, 85)));
    const sc = k.L('over', k.Rd, { light: [1, 1] }).add(P(56, 84, 72, 84, 64, 90), P(61, 88, 59, 98, 63, 96), P(67, 88, 69, 98, 65, 96));
    sc.tone(3, Ln(64, 85, 64, 89));
    b.arms.tone(k.r(k.Cl, 2), both(inter(C(44.5, 79, 42.5, 87, 6.4, 5.8), R(0, 87, 128, 4))));
    b.skirt!.tone(3, U(...[50, 57, 64, 71, 78].map(x => Ln(x, 98, x + (x - 64) * 0.35, 112))));
  },
  // 3 정장 — jacket with lapels, shirt, tie, slacks
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'long', lower: 'slacks', lo: k.C2, shoe: k.Dk, hem: 108 });
    b.torso.tone(k.r(k.Wt, 2), P(56, 72, 72, 72, 64, 92));
    b.torso.tone(4, U(Ln(56, 72, 64, 92, 72, 72), Ln(64, 92, 64, 107)));
    b.torso.tone(3, both(P(50, 73, 56, 73, 62, 88, 54, 82)));
    b.torso.tone(k.r(k.Ac, 3), P(62.5, 74, 65.5, 74, 66.5, 87, 64, 90, 61.5, 87)).tone(k.r(k.Ac, 4), R(63, 74, 2, 2));
    buttons(b.torso, k.r(k.Dk, 2), 66, [95, 101]);
    b.torso.tone(4, Ln(46, 96, 54, 96)).tone(k.r(k.Wt, 1), P(48, 82, 53, 82, 52, 85));
    b.arms.tone(k.r(k.Wt, 2), both(R(36, 95, 9, 2)));
  },
  // 4 원피스 — A-line dress, round collar, belt bow, mary janes
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'puff', lower: 'skirt', lo: k.Cl, shoe: k.Rd });
    b.skirt!.add(P(44, 96, 84, 96, 93, 114, 35, 114)).tone(3, U(Ln(52, 100, 48, 113), Ln(64, 100, 64, 113), Ln(76, 100, 80, 113)));
    k.L('over', k.Wt, { shadow: [1, 1] }).add(both(E(58.5, 73.5, 6, 4)));
    k.L('over', k.Ac).add(R(42, 95, 44, 3), both(P(64, 96, 57, 92, 57, 100)));
    b.arms.tone(3, both(R(36, 85, 14, 2)));
    b.skirt!.tone(k.r(k.Wt, 1), R(35, 112, 58, 1));
  },
  // 5 한복 — short jeogori, goreum ribbon, full chima skirt
  k => {
    const b = base(k, { top: k.Ac, sleeve: 'wide', lower: 'none', shoe: k.Wt });
    k.L('torso', k.Cl, { light: [3, 3] }).add(P(46, 84, 82, 84, 98, 122, 30, 122)).tone(3, U(...[48, 56, 64, 72, 80].map(x => Ln(x, 88, x + (x - 64) * 0.9, 121))));
    b.torso.cut(R(0, 92, 128, 30));
    k.L('over', k.Wt, { shadow: null }).add(P(56, 72, 60, 72, 68, 86, 64, 86), P(68, 72, 72, 72, 64, 82));
    const g = k.L('over', k.Rd, { light: [1, 1] }).add(E(66, 86, 3, 2.5), P(65, 87, 58, 104, 62, 104, 66, 89), P(67, 87, 71, 100, 74, 100, 68, 87));
    g.tone(3, Ln(66, 85, 66, 87));
    b.arms.tone(k.r(k.Cl, 2), both(B([29, 101, 38, 99, 47, 99], 1.4)));
    b.arms.tone(k.r(k.Wt, 2), both(B([31, 98, 38, 96, 46, 96], 1)));
  },
  // 6 갑옷 — breastplate, pauldrons, tabard in body colour, greaves
  k => {
    const b = base(k, { top: k.Mt, sleeve: 'long', sl: k.Dk, lower: 'pants', lo: k.Dk, shoe: k.Mt });
    b.torso.tone(1, E(56, 82, 6, 5)).tone(3, both(Ln(52, 96, 58, 102)));
    k.L('over', k.Cl, { light: [2, 2] }).add(P(55, 82, 73, 82, 72, 112, 64, 116, 56, 112)).tone(k.r(k.Gd, 2), P(60, 90, 68, 90, 68, 98, 64, 102, 60, 98)).tone(k.r(k.Gd, 4), Ln(64, 91, 64, 100));
    k.L('over', k.Lt).add(R(42, 98, 44, 4)).tone(k.r(k.Gd, 2), R(62, 98, 4, 4));
    const pd = k.L('arms', k.Mt, { light: [2, 2] }).add(both(E(42, 79, 9.5, 7)), both(E(42, 85, 8, 4)));
    pd.tone(3, both(Ln(34, 84, 50, 84))).tone(1, both(E(39, 76, 3, 2)));
    k.L('hands', k.Mt, { light: [1, 1] }).add(both(E(40, 100.5, 5, 5)));
    k.L('legs', k.Mt, { light: [1, 1] }).add(both(C(56, 108, 55.5, 116, 6.5, 6.4))).tone(3, both(Ln(50, 112, 61, 112)));
  },
  // 7 마법사 로브 — floor robe, bell sleeves, high collar, stars
  k => {
    k.L('back', k.C2).add(both(P(47, 74, 34, 50, 40, 70, 44, 80)));
    const b = base(k, { top: k.Cl, sleeve: 'wide', lower: 'none', shoe: k.Dk });
    const robe = k.L('torso', k.Cl, { light: [3, 3] }).add(P(44, 82, 84, 82, 96, 121, 32, 121));
    robe.tone(3, Ln(64, 84, 64, 120)).tone(k.r(k.Gd, 2), R(33, 118, 62, 2), star(52, 108, 3.6), star(78, 96, 2.6), star(70, 114, 2.4));
    k.L('over', k.Gd).add(B([43, 96, 54, 99, 64, 98, 74, 99, 85, 96], 1.3), C(66, 98, 70, 108, 1.1));
    b.torso.tone(k.r(k.Gd, 2), both(Ln(56, 72, 63, 90))).tone(4, Ln(64, 74, 64, 92));
    b.arms.tone(k.r(k.Gd, 2), both(Ln(28, 103, 47, 101)));
  },
  // 8 우주복 — bulky suit, neck ring, backpack, control panel
  k => {
    k.L('back', k.Mt).add(R(30, 74, 68, 30)).tone(3, R(30, 98, 68, 6)).tone(k.r(k.Dk, 2), R(33, 78, 3, 16), R(92, 78, 3, 16));
    k.L('legs', k.Wt).add(R(43, 99, 42, 8), both(C(55.5, 104, 55, 114, 8.5, 8))).tone(3, R(63, 106, 2, 9)).tone(4, both(R(47, 109, 17, 1)));
    k.L('feet', k.Cl, { light: [2, 2] }).add(both(U(E(54, 120, 10, 4.6), R(46, 114, 16, 6)))).tone(4, both(R(45, 123, 18, 1)));
    const t = k.L('torso', k.Wt, { light: [3, 3] }).add(P(46, 70, 82, 70, 90, 76, 92, 86, 89, 107, 39, 107, 36, 86, 38, 76));
    t.tone(k.r(k.Dk, 2), R(54, 84, 20, 13)).tone(k.r(k.Rd, 2), R(57, 87, 4, 3)).tone(k.r(k.Gd, 2), R(63, 87, 4, 3)).tone(k.r(k.Mn, 2), R(69, 87, 3, 3));
    t.tone(k.r(k.Cl, 2), R(57, 92, 15, 3), R(40, 100, 48, 4));
    k.L('arms', k.Wt, { light: [2, 2] }).add(both(C(43.5, 79, 38.5, 95, 7.8, 7.2))).tone(k.r(k.Cl, 2), both(R(31, 90, 15, 3)));
    k.L('hands', k.Cl, { light: [1, 1] }).add(both(E(38.5, 100, 6, 5.5)));
    k.L('over', k.Mt, { light: [1, 1] }).add(ring(64, 70, 17, 6.5, 3.5)).tone(3, inter(ring(64, 70, 17, 6.5, 3.5), R(0, 72, 128, 10)));
  },
  // 9 멜빵 — short-sleeve shirt, suspender shorts, knee socks
  k => {
    const b = base(k, { top: k.Wt, sleeve: 'short', sl: k.Wt, lower: 'shorts', lo: k.Cl, shoe: k.Lt, sock: k.Wt });
    b.torso.cut(P(59, 71, 69, 71, 64, 78)).tone(3, Ln(64, 78, 64, 98));
    const s = k.L('over', k.Cl, { light: [1, 1] }).add(both(C(51.5, 73, 53, 100, 2.6)), R(44, 97, 40, 6));
    s.tone(k.r(k.Gd, 2), both(R(52, 92, 2, 2)));
    k.L('legs', k.Rd).add(both(R(50, 111, 12, 1)));
    buttons(b.torso, k.r(k.Wt, 3), 63, [82, 88, 94]);
  },
  // 10 앞치마 — long-sleeve dress with frilled white apron
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'long', lower: 'skirt', lo: k.Cl, shoe: k.Dk, sock: k.Dk });
    b.skirt!.add(P(44, 96, 84, 96, 92, 115, 36, 115));
    const ap = k.L('over', k.Wt, { light: [2, 2] }).add(P(52, 80, 76, 80, 77, 98, 51, 98), P(47, 97, 81, 97, 86, 113, 42, 113), both(C(52.5, 74, 53, 81, 1.6)));
    for (let x = 43; x <= 85; x += 4) ap.add(E(x, 113.5, 2.3, 2));
    ap.tone(3, R(54, 101, 20, 7)).tone(4, U(Ln(54, 101, 73, 101), Ln(54, 101, 54, 107), Ln(73, 101, 73, 107)));
    k.L('over', k.Wt).add(both(E(58, 73, 5, 3.2))).tone(3, R(62, 72, 4, 3));
    b.arms.tone(k.r(k.Wt, 2), both(R(36, 94, 9, 3)));
  },
  // 11 트렌치코트 — knee-long belted double-breasted coat
  k => {
    base(k, { top: k.Cl, sleeve: 'long', lower: 'pants', lo: k.Dk, shoe: k.Lt });
    const coat = k.L('torso', k.Cl, { light: [3, 3] }).add(P(49, 72, 79, 72, 86, 76, 88, 84, 92, 116, 36, 116, 40, 84, 42, 76));
    coat.tone(k.r(k.Wt, 2), P(58, 72, 70, 72, 64, 84)).tone(4, Ln(64, 84, 64, 116));
    coat.tone(3, both(P(48, 72, 58, 72, 64, 86, 56, 90, 50, 80))).tone(4, both(Ln(50, 80, 56, 90, 64, 86)));
    coat.tone(k.r(k.C2, 2), R(38, 96, 52, 4)).tone(k.r(k.Gd, 2), R(61, 96, 6, 4)).tone(k.r(k.C2, 2), R(63, 97, 2, 2));
    buttons(coat, k.r(k.C2, 3), 57, [88, 103]); buttons(coat, k.r(k.C2, 3), 69, [88, 103]);
    k.L('arms', k.Cl, { light: [2, 2] }).add(both(C(44.5, 79, 39.8, 96.5, 6, 5.6))).tone(k.r(k.C2, 2), both(R(33, 92, 14, 2)));
  },
  // 12 체육복 — zip-up track jacket and pants with stripes
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'long', sl: k.C2, lower: 'pants', lo: k.C2, shoe: k.Wt, hem: 104, pose: 'wave', torso: P(47, 72, 81, 72, 89, 79, 87, 104, 41, 104, 39, 79) });
    b.torso.cut(R(60, 69, 8, 4)).tone(k.r(k.Wt, 2), R(62, 74, 4, 29)).tone(k.r(k.Mt, 2), R(62, 76, 4, 4)).tone(4, R(55, 72, 18, 3));
    b.arms.tone(k.r(k.Wt, 2), both(C(45, 80, 41, 94, 1.6)));
    b.legs!.tone(k.r(k.Wt, 2), both(R(48, 106, 3, 12))).tone(4, R(44, 104, 40, 1));
    b.shoes.tone(k.r(k.Cl, 2), both(R(51, 118, 6, 2)));
  },
  // 13 터틀넥 스웨터 — ribbed collar, cable knit, ribbed cuffs
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'bulky', lower: 'pants', lo: k.Jn, shoe: k.Lt, hem: 108, torso: P(46, 72, 82, 72, 91, 79, 90, 105, 38, 105, 37, 79) });
    const neck = k.L('torso', k.Cl, { light: [1, 1] }).add(R(53, 63, 22, 14));
    for (let x = 57; x < 72; x += 3) neck.tone(3, Ln(x, 64, x, 74));
    for (let x = 44; x < 86; x += 3) b.torso.tone(3, Ln(x, 103, x, 107));
    for (const x of [52, 64, 76]) b.torso.tone(3, B([x - 2, 78, x + 2, 84, x - 2, 90, x + 2, 96, x - 2, 102], 0.6, 0.6, 24)).tone(1, B([x + 2, 78, x - 2, 84, x + 2, 90, x - 2, 96, x + 2, 102], 0.5, 0.5, 24));
    b.arms.tone(3, both(U(R(35, 92, 11, 1), R(35, 95, 11, 1))));
  },
  // 14 셔츠+조끼 — white shirt, fitted vest, bow tie, watch chain
  k => {
    const b = base(k, { top: k.Wt, sleeve: 'long', sl: k.Wt, lower: 'slacks', lo: k.Dk, shoe: k.Dk });
    const v = k.L('over', k.Cl, { light: [2, 2] }).add(P(50, 74, 58, 74, 64, 88, 70, 74, 78, 74, 85, 82, 84, 106, 44, 106, 43, 82));
    v.tone(4, Ln(64, 88, 64, 106)).tone(3, both(Ln(52, 96, 57, 96)));
    buttons(v, k.r(k.Wt, 2), 65, [92, 98]);
    v.tone(k.r(k.Gd, 2), B([52, 98, 58, 102, 64, 100], 0.6));
    k.L('over', k.Rd, { light: [1, 1] }).add(P(57, 71, 63, 73.5, 57, 77), P(71, 71, 65, 73.5, 71, 77), R(62, 72, 4, 3));
    b.arms.tone(3, both(Ln(44, 86, 42, 92)));
  },
  // 15 드레스 — ball gown with lace hem, puff sleeves, necklace
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'puff', lower: 'none', shoe: k.Cl });
    k.L('over', k.Wt, { shadow: null }).add(B([47, 74, 56, 79, 64, 80, 72, 79, 81, 74], 1.6)).tone(3, U(...[50, 56, 62, 68, 74, 80].map(x => R(x, 77, 1, 1))));
    const sk = k.L('torso', k.Cl, { light: [3, 3] }).add(P(48, 93, 80, 93, 104, 119, 24, 119));
    for (let x = 26; x <= 102; x += 6) sk.add(E(x, 119, 3.5, 3));
    sk.tone(3, U(...[44, 54, 64, 74, 84].map(x => B([64 + (x - 64) * 0.4, 95, x, 106, x + (x - 64) * 0.5, 119], 0.6))));
    k.L('over', k.Wt, { shadow: null }).add(R(24, 118, 80, 2)).tone(k.r(k.Wt, 3), U(...Array.from({ length: 13 }, (_, i) => R(25 + i * 6, 119, 1, 1))));
    k.L('over', k.Ac).add(R(46, 91, 36, 3), E(64, 92.5, 3.5, 3));
    k.L('over', k.Gd, { outline: false, shadow: null }).add(B([56, 72, 64, 78, 72, 72], 0.6)).paint(k.r(k.Pk, 2), E(64, 78.5, 1.6, 1.6));
    b.arms.tone(3, both(Ln(38, 84, 47, 84)));
  },
  // 16 파일럿 재킷 — bomber with fur collar, goggles round the neck
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'long', lower: 'pants', lo: k.Lt, shoe: k.Dk, hem: 104 });
    b.torso.tone(k.r(k.Dk, 2), R(42, 100, 44, 4)).tone(4, Ln(64, 80, 64, 100)).tone(k.r(k.Gd, 2), P(74, 84, 81, 84, 81, 90, 77.5, 92, 74, 90));
    b.arms.tone(k.r(k.Dk, 2), both(R(35, 92, 11, 4))).tone(k.r(k.Rd, 2), Mi(R(39, 84, 5, 3)));
    const fur = k.L('over', k.Wt, { light: [1, 1] });
    for (const [x, y] of [[48, 76], [53, 74], [58, 76], [70, 76], [75, 74], [80, 76], [46, 80], [82, 80]]) fur.add(E(x, y, 4.2, 3.6));
    fur.tone(3, U(...[[50, 77], [56, 77], [72, 77], [78, 77]].map(([x, y]) => R(x, y, 1, 2))));
    const g = k.L('over', k.Lt).add(B([52, 84, 64, 88, 76, 84], 1.2));
    g.add(E(57, 85, 4, 3.4), E(71, 85, 4, 3.4)).tone(k.r(k.Mn, 2), E(57, 85, 2.4, 2), E(71, 85, 2.4, 2)).tone(k.r(k.Mn, 1), R(56, 84, 1, 1), R(70, 84, 1, 1));
  },
  // 17 의사 가운 — long open white coat, coloured scrubs, stethoscope
  k => {
    base(k, { top: k.Cl, sleeve: 'long', lower: 'pants', lo: k.Cl, shoe: k.Wt });
    const coat = k.L('over', k.Wt, { light: [3, 3] }).add(both(P(48, 72, 58, 72, 61, 115, 37, 115, 40, 84, 42, 76)));
    coat.tone(3, both(P(56, 72, 59, 72, 59, 86, 52, 82))).tone(4, both(Ln(52, 82, 59, 86))).tone(3, both(R(43, 100, 10, 1)));
    coat.tone(k.r(k.Ac, 2), Mi(R(46, 88, 1, 6))).tone(k.r(k.Rd, 2), Mi(R(48, 88, 1, 5)));
    k.L('arms', k.Wt, { light: [2, 2] }).add(both(C(44.5, 79, 40.2, 96.5, 5.8, 5.3))).tone(3, both(R(35, 93, 11, 1)));
    const st = k.L('top', k.Dk, { outline: false, shadow: null }).paint(k.r(k.Dk, 2), B([56, 72, 54, 86, 60, 92], 0.8), B([72, 72, 72, 84, 64, 90, 61, 94], 0.8));
    st.paint(k.r(k.Mt, 2), E(61, 95, 2.6, 2.6)).paint(k.r(k.Mt, 4), ring(61, 95, 2.6, 2.6, 0.8));
    k.L('top', k.Wt).add(R(43, 90, 9, 6)).tone(k.r(k.Ac, 2), R(45, 92, 5, 1)).tone(3, R(45, 94, 3, 1));
  },
  // 18 탱크톱 — bare shoulders, denim cut-offs, wristband
  k => {
    k.L('torso', k.S, { light: [2, 2] }).add(TORSO);
    const b = base(k, { top: k.Cl, sleeve: 'none', lower: 'shorts', lo: k.Jn, shoe: k.Wt, torso: P(50, 73, 55, 73, 57, 80, 71, 80, 73, 73, 78, 73, 82, 84, 86, 106, 42, 106, 46, 84) });
    b.torso.tone(k.r(k.Wt, 2), R(56, 88, 16, 4)).tone(k.r(k.Ac, 2), R(56, 92, 16, 3));
    b.legs!.tone(k.r(k.Wt, 2), both(U(Ln(50, 112, 62, 112)))).tone(1, both(R(49, 100, 8, 2)));
    k.L('hands', k.Ac).add(R(36, 94, 9, 3));
  },
  // 19 망토 — wide flowing cape, gold clasp, tunic and boots
  k => {
    const cape = k.L('back', k.Cl, { light: [3, 3] }).add(P(46, 72, 82, 72, 106, 122, 22, 122));
    cape.tone(3, U(...[34, 46, 82, 94].map(x => B([64 + (x - 64) * 0.4, 74, x, 100, x + (x - 64) * 0.2, 121], 0.6)))).tone(k.r(k.C2, 2), R(22, 119, 84, 3));
    const b = base(k, { top: k.Dk, sleeve: 'long', sl: k.Dk, lower: 'pants', lo: k.Dk, shoe: k.Lt });
    k.L('legs', k.Lt).add(both(C(55.5, 109, 55.5, 116, 6.6, 6.5))).tone(3, both(R(48, 109, 15, 1)));
    b.torso.tone(k.r(k.Lt, 2), R(42, 97, 44, 3));
    const dr = k.L('arms', k.Cl, { light: [2, 2] }).add(both(P(40, 74, 58, 72, 52, 92, 34, 98, 36, 82)));
    dr.tone(3, both(Ln(44, 80, 38, 96)));
    k.L('top', k.Gd, { light: [1, 1] }).add(E(64, 76, 4.5, 4.5)).tone(k.r(k.Rd, 2), E(64, 76, 2, 2));
    b.hands.cut(R(0, 0, 128, 128)).add(both(E(37, 100, 4.4, 4.4)));
  },
  // 20 군복 — epaulettes, medals, cross belt, high boots
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'long', lower: 'pants', lo: k.C2, shoe: k.Dk, hem: 108, pose: 'akimbo' });
    k.L('legs', k.Dk, { light: [1, 1] }).add(both(C(55.5, 106, 55.5, 116, 6.8, 6.6))).tone(1, both(R(51, 106, 2, 9)));
    b.torso.tone(k.r(k.C2, 2), R(57, 72, 14, 4)).tone(4, Ln(64, 76, 64, 107));
    buttons(b.torso, k.r(k.Gd, 2), 66, [80, 87, 94]);
    b.torso.tone(k.r(k.Rd, 2), R(47, 82, 3, 4)).tone(k.r(k.Gd, 2), R(51, 82, 3, 4)).tone(k.r(k.Mn, 2), R(55, 82, 3, 4));
    b.torso.tone(k.r(k.Gd, 1), R(48, 87, 2, 2), R(52, 87, 2, 2));
    k.L('over', k.Lt).add(C(45, 76, 82, 104, 1.8), R(42, 100, 44, 4)).tone(k.r(k.Gd, 2), R(62, 100, 4, 4));
    const ep = k.L('arms', k.Gd, { light: [1, 1] });
    k.layers.arms[0].tone(k.r(k.C2, 2), both(R(35, 92, 11, 3)));
    ep.add(both(P(36, 75, 50, 73, 50, 78, 36, 80))); for (let x = 37; x < 50; x += 2) ep.add(both(R(x, 80, 1, 3)));
  },
  // 21 파자마 — loose piped pyjamas with polka dots, fluffy slippers
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'long', lower: 'pants', lo: k.Cl, shoe: k.Wt, hem: 108 });
    b.legs!.add(both(C(56, 106, 55, 115, 8.5, 8)));
    const dots2: number[] = [];
    for (let y = 80; y < 120; y += 7) for (let x = 44 + (y % 2) * 4; x < 86; x += 8) dots2.push(x, y);
    const d = dots(dots2, 1.3);
    b.torso.tone(k.r(k.Wt, 1), d); b.legs!.tone(k.r(k.Wt, 1), d); b.arms.tone(k.r(k.Wt, 1), dots([38, 86, 42, 93, 90, 86, 86, 93], 1.2));
    b.torso.tone(k.r(k.Wt, 2), U(Ln(57, 72, 64, 82, 71, 72), Ln(64, 82, 64, 107), R(42, 107, 44, 1)));
    b.arms.tone(k.r(k.Wt, 2), both(R(35, 95, 11, 1)));
    buttons(b.torso, k.r(k.Wt, 3), 66, [88, 96]);
    const fl = k.L('feet', k.Wt, { light: [1, 1] }).add(both(E(54.5, 119, 9.5, 5.6)));
    fl.tone(k.r(k.Pk, 2), both(E(58, 116, 2.2, 2)));
  },
  // 22 점프수트 — one-piece with zip, belt, chest pockets, rolled sleeves
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'short', lower: 'pants', lo: k.Cl, shoe: k.Dk });
    b.legs!.tone(3, both(R(49, 108, 7, 5))).tone(4, both(Ln(49, 108, 56, 108)));
    b.torso.cut(P(58, 70, 70, 70, 64, 78)).tone(k.r(k.Mt, 2), Ln(64, 78, 64, 106)).tone(4, U(Ln(48, 82, 57, 82, 57, 90, 48, 90), Ln(71, 82, 80, 82, 80, 90, 71, 90)));
    k.L('over', k.Dk).add(R(42, 98, 44, 4)).tone(k.r(k.Mt, 1), R(61, 98, 6, 4)).tone(k.r(k.Dk, 3), R(62, 99, 4, 2));
    b.arms.tone(k.r(k.C2, 2), both(inter(C(44.5, 79, 42.5, 87, 6.4, 5.8), R(0, 85, 128, 5))));
    b.torso.tone(k.r(k.Ac, 2), R(73, 84, 5, 3));
  },
  // 23 스카프+재킷 — open jacket, chunky scarf with hanging tail, jeans, boots
  k => {
    const b = base(k, { top: k.Cl, sleeve: 'long', lower: 'pants', lo: k.Jn, shoe: k.Lt, hem: 108 });
    b.torso.tone(k.r(k.Dk, 2), P(57, 76, 71, 76, 70, 107, 58, 107)).tone(4, U(Ln(57, 76, 58, 107), Ln(71, 76, 70, 107)));
    b.torso.tone(3, both(R(44, 98, 8, 1)));
    const sc = k.L('over', k.Ac, { light: [2, 2] }).add(E(64, 73, 15, 5.4), P(66, 74, 76, 75, 78, 98, 70, 98));
    sc.tone(3, U(Ln(52, 72, 76, 72), Ln(72, 78, 73, 96))).tone(k.r(k.Ac, 1), Ln(68, 98, 78, 98));
    for (let x = 70; x <= 78; x += 2) sc.add(R(x, 98, 1, 3));
  },
];

/* --------------------------------------------------------------- public */

const cache = new Map<string, Uint32Array>();

/**
 * Renders the avatar into a 128 × 128 RGBA buffer.
 * pixels[y * width + x] is a 32-bit value 0xRRGGBBAA (red in the high byte,
 * alpha in the low byte); fully transparent pixels are 0. To fill an
 * ImageData, write bytes R,G,B,A per pixel (see pixelAvatarRGBA). Pure and
 * deterministic: identical input always gives identical pixels.
 */
export function pixelAvatarPixels(value: PixelAvatarData): { width: number; height: number; pixels: Uint32Array } {
  const v = normalizePixelAvatar(value);
  const key = [v.hair, v.face, v.body, v.hairColor, v.skinColor, v.bodyColor, v.eyeColor].join('|');
  let px = cache.get(key);
  if (!px) {
    const k = new Ctx(v);
    BODIES[v.body](k);
    const head = drawHead(k);
    const face = k.F('face'), top = k.F('top');
    FACES[v.face](k, face, top);
    HAIRS[v.hair](k);
    for (const h of [...k.layers.hair, ...k.layers.hat]) head.cast(h, 1, 2, 3);
    px = k.render();
    if (cache.size > 96) cache.delete(cache.keys().next().value as string);
    cache.set(key, px);
  }
  return { width: W, height: W, pixels: new Uint32Array(px) };
}

/** Same image as RGBA bytes (ImageData-compatible order R, G, B, A). */
export function pixelAvatarRGBA(value: PixelAvatarData): Uint8ClampedArray {
  const { pixels } = pixelAvatarPixels(value);
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    out[i * 4] = c >>> 24; out[i * 4 + 1] = (c >>> 16) & 255; out[i * 4 + 2] = (c >>> 8) & 255; out[i * 4 + 3] = c & 255;
  }
  return out;
}
