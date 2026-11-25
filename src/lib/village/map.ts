// 마을 지형 생성은 순수 함수로 유지한다. 방의 비밀 데이터나 권한은 여기서 다루지 않는다.
// 같은 시드·시대·장소 목록은 언제나 같은 맵을 만든다(모든 접속자가 같은 마을을 본다).
export type VillageEra = 'past' | 'modern' | 'sf';
/** sand·deep·bridge·dock·field·cliff·reed는 지형 장소용 타일 (v3 사용자 요청 — '바다' 같은 장소는 건물 대신 지형) */
export type VillageTile = 'grass' | 'tree' | 'path' | 'plaza' | 'water' | 'flower' | 'rock'
  | 'sand' | 'deep' | 'bridge' | 'dock' | 'field' | 'cliff' | 'reed';
export type PlaceKind = 'house' | 'shop' | 'tower' | 'school'
  | 'sea' | 'river' | 'lake' | 'forest' | 'mountain' | 'field' | 'garden' | 'well';
/** 건물이 아니라 주변 지형을 바꾸는 장소 종류 */
export const TERRAIN_KINDS: PlaceKind[] = ['sea', 'river', 'lake', 'forest', 'mountain', 'field', 'garden', 'well'];
export interface VillagePlace { id: string; name: string }
export interface MapPlace extends VillagePlace {
  x: number; y: number; kind: PlaceKind;
  /** 바다 장소: 바다가 있는 쪽(선착장 방향) */
  dir?: 'n' | 's' | 'w' | 'e';
}
export interface VillageMap {
  width: number;
  height: number;
  era: VillageEra;
  tiles: VillageTile[][];
  places: MapPlace[];
  /** 'shop' 장소가 없는 방의 광장 노점 칸 (기획서 5장) */
  kiosk: { x: number; y: number } | null;
}

const WIDTH = 28;
const HEIGHT = 20;
const MAX_PLACES = 20;

/** 장소 이름에서 모양을 고른다 — 지형 낱말이 먼저다(기획서 7장). 영어는 낱말 경계로만 본다(airport → 바다 방지) */
export function placeKind(name: string): PlaceKind {
  if (/우물|분수|\b(well|fountain)\b/i.test(name)) return 'well';
  if (/바다|해변|해안|바닷가|항구|포구|섬|\b(sea|beach|coast|harbou?r|port|island|ocean)\b/i.test(name)) return 'sea';
  if (/호수|연못|저수지|\b(lake|pond)\b/i.test(name)) return 'lake';
  if (/강$|강가|강변|개울|하천|냇가|시냇|\b(river|stream|creek)\b/i.test(name)) return 'river';
  if (/화산|뒷산|언덕|봉우리|산기슭|산$|\b(mountain|hill|volcano)\b/i.test(name)) return 'mountain';
  if (/숲|정글|밀림|\b(forest|jungle|woods?)\b/i.test(name)) return 'forest';
  if (/정원|공원|화원|꽃밭|\b(garden|park)\b/i.test(name)) return 'garden';
  if (/밭|농장|목장|논$|들판|\b(farm|field|ranch)\b/i.test(name)) return 'field';
  if (/학교|학원|서당|서원|도서관|교회|성당|사원|academy|school|library/i.test(name)) return 'school';   // 서당·서원 (v3)
  if (/탑|기지|함선|관제|연구|성|궁|tower|base|lab|castle/i.test(name)) return 'tower';
  if (/가게|상점|카페|식당|시장|주점|빵|편의점|shop|cafe|bar|market/i.test(name)) return 'shop';
  return 'house';
}

/** 세계관 설명에서 지형 성격을 뽑는다 — 방 시드 끝에 '~플래그'로 붙여 모든 접속자가 같은 지형을 만든다.
 *  w: 물가(바다·강·섬) / f: 숲·산 / r: 황무지·사막·폐허 / b: 꽃·정원·봄 */
