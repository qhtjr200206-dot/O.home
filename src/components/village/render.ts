'use client';
// 마을 캔버스 그리기 — 지형은 타일 16px 도트로 한 번 그려 두고, 화면에서는 정수 배율로만 확대한다.
// (v2.0 사용자 요청 — "sf·현대·과거에 맞는 건물 도트 추가, 전체 그래픽 개선")
//  · 도트 원칙: 정수 격자, 재질마다 색조 이동 램프(pixelRamp.ts), 순검정 대신 셀프컬러 외곽선, 빛은 왼쪽 위에서.
//  · 건물·나무·가로등은 지면에 굽지 않고 '소품'으로 따로 들고 있다가 캐릭터와 함께 y순으로 그린다 —
//    건물 뒤(위쪽 칸)를 걷는 캐릭터가 건물에 가려져 깊이가 생긴다. 걷기 판정(map.ts)은 바꾸지 않는다.
//  · 밤 조명: 창문·가로등·광장 불빛 자리를 함께 돌려주고, 화면에서 어둠 층을 그 자리만 도려낸다.
// 그림은 전부 이 파일에서 코드로 찍었다(외부 에셋 없음).
import { DEFAULT_PIXEL_AVATAR, type PixelAvatarData } from '@/components/chars/PixelAvatar';
import { pixelAvatarGrid, PIXEL_GRID } from '@/components/chars/pixelAvatarArt';
import { seededRandom, type VillageMap, type VillageEra, type PlaceKind, type VillageTile } from '@/lib/village/map';
import { mix, ramp, shade } from '@/lib/village/pixelRamp';
import type { Phase } from '@/lib/village/sim';

export const TILE = 16;
/** 마을에서 캐릭터 한 명이 차지하는 크기(지형 원본 좌표) — 도트 원본 32칸과 같게 두어 화면 배율이 곧 도트 배율이 된다 (v2.1) */
export const SPRITE_WORLD = 32;

/** 캐릭터와 함께 y순으로 그리는 소품(건물·나무·가로등). x,y는 원본 좌표의 왼쪽 위, sortY는 깊이(타일 행) */
export interface Prop { img: HTMLCanvasElement; x: number; y: number; sortY: number }
/** 밤에 켜지는 불빛. r은 원본 좌표 반지름, color는 'rgba(r,g,b,' 꼴(알파는 그릴 때 붙인다) */
export interface Light { x: number; y: number; r: number; color: string }
export interface VillageScene {
  /** 지면 두 장 — 물결·유도선만 다르다(번갈아 그려 물이 반짝인다) */
  ground: [HTMLCanvasElement, HTMLCanvasElement];
  props: Prop[];
  lights: Light[];
}

type Painter = {
  ctx: CanvasRenderingContext2D;
  r: (x: number, y: number, w: number, h: number, c: string) => void;
  p: (x: number, y: number, c: string) => void;
};
function painter(cv: HTMLCanvasElement): Painter {
  const ctx = cv.getContext('2d')!;
  const r = (x: number, y: number, w: number, h: number, c: string) => { if (w > 0 && h > 0) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); } };
  return { ctx, r, p: (x, y, c) => r(x, y, 1, 1, c) };
}
const canvas = (w: number, h: number) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };

/** 빛이 왼쪽 위에서 오는 상자: 셀프컬러 외곽선 + 위·왼쪽 밝은 면 + 아래·오른쪽 그림자 */
function box(P: Painter, x: number, y: number, w: number, h: number, base: string) {
  const [o, s, m, l] = ramp(base);
  P.r(x, y, w, h, o);
  P.r(x + 1, y + 1, w - 2, h - 2, m);
  P.r(x + 1, y + 1, w - 2, 1, l);
  P.r(x + 1, y + 1, 1, h - 2, l);
  P.r(x + 1, y + h - 2, w - 2, 1, s);
  P.r(x + w - 2, y + 2, 1, h - 3, s);
}
/** 창문 — 틀(셀프컬러) + 유리 + 왼쪽 위 반사 한 점. 밤 불빛 자리를 lights에 넣는다 */
function windowAt(P: Painter, x: number, y: number, w: number, h: number, frame: string, glass: string, lights: Light[] | null, cross = true) {
  const [fo] = ramp(frame);
  const [, gs, gm, gl, gh] = ramp(glass);
  P.r(x, y, w, h, fo);
  P.r(x + 1, y + 1, w - 2, h - 2, gm);
  P.r(x + 1, y + h - 2, w - 2, 1, gs);
  P.r(x + w - 2, y + 1, 1, h - 2, gs);
  P.p(x + 1, y + 1, gh);
  if (w > 4) P.p(x + 2, y + 1, gl);
  if (cross && w >= 6) P.r(x + Math.floor(w / 2), y + 1, 1, h - 2, fo);
  if (cross && h >= 6) P.r(x + 1, y + Math.floor(h / 2), w - 2, 1, fo);
  lights?.push({ x: x + w / 2, y: y + h / 2, r: Math.max(w, h) * 1.6 + 6, color: '' });
}
function door(P: Painter, x: number, y: number, w: number, h: number, base: string, knob = '#e8c35a') {
  const [o, s, m, l] = ramp(base);
  P.r(x, y, w, h, o);
  P.r(x + 1, y + 1, w - 2, h - 1, m);
  P.r(x + 1, y + 1, 1, h - 1, l);
  P.r(x + w - 2, y + 1, 1, h - 1, s);
  P.p(x + w - 3, y + Math.floor(h / 2) + 1, knob);
}

/* ================= 시대별 재질 ================= */
const MAT = {
  past: { plaster: '#e9dfc6', wood: '#7a5134', roof: '#55606f', thatch: '#c9a35a', stone: '#9b9588', paper: '#f3e6c2', red: '#b5453b', green: '#3e8a6c', gold: '#d8b25a' },
  modern: { wall: '#efe7d8', brick: '#b65c43', concrete: '#c7c2b6', glass: '#7db7dc', door: '#7a5a43', roofs: ['#c4544c', '#3f8a8c', '#5b6fae', '#8a6a4f'] },
  sf: { hull: '#d5dcea', panel: '#8d9abb', dark: '#3a4468', cyan: '#5ff2ff', magenta: '#ff5fd2', amber: '#ffb347', glass: '#64d4ff' },
};

/* ================= 건물 도트 =================
 * 모든 건물은 자기 캔버스에 그린다. 바닥선은 맨 아래 줄, 문은 가로 가운데 — 장소 칸(문 칸) 중앙에 맞춰 세운다.
 * 반환: 그림과 불빛(그림 안 좌표). variant는 장소 id에서 정한 0..3 — 같은 종류도 색·소품을 조금씩 바꾼다. */
type Art = { img: HTMLCanvasElement; lights: Light[] };

