'use client';
// 마을 캔버스 그리기 — 지형은 타일 16px 도트로 한 번 그려 두고, 화면에서는 정수 배율로 확대한다.
// 캐릭터는 프로필 도트(128×128 원본)를 캐시하고 보간 없이 화면에 그린다.
import { pixelAvatarPixels, DEFAULT_PIXEL_AVATAR, type PixelAvatarData } from '@/components/chars/PixelAvatar';
import { seededRandom, type VillageMap, type VillageEra, type PlaceKind } from '@/lib/village/map';
import type { Phase } from '@/lib/village/sim';

export const TILE = 16;

type Pal = Record<'g1' | 'g2' | 'g3' | 'path' | 'path2' | 'plaza' | 'plaza2' | 'water' | 'water2' | 'leaf' | 'leaf2' | 'trunk' | 'rock' | 'rock2' | 'flower' | 'flower2' | 'wall' | 'wall2' | 'roof' | 'roof2' | 'window' | 'outline', string>;
const PAL: Record<VillageEra, Pal> = {
  past: { g1: '#7caa58', g2: '#6f9d4c', g3: '#8bb965', path: '#c9a26a', path2: '#b38a55', plaza: '#b9ad97', plaza2: '#a39780', water: '#5c9cc4', water2: '#8cc2df', leaf: '#3f7a3b', leaf2: '#5a9748', trunk: '#6b4a2f', rock: '#8d8a83', rock2: '#b0ada5', flower: '#f2d16b', flower2: '#e98aa4', wall: '#e8dcc2', wall2: '#c9b994', roof: '#4a4f5c', roof2: '#636a7a', window: '#f6d98a', outline: '#2b2a2f' },
  modern: { g1: '#84b862', g2: '#77aa55', g3: '#92c46f', path: '#bfb9ae', path2: '#a8a297', plaza: '#dccfbb', plaza2: '#c7b9a3', water: '#4f9dd6', water2: '#86c1ea', leaf: '#3d7d45', leaf2: '#59a05a', trunk: '#71523a', rock: '#8f9399', rock2: '#b4b8bd', flower: '#ffffff', flower2: '#f39bb5', wall: '#f1ece2', wall2: '#d5cdbd', roof: '#b4544f', roof2: '#cf6f68', window: '#9fd2f2', outline: '#2a2c33' },
  sf: { g1: '#2b3352', g2: '#262d49', g3: '#323b5e', path: '#3d4a78', path2: '#56e0e8', plaza: '#4a5487', plaza2: '#6d79b4', water: '#2fd0c4', water2: '#a6fff5', leaf: '#8d5bd6', leaf2: '#c08cff', trunk: '#4a3d73', rock: '#5b6378', rock2: '#8a93ab', flower: '#ff7ad9', flower2: '#7affd1', wall: '#c9d3e8', wall2: '#93a0bf', roof: '#3a4466', roof2: '#5d6ca0', window: '#7ff3ff', outline: '#121522' },
};

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
}

