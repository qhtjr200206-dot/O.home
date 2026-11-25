'use client';
// 집 안 도트 — 방(벽·바닥·문)과 가구 33종을 코드로 직접 찍는다(외부 에셋 없음).
// (v3 사용자 요청 — 집 안에 들어가 가구를 놓는다) 도트 원칙은 render.ts와 같다: 정수 격자, 재질 램프(pixelRamp.ts),
// 셀프컬러 외곽선(재질의 가장 어두운 색), 빛은 왼쪽 위. 같은 가구 자리라도 시대마다 모양·팔레트가 다르다
// (과거: 나무·옻칠·한지·놋쇠, 현대: 원목·패브릭·흰 가전, SF: 선체 금속·네온·홀로그램).
import { TILE, canvas, painter, blob, crystal, type Painter } from './render';
import { mix, ramp, shade } from '@/lib/village/pixelRamp';
import { seededRandom, type VillageEra } from '@/lib/village/map';
import type { FurnitureItem } from '@/lib/village/catalog';
import { footprint, houseLayout, type HouseLevel } from '@/lib/village/house';

/** 가구 그림이 칸 위로 솟을 수 있는 높이(키 큰 장롱·시계) */
export const LIFT = 18;
/** 방 그림 여백: 뒷벽은 격자 위로 WALL_TOP만큼 더 높고, 옆벽·앞벽은 SIDE·FRONT 두께 */
export const WALL_TOP = 22, SIDE = 6, FRONT = 7;

type Mats = { wood: string; dark: string; accent: string; cloth: string; paper: string; metal: string; green: string; light: string };
const MATS: Record<VillageEra, Mats> = {
  past: { wood: '#8a5a36', dark: '#4a3326', accent: '#9c3b2f', cloth: '#4f6f8f', paper: '#f1e4c0', metal: '#c99a3c', green: '#4f7a4a', light: '#ffcf6b' },
  modern: { wood: '#b07d52', dark: '#4a505c', accent: '#de5a50', cloth: '#5b7fb0', paper: '#f4f1ea', metal: '#aab2bd', green: '#4f9a55', light: '#fff2b0' },
  sf: { wood: '#c9d2e6', dark: '#323a5e', accent: '#ff5fd2', cloth: '#6b78c6', paper: '#dfe6f5', metal: '#7d8bb3', green: '#3fd6a0', light: '#5ff2ff' },
};

/** 3/4 시점 상자 — 윗면(top줄)은 밝게, 앞면은 기본색, 왼쪽 모서리 빛·오른쪽 그늘, 셀프컬러 외곽선 */
function blk(P: Painter, x: number, y: number, w: number, h: number, top: number, base: string) {
  const [o, s, m, l, hi] = ramp(base);
  P.r(x, y, w, h, o);
  if (w < 3 || h < 3) return;
  const t = Math.max(1, Math.min(top, h - 2));
  P.r(x + 1, y + 1, w - 2, t, l);
  P.r(x + 1, y + 1, w - 2, 1, hi);
  P.r(x + 1, y + 1 + t, w - 2, h - 2 - t, m);
  if (h - 2 - t > 0) {
    P.r(x + 1, y + 1 + t, w - 2, 1, s);
    P.r(x + 1, y + 2 + t, 1, Math.max(0, h - 3 - t), l);
    P.r(x + w - 2, y + 2 + t, 1, Math.max(0, h - 3 - t), s);
  }
}
/** 바닥에 드리운 그림자(빛이 왼쪽 위 → 오른쪽 아래로 조금) */
function floorShadow(P: Painter, x: number, y: number, w: number) { P.r(x + 2, y, w - 1, 2, 'rgba(12,10,30,.22)'); }
/** 타원(항아리·구슬) — 왼쪽 위 밝게 */
function oval(P: Painter, cx: number, cy: number, rx: number, ry: number, base: string) {
  const [o, s, m, l, hi] = ramp(base);
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
    if (d > 1) continue;
    const edge = (x * x) / ((rx - 1) ** 2 || 1) + (y * y) / ((ry - 1) ** 2 || 1) > 1;
    const lit = (x + rx * 0.4) ** 2 / (rx * rx) + (y + ry * 0.4) ** 2 / (ry * ry) < 0.18;
    P.p(cx + x, cy + y, edge ? o : lit ? (d < 0.12 ? hi : l) : x / rx + y / ry > 0.5 ? s : m);
  }
}

/* ================= 가구 ================= */
type Draw = (P: Painter, W: number, D: number, B: number, e: VillageEra, m: Mats, rnd: () => number) => void;