function hanokRoof(P: Painter, x: number, y: number, w: number, h: number, base: string) {
  // 기와지붕: 용마루 + 기왓골(3칸마다 그림자·빛) + 처마 끝이 위로 들린 곡선
  const [o, s, m, l, hi] = ramp(base);
  for (let i = 0; i < h; i++) {
    const inset = Math.round((h - 1 - i) * 1.6);
    const x0 = x + inset, x1 = x + w - inset;
    P.r(x0, y + i, x1 - x0, 1, m);
    for (let cx = x0 + 1; cx < x1 - 1; cx++) {
      const k = (cx - x) % 3;
      if (k === 0) P.p(cx, y + i, s); else if (k === 1 && i % 2 === 0) P.p(cx, y + i, l);
    }
    P.p(x0, y + i, o); P.p(x1 - 1, y + i, o);
  }
  const top = Math.round((h - 1) * 1.6);
  P.r(x + top - 2, y - 2, w - 2 * top + 4, 2, o);
  P.r(x + top - 1, y - 1, w - 2 * top + 2, 1, hi);
  P.r(x + top - 4, y - 3, 3, 2, o); P.r(x + w - top + 1, y - 3, 3, 2, o);
  P.r(x, y + h, w, 1, o);
  P.r(x + 1, y + h - 1, w - 2, 1, l);
  P.r(x - 2, y + h - 2, 3, 2, o); P.r(x + w - 1, y + h - 2, 3, 2, o);
  P.p(x - 3, y + h - 3, o); P.p(x + w + 2, y + h - 3, o);
}
function thatchRoof(P: Painter, x: number, y: number, w: number, h: number, base: string, rnd: () => number) {
  // 초가지붕: 둥근 짚더미. 왼쪽 위가 밝고, 짚결 무늬와 새끼줄 두 줄
  const [o, s, m, l, hi] = ramp(base);
  for (let i = 0; i < h; i++) {
    const f = Math.sqrt(1 - Math.pow((h - 1 - i) / h, 2) * 0.85);
    const half = Math.round((w / 2) * f);
    const cx = Math.round(x + w / 2);
    P.r(cx - half, y + i, half * 2, 1, m);
    for (let px = cx - half + 1; px < cx + half - 1; px++) {
      const u = (px - (cx - half)) / (half * 2);
      const v = rnd();
      if (u < 0.35 && i < h * 0.6 && v < 0.35) P.p(px, y + i, l);
      else if (u > 0.7 && v < 0.4) P.p(px, y + i, s);
      else if (v < 0.12) P.p(px, y + i, (px + i) % 2 ? s : l);
    }
    P.p(cx - half, y + i, o); P.p(cx + half - 1, y + i, o);
    if (i === 0) P.r(cx - half, y, half * 2, 1, o);
  }
  P.r(x + 8, y + 2, 6, 1, hi); P.r(x + 6, y + 4, 4, 1, hi);
  for (const ry of [Math.round(h * 0.45), Math.round(h * 0.75)]) for (let px = x + 3; px < x + w - 3; px += 2) P.p(px, y + ry, s);
  P.r(x, y + h, w, 1, o);
  P.r(x + 1, y + h - 1, w - 2, 1, s);
}
function gableRoof(P: Painter, cx: number, y: number, h: number, base: string) {
  // 박공지붕(현대 주택): 왼쪽 경사는 빛을 받아 밝고 오른쪽은 그늘. 3줄마다 기와 줄눈
  const [o, s, m, l, hi] = ramp(base);
  for (let i = 0; i < h; i++) {
    const half = 3 + Math.round(i * 1.25);
    P.r(cx - half, y + i, half, 1, l);
    P.r(cx, y + i, half, 1, m);
    if (i % 3 === 2) { for (let x = cx - half + 1; x < cx + half - 1; x += 2) P.p(x, y + i, x < cx ? m : s); }
    P.p(cx - half, y + i, o); P.p(cx + half - 1, y + i, o);
  }
  P.r(cx - 3, y - 1, 6, 1, o);
  P.r(cx - 2, y, 2, 1, hi);
  const half = 3 + Math.round((h - 1) * 1.25);
  P.r(cx - half - 1, y + h, half * 2 + 2, 1, o);
  P.r(cx - half, y + h - 1, half * 2, 1, s);
}
function dome(P: Painter, cx: number, cy: number, rad: number, base: string) {
  // 반구(돔): 가로 위치로 명암 — 왼쪽 위 하이라이트, 오른쪽 그늘, 셀프컬러 외곽선
  const [o, s, m, l, hi] = ramp(base);
  for (let yy = cy - rad; yy <= cy; yy++) {
    const half = Math.round(Math.sqrt(Math.max(0, rad * rad - (cy - yy) * (cy - yy))));
    for (let xx = cx - half; xx < cx + half; xx++) {
      const u = (xx - (cx - half)) / Math.max(1, half * 2);
      const v = (yy - (cy - rad)) / rad;
      P.p(xx, yy, u < 0.25 && v < 0.6 ? l : u > 0.72 ? s : m);
    }
    P.p(cx - half, yy, o); P.p(cx + half - 1, yy, o);
  }
  P.r(cx - 3, cy - rad, 6, 1, o);
  P.r(cx - Math.round(rad * 0.55), cy - Math.round(rad * 0.6), 3, 2, hi);
}
/** 창호(격자무늬 종이창) */
function lattice(P: Painter, x: number, y: number, w: number, h: number, frame: string, paper: string, lights: Light[]) {
  const [fo, fs] = ramp(frame);
  P.r(x, y, w, h, fo);
  P.r(x + 1, y + 1, w - 2, h - 2, paper);
  for (let px = x + 2; px < x + w - 1; px += 2) P.r(px, y + 1, 1, h - 2, fs);
  P.r(x + 1, y + Math.floor(h / 2), w - 2, 1, fs);
  P.p(x + 1, y + 1, shade(paper, 1));
  lights.push({ x: x + w / 2, y: y + h / 2, r: Math.max(w, h) * 1.6 + 6, color: '' });
}

function artPast(kind: PlaceKind, v: number, rnd: () => number): Art {
  const M = MAT.past, L: Light[] = [];
  if (kind === 'house') {
    // 초가집: 돌기초 + 흙벽에 나무 기둥 + 창호지 창 + 둥근 초가지붕
    const cv = canvas(48, 40), P = painter(cv);
    box(P, 5, 33, 38, 7, M.stone);
    for (let x = 7; x < 41; x += 5) P.p(x, 36 + (x % 2), shade(M.stone, -1));
    box(P, 8, 19, 32, 15, M.plaster);
    for (const x of [8, 19, 29, 38]) box(P, x, 19, 2, 15, M.wood);
    box(P, 8, 19, 32, 2, M.wood);
    lattice(P, 11, 23, 7, 7, M.wood, M.paper, L);
    door(P, 21, 22, 7, 12, M.wood);
    lattice(P, 31, 23, 6, 7, M.wood, M.paper, L);
    thatchRoof(P, 1, 3, 46, 16, v % 2 ? M.thatch : '#bf9a55', rnd);
    if (v > 1) { box(P, 41, 27, 6, 7, '#6a4a3a'); P.r(42, 26, 4, 1, '#8a6a5a'); }   // 장독
    return { img: cv, lights: L };
  }
  if (kind === 'shop') {
    // 주막: 기와지붕, 처마 밑 초롱, 평상, 오른쪽에 '酒' 깃발
    const cv = canvas(48, 44), P = painter(cv);
    box(P, 4, 38, 40, 6, M.stone);
    box(P, 6, 22, 34, 17, M.plaster);
    for (const x of [6, 17, 28, 38]) box(P, x, 22, 2, 17, M.red);
    lattice(P, 9, 26, 7, 8, M.wood, M.paper, L);
    door(P, 19, 25, 8, 14, M.wood);
    lattice(P, 30, 26, 7, 8, M.wood, M.paper, L);
    hanokRoof(P, 3, 10, 40, 11, M.roof);
    P.r(3, 21, 40, 1, M.green);
    for (const x of [11, 34]) { P.r(x, 22, 1, 2, shade(M.wood, -2)); box(P, x - 2, 24, 5, 6, M.red); P.r(x - 1, 25, 1, 3, shade(M.red, 2)); L.push({ x: x + 0.5, y: 27, r: 12, color: 'rgba(255,150,90,' }); }
    box(P, 4, 34, 14, 4, M.wood);                       // 평상
    P.r(44, 6, 2, 38, shade(M.wood, -1)); P.r(44, 6, 1, 38, shade(M.wood, 1));
    box(P, 37, 7, 8, 12, '#f2ead8'); P.r(39, 10, 4, 1, M.red); P.r(40, 9, 1, 7, M.red); P.r(39, 13, 5, 1, M.red); P.p(42, 15, M.red);
    return { img: cv, lights: L };
  }
  if (kind === 'school') {
    // 서당: 높은 기단 위 마루와 난간, 처마 아래 현판, 큰 기와지붕
    const cv = canvas(52, 48), P = painter(cv);
    box(P, 2, 40, 48, 8, M.stone);
    for (let x = 5; x < 48; x += 6) P.r(x, 42, 1, 4, shade(M.stone, -1));
    box(P, 5, 22, 42, 19, M.plaster);
    for (const x of [5, 15, 25, 35, 45]) box(P, x, 22, 2, 19, M.wood);
    for (const x of [8, 37]) lattice(P, x, 26, 7, 8, M.wood, M.paper, L);
    door(P, 19, 27, 6, 13, M.wood); door(P, 27, 27, 6, 13, M.wood);
    box(P, 3, 36, 46, 2, M.wood);                       // 마루 난간
    for (let x = 6; x < 47; x += 4) P.r(x, 34, 1, 2, M.wood);
    hanokRoof(P, 1, 8, 50, 13, M.roof);
    P.r(1, 21, 50, 1, M.green); for (let x = 3; x < 50; x += 4) P.p(x, 21, M.red);
    box(P, 19, 15, 14, 6, '#3a2f2a'); for (let x = 22; x < 31; x += 3) P.r(x, 17, 2, 2, M.gold);   // 현판
    return { img: cv, lights: L };
  }
  if (kind === 'tower') {
    // 누각·탑: 3층 기와지붕, 붉은 기둥과 단청(초록 띠 + 금점)
    const cv = canvas(48, 68), P = painter(cv);
    box(P, 6, 60, 36, 8, M.stone);
    const tiers: [number, number, number][] = [[46, 36, 10], [26, 30, 9], [8, 22, 8]];
    tiers.forEach(([ty, w, h], i) => {
      const x = 24 - w / 2;
      const bottom = i === 0 ? 60 : tiers[i - 1][0] - 2;
      box(P, x + 3, ty + h + 1, w - 6, bottom - (ty + h + 1), i === 0 ? M.plaster : M.wood);
      for (let px = x + 3; px < x + w - 4; px += Math.max(5, Math.floor((w - 6) / 3))) box(P, px, ty + h + 1, 2, bottom - (ty + h + 1), M.red);
      hanokRoof(P, x, ty, w, h, M.roof);
      P.r(x, ty + h + 1, w, 1, M.green);
      for (let px = x + 2; px < x + w; px += 3) P.p(px, ty + h + 1, M.gold);
    });
    door(P, 20, 52, 8, 8, M.red);
    lattice(P, 11, 54, 6, 5, M.wood, M.paper, L); lattice(P, 31, 54, 6, 5, M.wood, M.paper, L);
    P.r(23, 0, 2, 6, M.gold); P.p(23, 0, shade(M.gold, 2));
    return { img: cv, lights: L };
  }
  return featureArt('past', kind, rnd);
}

