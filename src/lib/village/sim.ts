// 마을 자율 행동 — 순수 함수. 같은 방·같은 시각이면 모든 접속자가 같은 장면을 본다.
// 시간대(한국 시각)와 캐릭터 설정값(성격·집·대사)으로 목적지와 대사를 정한다.
import { findPath, seededRandom, walkable, type VillageMap } from './map';
import type { ActorOverride, RoomActor } from './types';

export const BLOCK_MS = 10 * 60 * 1000;     // 10분마다 새 목적지
export const STEP_MS = 650;                 // 한 칸 걷는 시간
export const CONTROL_MS = 5 * 60 * 1000;    // 조작을 멈추고 5분 뒤 자율 행동으로 돌아간다
const SPEECH_MS = 45 * 1000;
const SPEECH_SHOW_MS = 7 * 1000;

export type Phase = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
export const PHASE_LABEL: Record<Phase, string> = {
  dawn: '새벽', morning: '아침', noon: '점심', afternoon: '오후', evening: '저녁', night: '밤',
};
/** 한국 시각(UTC+9) 기준 시간대 */
export function phaseAt(t: number): Phase {
  const h = new Date(t + 9 * 3600 * 1000).getUTCHours();
  if (h < 6) return 'dawn';
  if (h < 10) return 'morning';
  if (h < 13) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}
const hash = (s: string) => seededRandom(s)();

export interface ActorFrame {
  id: string;
  x: number;            // 타일 좌표(소수 = 걷는 중)
  y: number;
  dir: -1 | 1;
  moving: boolean;
  sleeping: boolean;
  controlled: boolean;
  place: string;        // 현재 있거나 향하는 장소 id ('' = 광장)
  speech?: string;
  partner?: string;     // 같은 장소에서 어울리는 상대
}

function placeTile(map: VillageMap, placeId: string) {
  const p = map.places.find(x => x.id === placeId);
  return p ? { x: p.x, y: p.y } : { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
}
function homeOf(map: VillageMap, a: RoomActor, seed: string) {
  if (a.home && map.places.some(p => p.id === a.home)) return a.home;
  if (!map.places.length) return '';
  return map.places[Math.floor(hash(`${seed}|home|${a.id}`) * map.places.length)].id;
}

/** 블록 b에서 배우 a가 향하는 장소 */
export function targetPlace(map: VillageMap, seed: string, a: RoomActor, block: number): string {
  const phase = phaseAt(block * BLOCK_MS);
  const home = homeOf(map, a, seed);
  const r = hash(`${seed}|${a.id}|${block}`);
  const ids = map.places.map(p => p.id);
  if (phase === 'dawn' || phase === 'night') return home;
  if (!ids.length) return '';
  const pick = (list: string[]) => list.length ? list[Math.floor(r * list.length) % list.length] : '';
  const quiet = map.places.filter(p => p.kind === 'forest' || p.kind === 'water' || p.kind === 'field').map(p => p.id);
  const lively = map.places.filter(p => p.kind === 'shop' || p.kind === 'school' || p.kind === 'tower').map(p => p.id);
  if (phase === 'evening' && r < 0.45) return '';               // 저녁엔 광장에 모인다
  if (phase === 'noon' && lively.length && r < 0.5) return pick(lively);
  switch (a.personality) {
    case 'lively': return r < 0.3 ? '' : pick(ids);
    case 'calm': {
      const fav = ids[Math.floor(hash(`${seed}|fav|${a.id}`) * ids.length)];
      return r < 0.7 ? fav : pick(ids);
    }
    case 'shy': return r < 0.5 ? home : pick(quiet.length ? quiet : ids);
    case 'curious': return ids[(block + Math.floor(hash(`${seed}|cur|${a.id}`) * ids.length)) % ids.length];
    case 'lazy': return r < 0.6 ? home : '';
    default: return pick(ids);
  }
}

const SLOTS = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, 2], [2, 1], [-2, 1], [1, 2], [-1, 2], [2, 0], [-2, 0]];
/** 같은 장소에 모여도 겹치지 않도록 주변 칸을 나눠 쓴다 */
function standTile(map: VillageMap, placeId: string, slotSeed: number, taken?: Set<string>) {
  const base = placeTile(map, placeId);
  let first: { x: number; y: number } | null = null;
  for (let i = 0; i < SLOTS.length; i++) {
    const [dx, dy] = SLOTS[(slotSeed + i) % SLOTS.length];
    const x = base.x + dx, y = base.y + dy;
    if (!walkable(map.tiles[y]?.[x])) continue;
    first ??= { x, y };
    // 앞 순서 배우가 이미 선 칸은 건너뛴다(빈 칸이 없으면 첫 후보 칸)
    if (!taken || !taken.has(`${x},${y}`)) { taken?.add(`${x},${y}`); return { x, y }; }
  }
  return first ?? base;
}