export function terrainFlags(worldview: string): string {
  const t = typeof worldview === 'string' ? worldview : '';
  let f = '';
  if (/바다|해변|항구|섬|강|호수|어촌|포구|해안|sea|ocean|island|river|harbor|port|coast/i.test(t)) f += 'w';
  if (/숲|산|정글|밀림|산골|요정|엘프|나무|forest|jungle|mountain|wood/i.test(t)) f += 'f';
  if (/사막|황무지|폐허|화성|모래|광산|황야|desert|waste|ruin|mars|canyon/i.test(t)) f += 'r';
  if (/꽃|정원|봄|벚꽃|축제|화원|flower|garden|spring|blossom/i.test(t)) f += 'b';
  return f;
}

/** 결정적 의사 난수(FNV-1a 시드 + mulberry 계열). 보안용으로 쓰지 않는다. */
export function seededRandom(text: string): () => number {
  let state = 2166136261;
  for (const ch of text) state = Math.imul(state ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** 장식으로 덮어써도 되는 '빈 땅' */
const soft = (t: VillageTile) => t === 'grass' || t === 'flower' || t === 'tree' || t === 'rock';

/** 동일한 시드와 입력은 언제나 같은 맵을 만든다. 보안용 난수로 사용하지 않는다. */
export function generateVillageMap(seed: string, era: VillageEra, places: VillagePlace[]): VillageMap {
  if (typeof seed !== 'string' || seed.length > 200 || !['past', 'modern', 'sf'].includes(era)) {
    throw new Error('잘못된 마을 설정입니다');
  }
  if (!Array.isArray(places) || places.length > MAX_PLACES || places.some(p =>
    !p || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 100 ||
    typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100
  ) || new Set(places.map(p => p.id)).size !== places.length) {
    throw new Error('잘못된 장소 목록입니다');
  }
  const random = seededRandom(`${era}:${seed}`);
  const flags = seed.includes('~') ? seed.slice(seed.lastIndexOf('~') + 1) : '';
  const treeP = flags.includes('f') ? 0.2 : flags.includes('r') ? 0.04 : 0.1;
  const flowerP = treeP + (flags.includes('b') ? 0.14 : flags.includes('r') ? 0.02 : 0.06);
  const rockP = flowerP + (flags.includes('r') ? 0.1 : 0.02);
  const tiles: VillageTile[][] = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, () => {
      const r = random();
      return r < treeP ? 'tree' : r < flowerP ? 'flower' : r < rockP ? 'rock' : 'grass';
    }));
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
  // 가장자리는 숲(SF는 바위 지대)으로 둘러 마을 경계를 만든다
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) tiles[y][x] = era === 'sf' ? 'rock' : 'tree';
  }
  // 시드로 정한 연못 하나
  const px = 3 + Math.floor(random() * (WIDTH - 8)), py = 3 + Math.floor(random() * (HEIGHT - 8));
  for (let y = py; y < py + 3; y++) for (let x = px; x < px + 4; x++) tiles[y][x] = 'water';
  // 물가 세계관: 아래쪽 가장자리를 따라 바다/강줄기를 깐다(길은 나중에 다시 뚫린다)
  if (flags.includes('w')) {
    for (let x = 1; x < WIDTH - 1; x++) {
      const depth = 1 + Math.floor(random() * 2);
      for (let d = 0; d < depth; d++) tiles[HEIGHT - 2 - d][x] = 'water';
      // 물가 바로 위 풀밭은 모래톱으로 — 물과 풀이 바로 맞닿지 않게 (v3)
      if (soft(tiles[HEIGHT - 2 - depth][x])) tiles[HEIGHT - 2 - depth][x] = 'sand';
    }
  }
  const cx = Math.floor(WIDTH / 2);
  const cy = Math.floor(HEIGHT / 2);
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) tiles[y][x] = 'plaza';
  const isPlaza = (x: number, y: number) => Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1;

  // 장소마다 다른 좌표를 쓰고 광장까지 길을 연결해 도보 접근성을 보장한다.
  const cells: { x: number; y: number }[] = [];
  for (let y = 2; y < HEIGHT - 2; y++) {
    for (let x = 2; x < WIDTH - 2; x++) {
      if (Math.abs(x - cx) > 2 || Math.abs(y - cy) > 2) cells.push({ x, y });
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const kinds = places.map(p => placeKind(p.name));
  const edgeDist = (c: { x: number; y: number }) => Math.min(c.x, WIDTH - 1 - c.x, c.y, HEIGHT - 1 - c.y);
  const sideOf = (c: { x: number; y: number }): 'n' | 's' | 'w' | 'e' => {
    const d = { s: HEIGHT - 1 - c.y, n: c.y, w: c.x, e: WIDTH - 1 - c.x };
    return (['s', 'n', 'w', 'e'] as const).reduce((a, b) => (d[b] < d[a] ? b : a));
  };
  const chosen: ({ x: number; y: number } | null)[] = places.map(() => null);
  const taken = () => chosen.filter((c): c is { x: number; y: number } => !!c);
  const free = (c: { x: number; y: number }) => !taken().some(o => o.x === c.x && o.y === c.y);
  const spaced = (c: { x: number; y: number }) => taken().every(o => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) >= 4);
  // 1) 바다 장소는 가장자리에서 3칸(없으면 2칸) 안쪽 칸 — 바다·모래사장이 가장자리를 따라 생기고 장소가 해변에 선다
  kinds.forEach((k, i) => {
    if (k !== 'sea') return;
    chosen[i] = cells.find(c => edgeDist(c) === 3 && spaced(c)) ?? cells.find(c => edgeDist(c) === 2 && spaced(c))
      ?? cells.find(c => edgeDist(c) <= 3 && free(c)) ?? null;
  });
  const seaSides = new Set(chosen.filter((c, i) => c && kinds[i] === 'sea').map(c => sideOf(c!)));
  const nearSea = (c: { x: number; y: number }) => Array.from(seaSides).some(s =>
    (s === 's' ? HEIGHT - 1 - c.y : s === 'n' ? c.y : s === 'w' ? c.x : WIDTH - 1 - c.x) <= 4);
  // 2) 강 장소는 광장에서 가로·세로 모두 3칸 이상 떨어진 칸을 먼저 — 바다 쪽으로 흘러드는 방향(바다와 수직)을 고를 수 있게
  kinds.forEach((k, i) => {
    if (k !== 'river' || chosen[i]) return;
    chosen[i] = cells.find(c => !nearSea(c) && spaced(c) && Math.abs(c.x - cx) >= 3 && Math.abs(c.y - cy) >= 3) ?? null;
  });
  // 3) 나머지 장소: 바닷가 띠는 피하고(건물이 바다에 잠기지 않게), 가능하면 맨해튼 거리 4 이상 떨어뜨린다
  for (const strict of [true, false]) {
    kinds.forEach((_, i) => {
      if (chosen[i]) return;
      chosen[i] = cells.find(c => !nearSea(c) && spaced(c)) ?? (strict ? null : cells.find(c => !nearSea(c) && free(c)) ?? cells.find(free) ?? null);
    });
  }
  const positioned: MapPlace[] = places.map((place, i) => ({ id: place.id, name: place.name, x: chosen[i]!.x, y: chosen[i]!.y, kind: kinds[i] }));

  // 시드 연못이 장소 바로 옆을 덮었으면 걷어 낸다 — 장소가 물에 둘러싸여 보이지 않게 (v3)
  for (const p of positioned) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (tiles[p.y + dy]?.[p.x + dx] === 'water') tiles[p.y + dy][p.x + dx] = 'grass';
  }
  // 3) 지형 장소 — 장소 칸 주변 지형지물을 바꾼다(길은 마지막에 다시 뚫는다)
  const setSoft = (x: number, y: number, t: VillageTile) => { if (inside(x, y) && !isPlaza(x, y) && soft(tiles[y][x])) tiles[y][x] = t; };
  // 3-1) 바다: 가장 가까운 가장자리를 따라 깊은 바다 2~3줄 + 모래사장 1~2줄, 바다 장소 칸 앞으로 나무 선착장 두 칸.
  //      장소 바로 앞(좌우 1칸)은 물이 장소 칸에 닿지 않게 줄이고, 선착장은 모든 해안을 깐 뒤에 놓는다
  const seaPlaces = positioned.filter(p => p.kind === 'sea');
  const sides = Array.from(new Set(seaPlaces.map(p => sideOf(p))));
  const at = (side: string, a: number, d: number) => (side === 's' ? { x: a, y: HEIGHT - 1 - d } : side === 'n' ? { x: a, y: d } : side === 'w' ? { x: d, y: a } : { x: WIDTH - 1 - d, y: a });
  const alongOf = (side: string, c: { x: number; y: number }) => (side === 'n' || side === 's' ? c.x : c.y);
  for (const side of sides) {
    const r = seededRandom(`sea|${seed}|${side}`);
    const along = side === 'n' || side === 's' ? WIDTH : HEIGHT;
    const here = seaPlaces.filter(p => sideOf(p) === side);
    let deep = 2, sand = 1, run = 0;
    for (let a = 0; a < along; a++) {
      // 3~5칸마다 물 깊이·모래 폭이 바뀌어 해안선이 들쭉날쭉하다
      if (run-- <= 0) { deep = 2 + (r() < 0.5 ? 1 : 0); sand = 1 + (r() < 0.5 ? 1 : 0); run = 3 + Math.floor(r() * 3); }
      let k = deep, s = sand;
      for (const p of here) if (Math.abs(a - alongOf(side, p)) <= 1) { const pd = edgeDist(p); k = Math.min(k, pd - 1); s = Math.min(s, pd - k); }
      for (let d = 0; d < k + s; d++) {
        const c = at(side, a, d);
        if (!inside(c.x, c.y) || isPlaza(c.x, c.y)) continue;
        if (d < k) tiles[c.y][c.x] = 'deep';
        else if (tiles[c.y][c.x] !== 'path') tiles[c.y][c.x] = 'sand';
      }
    }
  }
  for (const p of seaPlaces) {
    const side = sideOf(p), pd = edgeDist(p);
    for (let d = pd - 1; d >= Math.max(1, pd - 2); d--) { const c = at(side, alongOf(side, p), d); tiles[c.y][c.x] = 'dock'; }
  }
  for (const p of positioned) {
    const r = seededRandom(`terrain|${seed}|${p.id}`);
    if (p.kind === 'sea') {
      // 해안 띠는 아래에서 가장자리별로 한 번에 깐다(같은 쪽 바다 장소가 여럿이면 서로의 선착장을 덮지 않게)
      p.dir = sideOf(p);
    } else if (p.kind === 'river') {
      // 맵을 가로지르는 2칸 폭 강 — 장소 칸은 강가. 광장을 지나지 않는 쪽으로 흐르고, 바다가 있으면 바다로 흘러든다(해안과 수직)
      const seaSide = seaPlaces.length ? sideOf(seaPlaces[0]) : null;
      const canV = Math.abs(p.x - cx) >= 3, canH = Math.abs(p.y - cy) >= 3;
      const vertical = seaSide === 'n' || seaSide === 's' ? canV : seaSide === 'w' || seaSide === 'e' ? !canH : canV;
      const pos = vertical ? p.x : p.y, center = vertical ? cx : cy, len = vertical ? HEIGHT : WIDTH, span = vertical ? WIDTH : HEIGHT;
      const away = pos > center ? 1 : -1;
      let c0 = away > 0 ? pos + 1 : pos - 2;
      if (c0 < 1 || c0 + 1 > span - 2) c0 = away > 0 ? pos - 2 : pos + 1;
      // 장소에서 먼 곳에서 한 번 굽이친다(굽는 줄은 3칸 폭으로 이어 대각선 끊김이 없게). 광장 쪽으로는 굽지 않는다
      const along = vertical ? p.y : p.x;
      const bend = Math.floor(r() * len);
      const shift = away > 0 ? 1 : -1;
      const bendOk = Math.abs(bend - along) >= 3;
      for (let a = 0; a < len; a++) {
        const off = bendOk && (bend < along ? a < bend : a > bend) ? shift : 0;
        const cols = new Set([c0 + off, c0 + 1 + off]);
        if (bendOk && a === bend) { cols.add(c0); cols.add(c0 + 1); }
        for (const col of cols) {
          const x = vertical ? col : a, y = vertical ? a : col;
          if (!inside(x, y) || isPlaza(x, y) || (x === p.x && y === p.y)) continue;
          // 바다와 만나면 모래사장을 지나 바다로 이어진다(강어귀). 선착장은 지우지 않는다
          if (tiles[y][x] !== 'deep' && tiles[y][x] !== 'dock') tiles[y][x] = 'water';
        }
      }
      // 강가 갈대 — 드문드문(길은 나중에 다시 뚫는다)
      for (let y = 1; y < HEIGHT - 1; y++) for (let x = 1; x < WIDTH - 1; x++) {
        if (tiles[y][x] !== 'grass' || Math.abs(x - p.x) + Math.abs(y - p.y) <= 1) continue;
        const nearRiver = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[y + dy]?.[x + dx] === 'water');
        if (nearRiver && r() < 0.18) tiles[y][x] = 'reed';
      }
    } else if (p.kind === 'lake') {
      // 장소 둘레 5×4 타원 물 + 갈대 가장자리 + 장소 칸에서 물로 나가는 작은 나무 데크
      const above = p.y - 5 >= 1;
      const top = above ? p.y - 4 : p.y + 1;
      const mask = ['.XXX.', 'XXXXX', 'XXXXX', '.XXX.'];
      const water: [number, number][] = [];
      mask.forEach((row, j) => row.split('').forEach((ch, i) => {
        const x = p.x - 2 + i, y = top + j;
        if (ch === 'X' && x > 0 && y > 0 && x < WIDTH - 1 && y < HEIGHT - 1 && !isPlaza(x, y) && tiles[y][x] !== 'dock' && tiles[y][x] !== 'deep') { tiles[y][x] = 'water'; water.push([x, y]); }
      }));
      for (const [wx, wy] of water) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = wx + dx, y = wy + dy;
        if (Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1) continue;
        if (inside(x, y) && soft(tiles[y][x]) && r() < 0.5) tiles[y][x] = 'reed';
      }
      for (const d of [1, 2]) { const y = above ? p.y - d : p.y + d; if (inside(p.x, y) && tiles[y][p.x] === 'water') tiles[y][p.x] = 'dock'; }
    } else if (p.kind === 'forest') {
      // 반경 3의 나무 밀집, 가운데 빈터
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy), x = p.x + dx, y = p.y + dy;
        if (x <= 0 || y <= 0 || x >= WIDTH - 1 || y >= HEIGHT - 1) continue;
        if (d <= 1.5) setSoft(x, y, r() < 0.25 ? 'flower' : 'grass');
        else if (d <= 3.6 && r() < 0.85) setSoft(x, y, 'tree');
      }
    } else if (p.kind === 'mountain') {
      // 장소 뒤(위)쪽으로 절벽, 아래쪽엔 바위 — 꼭대기 표지석은 render.ts가 장소 칸에 세운다
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = p.x + dx, y = p.y + dy;
        if (x <= 0 || y <= 0 || x >= WIDTH - 1 || y >= HEIGHT - 1) continue;
        if (d <= 1) setSoft(x, y, 'grass');
        else if (dy <= 0 && r() < 0.8) setSoft(x, y, 'cliff');
        else if (r() < 0.35) setSoft(x, y, 'rock');
      }
    } else if (p.kind === 'field') {
      // 장소 둘레 4×3 경작지(고랑) — 울타리는 render.ts가 경작지 가장자리에 그린다
      const x0 = r() < 0.5 ? p.x - 2 : p.x - 1;
      for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = x0; x < x0 + 4; x++) {
        if (x > 0 && y > 0 && x < WIDTH - 1 && y < HEIGHT - 1) setSoft(x, y, 'field');
      }
    } else if (p.kind === 'garden') {
      // 꽃밭(반경 2) + 장소에서 네 방향으로 뻗는 산책로(십자) — 벤치는 render.ts. 대각선 칸까지 꽃이라 정원으로 읽힌다
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (x <= 0 || y <= 0 || x >= WIDTH - 1 || y >= HEIGHT - 1 || isPlaza(x, y) || (!dx && !dy)) continue;
        if ((dx === 0 || dy === 0) && Math.abs(dx + dy) === 1 && soft(tiles[y][x])) tiles[y][x] = 'path';
        else if (r() < 0.9) setSoft(x, y, 'flower');
      }
    }
  }
  // 4) 길을 마지막에 깔아 장식이 길을 막지 않게 한다. 물을 건너면 다리, 선착장·광장은 그대로 둔다.
  const carve = (x: number, y: number) => {
    const t = tiles[y][x];
    if (t === 'plaza' || t === 'dock' || t === 'bridge') return;
    tiles[y][x] = t === 'water' || t === 'deep' ? 'bridge' : 'path';
  };
  for (const p of positioned) {
    let x = p.x, y = p.y;
    const horizontalFirst = random() < 0.5;
    const stepX = () => { while (x !== cx) { carve(x, y); x += x < cx ? 1 : -1; } };
    const stepY = () => { while (y !== cy) { carve(x, y); y += y < cy ? 1 : -1; } };
    if (horizontalFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  }
  for (const p of positioned) tiles[p.y][p.x] = 'path';
  const kiosk = positioned.some(p => p.kind === 'shop') ? null : { x: cx + 1, y: cy - 1 };
  return { width: WIDTH, height: HEIGHT, era, tiles, places: positioned, kiosk };
}