function artModern(kind: PlaceKind, v: number, rnd: () => number): Art {
  const M = MAT.modern, L: Light[] = [];
  const roof = M.roofs[v % M.roofs.length];
  if (kind === 'house') {
    // 주택: 박공지붕 + 굴뚝, 하얀 틀 창문 두 개, 나무 문, 창가 화분
    const cv = canvas(46, 44), P = painter(cv);
    box(P, 31, 6, 6, 10, M.brick);
    box(P, 5, 21, 36, 23, v === 3 ? '#e8d8bf' : M.wall);
    P.r(6, 22, 34, 1, shade(M.wall, -1));
    gableRoof(P, 23, 4, 17, roof);
    windowAt(P, 9, 26, 9, 8, '#ffffff', M.glass, L);
    windowAt(P, 28, 26, 9, 8, '#ffffff', M.glass, L);
    box(P, 8, 34, 11, 3, M.brick); P.r(10, 33, 2, 1, '#e36b8d'); P.r(14, 33, 2, 1, '#ffd166'); P.p(12, 32, '#4f9a55');
    door(P, 20, 31, 7, 13, M.door);
    P.r(19, 43, 9, 1, shade(M.concrete, -1));
    return { img: cv, lights: L };
  }
  if (kind === 'shop') {
    // 가게·카페: 납작 지붕 난간, 간판, 줄무늬 차양(물결 끝), 통유리 진열창과 유리문
    const cv = canvas(48, 42), P = painter(cv);
    box(P, 3, 12, 42, 30, v % 2 ? '#f1e4cf' : '#e6ecef');
    box(P, 1, 9, 46, 5, M.concrete);
    const sign = ['#2f6fb0', '#2f8a5a', '#8a3f7a', '#c4544c'][v % 4];
    box(P, 9, 14, 30, 7, sign);
    for (let x = 12; x < 36; x += 3) P.r(x, 16, 2, 3, shade(sign, 3));
    L.push({ x: 24, y: 17, r: 18, color: '' });
    const aw = ['#de5a50', '#3f8a8c', '#e0a43a', '#5b6fae'][v % 4];
    for (let x = 3; x < 45; x++) {
      const on = Math.floor((x - 3) / 4) % 2 === 0;
      P.r(x, 22, 1, 4, on ? aw : '#f7f1e6');
      if (on) P.p(x, 22, shade(aw, 1));
      if ((x - 3) % 4 < 2) P.p(x, 26, on ? shade(aw, -1) : '#e2d9c8');
    }
    P.r(3, 21, 42, 1, ramp(aw)[0]);
    windowAt(P, 5, 28, 17, 11, '#5a6170', M.glass, L, false);
    for (let i = 0; i < 6; i++) P.p(8 + i, 37 - i, shade(M.glass, 2));
    P.r(7, 36, 4, 2, '#ffd166'); P.r(13, 35, 3, 3, '#e36b8d');
    door(P, 26, 28, 10, 14, '#5a6170'); P.r(27, 29, 8, 12, M.glass); P.r(30, 29, 1, 12, '#5a6170'); P.p(28, 30, shade(M.glass, 2));
    box(P, 38, 30, 5, 9, '#5f8f4f'); P.r(39, 29, 3, 2, '#7cb86a');
    return { img: cv, lights: L };
  }
  if (kind === 'school') {
    // 학교: 붉은 벽돌 본관(줄눈), 가운데 시계탑, 깃대, 창문 두 줄, 양문
    const cv = canvas(52, 52), P = painter(cv);
    box(P, 2, 20, 48, 32, M.brick);
    for (let y = 23; y < 50; y += 3) for (let x = 4 + ((y / 3) % 2) * 2; x < 48; x += 5) P.p(x, y, shade(M.brick, -1));
    box(P, 0, 17, 52, 4, M.concrete);
    box(P, 18, 6, 16, 13, '#e6dfd2');
    gableRoof(P, 26, 1, 5, '#4f5d7a');
    P.r(22, 8, 8, 8, ramp('#e6dfd2')[0]); P.r(23, 9, 6, 6, '#ffffff'); P.r(25, 10, 1, 3, '#33363f'); P.r(25, 12, 3, 1, '#33363f'); P.p(23, 9, '#f4f4ea');
    P.r(44, 3, 1, 15, '#8d96a3'); box(P, 45, 3, 7, 5, '#de5a50'); P.r(46, 4, 2, 1, '#f7f1e6');
    for (const y of [24, 35]) for (const x of [5, 13, 33, 41]) windowAt(P, x, y, 7, 7, '#f1ece2', M.glass, L);
    box(P, 19, 37, 14, 15, M.concrete);
    door(P, 21, 39, 5, 13, '#5a6170'); door(P, 26, 39, 5, 13, '#5a6170');
    windowAt(P, 22, 24, 8, 8, '#f1ece2', M.glass, L);
    return { img: cv, lights: L };
  }
  if (kind === 'tower') {
    // 빌딩: 유리 커튼월 격자, 대각 반사띠, 옥상 난간과 안테나(빨간 경고등), 1층 캐노피
    const cv = canvas(40, 74), P = painter(cv);
    const body = v % 2 ? '#5d7896' : '#6a7f8f';
    box(P, 4, 10, 32, 64, body);
    const [, gs, gm, gl] = ramp(M.glass);
    for (let y = 13; y < 58; y += 5) for (let x = 7; x < 33; x += 6) {
      P.r(x, y, 4, 3, gm); P.r(x, y + 2, 4, 1, gs); P.p(x, y, gl);
      if (rnd() < 0.55) L.push({ x: x + 2, y: y + 1.5, r: 7, color: '' });
    }
    for (let i = 0; i < 40; i++) { const y = 56 - i, x = 6 + Math.floor(i * 0.7); if (x < 34 && y > 11) P.p(x, y, shade(M.glass, 2)); }
    box(P, 2, 7, 36, 4, M.concrete);
    P.r(27, 0, 1, 7, '#8d96a3'); P.p(27, 0, '#ff4d4d'); L.push({ x: 27.5, y: 0.5, r: 6, color: 'rgba(255,80,80,' });
    box(P, 10, 58, 20, 3, M.concrete);
    door(P, 14, 61, 12, 13, '#3d4552'); P.r(15, 62, 10, 12, M.glass); P.r(20, 62, 1, 12, '#3d4552');
    L.push({ x: 20, y: 66, r: 14, color: '' });
    return { img: cv, lights: L };
  }
  return featureArt('modern', kind, rnd);
}

