// 미니게임 규칙(src/lib/village/games.ts) 검사 — 브라우저 진행과 서버 재생이 같은 점수를 내는지, 규칙 위반 입력을 거부하는지.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const g = require(path.resolve(__dirname, '../src/lib/village/games.ts'));

// 별 줍기: 브라우저처럼 한 틱씩 진행한 점수 == 서버 재생 점수, 결정적
for (let k = 0; k < 50; k++) {
  const seed = `seed-${k}`;
  const s = g.catchStart(seed);
  const xs = [];
  for (let t = 0; t < g.CATCH.TICKS; t++) {
    // 가장 가까운 별을 쫓는 간단한 플레이어
    const target = s.items.filter(i => !i.bad).sort((a, b) => b.y - a.y)[0];
    const x = Math.max(g.CATCH.BASKET_MIN, Math.min(g.CATCH.BASKET_MAX, Math.round(target ? target.x : 150)));
    xs.push(x); g.catchStep(s, x);
  }
  assert.equal(g.catchReplay(seed, xs), Math.min(g.CATCH.MAX_SCORE, s.score));
  assert.equal(g.catchReplay(seed, xs), g.catchReplay(seed, xs));
  assert.ok(s.score >= 0 && s.score <= g.CATCH.MAX_SCORE);
}
assert.equal(g.catchReplay('x', []), null);
assert.equal(g.catchReplay('x', Array(g.CATCH.TICKS).fill(10)), null, '범위 밖');
assert.equal(g.catchReplay('x', Array(g.CATCH.TICKS).fill(150.5)), null, '정수 아님');
assert.equal(g.catchReplay('x', Array(g.CATCH.TICKS + 1).fill(150)), null, '틱 수');
assert.equal(g.catchReplay('x', 'abc'), null);

// 짝 맞추기: 덱 결정성·시대별 아이콘(덱은 서버 판 문서에만 저장 — 진행·점수는 server.ts memoryFlip, 에뮬레이터 시험에서 검증)
for (const era of ['past', 'modern', 'sf']) {
  const deck = g.memoryDeck('s1', era);
  assert.deepEqual(deck, g.memoryDeck('s1', era));
  assert.equal(deck.length, 16);
  assert.equal(new Set(deck).size, 8);
  assert.ok([...new Set(deck)].every(icon => deck.filter(x => x === icon).length === 2));
  assert.notDeepEqual(deck, g.memoryDeck('s2', era));
}
assert.equal(g.memoryReplay, undefined, '시드 재생 방식(클라이언트가 덱을 아는 구조)은 없어야 함');
assert.equal(g.memoryScore(8, 0), 1000);
assert.equal(g.memoryScore(8, 30_000), 880);
assert.equal(g.memoryScore(60, 600_000), 0);
console.log('마을 미니게임 규칙: 별 줍기 재생 일치 50판, 짝 맞추기 덱·점수 규칙 통과');
