// 자는 캐릭터 깨우기 시험 (v2.0 사용자 요청 — "자는 중에도 깨울 수 있게").
//  1) sim.ts: 깨운 기록이 있으면 WAKE_MS 동안 잠들지 않는다, 기록은 다른 캐릭터·오래된 것·먼 미래 것에 영향이 없다.
//  2) server.ts act('wake'): 메모리 Firestore(scripts/village-fake-firestore.cjs)에서 실제 서버 코드로
//     자는 캐릭터만 깨울 수 있고, 깨어 있으면 409, 권한 없는 캐릭터로는 403, 방 밖 대상은 400, 깨운 뒤엔 상태에 반영된다.
//  3) pixelRamp.ts: 램프가 어두운 쪽은 더 어둡고 밝은 쪽은 더 밝다(도트 명암 규칙).
// 실행: node scripts/test-village-wake.cjs
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

const sim = require(path.join(root, 'src/lib/village/sim.ts'));
const { generateVillageMap } = require(path.join(root, 'src/lib/village/map.ts'));
const ramp = require(path.join(root, 'src/lib/village/pixelRamp.ts'));

// 한국 시각 03:00(새벽) — 모두 잔다
const KST = 9 * 3600 * 1000;
const at = (h, m = 0) => Date.UTC(2026, 10, 24, h, m) - KST;
const DAWN = at(3), NOON = at(12);
const places = [{ id: 'p0', name: '집' }, { id: 'p1', name: '카페' }, { id: 'p2', name: '학교' }];
const map = generateVillageMap('wake-seed', 'modern', places);
const actors = ['a', 'b', 'c'].map((id, i) => ({ id, kind: 'char', name: id, color: '#888888', avatar: null, personality: 'calm', home: `p${i}`, lines: ['안녕'] }));

{
  const frames = sim.simulate(map, 'wake-seed', actors, [], DAWN);
  assert(frames.every(f => f.sleeping), '새벽엔 모두 잔다');
  const woke = sim.simulate(map, 'wake-seed', actors, [], DAWN + 1000, [{ id: 'a', at: DAWN }]);
  assert.equal(woke.find(f => f.id === 'a').sleeping, false, '깨운 캐릭터는 깨어 있다');
  assert.equal(woke.find(f => f.id === 'a').woke, true, '막 깨어난 표시');
  assert(woke.filter(f => f.id !== 'a').every(f => f.sleeping), '다른 캐릭터는 계속 잔다');
  const later = sim.simulate(map, 'wake-seed', actors, [], DAWN + sim.WOKE_SHOW_MS + 1000, [{ id: 'a', at: DAWN }]);
  assert.equal(later.find(f => f.id === 'a').sleeping, false);
  assert.equal(later.find(f => f.id === 'a').woke, undefined, '표시는 잠깐만');
  const expired = sim.simulate(map, 'wake-seed', actors, [], DAWN + sim.WAKE_MS + 1, [{ id: 'a', at: DAWN }]);
  assert.equal(expired.find(f => f.id === 'a').sleeping, true, 'WAKE_MS가 지나면 다시 잔다');
  const future = sim.simulate(map, 'wake-seed', actors, [], DAWN, [{ id: 'a', at: DAWN + 10 * 60_000 }]);
  assert.equal(future.find(f => f.id === 'a').sleeping, true, '먼 미래 기록은 무시');
  assert.equal(sim.activeWake([{ id: 'a', at: NaN }], 'a', DAWN), null);
  assert.equal(sim.activeWake(undefined, 'a', DAWN), null);
  // 깨운 기록이 있어도 결정적(모든 접속자가 같은 결과)
  assert.deepEqual(sim.simulate(map, 'wake-seed', actors, [], DAWN + 5000, [{ id: 'b', at: DAWN }]), sim.simulate(map, 'wake-seed', actors, [], DAWN + 5000, [{ id: 'b', at: DAWN }]));
}