const pathCache = new Map<string, { x: number; y: number }[]>();
function cachedPath(map: VillageMap, seed: string, a: { x: number; y: number }, b: { x: number; y: number }) {
  const k = `${seed}|${a.x},${a.y}|${b.x},${b.y}`;
  let p = pathCache.get(k);
  if (!p) {
    p = findPath(map, a, b);
    if (pathCache.size > 4000) pathCache.clear();
    pathCache.set(k, p);
  }
  return p;
}

/** 시각 t의 모든 배우 위치·대사·상호작용 */
export function simulate(map: VillageMap, seed: string, actors: RoomActor[], overrides: ActorOverride[], t: number): ActorFrame[] {
  const block = Math.floor(t / BLOCK_MS);
  const phase = phaseAt(t);
  const takenPrev = new Set<string>(), takenNow = new Set<string>();
  const frames: ActorFrame[] = actors.map((a, i) => {
    // 방마다 시작 칸만 섞고 배우 순서대로 칸을 나눈다 — 같은 장소에 모여도 12명까지는 서로 다른 칸에 선다
    const slot = Math.floor(hash(`${seed}|slot`) * SLOTS.length) + i;
    const ov = overrides.find(o => o.id === a.id && t - o.at < CONTROL_MS && t >= o.at - 60_000);
    if (ov) {
      return { id: a.id, x: ov.x, y: ov.y, dir: 1, moving: false, sleeping: false, controlled: true, place: '' };
    }
    const prevPlace = targetPlace(map, seed, a, block - 1);
    const place = targetPlace(map, seed, a, block);
    const from = standTile(map, prevPlace, slot, takenPrev);
    const to = standTile(map, place, slot, takenNow);
    const startAt = block * BLOCK_MS + Math.floor(hash(`${seed}|start|${a.id}|${block}`) * 90_000);
    const path = cachedPath(map, seed, from, to);
    let x = from.x, y = from.y, dir: -1 | 1 = 1, moving = false;
    if (t >= startAt && path.length) {
      const steps = (t - startAt) / STEP_MS;
      if (steps >= path.length) { x = to.x; y = to.y; }
      else {
        const i0 = Math.floor(steps), f = steps - i0;
        const p0 = i0 === 0 ? from : path[i0 - 1], p1 = path[i0];
        x = p0.x + (p1.x - p0.x) * f; y = p0.y + (p1.y - p0.y) * f;
        dir = p1.x < p0.x ? -1 : 1;
        moving = true;
      }
    } else if (!path.length) { x = to.x; y = to.y; }
    const sleeping = (phase === 'dawn' || (phase === 'night' && hash(`${seed}|nightowl|${a.id}`) < 0.6)) && !moving;
    return { id: a.id, x, y, dir, moving, sleeping, controlled: false, place: t < startAt && path.length ? prevPlace : place };
  });
  // 같은 장소에 도착한 깨어 있는 배우끼리 짝을 지어 어울린다
  const byPlace = new Map<string, ActorFrame[]>();
  for (const f of frames) {
    if (f.moving || f.sleeping || f.controlled) continue;
    const list = byPlace.get(f.place) ?? [];
    list.push(f);
    byPlace.set(f.place, list);
  }
  for (const list of byPlace.values()) {
    for (let i = 0; i + 1 < list.length; i += 2) {
      list[i].partner = list[i + 1].id; list[i + 1].partner = list[i].id;
      list[i].dir = list[i + 1].x >= list[i].x ? 1 : -1;
      list[i + 1].dir = list[i].x >= list[i + 1].x ? 1 : -1;
    }
  }
  // 미리 입력해 둔 대사 — 성격에 따라 말하는 빈도가 다르다. 대사가 없으면 말하지 않는다.
  const w = Math.floor(t / SPEECH_MS);
  frames.forEach((f, i) => {
    const a = actors[i];
    if (!a.lines.length || f.sleeping) return;
    const offset = Math.floor(hash(`${seed}|spoff|${a.id}`) * (SPEECH_MS - SPEECH_SHOW_MS));
    const inWindow = t - w * SPEECH_MS;
    if (inWindow < offset || inWindow > offset + SPEECH_SHOW_MS) return;
    const rate = { lively: 0.7, calm: 0.4, shy: 0.2, curious: 0.5, lazy: 0.3 }[a.personality] + (f.partner ? 0.25 : 0);
    const r = hash(`${seed}|speak|${a.id}|${w}`);
    if (r < rate) f.speech = a.lines[Math.floor(hash(`${seed}|line|${a.id}|${w}`) * a.lines.length)];
  });
  return frames;
}
