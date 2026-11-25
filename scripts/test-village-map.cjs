// 의존 패키지 추가 없이 실제 TypeScript 모듈을 메모리에서 변환해 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const filename = require('node:path').resolve(__dirname, '../src/lib/village/map.ts');
const source = fs.readFileSync(filename, 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = module.paths;
mod._compile(js, filename);
const { generateVillageMap, terrainFlags, placeKind, walkable, nearestWalkable } = mod.exports;

const places = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `장소 ${i}` }));
// v3 지형 장소: 바다·강·호수·숲·산·밭·정원·우물을 건물과 섞은 장소 목록 — 시드마다 개수·순서를 바꿔 넣는다
const TERRAIN_NAMES = ['바다', '강', '호수', '숲', '뒷산', '밭', '정원', '우물', '해변', '개울', '연못', '정글', '언덕', '농장', '공원'];
const BUILD_NAMES = ['카페', '학교', '관제탑', '집', '주막', '편의점', '도서관', '여관'];
const mixed = n => {
  const k = 3 + (n % 18);
  return Array.from({ length: k }, (_, i) => ({ id: `m${i}`, name: (i + n) % 2 ? TERRAIN_NAMES[(i * 7 + n) % TERRAIN_NAMES.length] : `${BUILD_NAMES[(i + n) % BUILD_NAMES.length]} ${i}` }));
};
const TILES = new Set(['grass', 'tree', 'path', 'plaza', 'water', 'flower', 'rock', 'sand', 'deep', 'bridge', 'dock', 'field', 'cliff', 'reed']);
// 길로 이어졌다고 볼 타일: 길·광장·다리·선착장 (다리·선착장으로 끊긴 길이 없어야 한다 — 기획서 10장)
const ROAD = new Set(['path', 'plaza', 'bridge', 'dock']);
const seenTiles = new Set();
for (const era of ['past', 'modern', 'sf']) {
  for (let n = 0; n < 500; n++) {
    // 세계관 지형 플래그(w 물가, f 숲, r 황무지, b 꽃)를 붙인 시드도 같은 보장을 지켜야 한다
    const seed = String(Math.floor(n / 5)) + ['', '~w', '~f', '~rb', '~wfrb'][n % 5];
    const list = n % 2 ? mixed(n) : places;
    const map = generateVillageMap(seed, era, list);
    assert.deepEqual(map, generateVillageMap(seed, era, list));
    assert(map.tiles.flat().every(t => TILES.has(t)), '알 수 없는 타일');
    map.tiles.flat().forEach(t => seenTiles.add(t));
    // 선착장은 걸을 수 있는 칸과 맞닿아 있어야 한다(물 위에 떠 있는 섬 금지)
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.tiles[y][x] !== 'dock') continue;
      assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkable(map.tiles[y + dy]?.[x + dx])), `선착장 고립 ${seed} ${x},${y}`);
    }
    // 바다 장소: 장소 앞에 선착장, 둘레에 모래·깊은 물
    for (const p of map.places.filter(p => p.kind === 'sea')) {
      assert(['n', 's', 'w', 'e'].includes(p.dir));
      const [dx, dy] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[p.dir];
      assert.equal(map.tiles[p.y + dy][p.x + dx], 'dock', `바다 장소 앞 선착장 ${seed}`);
    }
    if (map.places.some(p => p.kind !== 'shop')) assert.equal(map.kiosk === null, map.places.some(p => p.kind === 'shop'));
    if (list === places) assert.equal(map.places.length, places.length);
    assert.equal(map.tiles.length, map.height);
    assert(map.tiles.every(row => row.length === map.width));
    assert.equal(new Set(map.places.map(p => `${p.x},${p.y}`)).size, list.length);
    const start = [Math.floor(map.width / 2), Math.floor(map.height / 2)];
    const seen = new Set([start.join(',')]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [nx, ny] of [[x+1,y], [x-1,y], [x,y+1], [x,y-1]]) {
        if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height || seen.has(`${nx},${ny}`)) continue;
        if (!ROAD.has(map.tiles[ny][nx])) continue;
        seen.add(`${nx},${ny}`);
        queue.push([nx, ny]);
      }
    }
    for (const p of map.places) assert(seen.has(`${p.x},${p.y}`), `${seed} ${p.name} 길 끊김`);
    // 길 칸은 모두 걸을 수 있다
    for (const k of seen) { const [x, y] = k.split(',').map(Number); assert(walkable(map.tiles[y][x])); }
  }
}
for (const t of TILES) assert(seenTiles.has(t), `생성되지 않은 타일 ${t}`);
// 장소 이름 → 종류 (지형 낱말이 먼저, 영어는 낱말 경계)
const KIND = { 바다: 'sea', 해변: 'sea', 항구: 'sea', 강: 'river', 개울: 'river', 호수: 'lake', 연못: 'lake', 숲: 'forest', 뒷산: 'mountain', 북한산: 'mountain', 밭: 'field', 목장: 'field', 정원: 'garden', 공원: 'garden', 우물: 'well', 분수: 'well', 편의점: 'shop', 고궁: 'tower', 'AOC 빌딩': 'house', '여현의 집': 'house', 별관: 'house', 강당: 'house', airport: 'house', 'Sea Port': 'sea' };
for (const [name, kind] of Object.entries(KIND)) assert.equal(placeKind(name), kind, name);
// 운영 '테스트' 방과 같은 장소 목록 — 바다는 해안 지형, 나머지는 건물
{
  const prod = ['AOC 빌딩', 'X제약회사', '고궁', '여현의 집', '별관', '편의점', '바다'].map((name, i) => ({ id: `p${i}`, name }));
  const m = generateVillageMap('6d571a88e71bfb64~w', 'sf', prod);
  const sea = m.places.find(p => p.name === '바다');
  assert.equal(sea.kind, 'sea');
  const near = (t, r) => { let n = 0; for (let y = sea.y - r; y <= sea.y + r; y++) for (let x = sea.x - r; x <= sea.x + r; x++) if (m.tiles[y]?.[x] === t) n++; return n; };
  assert(near('deep', 3) >= 3 && near('sand', 3) >= 2 && near('dock', 2) >= 2, '바다 장소 둘레 해안');
  // 예전 조작 위치가 물이 되어도 가장 가까운 걸을 수 있는 칸으로
  const wet = []; for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.tiles[y][x] === 'deep') wet.push([x, y]);
  for (const [x, y] of wet) { const q = nearestWalkable(m, x, y); assert(walkable(m.tiles[q.y][q.x])); assert(Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= 4); }
}
assert.notDeepEqual(generateVillageMap('a', 'sf', []), generateVillageMap('b', 'sf', []));
// 세계관 → 지형: 물가 세계관은 물 칸이 확실히 많고, 숲 세계관은 나무가 많다
const count = (m, t) => m.tiles.flat().filter(x => x === t).length;
let wMore = 0, fMore = 0;
for (let i = 0; i < 50; i++) {
  if (count(generateVillageMap(`${i}~w`, 'modern', []), 'water') > count(generateVillageMap(`${i}`, 'modern', []), 'water') + 15) wMore++;
  if (count(generateVillageMap(`${i}~f`, 'modern', []), 'tree') > count(generateVillageMap(`${i}`, 'modern', []), 'tree')) fMore++;
}
assert.equal(wMore, 50); assert.ok(fMore >= 48, String(fMore));
assert.equal(terrainFlags('작은 항구 마을, 뒷산에 숲이 있다'), 'wf');
assert.equal(terrainFlags('화성 기지의 폐허'), 'r');
assert.equal(terrainFlags(''), '');
assert.throws(() => generateVillageMap('a', 'sf', [...places, { id: '20', name: '추가' }]));
assert.throws(() => generateVillageMap('a', 'sf', [places[0], places[0]]));
assert.throws(() => generateVillageMap('a', 'unknown', []));
console.log('마을 맵: 1500개 시드(세계관 지형·v3 지형 장소 포함)·시대의 결정성, 크기, 장소 중복, 길·다리·선착장 연결, 새 타일 7종 생성, 장소 종류, 위치 보정 및 입력 검증 통과');