const SHAPES: Record<string, Draw> = {
  plant: (P, W, _D, B, e, m, rnd) => {
    const cx = W / 2;
    floorShadow(P, cx - 5, B - 2, 10);
    const pot = e === 'past' ? '#e9e6df' : e === 'modern' ? '#c4704a' : m.metal;
    blk(P, cx - 4, B - 8, 8, 7, 2, pot);
    if (e === 'past') { P.r(cx - 3, B - 5, 6, 1, '#4f6fa8'); blob(P, cx, B - 11, 6, 2, '#3f7b44', rnd); blob(P, cx + 1, B - 14, 4, 2, '#3f7b44', rnd); P.r(cx - 1, B - 13, 2, 4, '#6b4a2f'); }
    else if (e === 'modern') blob(P, cx, B - 13, 6, 5, '#4a9150', rnd);
    else { crystal(P, cx, B - 7, 10, m.green); crystal(P, cx - 3, B - 7, 6, '#7ff3e0'); crystal(P, cx + 3, B - 7, 7, '#9b6be0'); }
  },
  lamp: (P, W, _D, B, e, m) => {
    const cx = W / 2;
    floorShadow(P, cx - 4, B - 2, 8);
    if (e === 'past') {
      blk(P, cx - 4, B - 4, 8, 3, 1, m.wood); P.r(cx - 1, B - 13, 2, 10, m.wood);
      blk(P, cx - 4, B - 21, 8, 9, 2, m.paper); P.r(cx - 2, B - 18, 4, 5, m.light); P.r(cx - 2, B - 18, 2, 2, '#fff2b0');
    } else if (e === 'modern') {
      blk(P, cx - 4, B - 3, 8, 3, 1, m.dark); P.r(cx - 1, B - 20, 2, 18, m.metal); P.r(cx - 1, B - 20, 1, 18, shade(m.metal, 1));
      blk(P, cx - 5, B - 26, 10, 7, 1, '#efe2c2'); P.r(cx - 4, B - 20, 8, 1, m.light);
    } else {
      blk(P, cx - 4, B - 4, 8, 3, 1, m.dark); P.r(cx - 3, B - 6, 6, 1, m.light);
      oval(P, cx, B - 14, 4, 4, m.light);
    }
  },
  cushion: (P, W, D, B, e, m) => {
    const c = e === 'past' ? m.accent : e === 'modern' ? '#f39bb5' : m.cloth;
    blk(P, 2, B - 10, W - 4, 8, 5, c);
    const [, , , l] = ramp(c);
    if (e === 'past') { P.r(W / 2 - 2, B - 8, 4, 2, m.metal); P.r(1, B - 10, 2, 2, m.metal); }
    else if (e === 'modern') P.r(W / 2 - 3, B - 8, 6, 1, l);
    else { P.r(3, B - 3, W - 6, 1, m.light); }
    void D;
  },
  chair: (P, W, _D, B, e, m) => {
    floorShadow(P, 3, B - 2, W - 6);
    if (e === 'past') {
      blk(P, 3, B - 11, W - 6, 5, 3, m.wood);
      for (const x of [4, W - 6]) P.r(x, B - 7, 2, 6, m.dark);
    } else if (e === 'modern') {
      blk(P, 3, B - 22, W - 6, 11, 1, m.wood);
      blk(P, 3, B - 12, W - 6, 5, 3, m.cloth);
      for (const x of [4, W - 6]) P.r(x, B - 8, 2, 7, m.dark);
    } else {
      blk(P, 3, B - 22, W - 6, 10, 1, m.wood); P.r(4, B - 19, W - 8, 1, m.light);
      blk(P, 3, B - 13, W - 6, 6, 3, m.wood);
      P.r(4, B - 4, W - 8, 1, m.light); P.r(5, B - 3, W - 10, 1, shade(m.light, -1));
    }
  },
  rug: (P, W, D, B, e, m) => {
    const y0 = B - D + 2, h = D - 4;
    if (e === 'past') {
      const c = '#d8bf7a', [o, s, , l] = ramp(c);
      P.r(1, y0, W - 2, h, o); P.r(2, y0 + 1, W - 4, h - 2, c);
      for (let y = y0 + 2; y < y0 + h - 2; y += 2) P.r(2, y, W - 4, 1, s);
      P.r(2, y0 + 1, W - 4, 1, m.accent); P.r(2, y0 + h - 2, W - 4, 1, m.cloth);
      for (let x = 6; x < W - 4; x += 8) { P.r(x, y0 + h / 2 - 1, 2, 2, m.accent); P.r(x - 1, y0 + h / 2, 1, 1, l); }
    } else if (e === 'modern') {
      const c = m.cloth, [o, , , l] = ramp(c);
      P.r(1, y0, W - 2, h, o); P.r(2, y0 + 1, W - 4, h - 2, c);
      for (let x = 4; x < W - 3; x += 6) P.r(x, y0 + 1, 2, h - 2, l);
      P.r(2, y0 + 1, W - 4, 1, shade(c, 2));
    } else {
      P.r(1, y0, W - 2, h, '#1d2240'); P.r(2, y0 + 1, W - 4, h - 2, m.dark);
      for (let x = 4; x < W - 2; x += 4) P.r(x, y0 + 1, 1, h - 2, shade(m.dark, 1));
      P.r(2, y0 + 1, W - 4, 1, m.light); P.r(2, y0 + h - 2, W - 4, 1, m.light);
    }
  },
  chest: (P, W, _D, B, e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    if (e === 'past') {
      blk(P, 1, B - 14, W - 2, 13, 4, m.wood);
      P.r(2, B - 9, W - 4, 1, shade(m.wood, -2));
      for (const x of [2, W - 4]) P.r(x, B - 9, 2, 2, m.metal);
      P.r(W / 2 - 2, B - 8, 4, 3, m.metal); P.r(W / 2 - 1, B - 7, 2, 1, shade(m.metal, -2));
    } else if (e === 'modern') {
      blk(P, 2, B - 12, W - 4, 11, 4, '#c9a97a');
      P.r(W / 2 - 1, B - 11, 2, 4, '#e9dcc0'); P.r(4, B - 6, W - 8, 2, shade('#c9a97a', -1));
    } else {
      blk(P, 2, B - 13, W - 4, 12, 4, m.wood);
      P.r(3, B - 7, W - 6, 1, m.light); P.r(W / 2 - 1, B - 5, 2, 2, m.accent);
    }
  },
  table: (P, W, D, B, e, m) => {
    const th = Math.max(5, Math.round(D * 0.45));
    const legH = e === 'past' ? 5 : 8;
    floorShadow(P, 2, B - 2, W - 4);
    const top = e === 'past' ? '#7a3b2a' : e === 'modern' ? m.wood : m.dark;
    if (e === 'sf') {
      P.r(W / 2 - 2, B - legH - 1, 4, legH, m.metal);
      blk(P, 1, B - legH - th - 3, W - 2, th + 3, th, top);
      P.r(2, B - legH - th - 2, W - 4, 1, m.light);
    } else {
      for (const x of [2, W - 4]) P.r(x, B - legH - 1, 2, legH, shade(top, -2));
      blk(P, 1, B - legH - th - 3, W - 2, th + 3, th, top);
      if (e === 'past') P.r(3, B - legH - 2, W - 6, 1, m.metal);
    }
  },
  bed: (P, W, D, B, e, m) => {
    const horiz = W > D;
    floorShadow(P, 1, B - 2, W - 2);
    if (e === 'past') {
      // 이부자리: 바닥에 펴 놓은 요와 이불, 베개
      blk(P, 1, B - D + 3, W - 2, D - 4, D - 7, '#efe6cf');
      if (horiz) { blk(P, 9, B - D + 4, W - 11, D - 6, D - 9, m.accent); P.r(3, B - D + 6, 5, 4, m.cloth); }
      else { blk(P, 2, B - D + 12, W - 4, D - 14, D - 17, m.accent); P.r(4, B - D + 5, W - 8, 4, m.cloth); }
    } else if (e === 'modern') {
      if (horiz) { blk(P, 1, B - D - 6, 5, D + 5, 2, m.wood); blk(P, 5, B - D + 1, W - 6, D - 2, D - 6, '#f4f1ea'); blk(P, 12, B - D + 2, W - 13, D - 4, D - 8, m.cloth); P.r(7, B - D + 4, 4, 5, '#ffffff'); }
      else { blk(P, 1, B - D - 6, W - 2, 10, 2, m.wood); blk(P, 1, B - D + 3, W - 2, D - 4, D - 8, '#f4f1ea'); blk(P, 1, B - D + 13, W - 2, D - 14, D - 18, m.cloth); P.r(3, B - D + 5, W - 6, 4, '#ffffff'); }
    } else {
      blk(P, 1, B - D + 1, W - 2, D - 2, D - 6, m.wood);
      const [go] = ramp('#7fd8ff');
      P.r(3, B - D + 3, W - 6, D - 10, go); P.r(4, B - D + 4, W - 8, D - 12, mix('#7fd8ff', m.dark, 0.35));
      P.r(4, B - D + 4, 3, 1, '#d8f6ff');
      P.r(2, B - 4, W - 4, 1, m.light);
    }
  },
  clock: (P, W, _D, B, e, m) => {
    const cx = W / 2;
    floorShadow(P, cx - 5, B - 2, 10);
    if (e === 'past') {
      // 향로: 세발 청동 향로와 피어오르는 연기(두 칸씩 이어진 곡선)
      for (const x of [cx - 4, cx + 2]) P.r(x, B - 5, 2, 4, '#6a5030');
      blk(P, cx - 5, B - 11, 10, 7, 2, '#8a6a3a');
      P.r(cx - 4, B - 12, 2, 1, '#8a6a3a'); P.r(cx + 2, B - 12, 2, 1, '#8a6a3a');
      for (let i = 0; i < 8; i++) P.r(cx + Math.round(Math.sin(i * 0.9) * 2), B - 14 - i * 2, 1, 2, '#d8d4cc');
    } else if (e === 'modern') {
      blk(P, cx - 5, B - 30, 10, 29, 2, m.wood);
      oval(P, cx, B - 24, 3, 3, '#f4f1ea'); P.r(cx, B - 26, 1, 3, m.dark); P.r(cx, B - 24, 2, 1, m.dark);
      P.r(cx - 2, B - 18, 4, 12, shade(m.wood, -2)); P.r(cx, B - 18, 1, 8, m.metal); oval(P, cx, B - 9, 2, 2, '#d8b25a');
    } else {
      blk(P, cx - 3, B - 28, 6, 27, 1, m.dark);
      for (let y = B - 25; y < B - 4; y += 4) P.r(cx - 2, y, 4, 2, y % 8 ? m.light : m.accent);
    }
  },
  mirror: (P, W, _D, B, e, m) => {
    const cx = W / 2;
    floorShadow(P, cx - 6, B - 2, 12);
    const glass = '#bfe0f0';
    if (e === 'past') {
      blk(P, 2, B - 9, W - 4, 8, 3, m.wood); P.r(cx - 1, B - 6, 2, 1, m.metal);
      blk(P, cx - 4, B - 19, 8, 11, 1, m.wood); P.r(cx - 3, B - 18, 6, 8, glass); P.r(cx - 2, B - 17, 1, 3, '#ffffff');
    } else if (e === 'modern') {
      blk(P, cx - 5, B - 30, 10, 29, 1, '#d8c9a8'); P.r(cx - 4, B - 29, 8, 26, glass);
      for (let i = 0; i < 8; i++) P.r(cx - 3 + Math.floor(i / 2), B - 26 + i * 2, 1, 2, '#ffffff');
    } else {
      blk(P, cx - 4, B - 4, 8, 3, 1, m.dark);
      P.r(cx - 5, B - 28, 10, 23, mix(m.light, m.dark, 0.55)); P.r(cx - 5, B - 28, 10, 1, m.light); P.r(cx - 5, B - 28, 1, 23, m.light);
      P.r(cx - 3, B - 25, 2, 6, '#e0ffff');
    }
  },
  desk: (P, W, D, B, e, m) => {
    const th = Math.max(5, Math.round(D * 0.4));
    floorShadow(P, 2, B - 2, W - 4);
    if (e === 'past') {
      for (const x of [2, W - 4]) P.r(x, B - 6, 2, 5, m.dark);
      blk(P, 1, B - 6 - th - 3, W - 2, th + 3, th, m.wood);
      blk(P, 4, B - 6 - th - 5, 8, 4, 2, m.paper); P.r(W - 8, B - 6 - th - 6, 1, 5, m.dark);
    } else if (e === 'modern') {
      for (const x of [2, W - 4]) P.r(x, B - 9, 2, 8, m.dark);
      blk(P, 1, B - 9 - th - 3, W - 2, th + 3, th, m.wood);
      blk(P, W / 2 - 5, B - 9 - th - 9, 10, 7, 1, m.dark); P.r(W / 2 - 4, B - 9 - th - 8, 8, 4, '#7db7dc');
    } else {
      blk(P, 1, B - 12, W - 2, 11, 3, m.dark); P.r(2, B - 8, W - 4, 1, m.light);
      for (let x = 3; x < W - 6; x += 9) { P.r(x, B - 22, 7, 8, mix(m.light, m.dark, 0.5)); P.r(x, B - 22, 7, 1, m.light); }
    }
  },
  sofa: (P, W, D, B, e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    if (e === 'past') {
      blk(P, 1, B - 10, W - 2, 9, 5, m.wood);
      for (const x of [3, W - 5]) P.r(x, B - 4, 2, 3, m.dark);
      P.r(3, B - 9, W - 6, 3, '#d8bf7a'); blk(P, 3, B - 13, 7, 4, 2, m.accent);
    } else {
      const c = e === 'modern' ? m.cloth : m.accent;
      blk(P, 1, B - 20, W - 2, 10, 2, c);
      blk(P, 3, B - 12, W - 6, 7, 3, c);
      blk(P, 1, B - 15, 4, 13, 2, shade(c, -1)); blk(P, W - 5, B - 15, 4, 13, 2, shade(c, -1));
      if (e === 'sf') P.r(3, B - 3, W - 6, 1, m.light);
      else for (const x of [3, W - 5]) P.r(x, B - 3, 2, 2, m.dark);
    }
    void D;
  },
  shelf: (P, W, _D, B, e, m, rnd) => {
    floorShadow(P, 1, B - 2, W - 2);
    const frame = e === 'sf' ? m.dark : m.wood;
    blk(P, 1, B - 32, W - 2, 31, 2, frame);
    for (const y of [B - 22, B - 12]) P.r(2, y, W - 4, 1, ramp(frame)[0]);
    const books = e === 'past' ? ['#4f6f8f', '#9c3b2f', '#d8bf7a', '#4f7a4a'] : e === 'modern' ? ['#de5a50', '#2f6fb0', '#e0a43a', '#4f9a55', '#8a3f7a'] : [m.light, m.accent, '#ffb347'];
    for (const y0 of [B - 29, B - 20, B - 10]) {
      for (let x = 3; x < W - 4;) {
        const w = 2, h = 5 + Math.floor(rnd() * 3), c = books[Math.floor(rnd() * books.length)];
        if (e === 'sf') { P.r(x, y0 + 3, 2, 2, c); x += 4; continue; }
        P.r(x, y0 + 7 - h, w, h, c); P.r(x, y0 + 7 - h, 1, h, shade(c, 1));
        x += w + (rnd() < 0.2 ? 2 : 0);
      }
    }
  },
  stove: (P, W, _D, B, e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    if (e === 'past') {
      blk(P, 1, B - 14, W - 2, 13, 5, '#a88d6a');
      oval(P, W / 2, B - 15, 6, 3, '#2f2a2a'); P.r(W / 2 - 6, B - 17, 12, 1, '#4a4040');
      P.r(W / 2 - 3, B - 6, 6, 4, '#3a2a20'); P.r(W / 2 - 2, B - 5, 4, 2, '#ff8a3a'); P.r(W / 2 - 1, B - 5, 2, 1, '#ffd166');
    } else if (e === 'modern') {
      blk(P, 1, B - 14, W - 2, 13, 5, '#efece6');
      P.r(4, B - 12, 9, 3, m.metal); P.r(5, B - 12, 7, 1, '#d8dde3');
      for (const x of [W - 13, W - 7]) { P.r(x, B - 12, 4, 2, m.dark); P.r(x + 1, B - 12, 2, 1, '#de5a50'); }
      P.r(3, B - 6, W - 6, 1, m.metal);
    } else {
      blk(P, 1, B - 16, W - 2, 15, 4, m.dark);
      P.r(4, B - 10, 10, 6, mix(m.light, m.dark, 0.5)); P.r(4, B - 10, 10, 1, m.light);
      oval(P, W - 8, B - 8, 3, 3, m.accent);
    }
  },
  lantern: (P, W, _D, B, e, m) => {
    const cx = W / 2;
    floorShadow(P, cx - 4, B - 2, 8);
    if (e === 'past') {
      blk(P, cx - 4, B - 4, 8, 3, 1, m.wood); P.r(cx - 1, B - 22, 2, 19, m.wood); P.r(cx - 1, B - 22, 5, 1, m.wood);
      blk(P, cx, B - 21, 7, 5, 1, '#c0392b'); blk(P, cx, B - 17, 7, 5, 1, '#2f5aa8'); P.r(cx + 2, B - 19, 3, 2, m.light);
    } else if (e === 'modern') {
      blk(P, cx - 4, B - 3, 8, 3, 1, m.dark); P.r(cx, B - 26, 1, 23, m.metal); oval(P, cx, B - 27, 4, 4, '#fff6dc');
    } else {
      blk(P, cx - 4, B - 4, 8, 3, 1, m.dark); blk(P, cx - 4, B - 30, 8, 3, 1, m.dark);
      P.r(cx - 2, B - 27, 4, 23, m.accent); P.r(cx - 2, B - 27, 1, 23, shade(m.accent, 2)); P.r(cx + 1, B - 27, 1, 23, shade(m.accent, -1));
    }
  },
  bigplant: (P, W, _D, B, e, m, rnd) => {
    const cx = W / 2;
    floorShadow(P, cx - 5, B - 2, 10);
    blk(P, cx - 5, B - 9, 10, 8, 2, e === 'past' ? '#5a7fa8' : e === 'modern' ? '#e9e6df' : m.dark);
    if (e === 'past') {
      for (const [x0, y0, x1, y1] of [[0, 9, -4, 22], [0, 9, 4, 24], [0, 14, 5, 18], [-2, 16, -6, 20]]) {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let i = 0; i <= n; i++) P.r(cx + Math.round(x0 + (x1 - x0) * i / n), B - Math.round(y0 + (y1 - y0) * i / n), 1, 1, '#4a3326');
      }
      for (const [x, y] of [[-4, 22], [4, 24], [5, 18], [-6, 20], [1, 26], [-2, 25]]) { P.r(cx + x - 1, B - y - 1, 2, 2, '#f0a3b8'); P.p(cx + x - 1, B - y - 1, '#ffd6e0'); }
    } else if (e === 'modern') {
      blob(P, cx - 3, B - 18, 5, 6, '#3f8648', rnd); blob(P, cx + 3, B - 20, 5, 7, '#4a9150', rnd); blob(P, cx, B - 25, 4, 4, '#4a9150', rnd);
    } else {
      for (let i = 0; i < 3; i++) { const dx = (i - 1) * 4; for (let y = 0; y < 16 + i * 3; y++) P.r(cx + dx + Math.round(Math.sin(y / 3 + i) * 2), B - 9 - y, 1, 1, '#9b6be0'); P.r(cx + dx - 1 + Math.round(Math.sin((16 + i * 3) / 3 + i) * 2), B - 10 - 16 - i * 3, 2, 2, m.light); }
    }
  },
  jar: (P, W, _D, B, e, m) => {
    const cx = W / 2;
    floorShadow(P, cx - 6, B - 2, 12);
    if (e === 'past') { oval(P, cx, B - 9, 6, 8, '#7a4a2a'); P.r(cx - 3, B - 17, 6, 2, '#5a3420'); P.r(cx - 5, B - 9, 10, 1, shade('#7a4a2a', -1)); }
    else if (e === 'modern') {
      blk(P, 1, B - 5, W - 2, 4, 1, m.dark);
      P.r(1, B - 20, W - 2, 16, '#3f6f8a'); P.r(2, B - 19, W - 4, 14, '#4fa3d6'); P.r(2, B - 19, W - 4, 2, '#9fd2f2');
      P.r(5, B - 13, 3, 2, '#ff8a3a'); P.r(9, B - 10, 3, 2, '#ffd166'); P.r(4, B - 7, 1, 2, '#3f8648'); P.r(11, B - 8, 1, 3, '#3f8648');
    } else {
      blk(P, cx - 6, B - 5, 12, 4, 1, m.dark); blk(P, cx - 6, B - 26, 12, 3, 1, m.dark);
      P.r(cx - 5, B - 23, 10, 18, mix(m.green, m.dark, 0.4)); P.r(cx - 5, B - 23, 1, 18, m.green);
      oval(P, cx, B - 14, 2, 3, '#ffb347');
    }
  },
  screen: (P, W, _D, B, e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    if (e === 'past') {
      blk(P, 1, B - 26, W - 2, 3, 1, m.wood);
      for (let x = 2; x < W - 2; x += 2) P.r(x, B - 23, 1, 20, x % 4 ? '#c9b46a' : '#a8923f');
      P.r(2, B - 14, W - 4, 1, m.accent);
    } else if (e === 'modern') {
      for (let i = 0; i < 3; i++) blk(P, 1 + i * Math.floor((W - 2) / 3), B - 24, Math.floor((W - 2) / 3), 23, 1, i % 2 ? '#d8d3c8' : '#c9c4b8');
    } else {
      for (const x of [1, W - 4]) blk(P, x, B - 28, 3, 27, 1, m.dark);
      for (let y = B - 25; y < B - 3; y += 3) P.r(4, y, W - 8, 1, mix(m.light, m.dark, 0.3));
    }
  },
  wardrobe: (P, W, _D, B, e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    const c = e === 'past' ? '#7a3b2a' : e === 'modern' ? '#efe9dc' : m.metal;
    blk(P, 1, B - 34, W - 2, 33, 2, c);
    P.r(W / 2, B - 31, 1, 29, ramp(c)[0]);
    if (e === 'past') { for (const y of [B - 26, B - 12]) for (const x of [3, W / 2 + 2]) P.r(x, y, W / 2 - 5, 4, m.metal); P.r(W / 2 - 2, B - 19, 4, 3, m.metal); }
    else if (e === 'modern') { P.r(W / 2 - 3, B - 20, 1, 5, m.dark); P.r(W / 2 + 2, B - 20, 1, 5, m.dark); }
    else for (let y = B - 28; y < B - 4; y += 6) { P.r(4, y, 2, 2, m.light); P.r(W - 6, y, 2, 2, m.accent); }
  },
  dining: (P, W, D, B, e, m) => {
    const th = Math.round(D * 0.55);
    floorShadow(P, 2, B - 2, W - 4);
    const top = e === 'past' ? '#7a3b2a' : e === 'modern' ? m.wood : m.dark;
    if (e === 'modern') for (const x of [2, W - 8]) { blk(P, x, B - D + 2, 6, 6, 3, m.cloth); blk(P, x, B - 8, 6, 6, 3, m.cloth); }
    const legH = e === 'past' ? 5 : 8, y0 = B - legH - th - 3;
    if (e !== 'sf') for (const x of [4, W - 6]) P.r(x, B - legH - 1, 2, legH, shade(top, -2));
    else P.r(W / 2 - 3, B - legH - 1, 6, legH, m.metal);
    blk(P, 2, y0, W - 4, th + 3, th, top);
    if (e === 'past') for (const [x, y] of [[8, 4], [16, 7], [22, 3], [12, 10]]) { oval(P, x, y0 + y + 2, 2, 1, '#f1ece0'); }
    else if (e === 'modern') { oval(P, W / 2, y0 + th / 2 + 1, 4, 2, '#f4f1ea'); P.r(W / 2 - 1, y0 + th / 2, 2, 1, '#de5a50'); }
    else { P.r(4, y0 + 1, W - 8, 1, m.light); oval(P, W / 2, y0 - 4, 4, 4, mix(m.light, m.dark, 0.3)); }
  },
  // ---- 레벨 10 시대 대표 가구 ----
  byeongpung: (P, W, _D, B, _e, m) => {
    // 십장생 병풍: 네 폭 — 산·해·소나무·학
    floorShadow(P, 1, B - 2, W - 2);
    const pw = Math.floor((W - 2) / 4);
    for (let i = 0; i < 4; i++) {
      const x = 1 + i * pw;
      blk(P, x, B - 28, pw, 27, 1, '#6b3a2a');
      P.r(x + 1, B - 26, pw - 2, 23, '#efe2bf');
      if (i === 0) { for (let k = 0; k < 4; k++) P.r(x + 2 + k, B - 9 - k, pw - 4 - k * 2, 1, '#4f7a4a'); }
      if (i === 1) oval(P, x + pw / 2, B - 21, 2, 2, '#d8502a');
      if (i === 2) { P.r(x + pw / 2, B - 16, 1, 10, '#4a3326'); P.r(x + 2, B - 18, pw - 4, 2, '#3f7b44'); }
      if (i === 3) { P.r(x + 2, B - 17, 3, 2, '#ffffff'); P.r(x + 4, B - 18, 1, 1, m.accent); }
    }
  },
  gayageum: (P, W, D, B, _e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    const horiz = W >= D;
    if (horiz) {
      blk(P, 1, B - 10, W - 2, 8, 5, '#b08a4f');
      for (let y = B - 9; y < B - 5; y++) P.r(3, y, W - 6, 1, y % 2 ? '#f1e4c0' : '#c9a35a');
      for (let x = 6; x < W - 4; x += 4) P.r(x, B - 10, 1, 2, '#4a3326');
      P.r(W - 4, B - 11, 3, 3, m.accent);
    } else {
      blk(P, 3, B - D + 1, W - 6, D - 2, D - 6, '#b08a4f');
      for (let x = 5; x < W - 5; x++) P.r(x, B - D + 3, 1, D - 8, x % 2 ? '#f1e4c0' : '#c9a35a');
    }
  },
  jagae: (P, W, _D, B, _e, _m, rnd) => {
    floorShadow(P, 1, B - 2, W - 2);
    blk(P, 1, B - 24, W - 2, 23, 2, '#2a2228');
    P.r(W / 2, B - 21, 1, 19, '#14101a');
    for (let i = 0; i < 18; i++) {
      const x = 3 + Math.floor(rnd() * (W - 7)), y = B - 20 + Math.floor(rnd() * 16);
      const c = ['#bfe8ff', '#f6d8ff', '#d8ffe8'][i % 3];
      P.r(x, y, 2, 1, c); P.p(x, y + 1, shade(c, -1));
    }
    for (const x of [3, W - 7]) P.r(x, B - 4, 4, 3, '#14101a');
  },
  moonjar: (P, W, _D, B) => {
    const cx = W / 2;
    floorShadow(P, cx - 6, B - 2, 12);
    oval(P, cx, B - 11, 7, 9, '#efeadd');
    P.r(cx - 3, B - 21, 6, 2, '#e0dacb'); P.r(cx - 7, B - 11, 14, 1, '#ddd6c6');
  },
  piano: (P, W, _D, B) => {
    floorShadow(P, 1, B - 2, W - 2);
    blk(P, 1, B - 28, W - 2, 27, 3, '#2a2a33');
    P.r(2, B - 16, W - 4, 3, '#f4f1ea');
    for (let x = 3; x < W - 3; x += 3) if (x % 7) P.r(x, B - 16, 1, 2, '#1a1a22');
    P.r(4, B - 24, W - 8, 1, '#d8b25a');
    for (const x of [3, W - 5]) P.r(x, B - 9, 2, 8, '#1a1a22');
  },
  tv: (P, W, _D, B, _e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    blk(P, 1, B - 9, W - 2, 8, 3, m.wood);
    blk(P, 2, B - 27, W - 4, 17, 1, '#1d1f26');
    P.r(3, B - 26, W - 6, 14, '#2f6fb0'); P.r(3, B - 26, W - 6, 4, '#7db7dc'); P.r(5, B - 18, 8, 4, '#4f9a55'); P.r(4, B - 25, 3, 1, '#d8ecff');
  },
  arcade: (P, W, _D, B) => {
    floorShadow(P, 1, B - 2, W - 2);
    blk(P, 2, B - 32, W - 4, 31, 2, '#5b3fa8');
    P.r(3, B - 29, W - 6, 4, '#ffd166');
    P.r(4, B - 24, W - 8, 9, '#14141c'); P.r(5, B - 23, 3, 2, '#5ff2ff'); P.r(9, B - 20, 2, 2, '#ff5fd2');
    blk(P, 2, B - 15, W - 4, 4, 2, '#3f2a80'); P.r(5, B - 17, 1, 3, '#2a2a33'); P.r(4, B - 18, 3, 2, '#de5a50'); P.r(10, B - 15, 2, 1, '#ffd166');
  },
  massage: (P, W, _D, B, _e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    blk(P, 2, B - 28, W - 4, 16, 2, '#5a3d2a');
    blk(P, 1, B - 14, W - 2, 9, 3, '#6b4a34');
    blk(P, 3, B - 7, W - 6, 6, 2, '#4a3326');
    P.r(W - 4, B - 18, 3, 3, m.dark); P.r(W - 3, B - 17, 1, 1, '#5ff2ff');
  },
  holotable: (P, W, _D, B, _e, m) => {
    floorShadow(P, 2, B - 2, W - 4);
    P.r(W / 2 - 4, B - 9, 8, 8, m.metal);
    blk(P, 1, B - 14, W - 2, 6, 3, m.dark); P.r(2, B - 13, W - 4, 1, m.light);
    for (let a = 0; a < 24; a++) P.r(W / 2 + Math.round(Math.cos(a / 24 * Math.PI * 2) * 7), B - 24 + Math.round(Math.sin(a / 24 * Math.PI * 2) * 6), 1, 1, a % 3 ? m.light : '#e0ffff');
    oval(P, W / 2, B - 24, 3, 3, '#3fd6a0');
  },
  cryopod: (P, W, D, B, _e, m) => {
    floorShadow(P, 1, B - 2, W - 2);
    blk(P, 1, B - D - 4, W - 2, D + 3, 3, m.metal);
    P.r(3, B - D, W - 6, D - 6, '#a8e4ff'); P.r(4, B - D + 1, W - 8, D - 8, '#d8f6ff'); P.r(4, B - D + 1, 2, D - 8, '#ffffff');
    oval(P, W / 2, B - D + 6, 2, 2, '#c9a0ff');
    for (let y = B - 8; y < B - 3; y += 2) P.r(W - 5, y, 2, 1, m.light);
  },
  robot: (P, W, _D, B, _e, m) => {
    const cx = W / 2;
    floorShadow(P, cx - 5, B - 2, 10);
    P.r(cx - 4, B - 4, 8, 2, m.light);
    blk(P, cx - 5, B - 17, 10, 12, 2, m.wood); P.r(cx - 2, B - 12, 4, 2, m.accent);
    oval(P, cx, B - 21, 4, 4, m.wood); P.r(cx - 2, B - 22, 4, 1, m.light); P.r(cx - 1, B - 26, 2, 2, '#ffb347');
    P.r(cx + 5, B - 15, 2, 7, m.metal);
  },
  planetarium: (P, W, _D, B, _e, m) => {
    const cx = W / 2;
    floorShadow(P, cx - 5, B - 2, 10);
    blk(P, cx - 4, B - 5, 8, 4, 1, m.dark); P.r(cx - 1, B - 12, 2, 7, m.metal);
    oval(P, cx, B - 16, 5, 5, '#2a3060');
    for (const [x, y] of [[-3, -18], [3, -15], [-1, -13], [2, -19], [-4, -14]]) P.r(cx + x, B + y, 1, 1, '#ffffff');
    for (const [x, y] of [[-7, -24], [6, -26], [0, -28], [-5, -29], [7, -21]]) P.r(cx + x, B + y, 2, 1, m.light);
  },
  goldframe: (P, W, _D, B) => {
    const cx = W / 2;
    floorShadow(P, cx - 6, B - 2, 12);
    for (const x of [cx - 5, cx + 3]) P.r(x, B - 12, 2, 11, '#6b4a2f');
    blk(P, cx - 7, B - 26, 14, 16, 1, '#d8b25a');
    P.r(cx - 5, B - 24, 10, 12, '#7db7dc'); P.r(cx - 5, B - 17, 10, 5, '#4f9a55'); oval(P, cx + 2, B - 21, 1, 1, '#ffd166');
  },
};