/** 정적 지형(타일 + 건물)을 원본 배율로 그린 캔버스 */
export function buildMapCanvas(map: VillageMap, seed: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = map.width * TILE; cv.height = map.height * TILE;
  const ctx = cv.getContext('2d')!;
  const p = PAL[map.era];
  const rnd = seededRandom(`tiles|${seed}`);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const X = x * TILE, Y = y * TILE, t = map.tiles[y][x];
    // 바닥 풀
    px(ctx, X, Y, TILE, TILE, (x + y) % 2 ? p.g1 : p.g2);
    for (let i = 0; i < 3; i++) px(ctx, X + Math.floor(rnd() * 14), Y + Math.floor(rnd() * 14), 2, 1, p.g3);
    if (t === 'path') {
      px(ctx, X, Y, TILE, TILE, p.path);
      for (let i = 0; i < 4; i++) px(ctx, X + Math.floor(rnd() * 14), Y + Math.floor(rnd() * 14), 2, 2, p.path2);
      if (map.era === 'sf') { px(ctx, X, Y + 7, TILE, 1, p.path2); }
    } else if (t === 'plaza') {
      px(ctx, X, Y, TILE, TILE, p.plaza);
      px(ctx, X, Y, TILE, 1, p.plaza2); px(ctx, X, Y + 8, TILE, 1, p.plaza2);
      px(ctx, X + (y % 2 ? 4 : 11), Y, 1, 8, p.plaza2); px(ctx, X + (y % 2 ? 11 : 4), Y + 8, 1, 8, p.plaza2);
    } else if (t === 'water') {
      px(ctx, X, Y, TILE, TILE, p.water);
      px(ctx, X + 3, Y + 4, 4, 1, p.water2); px(ctx, X + 9, Y + 10, 4, 1, p.water2);
    } else if (t === 'flower') {
      for (let i = 0; i < 4; i++) {
        const fx = X + 2 + Math.floor(rnd() * 11), fy = Y + 2 + Math.floor(rnd() * 11);
        px(ctx, fx, fy, 2, 2, i % 2 ? p.flower : p.flower2); px(ctx, fx, fy + 2, 1, 2, p.leaf);
      }
    } else if (t === 'rock') {
      px(ctx, X + 3, Y + 6, 10, 7, p.outline); px(ctx, X + 4, Y + 6, 8, 6, p.rock); px(ctx, X + 5, Y + 7, 4, 2, p.rock2);
    } else if (t === 'tree') {
      if (map.era === 'sf') {
        // 수정 식물
        px(ctx, X + 7, Y + 3, 2, 11, p.outline); px(ctx, X + 4, Y + 6, 2, 7, p.outline); px(ctx, X + 10, Y + 5, 2, 8, p.outline);
        px(ctx, X + 7, Y + 4, 1, 9, p.leaf2); px(ctx, X + 4, Y + 7, 1, 5, p.leaf); px(ctx, X + 10, Y + 6, 1, 6, p.leaf);
      } else {
        px(ctx, X + 7, Y + 10, 2, 5, p.trunk);
        px(ctx, X + 2, Y + 2, 12, 9, p.outline); px(ctx, X + 3, Y + 1, 10, 11, p.outline);
        px(ctx, X + 3, Y + 2, 10, 8, p.leaf); px(ctx, X + 4, Y + 2, 6, 4, p.leaf2); px(ctx, X + 5, Y + 3, 2, 1, p.g3);
      }
    }
  }
  for (const pl of map.places) drawBuilding(ctx, pl.x * TILE, pl.y * TILE, pl.kind, p, map.era);
  return cv;
}

