// 마을 경제 시험 (v3 사용자 요청 — 재화·경험치·레벨·호감도·채집·상점·가방·집 꾸미기).
//  1) 순수 규칙: 레벨 공식, 카탈로그 구성, 집 배치 규칙.
//  2) 기획서(docs/village-gdd.md) 11장: 30일 동안 세 유형(가끔·보통·최대)을 실제 규칙(economy.ts·catalog.ts)으로 시뮬레이션,
//     인플레이션 점검(30일 최대 수입 < 가구 한 세트 + 꾸미기 + 집 확장 총액).
//  3) 서버(server.ts)를 메모리 Firestore(scripts/village-fake-firestore.cjs)에서 그대로 돌려 구매·잔액 부족·레벨 잠금·하루 한도·
//     채집 쿨다운·권한 없음 403·가구 겹침/문 막기 거부·선물 재고 차감·호감도·레이트 리밋·방 삭제 정리를 확인한다.
// 실행: node scripts/test-village-economy.cjs   (표만 보려면 --table)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2));
  try { return origResolve.call(this, request, parent, ...rest); }
  catch (e) {
    for (const ext of ['.ts', '.tsx']) {
      const base = path.isAbsolute(request) ? request : path.resolve(path.dirname(parent?.filename ?? root), request);
      if (fs.existsSync(base + ext)) return base + ext;
    }
    throw e;
  }
};
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
}
const E = require(path.join(root, 'src/lib/village/economy.ts'));
const C = require(path.join(root, 'src/lib/village/catalog.ts'));
const H = require(path.join(root, 'src/lib/village/house.ts'));
const { generateVillageMap, walkable } = require(path.join(root, 'src/lib/village/map.ts'));
const sim = require(path.join(root, 'src/lib/village/sim.ts'));

