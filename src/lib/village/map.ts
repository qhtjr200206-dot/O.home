// 마을 지형 생성은 순수 함수로 유지한다. 방의 비밀 데이터나 권한은 여기서 다루지 않는다.
// 같은 시드·시대·장소 목록은 언제나 같은 맵을 만든다(모든 접속자가 같은 마을을 본다).
export type VillageEra = 'past' | 'modern' | 'sf';
export type VillageTile = 'grass' | 'tree' | 'path' | 'plaza' | 'water' | 'flower' | 'rock';
export type PlaceKind = 'house' | 'shop' | 'water' | 'forest' | 'tower' | 'school' | 'field';
export interface VillagePlace { id: string; name: string }
export interface VillageMap {
  width: number;
  height: number;
  era: VillageEra;
  tiles: VillageTile[][];
  places: (VillagePlace & { x: number; y: number; kind: PlaceKind })[];
}

const WIDTH = 28;
const HEIGHT = 20;
const MAX_PLACES = 20;

/** 장소 이름에서 건물 모양을 고른다 — 세계관 입력이 실제 지형에 반영되도록 */
export function placeKind(name: string): PlaceKind {
  if (/바다|호수|강|연못|해변|항구|분수|우물|lake|sea|river/i.test(name)) return 'water';
  if (/숲|산|공원|정원|뒷산|들판|forest|park|garden/i.test(name)) return 'forest';
  if (/학교|학원|도서관|교회|성당|사원|academy|school|library/i.test(name)) return 'school';
  if (/탑|기지|함선|관제|연구|성|궁|tower|base|lab|castle/i.test(name)) return 'tower';
  if (/가게|상점|카페|식당|시장|주점|빵|편의점|shop|cafe|bar|market/i.test(name)) return 'shop';
  if (/밭|농장|목장|farm|field/i.test(name)) return 'field';
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
    }
  }
  const cx = Math.floor(WIDTH / 2);
  const cy = Math.floor(HEIGHT / 2);
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) tiles[y][x] = 'plaza';

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
  // 장소끼리 너무 붙지 않도록 고른다(가능하면 맨해튼 거리 4 이상)
  const chosen: { x: number; y: number }[] = [];
  for (const c of cells) {
    if (chosen.length >= places.length) break;
    if (chosen.every(o => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) >= 4)) chosen.push(c);
  }
  for (const c of cells) {
    if (chosen.length >= places.length) break;
    if (!chosen.some(o => o.x === c.x && o.y === c.y)) chosen.push(c);
  }
  const positioned = places.map((place, i) => {
    const { x, y } = chosen[i];
    const kind = placeKind(place.name);
    // 장소 주변 장식 — 물가·숲·밭은 이웃 칸에 지형을 덧칠한다(길은 아래에서 다시 뚫는다)
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]]) {
      const tx = x + dx, ty = y + dy;
      if (tx > 0 && ty > 0 && tx < WIDTH - 1 && ty < HEIGHT - 1 && tiles[ty][tx] !== 'plaza') {
        tiles[ty][tx] = kind === 'water' ? 'water' : kind === 'forest' ? 'tree' : kind === 'field' ? 'flower' : tiles[ty][tx];
      }
    }
    return { id: place.id, name: place.name, x, y, kind };
  });
  // 길을 마지막에 깔아 장식이 길을 막지 않게 한다. 가로 먼저/세로 먼저를 시드로 섞는다.
  for (const p of positioned) {
    let x = p.x, y = p.y;
    const horizontalFirst = random() < 0.5;
    const stepX = () => { while (x !== cx) { if (tiles[y][x] !== 'plaza') tiles[y][x] = 'path'; x += x < cx ? 1 : -1; } };
    const stepY = () => { while (y !== cy) { if (tiles[y][x] !== 'plaza') tiles[y][x] = 'path'; y += y < cy ? 1 : -1; } };
    if (horizontalFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  }
  for (const p of positioned) tiles[p.y][p.x] = 'path';
  return { width: WIDTH, height: HEIGHT, era, tiles, places: positioned };
}

export const walkable = (t: VillageTile | undefined) => t === 'grass' || t === 'path' || t === 'plaza' || t === 'flower';

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
