// 제목·가수·문구 글자색 — 직접 지정색 또는 자동.
// 자동: 글자가 실제로 놓일 자리의 바탕(이미 그려진 캔버스 픽셀: 테마 면·사진·덮개)을 읽어 평균색을 구하고,
// 테마 원래 글자색이 충분히 읽히면 그대로, 모자라면 밝은 바탕 → 어두운 글씨 / 어두운 바탕 → 밝은 글씨로 옮긴다.
// 바탕 밝기에 대해 연속 함수라 사진이 크로스페이드되는 동안 글자색도 급변 없이 따라 바뀐다.
import { contrast, luminance, mix, rgbToHex } from './color';

/** 이 대비(WCAG 큰 글자 기준 3:1 + 여유)를 넘으면 테마 원래 색을 그대로 둔다 — 테마 디자인을 최대한 유지 */
const OK = 3.2;
/** 대비가 이만큼 모자라면 완전히 대체색으로 (그 사이는 섞어서 연속) */
const SPAN = 1.4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** fg(테마 색)를 바탕 bg 위에서 읽히게 — bg에 대해 연속 */
export function autoInk(fg: string, bg: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg)) return fg;
  const c = contrast(fg, bg);
  if (c >= OK) return fg;
  const L = luminance(bg);
  // 흑/백 대비가 같아지는 지점(L≈0.18) 주변에서 밝은 글씨 ↔ 어두운 글씨를 부드럽게 넘긴다. 테마 색조를 조금 남긴다.
  const light = mix(fg, '#ffffff', 0.9), dark = mix(fg, '#000000', 0.86);
  const target = mix(light, dark, smooth(0.13, 0.26, L));
  return mix(fg, target, clamp01((OK - c) / SPAN));
}

/** 현재 변환 기준 사각형 아래 캔버스 픽셀 평균색. 못 읽으면(작은 측정용 캔버스·tainted) null */
export function sampleUnder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string | null {
  const cv = ctx.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
  if (!cv || cv.width < 8 || cv.height < 8 || !(w > 0) || !(h > 0)) return null;
  let m: DOMMatrix;
  try { m = ctx.getTransform(); } catch { return null; }
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0])))), x1 = Math.min(cv.width, Math.ceil(Math.max(...pts.map(p => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1])))), y1 = Math.min(cv.height, Math.ceil(Math.max(...pts.map(p => p[1]))));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  let d: Uint8ClampedArray;
  try { d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data; } catch { return null; }
  // 2000점 정도만 — 균일 간격
  const px = d.length / 4;
  const step = Math.max(1, Math.floor(px / 2000));
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < px; i += step) {
    const o = i * 4, al = d[o + 3] / 255;
    r += d[o] * al; g += d[o + 1] * al; b += d[o + 2] * al; a += al;
  }
  if (a < 1) return null;
  return rgbToHex([r / a, g / a, b / a]);
}

export type InkRole = 'title' | 'artist' | 'phrase';

/** 직접 지정색이 있으면 그 색, 없으면 자동 */
export function resolveInk(custom: string, fallback: string, bg: string | null): string {
  if (custom && /^#[0-9a-f]{6}$/i.test(custom)) return custom;
  if (!bg) return fallback;
  // fallback이 rgba() 등 hex가 아니면 대략 hex로 (알파 무시) — 바꿀 필요가 없으면 원래 값(투명도 포함) 그대로
  const hex = toHex(fallback);
  if (!hex) return fallback;
  const out = autoInk(hex, bg);
  return out === hex ? fallback : out;
}

function toHex(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('').toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c);
  if (m) return rgbToHex([+m[1], +m[2], +m[3]]);
  return null;
}