function artSf(kind: PlaceKind, v: number, rnd: () => number): Art {
  const M = MAT.sf, L: Light[] = [];
  const neon = v % 2 ? M.cyan : M.magenta;
  const neonLight = v % 2 ? 'rgba(110,240,255,' : 'rgba(255,110,220,';
  if (kind === 'house') {
    // 거주 돔: 하부 링, 반구 선체와 이음매, 빛나는 창 띠, 해치, 작은 안테나
    const cv = canvas(48, 38), P = painter(cv);
    box(P, 3, 29, 42, 9, M.panel);
    for (let x = 7; x < 42; x += 6) P.r(x, 31, 1, 5, shade(M.panel, -1));
    dome(P, 24, 30, 19, M.hull);
    for (const x of [15, 33]) for (let y = 16; y < 30; y++) if ((x - 24) ** 2 + (30 - y) ** 2 < 17 * 17) P.p(x, y, shade(M.hull, -1));
    P.r(8, 21, 32, 3, ramp(M.glass)[0]); P.r(9, 22, 30, 1, M.glass); P.r(10, 22, 6, 1, shade(M.glass, 2));
    L.push({ x: 16, y: 22, r: 14, color: 'rgba(110,230,255,' }, { x: 32, y: 22, r: 14, color: 'rgba(110,230,255,' });
    box(P, 19, 27, 10, 11, M.dark); P.r(21, 29, 6, 1, neon); P.r(23, 30, 2, 7, shade(M.dark, -1));
    L.push({ x: 24, y: 30, r: 10, color: neonLight });
    P.r(35, 6, 1, 7, M.panel); P.r(33, 6, 5, 1, M.panel); P.p(35, 5, M.amber);
    return { img: cv, lights: L };
  }
  if (kind === 'shop') {
    // 네온 상점: 어두운 함체, 지붕 패널, 홀로그램 간판, 빛나는 판매창, 바닥 네온선
    const cv = canvas(48, 44), P = painter(cv);
    box(P, 4, 15, 40, 29, M.dark);
    box(P, 2, 11, 44, 5, M.panel);
    P.r(3, 16, 42, 1, neon);
    const [no] = ramp(neon);
    P.r(8, 1, 32, 9, no); P.r(9, 2, 30, 7, shade(M.dark, -1));
    for (let x = 11; x < 37; x += 4) { P.r(x, 3, 2, 5, neon); if (rnd() < 0.5) P.p(x + 2, 5, shade(neon, 2)); }
    L.push({ x: 24, y: 5, r: 22, color: neonLight });
    P.r(8, 22, 20, 9, ramp(M.glass)[0]); P.r(9, 23, 18, 7, M.glass); P.r(9, 23, 18, 1, shade(M.glass, 2));
    for (let x = 10; x < 26; x += 4) P.r(x, 26, 2, 3, shade(M.glass, -2));
    L.push({ x: 18, y: 26, r: 16, color: 'rgba(110,220,255,' });
    box(P, 31, 24, 9, 20, shade(M.dark, -1)); P.r(32, 25, 7, 1, M.amber);
    P.r(4, 43, 40, 1, neon);
    return { img: cv, lights: L };
  }
  if (kind === 'school') {
    // 아카데미: 두 단 각진 선체, 지붕 지느러미, 빛나는 띠, 세로 슬릿 창, 빛 테두리 입구
    const cv = canvas(52, 52), P = painter(cv);
    box(P, 2, 22, 48, 30, M.hull);
    box(P, 9, 11, 34, 12, M.panel);
    for (let i = 0; i < 9; i++) { P.r(9 + i, 11 - i, 1, i + 1, i < 2 ? ramp(M.panel)[0] : shade(M.panel, 1)); P.r(42 - i, 11 - i, 1, i + 1, i < 2 ? ramp(M.panel)[0] : shade(M.panel, -1)); }
    P.r(2, 26, 48, 2, M.cyan); P.r(2, 26, 48, 1, shade(M.cyan, 2));
    L.push({ x: 12, y: 27, r: 14, color: 'rgba(110,240,255,' }, { x: 40, y: 27, r: 14, color: 'rgba(110,240,255,' });
    for (const x of [6, 11, 37, 42]) windowAt(P, x, 31, 4, 12, M.dark, M.glass, L, false);
    for (const x of [14, 34]) windowAt(P, x, 14, 4, 6, M.dark, M.glass, L, false);
    box(P, 18, 32, 16, 20, M.dark);
    P.r(19, 33, 14, 1, M.cyan); P.r(19, 33, 1, 19, M.cyan); P.r(32, 33, 1, 19, shade(M.cyan, -1));
    P.r(22, 37, 8, 15, shade(M.dark, -1));
    return { img: cv, lights: L };
  }
  if (kind === 'tower') {
    // 관제탑: 넓은 기단, 가는 기둥, 위쪽 관측 포드(창 띠), 꼭대기 표지등
    const cv = canvas(40, 78), P = painter(cv);
    box(P, 5, 56, 30, 22, M.panel);
    P.r(6, 62, 28, 1, neon);
    box(P, 15, 18, 10, 40, M.hull);
    for (let y = 22; y < 56; y += 6) P.r(16, y, 8, 1, shade(M.hull, -1));
    box(P, 4, 7, 32, 12, M.dark);
    P.r(5, 11, 30, 3, M.glass); P.r(5, 11, 30, 1, shade(M.glass, 2));
    L.push({ x: 12, y: 12, r: 14, color: 'rgba(110,220,255,' }, { x: 28, y: 12, r: 14, color: 'rgba(110,220,255,' });
    box(P, 8, 4, 24, 4, M.panel);
    P.r(19, 0, 2, 4, M.panel); P.r(19, 0, 2, 1, M.amber);
    L.push({ x: 20, y: 0.5, r: 10, color: 'rgba(255,180,80,' });
    box(P, 15, 66, 10, 12, M.dark); P.r(16, 67, 8, 1, M.cyan);
    return { img: cv, lights: L };
  }
  return featureArt('sf', kind, rnd);
}