function drawBuilding(ctx: CanvasRenderingContext2D, X: number, Y: number, kind: PlaceKind, p: Pal, era: VillageEra) {
  // 문 칸(X,Y)의 위쪽에 건물을 세운다. 폭 24px, 높이 22px
  const L = X - 4, T = Y - 18;
  if (kind === 'water') {
    px(ctx, X - 2, Y + 1, 20, 12, p.outline); px(ctx, X - 1, Y + 2, 18, 10, p.water); px(ctx, X + 2, Y + 4, 6, 1, p.water2);
    px(ctx, X + 7, Y - 4, 2, 8, p.outline); px(ctx, X + 6, Y - 6, 4, 3, p.water2);   // 분수/표지
    return;
  }
  if (kind === 'forest') {
    for (const [dx, dy] of [[-4, -10], [6, -12], [1, -4]]) {
      px(ctx, X + dx + 2, Y + dy + 2, 12, 10, p.outline); px(ctx, X + dx + 3, Y + dy + 2, 10, 8, p.leaf); px(ctx, X + dx + 5, Y + dy + 3, 4, 3, p.leaf2);
      px(ctx, X + dx + 7, Y + dy + 11, 2, 3, p.trunk);
    }
    return;
  }
  if (kind === 'field') {
    for (let i = 0; i < 4; i++) { px(ctx, L + 2, T + 8 + i * 4, 20, 2, p.trunk); px(ctx, L + 3 + i * 4, T + 6 + i * 4, 2, 3, p.leaf2); }
    px(ctx, X + 5, Y - 12, 6, 12, p.outline); px(ctx, X + 6, Y - 11, 4, 4, p.flower);   // 허수아비
    return;
  }
  const tall = kind === 'tower' ? 10 : kind === 'school' ? 4 : 0;
  // 벽
  px(ctx, L, T + 6 - tall, 24, 16 + tall, p.outline);
  px(ctx, L + 1, T + 7 - tall, 22, 14 + tall, p.wall);
  px(ctx, L + 1, T + 18, 22, 3, p.wall2);
  // 지붕 — 시대별
  if (era === 'past') {
    px(ctx, L - 3, T + 1 - tall, 30, 7, p.outline); px(ctx, L - 2, T + 2 - tall, 28, 5, p.roof); px(ctx, L - 2, T + 2 - tall, 28, 1, p.roof2);
    px(ctx, L - 4, T + 6 - tall, 3, 2, p.outline); px(ctx, L + 25, T + 6 - tall, 3, 2, p.outline);   // 처마 끝
  } else if (era === 'modern') {
    px(ctx, L - 2, T + 2 - tall, 28, 5, p.outline); px(ctx, L - 1, T + 3 - tall, 26, 3, p.roof); px(ctx, L - 1, T + 3 - tall, 26, 1, p.roof2);
  } else {
    px(ctx, L + 3, T - tall, 18, 7, p.outline); px(ctx, L + 4, T + 1 - tall, 16, 5, p.roof2); px(ctx, L + 8, T - 3 - tall, 8, 4, p.window);
  }
  // 창문·간판·문
  px(ctx, L + 3, T + 10 - tall, 5, 4, p.outline); px(ctx, L + 4, T + 11 - tall, 3, 2, p.window);
  px(ctx, L + 16, T + 10 - tall, 5, 4, p.outline); px(ctx, L + 17, T + 11 - tall, 3, 2, p.window);
  if (tall) { px(ctx, L + 9, T + 2 - tall + 8, 6, 3, p.outline); px(ctx, L + 10, T + 3 - tall + 8, 4, 1, p.window); }
  if (kind === 'shop') { px(ctx, L + 1, T + 7, 22, 3, p.roof2); for (let i = 0; i < 22; i += 4) px(ctx, L + 1 + i, T + 7, 2, 3, p.wall); }
  if (kind === 'school') { px(ctx, X + 7, T - 10, 1, 8, p.outline); px(ctx, X + 8, T - 10, 5, 3, p.flower2); }
  px(ctx, X + 5, Y - 6, 6, 7, p.outline); px(ctx, X + 6, Y - 5, 4, 6, p.trunk);
}

/** 밤에 켜지는 창문 불빛 위치(원본 좌표) */
export function windowLights(map: VillageMap): { x: number; y: number }[] {
  return map.places.filter(p => !['water', 'forest', 'field'].includes(p.kind)).flatMap(p => {
    const L = p.x * TILE - 4, T = p.y * TILE - 18, tall = p.kind === 'tower' ? 10 : p.kind === 'school' ? 4 : 0;
    return [{ x: L + 5.5, y: T + 12 - tall }, { x: L + 18.5, y: T + 12 - tall }];
  });
}

/** NPC는 이름에서 정한 도트 외형 */
export function npcAvatar(id: string, name: string): PixelAvatarData {
  const r = seededRandom(`npc|${id}|${name}`);
  const col = () => `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`;
  const skins = ['#f3d0b5', '#e9b896', '#c98f6b', '#8d5a3e', '#f7dcc8'];
  return {
    hair: Math.floor(r() * 24), face: Math.floor(r() * 24), body: Math.floor(r() * 24),
    hairColor: col(), skinColor: skins[Math.floor(r() * skins.length)], bodyColor: col(), eyeColor: '#2d2a33',
  };
}