const furnCache = new Map<string, HTMLCanvasElement>();
/** 가구 그림 — 크기 = (칸 너비×16) × (칸 깊이×16 + LIFT). 아래 가장자리가 차지하는 칸의 바닥선이다 */
export function furnitureArt(era: VillageEra, item: FurnitureItem, r: 0 | 1): HTMLCanvasElement {
  const k = `${era}|${item.id}|${r}`;
  const hit = furnCache.get(k);
  if (hit) return hit;
  const [fw, fh] = footprint(item, r);
  const W = fw * TILE, D = fh * TILE, H = D + LIFT;
  const cv = canvas(W, H), P = painter(cv);
  (SHAPES[item.shape] ?? SHAPES.chest)(P, W, D, H, era, MATS[era], seededRandom(`furn|${era}|${item.id}`));
  furnCache.set(k, cv);
  return cv;
}

/* ================= 방(벽·바닥·문) ================= */
/** 방 그림 — 격자 원점은 (SIDE, WALL_TOP). 0줄은 뒷벽, 문은 아래 가운데 */
export function roomArt(era: VillageEra, level: HouseLevel, floor: string, wall: string): HTMLCanvasElement {
  const L = houseLayout(level);
  const W = L.w * TILE, H = L.h * TILE;
  const cv = canvas(W + SIDE * 2, H + WALL_TOP + FRONT), P = painter(cv);
  const ox = SIDE, oy = WALL_TOP;
  const m = MATS[era];
  const rnd = seededRandom(`room|${era}|${level}|${floor}|${wall}`);
  // 바닥
  const fy = oy + TILE, fh = H - TILE;
  const floorBase = { 'floor-ondol': '#e2b95e', 'floor-maru': '#b07d4f', 'floor-mat': '#d8c27e', 'floor-wood': '#c4925e', 'floor-tile': '#e9e4d8', 'floor-herring': '#b9895a', 'floor-deck': '#5d6890', 'floor-grid': '#262c4e', 'floor-hex': '#4c5888' }[floor] ?? '#c4925e';
  const F = ramp(floorBase);
  P.r(ox, fy, W, fh, F[2]);
  if (floor === 'floor-ondol') {
    // 노란 장판: 이음매는 은은하게(기본색과 그림자의 중간), 이음매 아래 한 줄은 밝게 — 반들반들한 장판 느낌
    const seam = mix(F[2], F[1], 0.5);
    for (let y = fy; y < fy + fh; y += 16) { P.r(ox, y, W, 1, seam); P.r(ox, y + 1, W, 1, F[3]); }
    for (let x = ox + 8; x < ox + W; x += 16) P.r(x, fy, 1, fh, seam);
  }
  else if (floor === 'floor-maru' || floor === 'floor-wood') {
    for (let y = fy; y < fy + fh; y += 4) { P.r(ox, y, W, 1, F[1]); const off = Math.floor(rnd() * 24); for (let x = ox + off; x < ox + W; x += 24 + Math.floor(rnd() * 8)) P.r(x, y, 1, 4, F[1]); P.r(ox, y + 1, W, 1, F[3]); }
  } else if (floor === 'floor-mat') {
    for (let y = fy; y < fy + fh; y += 2) P.r(ox, y, W, 1, F[1]);
    for (let y = fy + 6; y < fy + fh; y += 16) for (let x = ox + 6; x < ox + W; x += 16) { P.r(x, y, 4, 2, m.accent); P.r(x + 1, y - 1, 2, 4, m.accent); }
  } else if (floor === 'floor-tile') {
    for (let y = 0; y < fh; y += 8) for (let x = 0; x < W; x += 8) if (((x + y) / 8) % 2) P.r(ox + x, fy + y, 8, 8, '#6f7f96');
  } else if (floor === 'floor-herring') {
    for (let y = 0; y < fh; y += 4) for (let x = 0; x < W; x += 8) { const a = ((x / 8 + y / 4) % 2) ? F[1] : F[3]; P.r(ox + x + (y % 8 ? 4 : 0), fy + y, 4, 4, a); P.r(ox + x + (y % 8 ? 4 : 0), fy + y, 4, 1, F[1]); }
  } else if (floor === 'floor-deck') {
    for (let y = fy; y < fy + fh; y += 16) { P.r(ox, y, W, 1, F[3]); for (let x = ox; x < ox + W; x += 16) { P.r(x, y, 1, 16, F[1]); P.r(x + 2, y + 2, 1, 1, F[0]); P.r(x + 13, y + 13, 1, 1, F[0]); } }
  } else if (floor === 'floor-grid') {
    for (let y = fy; y < fy + fh; y += 8) P.r(ox, y, W, 1, '#3a5a9a');
    for (let x = ox; x < ox + W; x += 8) P.r(x, fy, 1, fh, '#3a5a9a');
    for (let y = fy; y < fy + fh; y += 16) for (let x = ox; x < ox + W; x += 16) P.r(x, y, 1, 1, m.light);
  } else if (floor === 'floor-hex') {
    for (let y = 0; y < fh; y += 6) for (let x = (y / 6) % 2 ? 5 : 0; x < W; x += 10) { P.r(ox + x, fy + y, 6, 1, F[3]); P.r(ox + x, fy + y + 5, 6, 1, F[1]); P.r(ox + x + 6, fy + y + 1, 1, 4, F[1]); }
  }
  // 뒷벽(0줄 + 위로 WALL_TOP)
  const wallBase = { 'wall-mud': '#d9c49c', 'wall-hanji': '#f1e9d2', 'wall-dancheong': '#e6d7b2', 'wall-white': '#efebe3', 'wall-stripe': '#e7d8e6', 'wall-flower': '#e9efe0', 'wall-panel': '#aeb8d2', 'wall-neon': '#2d3459', 'wall-star': '#1b2040' }[wall] ?? '#efebe3';
  const Wl = ramp(wallBase);
  const wy = 0, wh = oy + TILE;
  P.r(ox, wy, W, wh, Wl[2]);
  if (wall === 'wall-mud') { for (let i = 0; i < 40; i++) P.r(ox + Math.floor(rnd() * (W - 2)), Math.floor(rnd() * (wh - 6)), 2, 1, Wl[1]); for (let x = ox; x < ox + W; x += 48) { P.r(x, wy, 3, wh, m.wood); P.r(x, wy, 1, wh, shade(m.wood, 1)); } }
  else if (wall === 'wall-hanji') { for (let y = 4; y < wh - 4; y += 6) P.r(ox, y, W, 1, Wl[1]); for (let x = ox; x < ox + W; x += 6) P.r(x, 0, 1, wh - 4, Wl[1]); }
  else if (wall === 'wall-dancheong') { P.r(ox, 0, W, 7, '#2f7a6a'); for (let x = ox; x < ox + W; x += 8) { P.r(x + 1, 2, 4, 3, '#c0392b'); P.r(x + 2, 3, 2, 1, '#f2d16b'); } P.r(ox, 7, W, 1, '#1d4a40'); }
  else if (wall === 'wall-stripe') { for (let x = ox; x < ox + W; x += 8) P.r(x, 0, 3, wh, '#d6c2dc'); }
  else if (wall === 'wall-flower') { for (let y = 4; y < wh - 6; y += 10) for (let x = ox + ((y / 10) % 2 ? 6 : 1); x < ox + W; x += 12) { P.r(x, y, 2, 2, '#e98aa4'); P.r(x + 2, y + 1, 1, 1, '#4f9a55'); } }
  else if (wall === 'wall-panel') { for (let x = ox; x < ox + W; x += 20) { P.r(x, 0, 1, wh, Wl[0]); P.r(x + 1, 0, 1, wh, Wl[3]); } P.r(ox, 10, W, 1, Wl[1]); }
  else if (wall === 'wall-neon') { P.r(ox, 12, W, 2, m.accent); P.r(ox, 12, W, 1, shade(m.accent, 2)); P.r(ox, 26, W, 1, m.light); }
  else if (wall === 'wall-star') { for (let i = 0; i < 50; i++) P.r(ox + Math.floor(rnd() * W), 2 + Math.floor(rnd() * (wh - 10)), 1, 1, rnd() < 0.3 ? m.light : '#ffffff'); for (let x = ox; x < ox + W; x += 32) P.r(x, 0, 3, wh, '#3a4468'); }
  else { P.r(ox, wh - 10, W, 1, Wl[1]); }
  // 걸레받이 + 벽과 바닥 사이 그림자
  P.r(ox, wh - 3, W, 3, era === 'sf' ? m.dark : shade(m.wood, -1));
  P.r(ox, wh - 3, W, 1, era === 'sf' ? m.light : shade(m.wood, 1));
  P.r(ox, wh, W, 2, 'rgba(12,10,30,.18)');
  // 창문 두 개(시대별: 창호 / 흰 틀 유리창 / 둥근 현창)
  for (const wx of [ox + Math.round(W * 0.22) - 8, ox + Math.round(W * 0.78) - 8]) {
    if (era === 'past') { const [fo, fs] = ramp(m.wood); P.r(wx, 6, 16, 16, fo); P.r(wx + 1, 7, 14, 14, m.paper); for (let x = wx + 3; x < wx + 15; x += 3) P.r(x, 7, 1, 14, fs); P.r(wx + 1, 14, 14, 1, fs); }
    else if (era === 'modern') { P.r(wx, 5, 16, 17, '#ffffff'); P.r(wx + 1, 6, 14, 15, '#9fd2f2'); P.r(wx + 8, 6, 1, 15, '#ffffff'); P.r(wx + 1, 13, 14, 1, '#ffffff'); P.r(wx + 2, 7, 3, 1, '#e0f4ff'); P.r(wx - 1, 21, 18, 2, '#d8d3c8'); }
    else { oval(P, wx + 8, 13, 7, 7, m.metal); oval(P, wx + 8, 13, 5, 5, '#101530'); P.r(wx + 5, 10, 1, 1, '#ffffff'); P.r(wx + 10, 14, 1, 1, m.light); }
  }
  // 옆벽·앞벽(두께) — 셀프컬러 외곽선
  const side = era === 'sf' ? m.dark : era === 'modern' ? '#cfc6b6' : m.wood;
  const S = ramp(side);
  P.r(0, 0, SIDE, cv.height, S[2]); P.r(cv.width - SIDE, 0, SIDE, cv.height, S[1]);
  P.r(0, 0, 1, cv.height, S[0]); P.r(cv.width - 1, 0, 1, cv.height, S[0]); P.r(SIDE - 1, 0, 1, cv.height, S[3]);
  const by = oy + H;
  P.r(0, by, cv.width, FRONT, S[2]); P.r(0, by, cv.width, 1, S[3]); P.r(0, cv.height - 1, cv.width, 1, S[0]);
  // 문(아래 가운데): 앞벽이 트이고 문지방·발판
  const dx = ox + L.door.x * TILE;
  P.r(dx, by, TILE, FRONT, F[1]);
  P.r(dx - 1, by, 1, FRONT, S[0]); P.r(dx + TILE, by, 1, FRONT, S[0]);
  const mat = era === 'past' ? '#b08a4f' : era === 'modern' ? m.accent : m.light;
  P.r(dx + 2, by - 5, TILE - 4, 4, mat); P.r(dx + 2, by - 5, TILE - 4, 1, shade(mat, 1)); P.r(dx + 2, by - 2, TILE - 4, 1, shade(mat, -1));
  return cv;
}