/** 건물이 아닌 장소(물가·숲·밭)의 표지 소품 */
function featureArt(era: VillageEra, kind: PlaceKind, rnd: () => number): Art {
  const L: Light[] = [];
  if (kind === 'water') {
    if (era === 'past') {
      // 우물: 돌 둘레, 나무 지붕틀과 두레박
      const cv = canvas(26, 28), P = painter(cv);
      box(P, 4, 17, 18, 10, MAT.past.stone);
      for (let x = 6; x < 20; x += 4) P.r(x, 20, 1, 5, shade(MAT.past.stone, -1));
      P.r(6, 17, 14, 2, '#2c4f73'); P.r(7, 17, 4, 1, '#5c9cc4');
      box(P, 4, 6, 2, 12, MAT.past.wood); box(P, 20, 6, 2, 12, MAT.past.wood);
      hanokRoof(P, 4, 4, 18, 3, MAT.past.roof);
      P.r(12, 8, 1, 5, '#6b4a2f'); box(P, 10, 12, 5, 4, MAT.past.wood);
      return { img: cv, lights: L };
    }
    if (era === 'modern') {
      // 분수: 둥근 돌 수반, 가운데 기둥과 물줄기
      const cv = canvas(28, 24), P = painter(cv);
      box(P, 2, 14, 24, 9, '#c9c4b8');
      P.r(4, 15, 20, 3, '#3f86c4'); P.r(5, 15, 6, 1, '#9fd2f2');
      box(P, 12, 6, 4, 9, '#d8d3c8');
      for (const [x, y] of [[13, 1], [12, 2], [15, 2], [10, 4], [17, 4], [9, 7], [18, 7]]) P.p(x, y, '#bfe6ff');
      P.r(13, 3, 2, 3, '#9fd2f2');
      L.push({ x: 14, y: 12, r: 14, color: 'rgba(150,210,255,' });
      return { img: cv, lights: L };
    }
    // SF: 냉각수 펌프 — 금속 테두리 수조와 빛나는 코어 기둥
    const cv = canvas(28, 28), P = painter(cv);
    box(P, 2, 17, 24, 10, MAT.sf.panel);
    P.r(4, 18, 20, 3, '#22c4b8'); P.r(5, 18, 8, 1, '#a6fff5');
    box(P, 10, 3, 8, 15, MAT.sf.dark);
    P.r(12, 5, 4, 11, MAT.sf.cyan); P.r(12, 5, 1, 11, shade(MAT.sf.cyan, 2));
    L.push({ x: 14, y: 10, r: 18, color: 'rgba(90,255,230,' });
    return { img: cv, lights: L };
  }
  if (kind === 'forest') {
    // 숲: 큰 나무(과거 금줄 두른 당산나무·현대 벤치 옆 참나무) / SF 거대 수정
    const cv = canvas(40, 44), P = painter(cv);
    if (era === 'sf') {
      crystal(P, 20, 43, 30, MAT.sf.magenta); crystal(P, 10, 43, 18, '#9b6be0'); crystal(P, 31, 43, 20, MAT.sf.cyan);
      L.push({ x: 20, y: 26, r: 22, color: 'rgba(255,110,220,' });
      return { img: cv, lights: L };
    }
    const leaf = era === 'past' ? '#3f7a45' : '#4a8f4a';
    const K = ramp('#6b4a2f');
    P.r(17, 26, 6, 18, K[0]); P.r(18, 26, 4, 18, K[2]); P.r(18, 26, 1, 18, K[3]);
    P.r(14, 41, 12, 3, K[0]);
    blob(P, 20, 16, 18, 14, leaf, rnd);
    blob(P, 9, 22, 9, 7, leaf, rnd); blob(P, 31, 22, 9, 7, leaf, rnd);
    if (era === 'past') { P.r(16, 31, 8, 1, '#c9a35a'); for (let x = 16; x < 24; x += 2) P.r(x, 32, 1, 3, x % 4 ? '#e9dfc6' : '#b5453b'); }
    else { box(P, 26, 37, 12, 3, '#9a6b45'); P.r(27, 40, 1, 3, '#5a3d2a'); P.r(36, 40, 1, 3, '#5a3d2a'); }
    return { img: cv, lights: L };
  }
  // 밭: 과거 허수아비 / 현대 비닐하우스 / SF 수경 재배 돔
  if (era === 'past') {
    const cv = canvas(20, 28), P = painter(cv);
    P.r(9, 8, 2, 20, '#6b4a2f'); P.r(2, 12, 16, 2, '#6b4a2f');
    box(P, 5, 13, 10, 8, '#b5453b'); P.r(6, 14, 2, 6, shade('#b5453b', 1));
    box(P, 6, 3, 8, 7, '#e9d9a8'); P.p(8, 6, '#3a2f2a'); P.p(11, 6, '#3a2f2a');
    thatchRoof(P, 3, 0, 14, 3, '#c9a35a', rnd);
    return { img: cv, lights: L };
  }
  if (era === 'modern') {
    const cv = canvas(36, 26), P = painter(cv);
    const [go, gs, gm, gl] = ramp('#d7e9ec');
    for (let i = 0; i < 18; i++) {
      const half = Math.round(16 * Math.sqrt(1 - ((17 - i) / 18) ** 2));
      P.r(18 - half, 6 + i, half * 2, 1, i < 4 ? gl : gm);
      P.p(18 - half, 6 + i, go); P.p(18 + half - 1, 6 + i, go);
      P.r(18 + Math.round(half * 0.4), 6 + i, Math.round(half * 0.6), 1, gs);
    }
    for (let x = 8; x < 30; x += 5) P.r(x, 8, 1, 16, go);
    for (let x = 5; x < 32; x += 3) P.r(x, 20, 2, 3, '#5f9f55');
    P.r(1, 24, 34, 2, '#8fa6ad');
    return { img: cv, lights: L };
  }
  const cv = canvas(36, 26), P = painter(cv);
  for (const cx of [9, 27]) { dome(P, cx, 21, 8, '#9fe8d8'); for (let x = cx - 5; x < cx + 5; x += 2) P.r(x, 16, 1, 5, '#4ad27a'); }
  box(P, 1, 21, 34, 5, MAT.sf.panel);
  L.push({ x: 9, y: 17, r: 12, color: 'rgba(120,255,180,' }, { x: 27, y: 17, r: 12, color: 'rgba(120,255,180,' });
  return { img: cv, lights: L };
}
function blob(P: Painter, cx: number, cy: number, rw: number, rh: number, base: string, rnd: () => number) {
  // 둥근 수관: 셀프컬러 외곽선, 왼쪽 위 밝은 잎 덩어리, 아래 오른쪽 그늘
  const [o, s, m, l, hi] = ramp(base);
  for (let y = -rh; y <= rh; y++) for (let x = -rw; x <= rw; x++) {
    const d = (x * x) / (rw * rw) + (y * y) / (rh * rh);
    if (d > 1) continue;
    const edge = (x * x) / ((rw - 1) ** 2) + (y * y) / ((rh - 1) ** 2) > 1;
    const lit = (x + rw * 0.35) ** 2 / (rw * rw) + (y + rh * 0.35) ** 2 / (rh * rh) < 0.22;
    const dark = x / rw + y / rh > 0.55;
    P.p(cx + x, cy + y, edge ? o : lit ? (rnd() < 0.2 ? hi : l) : dark ? (rnd() < 0.25 ? m : s) : rnd() < 0.12 ? l : m);
  }
}
function crystal(P: Painter, cx: number, bottom: number, h: number, base: string) {
  // 수정 기둥: 왼쪽 면 밝게, 오른쪽 면 어둡게, 꼭짓점 하이라이트
  const [o, s, m, l, hi] = ramp(base);
  const w = Math.max(2, Math.round(h / 5));
  for (let i = 0; i < h; i++) {
    const half = i < w * 2 ? Math.ceil(i / 2) : w;
    const y = bottom - h + i;
    if (half <= 0) { P.p(cx, y, o); continue; }
    P.r(cx - half, y, half, 1, l); P.r(cx, y, half, 1, s);
    P.p(cx, y, m);
    P.p(cx - half - 1, y, o); P.p(cx + half, y, o);
  }
  P.p(cx - 1, bottom - h + 3, hi);
}

/* ================= 지형 ================= */
type Terrain = { grass: string; path: string; plaza: string; water: string; trunk: string; rock: string; flowers: string[]; crop: string; soil: string };
const TERRAIN: Record<VillageEra, Terrain> = {
  past: { grass: '#7aa95a', path: '#c3a06b', plaza: '#b7ad98', water: '#4b8fba', trunk: '#6b4a2f', rock: '#8f8a80', flowers: ['#f2d16b', '#e98aa4', '#f4f1e6'], crop: '#8fb84e', soil: '#8a6a45' },
  modern: { grass: '#84b961', path: '#c6c1b5', plaza: '#d7c6ab', water: '#4a96d2', trunk: '#71523a', rock: '#9095a0', flowers: ['#ffffff', '#f39bb5', '#ffd166'], crop: '#76b84f', soil: '#7d5e43' },
  sf: { grass: '#29335f', path: '#46527f', plaza: '#4c5890', water: '#1fbdb2', trunk: '#4a3d73', rock: '#5d6680', flowers: ['#ff7ad9', '#7affd1', '#b48cff'], crop: '#4ad27a', soil: '#2a3050' },
};
const isGrassy = (t: VillageTile | undefined) => t === 'grass' || t === 'flower' || t === 'tree' || t === 'rock';

