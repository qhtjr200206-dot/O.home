// 포인트색 팔레트 · 사진에서 색 추출
import type { Palette } from './types';

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xd9a441;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** a → b 로 t만큼 섞기 */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** #rrggbb + 투명도 → rgba() */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/** 상대 휘도 (WCAG) */
export function luminance(hex: string): number {
  const c = hexToRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** 명도만 바꾼 색 (색상·채도 유지) */
export function withLightness(hex: string, l: number, satMul = 1): string {
  const [h, s] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb(h, Math.min(1, s * satMul), Math.max(0, Math.min(1, l))));
}

export function derivePalette(accent: string): Palette {
  const a = /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : '#d9a441';
  const lum = luminance(a);
  const [, s] = rgbToHsl(hexToRgb(a));
  return {
    accent: a,
    accentSoft: withLightness(a, 0.9, Math.min(1, 0.55 + s * 0.3)),
    accentDeep: withLightness(a, 0.16, 0.9),
    // 포인트색 위 글자: 흰색과 진한 같은 계열 중 대비가 큰 쪽
    onAccent: contrast(a, '#ffffff') >= contrast(a, withLightness(a, 0.12)) ? '#ffffff' : withLightness(a, 0.12),
    isDark: lum < 0.18,
  };
}

/**
 * 사진에서 포인트색 후보 추출 (최대 n개, #rrggbb).
 * 64px로 줄여 색상(hue) 24칸 × 명도 3칸 히스토그램을 만들고,
 * 너무 회색·너무 어둡거나 밝은 픽셀은 덜 치며, 채도와 면적을 함께 본 점수 순으로 서로 떨어진 색을 고른다.
 */
export function extractColors(img: CanvasImageSource, n = 5): string[] {
  if (typeof document === 'undefined') return [];
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  try { ctx.drawImage(img, 0, 0, S, S); } catch { return []; }
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, S, S).data; } catch { return []; }

  type Bin = { r: number; g: number; b: number; w: number; sat: number };
  const bins = new Map<number, Bin>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb: RGB = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = rgbToHsl(rgb);
    if (l < 0.08 || l > 0.95) continue;
    const key = Math.floor(h * 24) * 3 + Math.min(2, Math.floor(l * 3));
    // 채도 높을수록, 중간 명도일수록 가중
    const w = (0.15 + s) * (1 - Math.abs(l - 0.5) * 1.2);
    if (w <= 0) continue;
    const b = bins.get(key) ?? { r: 0, g: 0, b: 0, w: 0, sat: 0 };
    b.r += rgb[0] * w; b.g += rgb[1] * w; b.b += rgb[2] * w; b.w += w; b.sat += s * w;
    bins.set(key, b);
  }
  const cands = [...bins.values()]
    .filter(b => b.w > 0)
    .map(b => {
      const rgb: RGB = [b.r / b.w, b.g / b.w, b.b / b.w];
      return { rgb, score: b.w * (0.4 + b.sat / b.w) };
    })
    .sort((x, y) => y.score - x.score);

  const out: RGB[] = [];
  const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const cnd of cands) {
    if (out.length >= n) break;
    if (out.every(o => dist(o, cnd.rgb) > 60)) out.push(cnd.rgb);
  }
  // 포인트색으로 쓰기 좋게 — 너무 탁한 색은 채도를 조금 올린다
  return out.map(rgb => {
    const [h, s, l] = rgbToHsl(rgb);
    return rgbToHex(hslToRgb(h, Math.min(1, Math.max(s, 0.35) * 1.1), Math.max(0.32, Math.min(0.68, l))));
  });
}