/** 마을에서 캐릭터 한 명이 차지하는 크기(지형 원본 좌표 기준, 128×128 도트 틀 전체) */
export const SPRITE_WORLD = 36;

const sourceCache = new Map<string, Float32Array>();
const sizedCache = new Map<string, HTMLCanvasElement>();
/** 128×128 원본 도트(미리 곱한 알파, RGBA float) */
function sourceOf(v: PixelAvatarData, key: string): Float32Array {
  let src = sourceCache.get(key);
  if (src) return src;
  const { pixels } = pixelAvatarPixels(v);
  src = new Float32Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i], a = (c & 255) / 255;
    src[i * 4] = (c >>> 24) * a; src[i * 4 + 1] = ((c >>> 16) & 255) * a; src[i * 4 + 2] = ((c >>> 8) & 255) * a; src[i * 4 + 3] = a;
  }
  if (sourceCache.size > 300) sourceCache.clear();
  sourceCache.set(key, src);
  return src;
}
/**
 * 화면의 실제 기기 픽셀 크기(px)에 맞춘 캐릭터 스프라이트. 128 원본을 면적 평균으로 정확히 그 크기까지 줄여 두고
 * 화면에는 보간 없이 1:1로 그린다 — 브라우저의 최근접 축소처럼 눈·입 선이 끊기거나, 부드러운 확대처럼 뭉개지지 않는다.
 * px가 128 이상이면 원본 도트를 정수 배율로 키운다.
 */
export function avatarSprite(avatar: PixelAvatarData | null, px = 128): HTMLCanvasElement {
  const v = avatar ?? DEFAULT_PIXEL_AVATAR;
  const size = Math.max(16, Math.min(512, Math.round(px / 2) * 2));
  const key = JSON.stringify(v);
  const ck = `${size}|${key}`;
  const hit = sizedCache.get(ck);
  if (hit) return hit;
  const S = 128;
  const src = sourceOf(v, key);
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  if (size >= S) {
    const k = size / S;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (Math.min(S - 1, Math.floor(y / k)) * S + Math.min(S - 1, Math.floor(x / k))) * 4, j = (y * size + x) * 4, a = src[i + 3];
      img.data[j] = a ? src[i] / a : 0; img.data[j + 1] = a ? src[i + 1] / a : 0; img.data[j + 2] = a ? src[i + 2] / a : 0; img.data[j + 3] = a * 255;
    }
  } else {
    const r = S / size;
    for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
      let R = 0, G = 0, B = 0, A = 0, W = 0;
      const x0 = tx * r, x1 = x0 + r, y0 = ty * r, y1 = y0 + r;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const w = (Math.min(x1, x + 1) - Math.max(x0, x)) * (Math.min(y1, y + 1) - Math.max(y0, y));
        const i = (y * S + x) * 4;
        R += src[i] * w; G += src[i + 1] * w; B += src[i + 2] * w; A += src[i + 3] * w; W += w;
      }
      const j = (ty * size + tx) * 4;
      img.data[j] = A ? R / A : 0; img.data[j + 1] = A ? G / A : 0; img.data[j + 2] = A ? B / A : 0; img.data[j + 3] = Math.round((A / W) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  if (sizedCache.size > 400) sizedCache.clear();
  sizedCache.set(ck, cv);
  return cv;
}

export const PHASE_TINT: Record<Phase, string | null> = {
  dawn: 'rgba(18,26,72,.52)', morning: 'rgba(255,214,150,.08)', noon: null,
  afternoon: 'rgba(255,190,120,.08)', evening: 'rgba(160,70,120,.28)', night: 'rgba(8,12,44,.6)',
};