/** 칸 모서리 값 잡음(시드 고정) — 풀색이 바둑판 대신 큰 얼룩으로 바뀌게 */
function valueNoise(seed: string, w: number, h: number, cell: number) {
  const r = seededRandom(`noise|${seed}`);
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => r());
  return (x: number, y: number) => {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const at = (a: number, b: number) => g[Math.min(gh - 1, b) * gw + Math.min(gw - 1, a)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
}

function drawGround(map: VillageMap, seed: string, frame: number, fieldNear: Set<string>, covered: Set<string>): HTMLCanvasElement {
  const W = map.width * TILE, H = map.height * TILE;
  const cv = canvas(W, H), P = painter(cv);
  const T = TERRAIN[map.era];
  const G = ramp(T.grass), D = ramp(T.path), Z = ramp(T.plaza), Wt = ramp(T.water);
  const noise = valueNoise(seed, W, H, 40);
  // 같은 시드 → 두 프레임이 물결 말고는 똑같도록 난수열을 프레임과 무관하게 쓴다
  const rnd = seededRandom(`ground|${seed}`);
  const tile = (x: number, y: number) => map.tiles[y]?.[x];
  // 1) 풀 바탕 — 큰 얼룩 세 톤(그림자 쪽은 파랗게, 밝은 쪽은 노랗게)
  const lo = mix(G[2], G[1], 0.55), hi = mix(G[2], G[3], 0.45);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = noise(x, y);
    P.p(x, y, n < 0.36 ? lo : n > 0.66 ? hi : G[2]);
  }
  for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
    const X = tx * TILE, Y = ty * TILE;
    // 풀포기('^' 모양, 꼭대기 밝은 점) + 드문 하이라이트 — 모든 칸에 같은 수만큼 난수를 써서 배치가 프레임마다 같다
    const tufts = [0, 1, 2].map(() => [X + 1 + Math.floor(rnd() * 13), Y + 2 + Math.floor(rnd() * 12)]);
    const spark = [rnd(), X + Math.floor(rnd() * 16), Y + Math.floor(rnd() * 16), rnd()];
    if (!isGrassy(tile(tx, ty))) continue;
    for (const [gx, gy] of tufts) { P.p(gx, gy, G[1]); P.p(gx + 2, gy, G[1]); P.p(gx + 1, gy - 1, G[1]); P.p(gx + 1, gy - 2, G[3]); }
    if (spark[0] < 0.35) P.p(spark[1], spark[2], G[4]);
    if (map.era === 'sf' && spark[3] < 0.2) P.p(X + (spark[2] - Y), Y + (spark[1] - X), spark[3] < 0.1 ? '#6fe3ff' : '#c08cff');
  }
  // 2) 타일별
  for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
    const t = tile(tx, ty), X = tx * TILE, Y = ty * TILE;
    const up = tile(tx, ty - 1), dn = tile(tx, ty + 1), lf = tile(tx - 1, ty), rt = tile(tx + 1, ty);
    const tr = seededRandom(`t|${seed}|${tx}|${ty}`);
    if (t === 'path') {
      if (map.era === 'past') {
        // 다진 흙길: 두 톤 얼룩 + 자갈(위쪽 밝은 점)
        P.r(X, Y, TILE, TILE, D[2]);
        for (let i = 0; i < 6; i++) P.r(X + Math.floor(tr() * 15), Y + Math.floor(tr() * 15), 2, 1, tr() < 0.5 ? D[1] : D[3]);
        for (let i = 0; i < 2; i++) { const px = X + 1 + Math.floor(tr() * 13), py = Y + 2 + Math.floor(tr() * 12); P.p(px, py, D[0]); P.p(px, py - 1, D[4]); }
      } else if (map.era === 'modern') {
        // 보도블록: 8px 판석을 엇갈려 깔고, 줄눈은 그림자색, 판 왼쪽 위 모서리 밝게
        P.r(X, Y, TILE, TILE, D[2]);
        for (let by = 0; by < 2; by++) {
          P.r(X, Y + by * 8, TILE, 1, D[1]);
          for (let bx = 0; bx < 2; bx++) {
            const x0 = X + bx * 8 + (by % 2 ? 4 : 0);
            P.r(x0, Y + by * 8, 1, 8, D[1]);
            P.p(x0 + 1, Y + by * 8 + 1, D[3]);
          }
        }
        if (tr() < 0.25) P.p(X + 3 + Math.floor(tr() * 10), Y + 3 + Math.floor(tr() * 10), D[0]);
      } else {
        // 금속 갑판: 판 이음매·리벳 + 가운데 빛나는 유도선(프레임마다 밝기가 바뀌어 흐르는 듯)
        P.r(X, Y, TILE, TILE, D[2]);
        P.r(X, Y, TILE, 1, D[3]); P.r(X, Y, 1, TILE, D[3]); P.r(X, Y + TILE - 1, TILE, 1, D[1]); P.r(X + TILE - 1, Y, 1, TILE, D[1]);
        for (const [rx, ry] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P.p(X + rx, Y + ry, D[0]);
        const horiz = lf === 'path' || rt === 'path' || lf === 'plaza' || rt === 'plaza';
        const glow = (tx + ty + frame) % 2 ? '#56e0e8' : '#3fb0bf';
        if (horiz) P.r(X, Y + 7, TILE, 2, glow); else P.r(X + 7, Y, 2, TILE, glow);
      }
      edgeBlend(P, X, Y, up, dn, lf, rt, G, D, tr);
    } else if (t === 'plaza') {
      if (map.era === 'past') {
        // 박석(넓적 돌): 크기 다른 돌판, 셀프컬러 줄눈, 돌마다 위쪽 밝은 줄
        P.r(X, Y, TILE, TILE, Z[1]);
        for (const [x0, y0, w, h] of [[0, 0, 9, 7], [9, 0, 7, 5], [0, 7, 6, 9], [6, 7, 10, 4], [9, 5, 7, 2], [6, 11, 10, 5]] as const) {
          P.r(X + x0 + 1, Y + y0 + 1, w - 1, h - 1, (x0 + y0 + tx + ty) % 3 ? Z[2] : mix(Z[2], Z[3], 0.5));
          P.r(X + x0 + 1, Y + y0 + 1, w - 1, 1, Z[3]);
        }
      } else if (map.era === 'modern') {
        // 벽돌 광장: 엇갈린 벽돌 줄
        P.r(X, Y, TILE, TILE, Z[2]);
        for (let r = 0; r < 4; r++) {
          P.r(X, Y + r * 4, TILE, 1, Z[1]);
          for (let c = (r % 2) * 4; c < TILE; c += 8) P.r(X + c, Y + r * 4, 1, 4, Z[1]);
          P.r(X + 1, Y + r * 4 + 1, TILE - 1, 1, Z[3]);
        }
      } else {
        // 격자 판: 어두운 이음점 + 밝은 모서리, 칸마다 빛나는 표지점
        P.r(X, Y, TILE, TILE, Z[2]);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
          const x0 = X + ((c * 4 + (r % 2 ? 2 : 0)) % TILE), y0 = Y + r * 4;
          P.p(x0, y0, Z[1]); P.p(x0 + 1, y0, Z[3]);
        }
        if ((tx + ty) % 2 === 0) P.p(X + 8, Y + 8, '#7ff3ff');
      }
      edgeBlend(P, X, Y, up, dn, lf, rt, G, Z, tr);
    } else if (t === 'water') {
      // 물: 사방이 물이면 깊어(어둡고), 위가 땅이면 둑 그림자 + 거품 줄, 나머지 가장자리는 밝은 물가선
      const deep = up === 'water' && dn === 'water' && lf === 'water' && rt === 'water';
      P.r(X, Y, TILE, TILE, deep ? Wt[1] : Wt[2]);
      const wr = seededRandom(`wave|${seed}|${tx}|${ty}|${frame}`);
      for (let i = 0; i < 3; i++) {
        const wx = X + 1 + Math.floor(wr() * 11), wy = Y + 3 + Math.floor(wr() * 11);
        P.r(wx, wy, 3 + Math.floor(wr() * 2), 1, deep ? Wt[2] : Wt[3]);
      }
      if (wr() < 0.4) P.p(X + Math.floor(wr() * 15), Y + Math.floor(wr() * 15), Wt[4]);
      if (up !== 'water' && up !== undefined) { P.r(X, Y, TILE, 2, mix(G[0], Wt[0], 0.5)); P.r(X, Y + 2, TILE, 1, Wt[4]); }
      if (dn !== 'water' && dn !== undefined) P.r(X, Y + TILE - 1, TILE, 1, Wt[3]);
      if (lf !== 'water' && lf !== undefined) P.r(X, Y, 1, TILE, Wt[3]);
      if (rt !== 'water' && rt !== undefined) P.r(X + TILE - 1, Y, 1, TILE, Wt[1]);
    } else if (t === 'flower') {
      if (fieldNear.has(`${tx},${ty}`)) {
        // 밭(장소 '밭' 주변): 고랑과 작물 줄
        const S = ramp(T.soil), C = ramp(T.crop);
        P.r(X, Y, TILE, TILE, S[2]);
        for (let r = 0; r < 4; r++) {
          P.r(X, Y + r * 4 + 3, TILE, 1, S[1]);
          for (let c = 1; c < TILE; c += 3) { P.p(X + c, Y + r * 4 + 1, C[2]); P.p(X + c, Y + r * 4, C[3]); P.p(X + c + 1, Y + r * 4 + 1, C[1]); }
        }
        P.r(X, Y, TILE, 1, S[3]);
      } else {
        // 꽃무더기: 꽃잎 램프(왼쪽 위 밝게, 오른쪽 아래 그림자) + 줄기 + 노란 꽃술
        for (let i = 0; i < 4; i++) {
          const fx = X + 2 + Math.floor(tr() * 11), fy = Y + 3 + Math.floor(tr() * 10);
          const F = ramp(T.flowers[Math.floor(tr() * T.flowers.length)]);
          P.p(fx, fy + 2, G[1]); P.p(fx, fy + 3, G[1]);
          P.p(fx - 1, fy, F[3]); P.p(fx + 1, fy, F[1]); P.p(fx, fy - 1, F[3]); P.p(fx, fy + 1, F[1]); P.p(fx, fy, '#f6e27a');
        }
      }
    } else if (t === 'rock') {
      // 바위: 셀프컬러 외곽선, 왼쪽 위 밝은 면, 오른쪽 아래 그림자, 땅에 드리운 그림자
      const R = ramp(T.rock);
      const ox = X + 2 + Math.floor(tr() * 2), oy = Y + 4 + Math.floor(tr() * 2);
      P.r(ox + 2, oy + 9, 12, 2, 'rgba(10,12,30,.22)');
      P.r(ox + 1, oy, 10, 10, R[0]); P.r(ox, oy + 2, 12, 7, R[0]);
      P.r(ox + 1, oy + 1, 10, 8, R[2]); P.r(ox + 1, oy + 3, 10, 5, R[2]);
      P.r(ox + 2, oy + 1, 5, 3, R[3]); P.p(ox + 2, oy + 1, R[4]);
      P.r(ox + 7, oy + 6, 4, 3, R[1]); P.r(ox + 1, oy + 8, 10, 1, R[1]);
      if (map.era === 'sf' && tr() < 0.4) P.p(ox + 5, oy + 4, '#7ff3ff');
    } else if (t === 'tree' && !covered.has(`${tx},${ty}`)) {
      // 나무 그림자(오른쪽 아래) — 나무 자체는 소품으로 그린다(건물이 덮는 칸에는 세우지 않음)
      P.r(X + 4, Y + 12, 12, 3, 'rgba(10,12,30,.2)');
    }
  }
  return cv;
}
/** 길·광장 가장자리를 풀과 섞는다 — 풀이 1~2px 덮고, 위쪽 풀 아래에는 1px 그림자(빛이 위에서) */
function edgeBlend(P: Painter, X: number, Y: number, up: VillageTile | undefined, dn: VillageTile | undefined, lf: VillageTile | undefined, rt: VillageTile | undefined, G: string[], D: string[], rnd: () => number) {
  if (isGrassy(up)) for (let i = 0; i < TILE; i++) { const d = rnd() < 0.5 ? 1 : 2; P.r(X + i, Y, 1, d, G[2]); P.p(X + i, Y + d, D[1]); }
  if (isGrassy(dn)) for (let i = 0; i < TILE; i++) { if (rnd() < 0.55) P.p(X + i, Y + TILE - 1, G[2]); }
  if (isGrassy(lf)) for (let i = 0; i < TILE; i++) { const d = rnd() < 0.5 ? 1 : 2; P.r(X, Y + i, d, 1, G[2]); }
  if (isGrassy(rt)) for (let i = 0; i < TILE; i++) { if (rnd() < 0.55) P.p(X + TILE - 1, Y + i, G[2]); }
}

