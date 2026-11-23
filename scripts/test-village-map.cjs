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
const { generateVillageMap, terrainFlags } = mod.exports;

const places = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `장소 ${i}` }));
for (const era of ['past', 'modern', 'sf']) {
  for (let n = 0; n < 500; n++) {
    // 세계관 지형 플래그(w 물가, f 숲, r 황무지, b 꽃)를 붙인 시드도 같은 보장을 지켜야 한다
    const seed = String(Math.floor(n / 5)) + ['', '~w', '~f', '~rb', '~wfrb'][n % 5];
    const map = generateVillageMap(seed, era, places);
    assert.deepEqual(map, generateVillageMap(seed, era, places));
    assert.equal(map.tiles.length, map.height);
    assert(map.tiles.every(row => row.length === map.width));
    assert.equal(new Set(map.places.map(p => `${p.x},${p.y}`)).size, places.length);
    const start = [Math.floor(map.width / 2), Math.floor(map.height / 2)];
    const seen = new Set([start.join(',')]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [nx, ny] of [[x+1,y], [x-1,y], [x,y+1], [x,y-1]]) {
        if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height || seen.has(`${nx},${ny}`)) continue;
        if (!['path', 'plaza'].includes(map.tiles[ny][nx])) continue;
        seen.add(`${nx},${ny}`);
        queue.push([nx, ny]);
      }
    }
    for (const p of map.places) assert(seen.has(`${p.x},${p.y}`));
  }
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
console.log('마을 맵: 1500개 시드(세계관 지형 포함)·시대의 결정성, 크기, 장소 중복, 길 연결 및 입력 검증 통과');