/* ---------------- 1) 순수 규칙 ---------------- */
assert.deepEqual([2, 3, 5, 8, 10, 15, 20].map(E.need), [50, 174, 606, 1660, 2610, 5781, 10017]);
assert.equal(E.levelOf(0), 1); assert.equal(E.levelOf(49), 1); assert.equal(E.levelOf(50), 2); assert.equal(E.levelOf(1e9), 20);
assert.equal(E.levelProgress(100).level, 2); assert(E.levelProgress(100).frac > 0.3 && E.levelProgress(100).frac < 0.5);
assert.equal(E.titleOf(15), '마을 터줏대감'); assert.equal(E.titleOf(20), '마을의 전설'); assert.equal(E.titleOf(14), '');
assert.equal(E.kstDay(Date.UTC(2026, 10, 24, 15, 30)), '2026-11-25', '한국 시각 자정 기준');
for (const era of ['past', 'modern', 'sf']) {
  const gifts = C.GIFT_CATALOG[era], furn = C.FURNITURE_CATALOG[era];
  assert.equal(gifts.length, 12, `${era} 선물 12종`);
  assert.deepEqual([1, 3, 6, 10].map(l => gifts.filter(g => g.level === l).length), [4, 3, 3, 2], `${era} 선물 단계`);
  assert(gifts.every(g => [15, 30, 60, 100, 150].includes(g.price)));
  assert.equal(furn.filter(f => f.level <= 10).length, 24, `${era} 가구 24종`);
  assert.deepEqual([1, 3, 6, 10].map(l => furn.filter(f => f.level === l).length), [8, 6, 6, 4], `${era} 가구 단계`);
  assert(furn.every(f => [30, 80, 150, 300, 600].includes(f.price) && f.w >= 1 && f.h >= 1 && f.w <= 2 && f.h <= 2));
  assert.equal(furn.find(f => f.level === 20).id, 'f-goldframe');
  assert.equal(new Set([...gifts, ...furn, ...C.STYLE_CATALOG[era]].map(x => x.id)).size, 12 + furn.length + 6, '상품 id 중복 없음');
  // 예전 방의 선물 id가 남아 있다(소식 기록 호환)
  const legacy = { past: ['flower', 'tea', 'rice-cake', 'hairpin', 'book'], modern: ['coffee', 'cake', 'bouquet', 'ticket', 'plush'], sf: ['battery', 'chip', 'ration', 'crystal', 'drone'] }[era];
  assert(legacy.every(id => gifts.some(g => g.id === id)));
}
assert.equal(C.findItem('modern', 'f-piano').type, 'furniture'); assert.equal(C.findItem('past', 'f-piano'), null); assert.equal(C.findItem('sf', 'wall-neon').type, 'style');
// 채집표: 범위·결정성
for (const k of Object.keys(E.GATHER)) for (let i = 0; i < 200; i++) {
  const v = E.gatherRoll('s', 'a', 'p', i * E.GATHER_COOLDOWN_MS, k);
  assert(v >= E.GATHER[k].min && v <= E.GATHER[k].max);
  assert.equal(v, E.gatherRoll('s', 'a', 'p', i * E.GATHER_COOLDOWN_MS + 1000, k));
}
// 하루 한도: 넘치는 만큼 잘리고 경험치도 같은 비율
{
  const e = E.normalizeEcon({}, 'a', 'd');
  assert.deepEqual(E.grant(e, 'game', 140, 140), { coins: 140, exp: 140 });
  assert.deepEqual(E.grant(e, 'game', 30, 30), { coins: 10, exp: 10 });
  assert.deepEqual(E.grant(e, 'game', 30, 30), { coins: 0, exp: 0 });
  const e2 = E.normalizeEcon({ ...e, day: 'd' }, 'a', 'd2');
  assert.equal(e2.daily.game, 0, '날짜가 바뀌면 한도 초기화');
  assert.equal(e2.coins, 150);
  assert.deepEqual(E.normalizeEcon({ coins: -5, exp: 'x', inv: { 'f-bed': 3, bad: -1, '../x': 1 } }, 'a', 'd').inv, { 'f-bed': 3 });
}
// 호감도
assert.equal(E.bondTier(0).label, '낯선 사이'); assert.equal(E.bondTier(60).label, '친구'); assert.equal(E.bondTier(300).hearts, 4);
assert.equal(E.bondKey('b', 'a'), E.bondKey('a', 'b'));
assert.notEqual(E.bondKey('a', 'b__c'), E.bondKey('a__b', 'c'), '구분자가 들어간 배우 ID도 서로 다른 쌍');
assert.equal(E.giftBondPts(15, false), 2); assert.equal(E.giftBondPts(150, true), 30);
{
  const ids = C.GIFT_CATALOG.modern.map(g => g.id);
  const fav = E.favoriteGifts('seed', 'actor', ids);
  assert.equal(fav.length, 2); assert.notEqual(fav[0], fav[1]); assert.deepEqual(fav, E.favoriteGifts('seed', 'actor', ids));
}
// 집 배치 규칙
{
  const look = id => C.furnitureOf('modern', id);
  const L1 = H.houseLayout(1);
  assert.deepEqual([L1.w, L1.h, L1.door.x, L1.door.y], [8, 6, 4, 5]);
  assert.deepEqual([H.houseLayout(2).w, H.houseLayout(2).h, H.houseLayout(3).w, H.houseLayout(3).h], [10, 7, 12, 8]);
  const it = (k, item, x, y, r = 0) => ({ k, item, x, y, r, by: 'a' });
  assert.equal(H.validateHouse(1, [it('1', 'f-bed', 0, 1), it('2', 'f-table', 2, 1)], look), null);
  assert.match(H.validateHouse(1, [it('1', 'f-table', 0, 1), it('2', 'f-chair', 1, 1)], look), /겹/);
  assert.match(H.validateHouse(1, [it('1', 'f-chair', 4, 5)], look), /문/, '문 칸');
  assert.match(H.validateHouse(1, [it('1', 'f-table', 3, 4)], look), /문/, '문 앞 칸');
  assert.match(H.validateHouse(1, [it('1', 'f-chair', 0, 0)], look), /벽/, '뒷벽 줄');
  assert.match(H.validateHouse(1, [it('1', 'f-bed', 7, 5)], look), /밖|벽/, '집 밖');
  assert.equal(H.validateHouse(1, [it('1', 'f-bed', 6, 5, 1)], look), null, '회전하면 가로 2칸');
  // 문 옆을 가로막는 벽: 문 앞 칸 양옆과 그 위를 막으면 바닥 절반에 닿지 못한다
  const wall = [it('a', 'f-table', 2, 4), it('b', 'f-table', 5, 4), it('c', 'f-chair', 4, 3), it('d', 'f-chair', 3, 5), it('e', 'f-chair', 5, 5)];
  assert.match(H.validateHouse(1, wall, look) ?? '', /걸어/, '소프트락 거부');
  // 러그는 밟고 지나갈 수 있다
  assert.equal(H.validateHouse(1, [it('r', 'f-rug', 2, 4), it('r2', 'f-rug', 5, 4)], look), null);
  const shifted = H.upgradeShift([it('1', 'f-bed', 0, 1)]);
  assert.deepEqual([shifted[0].x, shifted[0].y], [1, 2]);
  assert.equal(H.validateHouse(2, shifted, look), null);
  assert.equal(H.coziness([it('1', 'f-bed', 0, 1), it('2', 'f-piano', 2, 1)], look), 75);
  assert.equal(H.cozyStars(75), 2);
}