{
  // 도트 램프: [외곽선, 그림자, 기본, 밝음, 하이라이트] 밝기 순서
  const lum = hex => { const [r, g, b] = ramp.hexToRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; };
  for (const base of ['#7aa95a', '#c4544c', '#5ff2ff', '#9b9588', '#2f3759', '#efe7d8']) {
    const r = ramp.ramp(base);
    for (let i = 1; i < r.length; i++) assert(lum(r[i]) >= lum(r[i - 1]) - 0.5, `${base} 램프 ${i}`);
    assert(lum(r[0]) < lum(r[2]) && lum(r[4]) > lum(r[2]) - 0.5, `${base} 외곽선·하이라이트`);
    assert.match(r[0], /^#[0-9a-f]{6}$/);
  }
}

(async () => {
  const { FakeFirestore } = require('./village-fake-firestore.cjs');
  const server = require(path.join(root, 'src/lib/village/server.ts'));
  const { hashRoomPassword } = require(path.join(root, 'src/lib/village/password.ts'));
  const db = new FakeFirestore();
  const OWNER = 'ownerUid0001', MEMBER = 'memberUid002', STRANGER = 'strangerUid3';
  db.seed('meta/owner', { uid: 'adminUid0000', admins: ['adminUid0000'] });
  const charDoc = (id, authorId, grants = []) => ({ data: { id, name: id, visibility: 'public', color: '#336699', grants }, authorId, visibility: 'public', editorIds: [authorId] });
  const created = { seconds: 1_700_000_000, nanoseconds: 5000 };
  db.seed('characters/charA', charDoc('charA', OWNER), created);
  db.seed('characters/charB', charDoc('charB', OWNER, [{ userId: MEMBER, level: 'play' }]), created);
  let clock = DAWN;
  const c = { db, key: Buffer.alloc(32, 3), now: () => clock };
  const ident = id => ({ id, authorId: OWNER, created: `${created.seconds}:${created.nanoseconds}`, allow: id === 'charB' ? [MEMBER] : [] });
  db.seed('village_rooms/roomWakeTest00000001', {
    name: '깨우기 시험', era: 'modern', worldview: '', seed: 'wake-seed', instance: 'inst1', status: 'active', ownerUid: OWNER, passwordVersion: 1,
    pwHash: await hashRoomPassword('password-1234'), places, createdAt: DAWN, relId: '',
    identities: [ident('charA'), ident('charB')],
    actors: [
      { id: 'charA', kind: 'char', name: 'charA', color: '#336699', avatar: null, personality: 'calm', home: 'p0', lines: [] },
      { id: 'charB', kind: 'char', name: 'charB', color: '#336699', avatar: null, personality: 'calm', home: 'p1', lines: [] },
      { id: 'npc:0', kind: 'npc', name: '엔피씨', color: '#888888', avatar: null, personality: 'lazy', home: 'p2', lines: [], role: '' },
    ],
  });
  const room = 'roomWakeTest00000001';
  // createKey 형식이 바뀌어도 시험이 조용히 통과하지 않게 — 실제 서버의 조작 목록으로 확인
  const owner = await server.joinRoom(c, room, 'password-1234', OWNER);
  assert.deepEqual(await server.myControls(c, room, owner.token, OWNER), ['charA', 'charB', 'npc:0'], '방 주인은 자기 캐릭터와 NPC를 조작');
  const member = await server.joinRoom(c, room, 'password-1234', MEMBER);
  assert.deepEqual(await server.myControls(c, room, member.token, MEMBER), ['charB'], '허락받은 회원은 그 캐릭터만');
  const stranger = await server.joinRoom(c, room, 'password-1234', STRANGER);

  const st0 = await server.roomState(c, room, owner.token, OWNER, 0);
  assert.deepEqual(st0.wakes, [], '처음엔 깨운 기록 없음');
  // 권한 없는 캐릭터로 깨우기 → 403
  await assert.rejects(server.act(c, room, stranger.token, STRANGER, { type: 'wake', actor: 'charA', to: 'charB' }), e => e.status === 403);
  // 방에 없는 대상 → 400
  await assert.rejects(server.act(c, room, member.token, MEMBER, { type: 'wake', actor: 'charB', to: 'ghost' }), e => e.status === 400);
  // 회원이 자기 캐릭터로 남의 자는 캐릭터(NPC)를 깨운다
  await server.act(c, room, member.token, MEMBER, { type: 'wake', actor: 'charB', to: 'npc:0' });
  const st1 = await server.roomState(c, room, member.token, MEMBER, 0);
  assert.deepEqual(st1.wakes.map(w => w.id), ['npc:0']);
  assert(st1.events.some(e => e.type === 'wake' && e.from === 'charB' && e.to === 'npc:0'), '소식에 남는다');
  assert(!JSON.stringify(st1.events).includes(MEMBER), '소식에 회원 uid가 새지 않는다');
  // 이미 깨어 있으면 409
  clock += 1000;
  await assert.rejects(server.act(c, room, member.token, MEMBER, { type: 'wake', actor: 'charB', to: 'npc:0' }), e => e.status === 409);
  // 스스로 일어나기
  await server.act(c, room, member.token, MEMBER, { type: 'wake', actor: 'charB', to: 'charB' });
  const frames = sim.simulate(map, 'wake-seed', (await server.roomState(c, room, owner.token, OWNER, 0)).room.actors, [], clock + 1000, (await server.roomState(c, room, owner.token, OWNER, 0)).wakes);
  assert.equal(frames.find(f => f.id === 'charB').sleeping, false);
  assert.equal(frames.find(f => f.id === 'charA').sleeping, true);
  // 낮(모두 깨어 있음)에는 깨울 수 없다
  clock = NOON;
  await assert.rejects(server.act(c, room, owner.token, OWNER, { type: 'wake', actor: 'charA', to: 'charA' }), e => e.status === 409);
  console.log('village wake ok');

  // 비밀번호 재설정 (v2.1 사용자 요청): 지금 비밀번호 없이 방 주인·관리자만. 관리자는 쉬운 비밀번호(길이 4~64)도 허용
  const types = require(path.join(root, 'src/lib/village/types.ts'));
  assert.ok(types.passwordProblem('000000'), '회원 기준으로는 000000 거부');
  assert.equal(types.passwordProblem('000000', true), null, '관리자는 000000 허용');
  assert.ok(types.passwordProblem('000', true), '관리자도 4자 미만은 거부');
  await assert.rejects(server.changePassword(c, STRANGER, room, 'new-pass-9876'), e => e.status === 403, '남은 못 바꾼다');
  await assert.rejects(server.changePassword(c, OWNER, room, '000000'), e => e.status === 400, '방 주인(회원)은 쉬운 비밀번호 불가');
  await server.changePassword(c, OWNER, room, 'new-pass-9876');
  await assert.rejects(server.roomState(c, room, member.token, MEMBER, 0), e => e.status === 401, '바꾸면 기존 세션 무효');
  await server.changePassword(c, 'adminUid0000', room, '000000');
  await server.joinRoom(c, room, '000000', MEMBER);
  await assert.rejects(server.joinRoom(c, room, 'new-pass-9876', STRANGER), e => e.status === 401 || e.status === 403);
  console.log('village password reset ok');
})().catch(e => { console.error(e); process.exit(1); });