/** 나무 소품(16×24) — 시대별: 과거 소나무, 현대 둥근 활엽수, SF 수정 식물 */
function treeArt(era: VillageEra, v: number): HTMLCanvasElement {
  const cv = canvas(16, 24), P = painter(cv);
  const r = seededRandom(`tree|${era}|${v}`);
  if (era === 'sf') {
    crystal(P, 8, 23, 17 + (v % 3) * 2, v % 2 ? '#9b6be0' : '#5fb8f2');
    crystal(P, 3, 23, 9, '#c08cff'); crystal(P, 13, 23, 11, v % 2 ? '#5ff2ff' : '#ff7ad9');
    return cv;
  }
  const K = ramp(TERRAIN[era].trunk);
  P.r(6, 14, 4, 10, K[0]); P.r(7, 14, 2, 9, K[2]); P.p(7, 15, K[3]);
  if (era === 'past') {
    // 소나무: 층진 납작한 잎 덩어리 세 개
    const leaf = v % 2 ? '#356f45' : '#3f7b44';
    blob(P, 8, 16, 7, 3, leaf, r); blob(P, 8, 10, 6, 3, leaf, r); blob(P, 8, 5, 4, 3, leaf, r);
  } else {
    const leaf = ['#3f8648', '#4a9150', '#5a8f3a', '#3f8648'][v % 4];
    blob(P, 8, 9, 7, 8, leaf, r);
    if (v === 1) { P.p(5, 7, '#e8505b'); P.p(10, 11, '#e8505b'); P.p(7, 13, '#e8505b'); }   // 열매
  }
  return cv;
}
/** 가로등 소품 — 과거 석등, 현대 가로등, SF 네온 기둥 */
function lampArt(era: VillageEra): HTMLCanvasElement {
  const cv = canvas(10, 24), P = painter(cv);
  if (era === 'past') {
    box(P, 2, 19, 6, 5, MAT.past.stone); P.r(4, 13, 2, 6, MAT.past.stone);
    box(P, 1, 7, 8, 7, MAT.past.stone); P.r(3, 9, 4, 3, '#ffcf6b'); P.p(3, 9, '#fff2b0');
    box(P, 0, 4, 10, 3, shade(MAT.past.stone, -1)); P.r(4, 2, 2, 2, MAT.past.stone);
  } else if (era === 'modern') {
    P.r(4, 6, 2, 17, '#4a505c'); P.r(4, 6, 1, 17, '#7a8190'); box(P, 2, 21, 6, 3, '#4a505c');
    box(P, 1, 2, 8, 5, '#3d4350'); P.r(2, 5, 6, 1, '#fff2b0');
  } else {
    P.r(4, 4, 2, 19, '#3a4468'); box(P, 2, 21, 6, 3, '#5d6c9a');
    P.r(3, 3, 4, 2, '#5ff2ff'); P.r(4, 8, 2, 1, '#5ff2ff'); P.r(4, 12, 2, 1, '#ff5fd2');
  }
  return cv;
}

const LIGHT_DEFAULT: Record<VillageEra, string> = { past: 'rgba(255,190,110,', modern: 'rgba(255,214,140,', sf: 'rgba(110,240,255,' };

