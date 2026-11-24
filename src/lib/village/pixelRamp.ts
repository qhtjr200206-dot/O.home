// 도트 색 램프 — 순수 함수(가져오기 없음). 마을 지형·건물 도트가 같은 규칙으로 명암을 만든다.
// (v2.0 사용자 요청 — "마을 그래픽 개선") 도트 원칙: 밝은 쪽은 노랑 쪽으로, 어두운 쪽은 파랑·보라 쪽으로
// 색조를 옮기고(색조 이동), 외곽선은 순검정 대신 그 재질의 가장 어두운 색(셀프컬러 외곽선)을 쓴다.

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** 색조 h를 목표 색조 쪽으로 최단 방향으로 최대 amt도 옮긴다 */
export function hueToward(h: number, target: number, amt: number): number {
  let d = ((target - h + 540) % 360) - 180;
  if (Math.abs(d) < amt) return target;
  d = Math.sign(d) * amt;
  return (h + d + 360) % 360;
}

const WARM = 55;   // 하이라이트가 향하는 노랑
const COOL = 250;  // 그림자가 향하는 파랑·보라

/** 밝기 단계 k(-3..+2)의 색. 음수는 어둡고 파랗게, 양수는 밝고 노랗게. 채도가 거의 없는 색(회색)은 색조를 덜 옮긴다 */
export function shade(base: string, k: number): string {
  if (!k) return base;
  const [h, s, l] = rgbToHsl(hexToRgb(base));
  const grey = s < 0.08;
  if (k > 0) {
    const nh = grey ? h : hueToward(h, WARM, 10 * k);
    return rgbToHex(hslToRgb([nh, Math.max(0, s - 0.04 * k), Math.min(0.97, l + 0.1 * k)]));
  }
  const n = -k;
  const nh = grey ? (s ? h : COOL) : hueToward(h, COOL, 12 * n);
  return rgbToHex(hslToRgb([nh, Math.min(1, (grey ? Math.max(s, 0.06) : s) + 0.05 * n), Math.max(0.04, l - 0.11 * n - (n === 3 ? 0.05 : 0))]));
}

/** 재질 하나의 램프 — [외곽선, 그림자, 기본, 밝은 면, 하이라이트] (3~4단 색조 이동 + 셀프컬러 외곽선) */
export function ramp(base: string): [string, string, string, string, string] {
  return [shade(base, -3), shade(base, -1), base, shade(base, 1), shade(base, 2)];
}

/** 두 색을 t(0..1)로 섞는다 */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