/* ---------------- 2) 30일 시뮬레이션 (기획서 11장) ---------------- */
// 점수 가정: 별 줍기 46점(23), 짝 맞추기 840점(21) — 실제 플레이 기록(빠른 플레이 800~900점)을 근거로 잡은 '잘하는 보통 플레이'
const CATCH_SCORE = 46, MEMORY_SCORE = 840;
const PLACES = ['sea', 'river', 'forest', 'field', 'garden', 'lake'];
function month(profile, era = 'modern', days = 30) {
  const e = E.normalizeEcon({}, 'sim', 'd0');
  let income = 0, spent = 0, house = 1, giftsGiven = 0;
  const owned = [];
  const furn = C.FURNITURE_CATALOG[era].slice().sort((a, b) => a.level - b.level || a.price - b.price);
  for (let d = 0; d < days; d++) {
    const day = `d${d + 1}`;
    Object.assign(e, E.normalizeEcon(e, 'sim', day));
    const c0 = e.coins;
    const t0 = Date.UTC(2026, 10, 1) + d * 86400000;
    E.grant(e, 'attend', E.REWARD.attend.coins, E.REWARD.attend.exp);
    const games = { casual: 1, normal: 4, max: 99 }[profile];
    for (let i = 0; i < games && E.dailyLeft(e, 'game') > 0; i++) {
      const c = i % 2 ? E.memoryCoins(MEMORY_SCORE) : E.catchCoins(CATCH_SCORE);
      E.grant(e, 'game', c, c);
    }
    const talks = { casual: 0, normal: 5, max: 99 }[profile];
    for (let i = 0; i < talks && E.dailyLeft(e, 'talk') > 0; i++) E.grant(e, 'talk', 2, 2);
    if (profile === 'max') for (let i = 0; i < 5; i++) E.grant(e, 'wake', 3, 3);
    const gathers = { casual: 2, normal: 4, max: 99 }[profile];
    for (let i = 0; i < gathers && E.dailyLeft(e, 'gather') > 0; i++) {
      const kind = PLACES[i % PLACES.length];
      E.grant(e, 'gather', E.gatherRoll('sim-seed', profile, `p${i}`, t0 + i * E.GATHER_COOLDOWN_MS, kind), E.REWARD.gatherExp);
    }
    income += e.coins - c0;
    // 소비: 집 확장이 열리면 먼저 모으고, 아니면 아직 없는 가장 싼 가구. 선물은 가끔 유형 사흘마다, 나머지 이틀마다 하나
    const lv = E.levelOf(e.exp);
    const next = house < 3 ? C.HOUSE_UPGRADE[house + 1] : null;
    if (next && lv >= next.level) {
      if (e.coins >= next.price) { e.coins -= next.price; spent += next.price; house++; }
    } else {
      for (const f of furn) {
        if (f.level > lv || owned.includes(f.id) || e.coins < f.price) continue;
        e.coins -= f.price; spent += f.price; owned.push(f.id);
      }
    }
    if (d % (profile === 'casual' ? 3 : 2) === 0) {
      const gift = C.GIFT_CATALOG[era].filter(g => g.level <= lv && g.price <= e.coins).sort((a, b) => b.price - a.price)[0];
      if (gift) { e.coins -= gift.price; spent += gift.price; giftsGiven++; E.grant(e, null, 0, E.giftExp(gift.price)); }
    }
  }
  return { profile, level: E.levelOf(e.exp), exp: e.exp, income, perDay: Math.round(income / days), expPerDay: Math.round(e.exp / days), spent, left: e.coins, furniture: owned.length, house, giftsGiven };
}
const rows = ['casual', 'normal', 'max'].map(p => month(p));
const [casual, normal, max] = rows;
const sink = C.catalogSinkTotal('modern');
console.log('유형    | 레벨 | 경험치 | 하루 재화 | 하루 EXP | 30일 수입 | 소비 | 남은 | 가구 | 집 | 선물');
for (const r of rows) console.log(`${r.profile.padEnd(7)} | ${String(r.level).padStart(4)} | ${String(r.exp).padStart(6)} | ${String(r.perDay).padStart(9)} | ${String(r.expPerDay).padStart(8)} | ${String(r.income).padStart(9)} | ${String(r.spent).padStart(4)} | ${String(r.left).padStart(4)} | ${String(r.furniture).padStart(4)} | ${r.house}  | ${r.giftsGiven}`);
console.log(`카탈로그(현대) 가구 ${sink.furniture} + 바닥·벽 ${sink.styles} + 집 확장 ${sink.upgrades} = ${sink.total}`);
if (process.argv.includes('--table')) process.exit(0);
// 목표(기획서 11장)
assert(casual.level >= 7 && casual.level <= 9, `가끔: L8 전후 (${casual.level})`);
assert(casual.furniture >= 8 && casual.furniture <= 12, `가끔: 가구 8~12개 (${casual.furniture})`);
assert(casual.level >= 5 && casual.income >= C.HOUSE_UPGRADE[2].price, '가끔: 집 2단계 가능');
assert(normal.level >= 12 && normal.level <= 13, `보통: L12~13 (${normal.level})`);
assert(normal.house >= 2, `보통: 집 3단계 근처 (${normal.house})`);
assert(max.level >= 17 && max.level <= 19, `최대: L18 전후 (${max.level})`);
assert.equal(max.perDay, 275, '최대: 하루 재화 275');
// 인플레이션 점검: 30일 최대 수입 < 가구 한 세트 + 꾸미기 + 집 확장 → 한 달을 꽉 채워도 다 살 수 없다
for (const era of ['past', 'modern', 'sf']) {
  const m = month('max', era);
  const total = C.catalogSinkTotal(era).total;
  assert(m.income < total, `${era}: 30일 최대 수입 ${m.income} < 카탈로그 ${total}`);
  assert(m.furniture < C.FURNITURE_CATALOG[era].length, `${era}: 최대 유형도 30일에 전부 사지 못한다`);
}
console.log('village economy sim ok');

