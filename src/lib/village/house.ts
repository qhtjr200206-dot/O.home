// 집 안 배치 규칙 — 순수 함수(가져오기 없음). 화면의 '꾸미기'와 서버(house.place 등)가 같은 규칙으로 검사한다.
// (v3 사용자 요청 — 집 안에 들어가 가구를 놓고 집을 넓힌다) 크기·규칙은 docs/village-gdd.md 6장·10장.
//  · 격자 W×H: 맨 윗줄(y=0)은 뒷벽, 나머지가 바닥. 문은 아래 가운데(doorX = W/2, y = H-1).
//  · 가구는 겹치거나 문 칸·문 앞 칸을 막을 수 없고, 문에서 걸어서 바닥 절반 이상에 닿아야 한다(소프트락 방지).

export type HouseLevel = 1 | 2 | 3;
export const HOUSE_SIZE: Record<HouseLevel, { w: number; h: number }> = { 1: { w: 8, h: 6 }, 2: { w: 10, h: 7 }, 3: { w: 12, h: 8 } };
export const HOUSE_MAX_ITEMS = 60;

export interface PlacedItem { k: string; item: string; x: number; y: number; r: 0 | 1; by: string }
export interface HouseDoc { level: HouseLevel; floor: string; wall: string; items: PlacedItem[] }
export interface FurnSpec { w: number; h: number; walk?: boolean; price: number }
export type FurnLookup = (id: string) => FurnSpec | undefined;

export function houseLayout(level: HouseLevel) {
  const { w, h } = HOUSE_SIZE[level] ?? HOUSE_SIZE[1];
  const door = { x: Math.floor(w / 2), y: h - 1 };
  return { w, h, door, front: { x: door.x, y: h - 2 }, floorCells: w * (h - 1) };
}
/** 회전(r=1)하면 가로·세로가 바뀐다 */
export const footprint = (spec: { w: number; h: number }, r: number): [number, number] => (r ? [spec.h, spec.w] : [spec.w, spec.h]);

export function normalizeHouse(raw: unknown, defFloor: string, defWall: string): HouseDoc {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const level = (r.level === 2 || r.level === 3 ? r.level : 1) as HouseLevel;
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, HOUSE_MAX_ITEMS).flatMap(v => {
    const o = v && typeof v === 'object' ? v as Record<string, unknown> : {};
    if (typeof o.k !== 'string' || typeof o.item !== 'string' || !Number.isInteger(o.x) || !Number.isInteger(o.y)) return [];
    return [{ k: o.k, item: o.item, x: o.x as number, y: o.y as number, r: (o.r === 1 ? 1 : 0) as 0 | 1, by: typeof o.by === 'string' ? o.by : '' }];
  });
  return {
    level,
    floor: typeof r.floor === 'string' && r.floor ? r.floor : defFloor,
    wall: typeof r.wall === 'string' && r.wall ? r.wall : defWall,
    items,
  };
}

/** 가구가 걸을 수 없게 막는 칸 집합(깔개는 막지 않는다) */
export function occupancy(level: HouseLevel, items: PlacedItem[], lookup: FurnLookup) {
  const { w, h } = houseLayout(level);
  const owner: (string | null)[] = Array(w * h).fill(null);
  const block: boolean[] = Array(w * h).fill(false);
  for (const it of items) {
    const spec = lookup(it.item);
    if (!spec) continue;
    const [fw, fh] = footprint(spec, it.r);
    for (let y = it.y; y < it.y + fh; y++) for (let x = it.x; x < it.x + fw; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      owner[y * w + x] = it.k;
      if (!spec.walk) block[y * w + x] = true;
    }
  }
  return { w, h, owner, block };
}

/** 문에서 걸어 닿을 수 있는 바닥 칸 수 */
export function reachableFromDoor(level: HouseLevel, items: PlacedItem[], lookup: FurnLookup): number {
  const { w, h, block } = occupancy(level, items, lookup);
  const { door } = houseLayout(level);
  if (block[door.y * w + door.x]) return 0;
  const seen = new Set([door.y * w + door.x]);
  const q = [door.y * w + door.x];
  for (let i = 0; i < q.length; i++) {
    const x = q[i] % w, y = Math.floor(q[i] / w);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || nx >= w || ny < 1 || ny >= h) continue;
      const k = ny * w + nx;
      if (seen.has(k) || block[k]) continue;
      seen.add(k); q.push(k);
    }
  }
  return seen.size;
}

/** 배치 전체 검사 — 문제가 없으면 null, 있으면 사람이 읽을 이유 */
export function validateHouse(level: HouseLevel, items: PlacedItem[], lookup: FurnLookup): string | null {
  if (items.length > HOUSE_MAX_ITEMS) return `가구는 한 집에 ${HOUSE_MAX_ITEMS}개까지 놓을 수 있어요`;
  const L = houseLayout(level);
  const seen = new Set<number>();
  const keys = new Set<string>();
  for (const it of items) {
    const spec = lookup(it.item);
    if (!spec) return '이 세계관에 없는 가구입니다';
    if (keys.has(it.k)) return '같은 가구가 두 번 놓였습니다';
    keys.add(it.k);
    const [fw, fh] = footprint(spec, it.r);
    // 뒷벽 줄(y=0)과 바깥은 놓을 수 없다
    if (it.x < 0 || it.y < 1 || it.x + fw > L.w || it.y + fh > L.h) return '집 밖이나 벽에는 놓을 수 없어요';
    for (let y = it.y; y < it.y + fh; y++) for (let x = it.x; x < it.x + fw; x++) {
      if ((x === L.door.x && y === L.door.y) || (x === L.front.x && y === L.front.y)) return '문과 문 앞은 비워 두어야 해요';
      const k = y * L.w + x;
      if (seen.has(k)) return '다른 가구와 겹쳐요';
      seen.add(k);
    }
  }
  // 소프트락 방지: 문에서 바닥 절반 이상에 걸어서 닿아야 한다
  if (reachableFromDoor(level, items, lookup) * 2 < L.floorCells) return '이렇게 놓으면 집 안을 걸어 다닐 수 없어요';
  return null;
}

/** 집을 넓히면 문이 가운데로 옮겨 가므로 가구를 오른쪽·아래로 한 칸씩 옮겨 문과의 관계를 그대로 둔다 */
export function upgradeShift(items: PlacedItem[]): PlacedItem[] {
  return items.map(it => ({ ...it, x: it.x + 1, y: it.y + 1 }));
}

/** 집 점수 = 놓인 가구 가격 합 ÷ 10 */
export function coziness(items: PlacedItem[], lookup: FurnLookup): number {
  return Math.floor(items.reduce((a, it) => a + (lookup(it.item)?.price ?? 0), 0) / 10);
}
/** 아늑함 별 단계(0~5) — 가구 몇 개면 첫 별, 시대 대표 가구를 들여야 마지막 별 */
export const COZY_STEPS = [10, 40, 100, 200, 400];
export const cozyStars = (score: number) => COZY_STEPS.filter(s => score >= s).length;