/** 걸을 수 있는 타일 — 모래·다리·선착장·경작지도 걷는다. 깊은 물·절벽·갈대는 못 걷는다 */
export const walkable = (t: VillageTile | undefined) =>
  t === 'grass' || t === 'path' || t === 'plaza' || t === 'flower' || t === 'sand' || t === 'bridge' || t === 'dock' || t === 'field';

/** 가장 가까운 걸을 수 있는 칸 — 새 지형 규칙으로 예전 조작 위치(pos)가 물·절벽이 되어도 깨지지 않게 옮겨 세운다 (v3) */
export function nearestWalkable(map: VillageMap, x: number, y: number): { x: number; y: number } {
  const ix = Math.max(0, Math.min(map.width - 1, Math.round(Number(x) || 0)));
  const iy = Math.max(0, Math.min(map.height - 1, Math.round(Number(y) || 0)));
  if (walkable(map.tiles[iy]?.[ix])) return { x: ix, y: iy };
  for (let r = 1; r < Math.max(map.width, map.height); r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = ix + dx, ny = iy + dy;
      if (!walkable(map.tiles[ny]?.[nx])) continue;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { x: nx, y: ny, d };
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
}

/** 칸 사이 거리(체비쇼프) — '장소 칸이나 바로 옆'(채집·상점·집 들어가기) 판정 */
export const nearTile = (a: { x: number; y: number }, b: { x: number; y: number }, r = 1) =>
  Math.max(Math.abs(Math.round(a.x) - b.x), Math.abs(Math.round(a.y) - b.y)) <= r;

/** 4방향 최단 경로(시작 제외, 도착 포함). 막혀 있거나 같은 칸이면 빈 배열 */
export function findPath(map: VillageMap, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const key = (x: number, y: number) => y * map.width + x;
  if (!walkable(map.tiles[to.y]?.[to.x]) || (from.x === to.x && from.y === to.y)) return [];
  if (from.x < 0 || from.y < 0 || from.x >= map.width || from.y >= map.height) return [];
  const prev = new Int32Array(map.width * map.height).fill(-1);
  const start = key(from.x, from.y);
  prev[start] = start;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const x = k % map.width, y = Math.floor(k / map.width);
    if (x === to.x && y === to.y) break;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const nk = key(nx, ny);
      if (prev[nk] !== -1 || !walkable(map.tiles[ny][nx])) continue;
      prev[nk] = k;
      queue.push(nk);
    }
  }
  const end = key(to.x, to.y);
  if (prev[end] === -1) return [];
  const out: { x: number; y: number }[] = [];
  for (let k = end; k !== start; k = prev[k]) out.push({ x: k % map.width, y: Math.floor(k / map.width) });
  return out.reverse();
}