/* ---------------- 3) 서버 시험(메모리 Firestore) ---------------- */
(async () => {
  const { FakeFirestore } = require('./village-fake-firestore.cjs');
  const server = require(path.join(root, 'src/lib/village/server.ts'));
  const { hashRoomPassword } = require(path.join(root, 'src/lib/village/password.ts'));
  const KST = 9 * 3600 * 1000;
  const db = new FakeFirestore();
  const OWNER = 'ownerUid0001', MEMBER = 'memberUid002', STRANGER = 'strangerUid3';
  db.seed('meta/owner', { uid: 'adminUid0000', admins: ['adminUid0000'] });
  const charDoc = (id, grants = []) => ({ data: { id, name: id, visibility: 'public', color: '#336699', grants }, authorId: OWNER, visibility: 'public', editorIds: [OWNER] });
  const created = { seconds: 1_700_000_000, nanoseconds: 5000 };
  db.seed('characters/charA', charDoc('charA'), created);
  db.seed('characters/charB', charDoc('charB', [{ userId: MEMBER, level: 'play' }]), created);
  let clock = Date.UTC(2026, 10, 24, 12, 0) - KST;     // 한국 시각 정오
  const c = { db, key: Buffer.alloc(32, 9), now: () => clock };
  const places = [{ id: 'p0', name: '우리 집' }, { id: 'p1', name: '카페' }, { id: 'p2', name: '바다' }, { id: 'p3', name: '숲' }];
  const seed = 'econ-seed';
  const ident = id => ({ id, authorId: OWNER, created: `${created.seconds}:${created.nanoseconds}`, allow: id === 'charB' ? [MEMBER] : [] });
  const roomId = 'roomEconTest00000001';
  const roomPath = `village_rooms/${roomId}`;
  db.seed(roomPath, {
    name: '경제 시험', era: 'modern', worldview: '', seed, instance: 'inst1', status: 'active', ownerUid: OWNER, passwordVersion: 1,
    pwHash: await hashRoomPassword('password-1234'), places, createdAt: clock, relId: '',
    identities: [ident('charA'), ident('charB')],
    actors: [
      { id: 'charA', kind: 'char', name: 'charA', color: '#336699', avatar: null, personality: 'calm', home: 'p0', lines: [] },
      { id: 'charB', kind: 'char', name: 'charB', color: '#336699', avatar: null, personality: 'calm', home: 'p1', lines: [] },
      { id: 'npc:0', kind: 'npc', name: '엔피씨', color: '#888888', avatar: null, personality: 'lazy', home: 'p0', lines: [], role: '' },
    ],
  });
  const map = generateVillageMap(seed, 'modern', places);
  const sea = map.places.find(p => p.id === 'p2'), home = map.places.find(p => p.id === 'p0');
  assert.equal(sea.kind, 'sea'); assert.equal(home.kind, 'house');
  let owner = await server.joinRoom(c, roomId, 'password-1234', OWNER);
  let member = await server.joinRoom(c, roomId, 'password-1234', MEMBER);
  const stranger = await server.joinRoom(c, roomId, 'password-1234', STRANGER);
  const A = (action, tok = owner.token, uid = OWNER) => server.act(c, roomId, tok, uid, action);
  const econ = id => db._docs.get(`${roomPath}/econ/${id}`)?.data;
  const status = s => e => e.status === s;
  const tick = (ms = 61_000) => { clock += ms; };

  // 출석: 그날 첫 조작에 +30·+20, 두 번째는 없음
  const r1 = await A({ type: 'move', actor: 'charA', x: home.x, y: home.y });
  assert.deepEqual([r1.reward.coins, r1.reward.exp, r1.reward.attend], [30, 20, true]);
  const r2 = await A({ type: 'move', actor: 'charA', x: home.x, y: home.y });
  assert.equal(r2.reward, undefined);
  assert.equal(econ('charA').coins, 30);
  // 조작 해제는 출석이 아니다
  await server.act(c, roomId, owner.token, OWNER, { type: 'release', actor: 'npc:0' });
  assert.equal(econ('npc:0'), undefined);

  // 권한 없음 403 — 남의 캐릭터로 사기·집 꾸미기·채집
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'coffee' }, stranger.token, STRANGER), status(403));
  await assert.rejects(A({ type: 'house.upgrade', actor: 'charA', place: 'p0' }, member.token, MEMBER), status(403));
  await assert.rejects(A({ type: 'gather', actor: 'charA', place: 'p2' }, stranger.token, STRANGER), status(403));

  // 클라이언트 위치는 믿지 않고 실제 상점 근처에서만 구매한다.
  const shop = map.places.find(p => p.kind === 'shop');
  const far = map.places.find(p => Math.max(Math.abs(p.x - shop.x), Math.abs(p.y - shop.y)) > 1);
  db.seed(`${roomPath}/pos/charA`, { x: far.x, y: far.y, at: clock, by: OWNER });
  const walletBeforeFar = structuredClone(econ('charA'));
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'coffee', x: shop.x, y: shop.y }), status(409));
  assert.deepEqual(econ('charA'), walletBeforeFar);
  const atShop = () => db.seed(`${roomPath}/pos/charA`, { x: shop.x, y: shop.y, at: clock, by: OWNER });
  atShop();
  // 상점이 없는 맵은 광장 노점에서만 구매 가능하다.
  const originalRoom = structuredClone(db._docs.get(roomPath).data);
  const kioskPlaces = places.filter(p => p.id !== 'p1');
  const kioskMap = generateVillageMap(seed, 'modern', kioskPlaces);
  assert(kioskMap.kiosk);
  const kioskRoomId = 'roomKioskTest0000001';
  const kioskPath = `village_rooms/${kioskRoomId}`;
  db.seed(kioskPath, { ...originalRoom, instance: 'kiosk-inst', places: kioskPlaces });
  const kioskSession = await server.joinRoom(c, kioskRoomId, 'password-1234', OWNER);
  db.seed(`${kioskPath}/econ/charA`, walletBeforeFar);
  db.seed(`${kioskPath}/pos/charA`, { ...kioskMap.kiosk, at: clock, by: OWNER });
  await server.act(c, kioskRoomId, kioskSession.token, OWNER, { type: 'shop.buy', actor: 'charA', item: 'coffee' });
  atShop();
  // 조작 시간이 만료되면 이전 상점 좌표가 아니라 자율 시뮬레이션 위치를 쓴다.
  const { simulate } = require(path.join(root, 'src/lib/village/sim.ts'));
  const savedClock = clock;
  const actors = originalRoom.actors;
  let autonomous;
  for (let dt = 301_000; dt < 7_200_000; dt += 15_000) {
    const f = simulate(map, seed, actors, [], savedClock + dt).find(x => x.id === 'charA');
    if (f && Math.max(Math.abs(Math.round(f.x) - shop.x), Math.abs(Math.round(f.y) - shop.y)) > 1) { clock = savedClock + dt; autonomous = f; break; }
  }
  assert(autonomous && !autonomous.controlled);
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'coffee' }), status(409));
  clock = savedClock;
  atShop();
  // 구매: 클라이언트가 보낸 가격은 무시, 카탈로그 가격으로만
  const b1 = await A({ type: 'shop.buy', actor: 'charA', item: 'coffee', qty: 2, price: 0 });
  assert.equal(b1.ok, true);
  assert.equal(econ('charA').coins, 0); assert.equal(econ('charA').inv.coffee, 2);
  // 잔액 부족 409
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'coffee' }), status(409));
  // 레벨 잠금 403 (영화표는 레벨 3)
  db.seed(`${roomPath}/econ/charA`, { ...econ('charA'), coins: 1000 });
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'ticket' }), e => e.status === 403 && /레벨 3/.test(e.message));
  // 잘못된 수량·없는 상품·다른 시대 상품 400
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'coffee', qty: 6 }), status(400));
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'tea' }), status(400));
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'f-gayageum' }), status(400));

  // 선물: 가방에 없으면 409, 있으면 1개 차감 + 호감도 + 주는 쪽 경험치(가격의 10%)
  await assert.rejects(A({ type: 'gift', actor: 'charA', to: 'charB', item: 'cake' }), status(409));
  // 이전 v3 개발 데이터는 쌍이 일치할 때만 새 키로 이관한다.
  db.seed(`${roomPath}/bonds/charA__charB`, { a: 'charA', b: 'charB', pts: 7, day: E.kstDay(clock), talkToday: 0 });
  const exp0 = econ('charA').exp;
  const g1 = await A({ type: 'gift', actor: 'charA', to: 'charB', item: 'coffee' });
  assert.equal(econ('charA').inv.coffee, 1, '선물 재고 차감');
  assert.equal(econ('charA').exp, exp0 + 2, '선물 경험치 = 가격의 10%');
  const fav = E.favoriteGifts(seed, 'charB', C.GIFT_CATALOG.modern.map(g => g.id));
  const bond = () => db._docs.get(`${roomPath}/bonds/v3-${require('node:crypto').createHash('sha256').update(E.bondKey('charA', 'charB')).digest('hex')}`)?.data;
  assert.equal(bond().pts, 7 + (fav.includes('coffee') ? 4 : 2), '기존 호감도 보존');
  assert.equal(db._docs.has(`${roomPath}/bonds/charA__charB`), false);
  assert.equal(g1.liked, fav.includes('coffee'));
  // 좋아하는 선물: ×2 + 받는 쪽 지갑에 공개
  const likedGift = C.GIFT_CATALOG.modern.find(g => fav.includes(g.id) && g.level === 1) ?? C.GIFT_CATALOG.modern.find(g => fav.includes(g.id));
  db.seed(`${roomPath}/econ/charA`, { ...econ('charA'), coins: 5000, exp: E.need(10) });
  tick();
  atShop();
  await A({ type: 'shop.buy', actor: 'charA', item: likedGift.id });
  const before = bond().pts;
  const g2 = await A({ type: 'gift', actor: 'charA', to: 'charB', item: likedGift.id });
  assert.equal(g2.liked, true);
  assert.equal(bond().pts - before, E.giftBondPts(likedGift.price, true));
  assert.deepEqual(econ('charB').liked, [likedGift.id], '좋아하는 선물 공개');
  // 대화: +2 재화(하루 20까지), 호감도 +1(그 쌍 하루 5까지)
  const coins0 = econ('charA').coins, pts0 = bond().pts;
  for (let i = 0; i < 12; i++) {
    if (i === 6) tick();                                         // 대화 분당 12회 한도를 넘지 않게
    await A({ type: 'message', actor: 'charA', to: 'charB', text: `안녕 ${i}` });
  }
  assert.equal(econ('charA').coins - coins0, 20, '대화 재화 하루 20');
  assert.equal(bond().pts - pts0, 5, '대화 호감도 하루 5');
  // 레이트 리밋: 대화 분당 12회
  tick();
  for (let i = 0; i < 12; i++) await A({ type: 'message', actor: 'charA', to: 'npc:0', text: 'x' });
  await assert.rejects(A({ type: 'message', actor: 'charA', to: 'npc:0', text: 'x' }), status(429));

  // 채집: 장소 칸이나 바로 옆에서만, 2시간 쿨다운, 하루 60
  tick();
  await assert.rejects(A({ type: 'gather', actor: 'charA', place: 'p2' }), status(409), '멀리서는 안 된다');
  await assert.rejects(A({ type: 'gather', actor: 'charA', place: 'p0' }), status(400), '집은 채집 장소가 아니다');
  await A({ type: 'move', actor: 'charA', x: sea.x, y: sea.y });
  const g0 = econ('charA');
  const gr = await A({ type: 'gather', actor: 'charA', place: 'p2' });
  assert(gr.reward.coins >= 8 && gr.reward.coins <= 14 && gr.reward.exp === 8, JSON.stringify(gr.reward));
  assert.equal(econ('charA').coins - g0.coins, gr.reward.coins);
  await assert.rejects(A({ type: 'gather', actor: 'charA', place: 'p2' }), e => e.status === 429 && /분 뒤/.test(e.message), '쿨다운');
  // 하루 한도: 55까지 받은 상태면 5만
  tick(E.GATHER_COOLDOWN_MS);
  await A({ type: 'move', actor: 'charA', x: sea.x, y: sea.y });
  db.seed(`${roomPath}/econ/charA`, { ...econ('charA'), daily: { ...econ('charA').daily, gather: 55 } });
  const gcap = await A({ type: 'gather', actor: 'charA', place: 'p2' });
  assert.equal(gcap.reward.coins, 5, '채집 하루 한도 60');
  tick(E.GATHER_COOLDOWN_MS);
  await A({ type: 'move', actor: 'charA', x: sea.x, y: sea.y });
  await assert.rejects(A({ type: 'gather', actor: 'charA', place: 'p2' }), status(409), '한도 다 차면 거부');
  const feed = await server.roomState(c, roomId, owner.token, OWNER, 0);
  assert(feed.events.some(e => e.type === 'gather' && e.from === 'charA' && e.place === 'p2'));

  // 미니게임 하루 한도(합산 150): 149까지 받았으면 별 줍기 보상은 1
  db.seed(`${roomPath}/econ/charA`, { ...econ('charA'), daily: { ...econ('charA').daily, game: 149 } });
  tick();
  const gs = await A({ type: 'gameStart', actor: 'charA', game: 'catch' });
  tick(20_000);
  const games = require(path.join(root, 'src/lib/village/games.ts'));
  const st = games.catchStart(gs.seed); const xs = [];
  for (let i = 0; i < games.CATCH.TICKS; i++) { const tgt = st.items.filter(x => !x.bad).sort((a, b) => b.y - a.y)[0]; const x = Math.max(20, Math.min(280, Math.round(tgt ? tgt.x : 150))); xs.push(x); games.catchStep(st, x); }
  const sub = await A({ type: 'game', actor: 'charA', game: 'catch', gameId: gs.gameId, input: xs });
  assert(sub.score >= 2, `점수 ${sub.score}`);
  assert.equal(sub.reward.coins, 1, '미니게임 하루 한도');

  // 집: 주민만, 가구 배치 규칙은 서버가 같은 규칙으로 검사
  tick();
  await assert.rejects(A({ type: 'house.place', actor: 'charB', place: 'p0', item: 'f-bed', x: 0, y: 1 }, member.token, MEMBER), status(403), '주민이 아니면 403');
  await assert.rejects(A({ type: 'house.place', actor: 'charA', place: 'p2', item: 'f-bed', x: 0, y: 1 }), status(400), '집이 아닌 장소');
  await assert.rejects(A({ type: 'house.place', actor: 'charA', place: 'p0', item: 'f-bed', x: 0, y: 1 }), status(409), '가방에 없으면 409');
  atShop();
  for (const item of ['f-bed', 'f-table', 'f-chair']) await A({ type: 'shop.buy', actor: 'charA', item });
  await A({ type: 'house.place', actor: 'charA', place: 'p0', item: 'f-bed', x: 0, y: 1 });
  assert.equal(econ('charA').inv['f-bed'], undefined, '놓으면 가방에서 빠진다');
  await assert.rejects(A({ type: 'house.place', actor: 'charA', place: 'p0', item: 'f-table', x: 0, y: 2 }), e => e.status === 400 && /겹/.test(e.message), '겹침 거부');
  await assert.rejects(A({ type: 'house.place', actor: 'charA', place: 'p0', item: 'f-table', x: 3, y: 4 }), e => e.status === 400 && /문/.test(e.message), '문 막기 거부');
  assert.equal(econ('charA').inv['f-table'], 1, '거부되면 가방은 그대로');
  await A({ type: 'house.place', actor: 'charA', place: 'p0', item: 'f-table', x: 2, y: 1 });
  const houseDoc = () => db._docs.get(`${roomPath}/houses/p0`).data;
  assert.equal(houseDoc().items.length, 2);
  // NPC 주민(방 주인이 조작)도 같은 집을 꾸밀 수 있다. 돌리기·옮기기는 같은 가구 키로
  const tableK = houseDoc().items.find(i => i.item === 'f-table').k;
  await A({ type: 'house.place', actor: 'npc:0', place: 'p0', k: tableK, x: 6, y: 1, r: 1 });
  assert.deepEqual(houseDoc().items.find(i => i.k === tableK), { k: tableK, item: 'f-table', x: 6, y: 1, r: 1, by: 'charA' });
  // 거둘 가구의 원래 주인 가방이 가득 차면 집과 가방 모두 그대로다.
  db.seed(`${roomPath}/econ/charA`, { ...econ('charA'), inv: { ...econ('charA').inv, 'f-table': E.INV_MAX_EACH } });
  const beforeRemove = structuredClone(houseDoc());
  await assert.rejects(A({ type: 'house.remove', actor: 'npc:0', place: 'p0', k: tableK }), status(409));
  assert.deepEqual(houseDoc(), beforeRemove);
  assert.equal(econ('charA').inv['f-table'], E.INV_MAX_EACH);
  db.seed(`${roomPath}/econ/charA`, { ...econ('charA'), inv: { ...econ('charA').inv, 'f-table': E.INV_MAX_EACH - 1 } });
  // 거두면 놓은 배우의 가방으로
  await A({ type: 'house.remove', actor: 'npc:0', place: 'p0', k: tableK });
  assert.equal(econ('charA').inv['f-table'], E.INV_MAX_EACH);
  // 확장: 레벨 5 미만 403, 레벨 되면 800 차감 + 가구가 한 칸씩 옮겨 간다
  db.seed(`${roomPath}/econ/npc:0`, { actor: 'npc:0', coins: 5000, exp: 0, inv: {}, day: E.kstDay(clock), daily: { attend: 30, game: 0, talk: 0, wake: 0, gather: 0 }, gatherAt: {}, liked: [] });
  await assert.rejects(A({ type: 'house.upgrade', actor: 'npc:0', place: 'p0' }), e => e.status === 403 && /레벨 5/.test(e.message));
  const cA = econ('charA').coins;
  await A({ type: 'house.upgrade', actor: 'charA', place: 'p0' });
  assert.equal(econ('charA').coins, cA - 800);
  assert.equal(houseDoc().level, 2);
  assert.deepEqual([houseDoc().items[0].x, houseDoc().items[0].y], [1, 2]);
  // 바닥재: 사지 않은 것은 못 쓰고, 기본은 공짜
  await assert.rejects(A({ type: 'house.style', actor: 'charA', place: 'p0', style: 'floor-tile' }), status(409));
  await A({ type: 'shop.buy', actor: 'charA', item: 'floor-tile' });
  await assert.rejects(A({ type: 'shop.buy', actor: 'charA', item: 'floor-tile' }), status(409), '같은 바닥재 두 번 사기');
  await A({ type: 'house.style', actor: 'charA', place: 'p0', style: 'floor-tile' });
  assert.equal(houseDoc().floor, 'floor-tile');
  // 레이트 리밋: 상점 분당 30회
  tick();
  let limited = false;
  for (let i = 0; i < 31; i++) { try { await A({ type: 'shop.buy', actor: 'charA', item: 'coffee' }); } catch (e) { if (e.status === 429) { limited = i === 30; break; } throw e; } }
  assert(limited, '상점 분당 30회');

  // 레벨업: 소식 기록과 토스트 값
  tick(86400_000);                                               // 다음 날 → 출석 다시(방 세션 12시간이라 다시 입장)
  owner = await server.joinRoom(c, roomId, 'password-1234', OWNER);
  member = await server.joinRoom(c, roomId, 'password-1234', MEMBER);
  db.seed(`${roomPath}/econ/charB`, { ...(econ('charB') ?? {}), actor: 'charB', coins: 0, exp: 45, inv: {}, day: 'old', daily: {}, gatherAt: {}, liked: econ('charB')?.liked ?? [] });
  const lv = await A({ type: 'move', actor: 'charB', x: home.x, y: home.y }, member.token, MEMBER);
  assert.deepEqual([lv.reward.attend, lv.reward.levelUp, lv.reward.level], [true, true, 2]);
  const st2 = await server.roomState(c, roomId, member.token, MEMBER, 0, true);
  assert(st2.events.some(e => e.type === 'levelup' && e.from === 'charB' && e.level === 2));
  assert(st2.econ.some(e => e.actor === 'charA' && e.level === 10), '상태 조회에 지갑');
  assert(st2.houses.some(h => h.place === 'p0' && h.level === 2));
  assert(st2.bonds.some(b => b.pts > 0));
  assert(!JSON.stringify(st2).includes(MEMBER) && !JSON.stringify(st2).includes(OWNER), '응답에 uid가 새지 않는다');
  const light = await server.roomState(c, roomId, member.token, MEMBER, clock - 1);
  assert.equal(light.econ, undefined, '가벼운 폴링에는 지갑을 싣지 않는다');

  // 기존 방 호환: 예전 조작 위치가 걸을 수 없는 칸이 돼도 가까운 걸을 수 있는 칸에 선다
  const wet = []; for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.tiles[y][x] === 'deep') wet.push({ x, y });
  db.seed(`${roomPath}/pos/charB`, { x: wet[0].x, y: wet[0].y, at: clock, by: MEMBER });
  const st3 = await server.roomState(c, roomId, member.token, MEMBER, 0);
  const fr = sim.simulate(map, seed, st3.room.actors, st3.overrides, clock, st3.wakes).find(f => f.id === 'charB');
  assert(walkable(map.tiles[fr.y][fr.x]), '보정된 위치는 걸을 수 있는 칸');

  // 호감도 → 자율 행동: 친구 이상이면 같은 장소에서 짝을 먼저 짓는다(결정적)
  const actors3 = ['x', 'y', 'z'].map(id => ({ id, kind: 'char', name: id, color: '#888888', avatar: null, personality: 'calm', home: 'p1', lines: [] }));
  const noon = Date.UTC(2026, 10, 25, 3, 0);
  const plain = sim.simulate(map, seed, actors3, [], noon + 5 * 60_000);
  const friendly = sim.simulate(map, seed, actors3, [], noon + 5 * 60_000, [], [{ a: 'x', b: 'z', pts: 200 }]);
  assert.deepEqual(friendly, sim.simulate(map, seed, actors3, [], noon + 5 * 60_000, [], [{ a: 'x', b: 'z', pts: 200 }]));
  const xz = friendly.find(f => f.id === 'x');
  if (xz.place === friendly.find(f => f.id === 'z').place && !xz.moving) assert.equal(xz.partner, 'z', '같은 장소면 친구와 짝');
  void plain;

  // 방 삭제: econ·houses·bonds 하위 문서까지 지운다
  await server.deleteRoom(c, OWNER, roomId);
  assert(![...db._docs.keys()].some(k => k.startsWith(`${roomPath}/`) || k === roomPath), '하위 컬렉션 정리');
  console.log('village economy server ok');
})().catch(e => { console.error(e); process.exit(1); });