/** 정적 장면(지면 두 장 + 소품 + 불빛)을 한 번 만든다 */
export function buildScene(map: VillageMap, seed: string): VillageScene {
  const era = map.era;
  const def = LIGHT_DEFAULT[era];
  const props: Prop[] = [];
  const lights: Light[] = [];
  // 건물·장소 소품 — 문 칸 가운데 아래에 맞춘다. 건물이 덮는 칸과 문 앞 한 칸의 나무는 세우지 않는다
  // (나무가 건물 정면·문을 가려 지저분해 보였다 — 걷기 판정은 map.ts 그대로라 막힌 칸이 길이 되지는 않는다)
  const covered = new Set<string>();
  for (const pl of map.places) {
    const v = Math.floor(seededRandom(`bld|${seed}|${pl.id}`)() * 4);
    const art = buildingArt(era, pl.kind, v, `${seed}|${pl.id}`);
    const bx = pl.x * TILE + TILE / 2 - Math.floor(art.img.width / 2);
    const by = (pl.y + 1) * TILE - art.img.height;
    props.push({ img: art.img, x: bx, y: by, sortY: pl.y - 0.02 });
    for (const l of art.lights) lights.push({ x: bx + l.x, y: by + l.y, r: l.r, color: l.color || def });
    for (let ty = Math.floor(by / TILE); ty <= pl.y + 1; ty++) for (let tx = Math.floor(bx / TILE); tx <= Math.floor((bx + art.img.width - 1) / TILE); tx++) covered.add(`${tx},${ty}`);
  }
  const fieldNear = new Set<string>();
  for (const p of map.places) if (p.kind === 'field') for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fieldNear.add(`${p.x + dx},${p.y + dy}`);
  const ground: [HTMLCanvasElement, HTMLCanvasElement] = [drawGround(map, seed, 0, fieldNear, covered), drawGround(map, seed, 1, fieldNear, covered)];
  const treeImgs = [0, 1, 2, 3].map(v => treeArt(era, v));
  const pick = seededRandom(`props|${seed}`);
  // 가로등: 길 옆 나무·바위 칸(원래 걸을 수 없는 칸) 몇 곳을 골라 나무 대신 세운다 — 걷기 판정은 그대로
  const lampAt = new Set<string>();
  const lampCand: [number, number][] = [];
  for (let y = 2; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) {
    const t = map.tiles[y][x];
    if (covered.has(`${x},${y}`)) continue;
    if ((t === 'tree' || t === 'rock') && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.tiles[y + dy][x + dx] === 'path')) lampCand.push([x, y]);
  }
  for (let i = lampCand.length - 1; i > 0; i--) { const j = Math.floor(pick() * (i + 1)); [lampCand[i], lampCand[j]] = [lampCand[j], lampCand[i]]; }
  const lamp = lampArt(era);
  for (const [x, y] of lampCand.slice(0, Math.min(8, Math.ceil(lampCand.length / 3)))) {
    lampAt.add(`${x},${y}`);
    props.push({ img: lamp, x: x * TILE + 3, y: y * TILE + TILE - 24, sortY: y - 0.01 });
    lights.push({ x: x * TILE + 8, y: y * TILE - 2, r: 30, color: def });
  }
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (map.tiles[y][x] !== 'tree' || lampAt.has(`${x},${y}`) || covered.has(`${x},${y}`)) continue;
    props.push({ img: treeImgs[Math.floor(pick() * 4)], x: x * TILE, y: y * TILE + TILE - 24, sortY: y - 0.01 });
  }
  // 광장 한가운데 불빛
  const cx = Math.floor(map.width / 2), cy = Math.floor(map.height / 2);
  lights.push({ x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE, r: 40, color: def });
  // 건물 그림자: 빛이 왼쪽 위에서 오므로 오른쪽 아래로 — 지면 두 장에 같이 굽는다
  for (const g of ground) {
    const ctx = g.getContext('2d')!;
    ctx.fillStyle = 'rgba(10,12,30,.22)';
    for (const pr of props) {
      if (pr.img.width < 20) continue;
      const w = pr.img.width, bottom = pr.y + pr.img.height, sh = Math.min(16, Math.round(pr.img.height * 0.4));
      ctx.fillRect(Math.round(pr.x + w - 5), bottom - sh, 6, sh);
      ctx.fillRect(Math.round(pr.x + 4), bottom, w - 3, 2);
    }
  }
  return { ground, props, lights };
}

/** 장소 종류·시대에 맞는 건물 도트(미리보기에서도 쓴다) */
export function buildingArt(era: VillageEra, kind: PlaceKind, variant: number, seedKey = ''): Art {
  const rnd = seededRandom(`art|${era}|${kind}|${variant}|${seedKey}`);
  return era === 'past' ? artPast(kind, variant, rnd) : era === 'modern' ? artModern(kind, variant, rnd) : artSf(kind, variant, rnd);
}

/** NPC는 이름에서 정한 도트 외형 */
export function npcAvatar(id: string, name: string): PixelAvatarData {
  const r = seededRandom(`npc|${id}|${name}`);
  const col = () => `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`;
  const skins = ['#f3d0b5', '#e9b896', '#c98f6b', '#8d5a3e', '#f7dcc8'];
  const hair = Math.floor(r() * 24), face = Math.floor(r() * 24), body = Math.floor(r() * 24);
  const hairColor = col(), skinColor = skins[Math.floor(r() * skins.length)], bodyColor = col();
  // 앞머리·뒷머리 파츠(v2.1 도트)도 이름으로 정한다. 예전 값(hair·색)을 먼저 같은 순서로 뽑아 기존 NPC 색은 그대로다
  return { hair, face, body, hairColor, skinColor, bodyColor, eyeColor: '#2d2a33', back: Math.floor(r() * 40), front: Math.floor(r() * 16) } as PixelAvatarData;
}

const gridCache = new Map<string, Uint32Array>();
const sizedCache = new Map<string, HTMLCanvasElement>();
/** 32×32 원본 도트(0xRRGGBBAA). 도트 캐릭터는 이 격자를 4배로 키운 그림이다 (v2.1 도트 개편) */
function gridOf(v: PixelAvatarData, key: string): Uint32Array {
  let g = gridCache.get(key);
  if (g) return g;
  g = pixelAvatarGrid(v).pixels;
  if (gridCache.size > 300) gridCache.clear();
  gridCache.set(key, g);
  return g;
}
/**
 * 화면의 실제 기기 픽셀 크기(px)에 가장 가까운 '32의 정수배' 크기 스프라이트. 화면에는 보간 없이 1:1로 그린다.
 * 32칸 원본을 정수 배율로만 키우므로 모든 도트 칸이 같은 크기의 정사각형이 된다 — 예전처럼 128 그림을
 * 면적 평균으로 줄이면 칸 경계에 걸친 픽셀이 섞여 외곽선이 흐려졌다 (v2.1 도트 4배 그림 대응, 사용자 권장 방식).
 */
export function avatarSprite(avatar: PixelAvatarData | null, px = 128): HTMLCanvasElement {
  const v = avatar ?? DEFAULT_PIXEL_AVATAR;
  const k = Math.max(1, Math.min(16, Math.round(px / PIXEL_GRID)));
  const size = PIXEL_GRID * k;
  const key = JSON.stringify(v);
  const ck = `${size}|${key}`;
  const hit = sizedCache.get(ck);
  if (hit) return hit;
  const g = gridOf(v, key);
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = g[Math.floor(y / k) * PIXEL_GRID + Math.floor(x / k)], j = (y * size + x) * 4;
    img.data[j] = c >>> 24; img.data[j + 1] = (c >>> 16) & 255; img.data[j + 2] = (c >>> 8) & 255; img.data[j + 3] = c & 255;
  }
  ctx.putImageData(img, 0, 0);
  if (sizedCache.size > 400) sizedCache.clear();
  sizedCache.set(ck, cv);
  return cv;
}

/** 시간대 색 — 곱하기(multiply)로 덮어 색이 물든다. 어두움은 DARKNESS 층이 따로 맡는다 */
export const PHASE_TINT: Record<Phase, string | null> = {
  dawn: '#9aa6e0', morning: '#fff1dc', noon: null, afternoon: '#ffe8cc', evening: '#eab0bc', night: '#8a96d4',
};
/** 어둠 층(불빛 자리는 도려낸다). null이면 어둠 없음 */
export const DARKNESS: Record<Phase, string | null> = {
  dawn: 'rgba(10,14,46,.5)', morning: null, noon: null, afternoon: null, evening: 'rgba(40,20,60,.22)', night: 'rgba(6,10,36,.58)',
};
