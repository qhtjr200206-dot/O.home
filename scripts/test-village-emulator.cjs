// 마을 서버 공격·회귀 시험 — 실제 Firestore/Auth 에뮬레이터에서 돈다(운영 DB와 무관한 demo 프로젝트).
// 실행: node scripts/run-village-emulator.cjs  (에뮬레이터를 띄우고 이 파일을 실행)
// 확인 항목: 방 격리, 비밀번호·시도 제한, 토큰 위조·만료·교차 사용, 캐릭터 조작 권한, 가입자 동시 1개/관리자 무제한,
// 동시 생성 경합, 삭제 후 재생성·접근 폐기·하위 데이터 정리, 클라이언트 SDK 직접 접근 차단(운영·설치 규칙 모두).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('에뮬레이터 환경변수가 없습니다 — scripts/run-village-emulator.cjs 로 실행하세요');
  process.exit(2);
}
const root = path.join(__dirname, '..');
// TypeScript 소스를 그대로 불러온다(@/ 별칭 포함)
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
  require.extensions[ext] = (m, filename) => {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    m._compile(out, filename);
  };
}
process.env.VILLAGE_EMULATOR = '1';
process.env.VILLAGE_EMULATOR_PROJECT = 'demo-ohome-village';
delete process.env.VERCEL;

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const server = require(path.join(root, 'src/lib/village/server.ts'));
const { handleVillage } = require(path.join(root, 'src/lib/village/firebase.ts'));

const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n ', e.stack); process.exitCode = 1; }
};

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
async function user(email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'pw123456', returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('auth emulator signUp 실패 ' + JSON.stringify(j));
  return { uid: j.localId, idToken: j.idToken };
}
let ip = 0;
async function call(op, body = {}, idToken, client) {
  const headers = { 'content-type': 'application/json', 'x-real-ip': client ?? `10.0.0.${++ip % 250}` };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  const res = await handleVillage(new Request('http://localhost/api/village', { method: 'POST', headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, body: await res.json(), headers: res.headers };
}
const roomInput = (chars, extra = {}) => ({
  name: '테스트 마을', era: 'modern', worldview: '작은 바닷가 마을', password: 'secret-1',
  places: ['카페', '바닷가', '학교'], chars: chars.map(c => ({ personality: 'lively', home: 'p0', lines: ['안녕!', '오늘 날씨 좋다'], ...(typeof c === 'string' ? { id: c } : c) })),
  npcs: [{ name: '우체부', role: '배달', personality: 'curious', lines: ['편지 왔어요'] }], ...extra,
});

(async () => {
  const adminApp = getApps().find(a => a.name === 'fixtures') ?? initializeApp({ projectId: 'demo-ohome-village' }, 'fixtures');
  const db = getFirestore(adminApp);
  const [admin, alice, bob, carol, dave] = await Promise.all(['admin', 'alice', 'bob', 'carol', 'dave'].map(n => user(`${n}-${Date.now()}@test.local`)));
  await db.doc('meta/owner').set({ uid: admin.uid, admins: [] });
  const ch = (id, authorId, visibility, extra = {}) => db.doc(`characters/${id}`).set({ data: { id, name: id.toUpperCase(), color: '#aa8899', pixelAvatar: { hair: 3, face: 2, body: 5, hairColor: '#112233', skinColor: '#ffddcc', bodyColor: '#445566' }, ...extra }, authorId, visibility, sort: 0 });
  await Promise.all([
    ch('c-alice', alice.uid, 'public'),
    ch('c-bob-private', bob.uid, 'private'),
    ch('c-admin', admin.uid, 'public', { grants: [{ userId: carol.uid, level: 'play' }] }),
    ch('c-member', admin.uid, 'member'),
  ]);

  let roomA, tokenA;
  await step('비로그인 방 생성 거부(401)', async () => {
    const r = await call('create', { room: roomInput(['c-alice']) });
    assert.equal(r.status, 401);
  });
  await step('가입자 방 생성 성공 + 응답 no-store', async () => {
    // c-admin의 권한 회원 carol을 이 방에서 조작해도 된다고 방 주인이 허락한다
    const r = await call('create', { room: roomInput(['c-alice', { id: 'c-admin', allow: [carol.uid, dave.uid] }, 'c-member']) }, alice.idToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.headers.get('cache-control'), /no-store/);
    roomA = r.body.roomId; tokenA = r.body.token;
    const doc = (await db.doc(`village_rooms/${roomA}`).get()).data();
    assert.deepEqual(doc.identities.find(x => x.id === 'c-admin').allow, [carol.uid], '권한이 없는 uid(dave)는 허락 목록에서 빠짐');
    assert.match(doc.pwHash, /^scrypt-v1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.ok(!JSON.stringify(doc).includes('secret-1'), '평문 비밀번호 저장 금지');
  });
  await step('가입자 두 번째 방 생성 거부(409)', async () => {
    const r = await call('create', { room: roomInput(['c-alice']) }, alice.idToken);
    assert.equal(r.status, 409);
  });
  await step('남의 비공개 캐릭터로 방 생성 거부(403)', async () => {
    const r = await call('create', { room: roomInput(['c-bob-private']) }, carol.idToken);
    assert.equal(r.status, 403);
    const owned = await db.collection('village_rooms').where('ownerUid', '==', carol.uid).get();
    assert.equal(owned.size, 0);
  });
  await step('나만보기 캐릭터는 작성자·관리자도 마을에 넣을 수 없음(안내 문구)', async () => {
    const own = await call('create', { room: roomInput(['c-bob-private']) }, bob.idToken);
    assert.equal(own.status, 403);
    assert.match(own.body.error, /나만보기/);
    const adm = await call('create', { room: roomInput(['c-bob-private']) }, admin.idToken);
    assert.equal(adm.status, 403);
    assert.equal((await db.collection('village_rooms').where('ownerUid', '==', bob.uid).get()).size, 0);
  });
  await step('가입자 동시 생성 8건 경합 — 정확히 1건만 성공', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => call('create', { room: roomInput(['c-alice']) }, bob.idToken)));
    const ok = rs.filter(r => r.status === 200).length;
    assert.equal(ok, 1, JSON.stringify(rs.map(r => r.status)));
    // 나머지는 한도 초과(409) 또는 경합 재시도 실패(409) — 서버 오류(500) 없이 닫혀야 한다
    assert.ok(rs.every(r => r.status === 200 || r.status === 409), JSON.stringify(rs.map(r => [r.status, r.body.error])));
    const owned = await db.collection('village_rooms').where('ownerUid', '==', bob.uid).get();
    assert.equal(owned.size, 1);
  });
  const adminRooms = [];
  await step('관리자 무제한 생성(경합 시 재시도)', async () => {
    const rs = await Promise.all(Array.from({ length: 4 }, () => call('create', { room: roomInput(['c-admin']) }, admin.idToken)));
    assert.ok(rs.every(r => [200, 409].includes(r.status)), JSON.stringify(rs.map(r => r.status)));
    adminRooms.push(...rs.filter(r => r.status === 200).map(r => r.body.roomId));
    while (adminRooms.length < 4) {
      const r = await call('create', { room: roomInput(['c-admin']) }, admin.idToken);
      assert.equal(r.status, 200);
      adminRooms.push(r.body.roomId);
    }
  });
  await step('목록에는 이름·시대만(비밀·내용 없음)', async () => {
    const r = await call('list', {});
    assert.equal(r.status, 200);
    const s = JSON.stringify(r.body);
    for (const leak of ['pwHash', 'scrypt', 'actors', 'worldview', '안녕!', 'seed', 'instance', 'ownerUid']) assert.ok(!s.includes(leak), leak);
    assert.ok(r.body.rooms.some(x => x.id === roomA));
  });
  await step('토큰 없이/엉뚱한 토큰으로 방 상태 조회 거부', async () => {
    assert.equal((await call('state', { roomId: roomA })).status, 401);
    assert.equal((await call('state', { roomId: roomA, token: 'abc.def' })).status, 401);
    const [body, mac] = tokenA.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), e: Date.now() + 9e9 })).toString('base64url');
    assert.equal((await call('state', { roomId: roomA, token: `${forged}.${mac}` }, alice.idToken)).status, 401, '서명 위조');
  });
  await step('다른 방 토큰으로 교차 조회·쓰기 거부', async () => {
    const r = await call('state', { roomId: adminRooms[0], token: tokenA }, alice.idToken);
    assert.equal(r.status, 401);
    const w = await call('act', { roomId: adminRooms[0], token: tokenA, action: { type: 'message', actor: 'c-alice', to: 'npc:0', text: 'x' } }, alice.idToken);
    assert.equal(w.status, 401);
  });
  await step('토큰은 발급받은 로그인 사용자에게만 유효(다른 계정이 훔쳐 쓰기 거부)', async () => {
    assert.equal((await call('state', { roomId: roomA, token: tokenA }, carol.idToken)).status, 401);
    assert.equal((await call('state', { roomId: roomA, token: tokenA })).status, 401);
    assert.equal((await call('state', { roomId: roomA, token: tokenA }, alice.idToken)).status, 200);
  });
  await step('익명 입장 거부 및 기존 익명 토큰의 로그인 계정 사용 거부', async () => {
    assert.equal((await call('join', { roomId: roomA, password: 'secret-1' })).status, 401);
    const data = (await db.doc(`village_rooms/${roomA}`).get()).data();
    const key = Buffer.alloc(32, 4);
    const token = server.signSession(key, { r: roomA, i: data.instance, v: data.passwordVersion, u: '', e: Date.now() + 60000 });
    await assert.rejects(server.roomState({ db, key }, roomA, token, alice.uid, 0), e => e.status === 401);
  });
  await step('예약된 NPC 접두 캐릭터 거부', async () => {
    await ch('npc:0', admin.uid, 'public');
    assert.equal((await call('create', { room: roomInput(['npc:0']) }, admin.idToken)).status, 400);
  });
  await step('캐릭터 삭제·재생성 시 원본 권한 폐기, 같은 문서의 작성자 변경은 사이트 권한 모델 그대로', async () => {
    await ch('identity-test', alice.uid, 'public');
    const r = await call('create', { room: roomInput(['identity-test']) }, admin.idToken);
    assert.equal(r.status, 200);
    const id = r.body.roomId;
    const j = await call('join', { roomId: id, password: 'secret-1' }, alice.idToken);
    const b = await call('join', { roomId: id, password: 'secret-1' }, bob.idToken);
    const controls = (token, auth) => call('controls', { roomId: id, token }, auth);
    assert.deepEqual((await controls(j.body.token, alice.idToken)).body.actors, ['identity-test']);
    assert.ok(!JSON.stringify((await call('state', { roomId: id, token: j.body.token }, alice.idToken)).body).includes('identities'));
    // 같은 문서에서 작성자가 바뀌면(사이트 규칙상 작성자·관리자만 가능) 새 작성자가 조작, 이전 작성자는 불가
    await db.doc('characters/identity-test').update({ authorId: bob.uid });
    assert.deepEqual((await controls(b.body.token, bob.idToken)).body.actors, ['identity-test']);
    assert.deepEqual((await controls(j.body.token, alice.idToken)).body.actors, []);
    await db.doc('characters/identity-test').update({ authorId: alice.uid });
    await db.doc('characters/identity-test').delete();
    await ch('identity-test', alice.uid, 'public', { grants: [{ userId: bob.uid, level: 'play' }] });
    assert.deepEqual((await controls(j.body.token, alice.idToken)).body.actors, []);
    assert.deepEqual((await controls(b.body.token, bob.idToken)).body.actors, []);
    assert.equal((await call('act', { roomId: id, token: b.body.token, action: { type: 'release', actor: 'identity-test' } }, bob.idToken)).status, 403);
    // 원본과 다른 문서는 관리자도 조작 불가, 방 화면에서도 사라진다
    assert.ok(!(await controls(r.body.token, admin.idToken)).body.actors.includes('identity-test'));
    await new Promise(res => setTimeout(res, 4200));
    assert.ok(!(await call('state', { roomId: id, token: j.body.token }, alice.idToken)).body.room.actors.some(x => x.id === 'identity-test'), '재생성된 다른 문서는 방에 표시 안 됨');
    await db.doc(`village_rooms/${id}`).update({ identities: require('firebase-admin/firestore').FieldValue.delete() });
    assert.deepEqual((await controls(j.body.token, alice.idToken)).body.actors, []);
  });
  await step('메시지 표시 제어문자 제거 및 빈 메시지 거부', async () => {
    const send = text => call('act', { roomId: roomA, token: tokenA, action: { type: 'message', actor: 'c-alice', to: 'npc:0', text } }, alice.idToken);
    assert.equal((await send('‮​⁦')).status, 400);
    assert.equal((await send('한‮​⁦글')).status, 200);
    const state = await call('state', { roomId: roomA, token: tokenA }, alice.idToken);
    assert.ok(state.body.events.some(e => e.text === '한글'));
  });
  await step('위조된 Firebase ID 토큰 거부(형식 파손·서명 변조)', async () => {
    const fake = alice.idToken.split('.').slice(0, 2).join('.') + '.AAAA';
    for (const t of [fake, 'garbage', 'a.b.c']) {
      const r = await call('create', { room: roomInput(['c-admin']) }, t);
      assert.equal(r.status, 401, t.slice(0, 10));
    }
  });
  await step('uid 바꿔치기(서명 없는) 토큰 — 실제 Firebase 검증 경로(에뮬레이터 밖)에서 거부', async () => {
    // Auth 에뮬레이터는 서명을 검사하지 않으므로, 에뮬레이터 환경변수를 지운 별도 프로세스에서
    // 운영과 같은 Admin SDK verifyIdToken(구글 공개키 서명 검증)으로 확인한다.
    const p = JSON.parse(Buffer.from(alice.idToken.split('.')[1], 'base64url'));
    const swapped = [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ ...p, user_id: admin.uid, sub: admin.uid })).toString('base64url'), ''].join('.');
    const { spawnSync } = require('node:child_process');
    const env = { ...process.env }; delete env.FIREBASE_AUTH_EMULATOR_HOST; delete env.FIRESTORE_EMULATOR_HOST;
    const code = `const {initializeApp}=require('firebase-admin/app');const {getAuth}=require('firebase-admin/auth');getAuth(initializeApp({projectId:'demo-ohome-village'})).verifyIdToken(process.argv[1],true).then(()=>{console.log('ACCEPTED');process.exit(3)},e=>{console.log('REJECTED',e.code);process.exit(0)})`;
    const r = spawnSync(process.execPath, ['-e', code, swapped], { env, cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.startsWith('REJECTED auth/'), r.stdout);
    console.log('   실제 검증 결과:', r.stdout.trim());
  });
  let tokenCarol;
  await step('계정별 제한: IP 위조 우회 불가 및 다른 계정 입장 유지', async () => {
    for (let i = 0; i < 8; i++) assert.equal((await call('join', { roomId: roomA, password: 'wrong' + i }, dave.idToken, `203.0.113.${i}`)).status, 401);
    assert.equal((await call('join', { roomId: roomA, password: 'secret-1' }, dave.idToken, '203.0.113.99')).status, 429);
    assert.equal((await call('join', { roomId: roomA, password: 'secret-1' }, carol.idToken, '203.0.113.99')).status, 200);
    assert.equal((await call('join', { roomId: roomA, password: 'secret-1' }, alice.idToken, '203.0.113.99')).status, 200);
  });
  await step('병렬 대입은 계정당 예약 8회까지만 검사', async () => {
    const id = adminRooms[0];
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call('join', { roomId: id, password: 'guess' + i }, dave.idToken, `198.51.100.${i}`)));
    assert.ok(rs.every(r => [401, 409, 429].includes(r.status)), JSON.stringify(rs.map(r => r.status)));
    const { createHash } = require('node:crypto');
    const ref = db.doc(`village_join_tries/${createHash('sha256').update(`u|${dave.uid}|${id}`).digest('hex')}`);
    const recorded = (await ref.get()).data().fails;
    assert.equal(recorded, rs.filter(r => r.status === 401).length);
    assert.ok(recorded <= 8);
  });
  await step('입장 비밀번호 검증 중 변경·삭제된 방 내용은 반환하지 않음', async () => {
    const passwordModule = require(path.join(root, 'src/lib/village/password.ts'));
    const original = passwordModule.verifyRoomPassword;
    try {
      for (const mutation of ['password', 'delete']) {
        const created = await call('create', { room: roomInput(['c-admin']) }, admin.idToken);
        assert.equal(created.status, 200);
        const ref = db.doc(`village_rooms/${created.body.roomId}`);
        passwordModule.verifyRoomPassword = async (...args) => {
          const ok = await original(...args);
          if (mutation === 'password') await ref.update({ passwordVersion: 2 });
          else await ref.delete();
          return ok;
        };
        await assert.rejects(server.joinRoom({ db, key: Buffer.alloc(32) }, ref.id, 'secret-1', bob.uid), e => e.status === 401);
        passwordModule.verifyRoomPassword = original;
      }
    } finally { passwordModule.verifyRoomPassword = original; }
  });
  await step('올바른 비밀번호로 입장 → 방 내용 수신', async () => {
    const r = await call('join', { roomId: roomA, password: 'secret-1' }, carol.idToken);
    assert.equal(r.status, 200);
    tokenCarol = r.body.token;
    assert.equal(r.body.room.actors.length, 4);
    assert.ok(!JSON.stringify(r.body).includes('pwHash'));
  });
  await step('조작 권한: 작성자·grant 받은 회원만, 남의 캐릭터 거부', async () => {
    const mv = (tok, idt, actor, x, y) => call('act', { roomId: roomA, token: tok, action: { type: 'move', actor, x, y } }, idt);
    const st = (await call('state', { roomId: roomA, token: tokenA }, alice.idToken)).body;
    const { generateVillageMap } = require(path.join(root, 'src/lib/village/map.ts'));
    const map = generateVillageMap(st.room.seed, st.room.era, st.room.places);
    const p = map.places[0];
    assert.equal((await mv(tokenA, alice.idToken, 'c-alice', p.x, p.y)).status, 200);
    assert.equal((await mv(tokenA, alice.idToken, 'c-admin', p.x, p.y)).status, 403, 'alice는 c-admin 권한 없음');
    assert.equal((await mv(tokenCarol, carol.idToken, 'c-admin', p.x, p.y)).status, 200, 'carol은 grant play');
    assert.equal((await mv(tokenCarol, carol.idToken, 'c-alice', p.x, p.y)).status, 403);
    assert.equal((await mv(tokenCarol, carol.idToken, 'npc:0', p.x, p.y)).status, 403, 'NPC는 방 주인·관리자만');
    assert.equal((await mv(tokenA, alice.idToken, 'npc:0', p.x, p.y)).status, 200);
    assert.equal((await mv(tokenA, alice.idToken, 'c-not-in-room', p.x, p.y)).status, 403);
    let wall; for (let y = 0; y < map.height && !wall; y++) for (let x = 0; x < map.width; x++) if (['tree', 'water', 'rock'].includes(map.tiles[y][x])) { wall = { x, y }; break; }
    assert.equal((await mv(tokenA, alice.idToken, 'c-alice', wall.x, wall.y)).status, 400, '벽 이동 거부');
    assert.equal((await mv(tokenA, alice.idToken, 'c-alice', 999, 0)).status, 400);
    assert.equal((await mv(tokenA, undefined, 'c-alice', p.x, p.y)).status, 401, '비로그인 조작 거부');
    const c = await call('controls', { roomId: roomA, token: tokenCarol }, carol.idToken);
    assert.deepEqual(c.body.actors, ['c-admin']);
  });
  await step('권한 회수 즉시 반영(grant 삭제 후 조작 거부)', async () => {
    await db.doc('characters/c-admin').update({ 'data.grants': [] });
    const st = (await call('state', { roomId: roomA, token: tokenA }, alice.idToken)).body;
    const { generateVillageMap } = require(path.join(root, 'src/lib/village/map.ts'));
    const p = generateVillageMap(st.room.seed, st.room.era, st.room.places).places[1];
    const r = await call('act', { roomId: roomA, token: tokenCarol, action: { type: 'move', actor: 'c-admin', x: p.x, y: p.y } }, carol.idToken);
    assert.equal(r.status, 403);
    await db.doc('characters/c-admin').update({ 'data.grants': [{ userId: carol.uid, level: 'play' }] });
  });
  await step('선물·메시지·미니게임 검증(세계관 밖 선물/과도한 길이/불가능한 점수 거부)', async () => {
    const a = action => call('act', { roomId: roomA, token: tokenA, action }, alice.idToken);
    // (v3 사용자 요청) 선물은 가방에 있는 것만 — 빈 가방이면 409, 시험용으로 가방에 하나 넣은 뒤(서버 문서 직접 쓰기) 성공
    assert.equal((await a({ type: 'gift', actor: 'c-alice', to: 'c-admin', item: 'coffee' })).status, 409, '가방에 없는 선물 거부');
    await db.doc(`village_rooms/${roomA}/econ/c-alice`).set({ actor: 'c-alice', coins: 0, exp: 0, inv: { coffee: 1 }, day: 'old', daily: {}, gatherAt: {}, liked: [] });
    assert.equal((await a({ type: 'gift', actor: 'c-alice', to: 'c-admin', item: 'coffee' })).status, 200);
    assert.equal((await db.doc(`village_rooms/${roomA}/econ/c-alice`).get()).data().inv.coffee ?? 0, 0, '선물 재고 차감');
    assert.equal((await a({ type: 'gift', actor: 'c-alice', to: 'c-admin', item: 'battery' })).status, 400, 'SF 선물은 현대 방에서 거부');
    assert.equal((await a({ type: 'gift', actor: 'c-alice', to: 'c-alice', item: 'coffee' })).status, 400, '자기 자신에게 선물 거부');
    assert.equal((await a({ type: 'message', actor: 'c-alice', to: 'c-admin', text: '안녕하세요' })).status, 200);
    assert.equal((await a({ type: 'message', actor: 'c-alice', to: 'c-admin', text: 'x'.repeat(301) })).status, 400);
    assert.equal((await a({ type: 'message', actor: 'c-admin', to: 'c-alice', text: '사칭' })).status, 403, '남의 캐릭터 이름으로 메시지 거부');
    // 점수 신고 방식은 더 이상 받지 않는다(서버가 입력을 재생해 계산)
    assert.equal((await a({ type: 'game', actor: 'c-alice', game: 'catch', score: 30 })).status, 400);
    assert.equal((await a({ type: 'game', actor: 'c-alice', game: 'memory', score: 1000 })).status, 400);
    const st = (await call('state', { roomId: roomA, token: tokenCarol }, carol.idToken)).body;
    assert.ok(st.events.some(e => e.type === 'message' && e.text === '안녕하세요'));
    assert.ok(st.events.some(e => e.type === 'gift' && e.item === 'coffee'));
    assert.equal(st.scores.length, 0, '위조 점수 기록 없음');
    assert.ok(!JSON.stringify(st).includes(alice.uid), '이벤트에 작성자 uid 노출 금지');
  });
  await step('미니게임 점수는 서버가 재생해 계산 — 위조·재제출·조기 제출·남의 판 거부', async () => {
    const games = require(path.join(root, 'src/lib/village/games.ts'));
    let clock = Date.now() + 120_000;
    const K = Buffer.alloc(32, 7);
    const ctx = { db, key: K, now: () => clock };
    const j = await server.joinRoom(ctx, roomA, 'secret-1', alice.uid);
    const jc = await server.joinRoom(ctx, roomA, 'secret-1', carol.uid);
    const act = (uid, tok, action) => server.act(ctx, roomA, tok, uid, action);
    // 별 줍기: 바구니를 가운데 고정한 입력 → 서버 재생 점수와 같은 규칙의 로컬 계산이 일치
    const s1 = await act(alice.uid, j.token, { type: 'gameStart', actor: 'c-alice', game: 'catch' });
    assert.ok(s1.gameId && s1.seed);
    const xs = Array.from({ length: games.CATCH.TICKS }, () => 150);
    await assert.rejects(act(alice.uid, j.token, { type: 'game', actor: 'c-alice', game: 'catch', gameId: s1.gameId, input: xs }), e => e.status === 400 && /끝나기 전/.test(e.message), '20초 전 제출 거부');
    clock += 20_000;
    await assert.rejects(act(alice.uid, j.token, { type: 'game', actor: 'c-alice', game: 'catch', gameId: s1.gameId, input: xs.slice(1) }), e => e.status === 400, '틱 수 위조 거부');
    await assert.rejects(act(alice.uid, j.token, { type: 'game', actor: 'c-alice', game: 'catch', gameId: s1.gameId, input: xs.map(() => 9999) }), e => e.status === 400, '범위 밖 입력 거부');
    await assert.rejects(act(carol.uid, jc.token, { type: 'game', actor: 'c-admin', game: 'catch', gameId: s1.gameId, input: xs }), e => e.status === 400, '남의 판 제출 거부');
    const r1 = await act(alice.uid, j.token, { type: 'game', actor: 'c-alice', game: 'catch', gameId: s1.gameId, input: xs, score: 60 });
    assert.equal(r1.score, games.catchReplay(s1.seed, xs), '서버 계산 점수(신고 점수 무시)');
    await assert.rejects(act(alice.uid, j.token, { type: 'game', actor: 'c-alice', game: 'catch', gameId: s1.gameId, input: xs }), e => e.status === 400, '같은 판 재제출 거부');
    // 짝 맞추기: 시드를 주지 않고, 카드 배치는 서버 판 문서에만 있다. 한 장씩 뒤집을 때마다 그 카드 그림만 받는다.
    const s2 = await act(alice.uid, j.token, { type: 'gameStart', actor: 'c-alice', game: 'memory' });
    assert.ok(s2.gameId && s2.seed === undefined, '짝 맞추기는 시드를 내려 주지 않음');
    const deck = (await db.doc(`village_rooms/${roomA}/games/${s2.gameId}`).get()).data().deck; // 시험용으로만 서버 문서를 직접 읽음
    assert.equal(deck.length, 16);
    const flip = (card, who = alice.uid, tok = j.token, actor = 'c-alice', gameId = s2.gameId) => act(who, tok, { type: 'gameFlip', actor, gameId, card });
    await assert.rejects(flip(0, carol.uid, jc.token, 'c-admin'), e => e.status === 400, '남의 판 뒤집기 거부');
    for (const bad of [16, -1, 1.5, '3']) await assert.rejects(flip(bad), e => e.status === 400, `잘못된 카드 ${bad}`);
    const first = await flip(0);
    assert.equal(first.icon, deck[0]);
    assert.equal(first.match, undefined, '첫 장은 짝 판정 없음');
    await assert.rejects(flip(0), e => e.status === 400, '열린 카드 다시 거부');
    const miss = deck.findIndex((x, m) => m > 0 && x !== deck[0]);
    const r0 = await flip(miss);
    assert.deepEqual([r0.icon, r0.match, r0.done], [deck[miss], false, undefined]);
    await assert.rejects(flip(1), e => e.status === 429, '두 장을 보여 주는 시간 안에 다음 짝 거부(봇 속도 제한)');
    const pairs = [];
    const used = new Set();
    deck.forEach((icon, i) => { if (used.has(i)) return; const k = deck.findIndex((x, m) => m !== i && x === icon && !used.has(m)); used.add(i); used.add(k); pairs.push([i, k]); });
    let last;
    for (const [a, b] of pairs) {
      clock += 600;
      await flip(a);
      last = await flip(b);
      assert.equal(last.match, true);
      if (last.done) break;
      await assert.rejects(flip(a), e => e.status === 400, '맞춘 카드 다시 거부');
    }
    assert.equal(last.done, true);
    assert.equal(last.score, games.memoryScore(9, 600 * 8), '서버가 잰 시간·시도 횟수로 점수 계산');
    assert.ok(last.score < 1000, '틀린 시도 감점 반영');
    await assert.rejects(flip(0), e => e.status === 400, '끝난 판 거부');
    await assert.rejects(act(alice.uid, j.token, { type: 'game', actor: 'c-alice', game: 'memory', gameId: s2.gameId, input: [] }), e => e.status === 400, '짝 맞추기 점수 제출 경로 없음');
    const st = await server.roomState(ctx, roomA, j.token, alice.uid, 0);
    assert.equal(st.scores.find(x => x.game === 'memory').best, last.score);
    // 오래 묵힌 판 거부
    const s3 = await act(alice.uid, j.token, { type: 'gameStart', actor: 'c-alice', game: 'catch' });
    clock += 16 * 60_000;
    await assert.rejects(act(alice.uid, j.token, { type: 'game', actor: 'c-alice', game: 'catch', gameId: s3.gameId, input: xs }), e => e.status === 400, '만료된 판');
  });
  await step('원본 캐릭터 변경이 기존 방에 반영(도트·이름), 비공개 전환 시 방에서 숨김·조작/선물 차단', async () => {
    let clock = Date.now() + 40 * 60_000;
    const K = Buffer.alloc(32, 8);
    const ctx = { db, key: K, now: () => clock };
    await ch('live-test', alice.uid, 'public');
    await ch('live-npcish', carol.uid, 'public');
    // 방 주인 carol(관리자 아님), 캐릭터 작성자 alice
    const r = await server.createRoom(ctx, carol.uid, roomInput(['live-test', 'live-npcish'], { password: 'live-pass-1' }));
    const ja = await server.joinRoom(ctx, r.roomId, 'live-pass-1', alice.uid);
    assert.equal(ja.room.actors.find(x => x.id === 'live-test').avatar.hair, 3);
    await db.doc('characters/live-test').update({ 'data.pixelAvatar': { hair: 16, face: 13, body: 14, hairColor: '#ee3333', skinColor: '#ffddcc', bodyColor: '#445566', eyeColor: '#1ec8b4' }, 'data.name': '새이름' });
    clock += 5000;
    let st = await server.roomState(ctx, r.roomId, ja.token, alice.uid, 0);
    const live = st.room.actors.find(x => x.id === 'live-test');
    assert.deepEqual([live.avatar.hair, live.avatar.face, live.avatar.body, live.avatar.eyeColor, live.name], [16, 13, 14, '#1ec8b4', '새이름']);
    assert.ok((await server.myControls(ctx, r.roomId, ja.token, alice.uid)).includes('live-test'));
    await db.doc('characters/live-test').update({ visibility: 'private' });
    clock += 5000;
    st = await server.roomState(ctx, r.roomId, ja.token, alice.uid, 0);
    assert.ok(!st.room.actors.some(x => x.id === 'live-test'), '비공개 전환된 캐릭터는 방에서 사라짐');
    assert.ok(!JSON.stringify(st).includes('새이름'));
    assert.ok(!(await server.myControls(ctx, r.roomId, ja.token, alice.uid)).includes('live-test'), '작성자도 방 안에서는 조작 불가');
    const jo = await server.joinRoom(ctx, r.roomId, 'live-pass-1', carol.uid);
    await assert.rejects(server.act(ctx, r.roomId, jo.token, carol.uid, { type: 'gift', actor: 'live-npcish', to: 'live-test', item: 'coffee' }), e => e.status === 400, '숨겨진 캐릭터에게 선물 거부');
    await db.doc('characters/live-test').update({ visibility: 'public', 'data.locked': true });
    clock += 5000;
    st = await server.roomState(ctx, r.roomId, ja.token, alice.uid, 0);
    assert.equal(st.room.actors.find(x => x.id === 'live-test').avatar, null, '잠긴 캐릭터 도트 비공개');
    await server.deleteRoom(ctx, carol.uid, r.roomId);
  });
  await step('방 생성은 관리자·자관·캐릭터 권한을 같은 트랜잭션에서 읽음(권한 변경 경합 방지)', async () => {
    const orig = db.runTransaction.bind(db);
    const seen = [];
    db.runTransaction = (fn, opts) => orig(tx => {
      const get = tx.get.bind(tx);
      tx.get = ref => { seen.push(ref.path ?? '(query)'); return get(ref); };
      return fn(tx);
    }, opts);
    try {
      await db.doc('relations/rel-1').set({ visibility: 'public', authorId: admin.uid, data: {} });
      const r = await server.createRoom({ db, key: Buffer.alloc(32, 11) }, admin.uid, roomInput(['c-admin'], { relId: 'rel-1' }));
      assert.ok(r.roomId);
    } finally { db.runTransaction = orig; }
    for (const p of ['meta/owner', 'relations/rel-1', 'characters/c-admin']) assert.ok(seen.includes(p), `${p} 트랜잭션 안에서 읽음: ${seen}`);
  });
  await step('authorId 위조 캐릭터(기존 규칙 허용)로는 마을에서 남의 권한을 얻지 못함', async () => {
    // 공격자 dave가 alice 명의로 캐릭터 문서를 만들어도(현행 규칙 허용) 마을 조작권은 dave에게 생기지 않는다.
    await db.doc('characters/forged-by-dave').set({ authorId: alice.uid, visibility: 'public', sort: 0, data: { id: 'forged-by-dave', name: 'ALICE?' } });
    const r = await call('create', { room: roomInput(['forged-by-dave'], { password: 'forge-pass-1' }) }, dave.idToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const c = await call('controls', { roomId: r.body.roomId, token: r.body.token }, dave.idToken);
    assert.deepEqual(c.body.actors.filter(x => !x.startsWith('npc:')), [], '위조자는 그 캐릭터를 조작할 수 없음');
    const mv = await call('act', { roomId: r.body.roomId, token: r.body.token, action: { type: 'message', actor: 'forged-by-dave', to: 'npc:0', text: '사칭' } }, dave.idToken);
    assert.equal(mv.status, 403);
    assert.equal((await call('delete', { roomId: r.body.roomId }, dave.idToken)).status, 200);
  });
  await step('authorId 위조로 남의 캐릭터 목록에 심은 권한은 방 주인이 허락하지 않으면 무효', async () => {
    const victim = await user(`victim-${Date.now()}@test.local`);
    const planter = await user(`planter-${Date.now()}@test.local`);
    // 현행 사이트 규칙이 허용하는 위조: planter가 victim 명의로, 자기에게 play 권한을 준 캐릭터를 만든다
    await db.doc('characters/planted').set({ authorId: victim.uid, visibility: 'public', sort: 0, data: { id: 'planted', name: 'MINE?', grants: [{ userId: planter.uid, level: 'play' }] } });
    const r = await call('create', { room: roomInput(['planted'], { password: 'plant-pass-1' }) }, victim.idToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const jp = await call('join', { roomId: r.body.roomId, password: 'plant-pass-1' }, planter.idToken);
    assert.equal(jp.status, 200);
    assert.deepEqual((await call('controls', { roomId: r.body.roomId, token: jp.body.token }, planter.idToken)).body.actors, [], '심은 권한으로 조작 불가');
    assert.equal((await call('act', { roomId: r.body.roomId, token: jp.body.token, action: { type: 'message', actor: 'planted', to: 'npc:0', text: '사칭' } }, planter.idToken)).status, 403);
    assert.ok((await call('controls', { roomId: r.body.roomId, token: r.body.token }, victim.idToken)).body.actors.includes('planted'), '방 주인(표시상 작성자)은 조작');
    assert.equal((await call('delete', { roomId: r.body.roomId }, victim.idToken)).status, 200);
    // 방 주인이 그 회원을 명시적으로 허락했을 때만 조작 가능
    const r2 = await call('create', { room: roomInput([{ id: 'planted', allow: [planter.uid] }], { password: 'plant-pass-1' }) }, victim.idToken);
    const jp2 = await call('join', { roomId: r2.body.roomId, password: 'plant-pass-1' }, planter.idToken);
    assert.deepEqual((await call('controls', { roomId: r2.body.roomId, token: jp2.body.token }, planter.idToken)).body.actors, ['planted']);
    // 허락했더라도 원본 권한이 회수되면 즉시 조작 불가
    await db.doc('characters/planted').update({ 'data.grants': [] });
    assert.deepEqual((await call('controls', { roomId: r2.body.roomId, token: jp2.body.token }, planter.idToken)).body.actors, []);
    assert.equal((await call('delete', { roomId: r2.body.roomId }, victim.idToken)).status, 200);
  });
  await step('관리자 방이라도 비공개로 바뀐 캐릭터는 모든 참가자(관리자 포함)에게서 숨김', async () => {
    let clock = Date.now() + 50 * 60_000;
    const ctx = { db, key: Buffer.alloc(32, 12), now: () => clock };
    await ch('adm-flip', admin.uid, 'public');
    const r = await server.createRoom(ctx, admin.uid, roomInput(['adm-flip', 'c-alice'], { password: 'flip-pass-1' }));
    const jm = await server.joinRoom(ctx, r.roomId, 'flip-pass-1', carol.uid);
    assert.ok(jm.room.actors.some(x => x.id === 'adm-flip'));
    await db.doc('characters/adm-flip').update({ visibility: 'private' });
    clock += 5000;
    for (const [who, tok] of [[carol.uid, jm.token], [admin.uid, r.token]]) {
      const st = await server.roomState(ctx, r.roomId, tok, who, 0);
      assert.ok(!st.room.actors.some(x => x.id === 'adm-flip'), `숨김(${who === admin.uid ? '관리자' : '회원'})`);
      assert.ok(!JSON.stringify(st).includes('ADM-FLIP'));
    }
    assert.ok(!(await server.myControls(ctx, r.roomId, r.token, admin.uid)).includes('adm-flip'));
    await server.deleteRoom(ctx, admin.uid, r.roomId);
  });
  await step('방 이름·NPC 이름·대사·세계관의 양방향·zero-width 문자 제거', async () => {
    const r = await call('create', { room: { ...roomInput(['c-admin']), name: 'a\u202eb\u200bc\u2066d', worldview: 'w\u200fx', npcs: [{ name: 'n\u202ep', role: 'r\ufeffs', lines: ['l\u2067m'] }] } }, admin.idToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const listed = (await call('list', {})).body.rooms.find(x => x.id === r.body.roomId);
    assert.equal(listed.name, 'abcd');
    const doc = (await db.doc(`village_rooms/${r.body.roomId}`).get()).data();
    assert.equal(doc.worldview, 'wx');
    const npc = doc.actors.find(x => x.kind === 'npc');
    assert.deepEqual([npc.name, npc.role, npc.lines[0]], ['np', 'rs', 'lm']);
    assert.equal((await call('delete', { roomId: r.body.roomId }, admin.idToken)).status, 200);
  });
  await step('입장 DoS 방지: 여러 계정 대입으로 보호 모드가 켜져도 정답 입장은 누구나(새 계정 포함) 허용, 오답 허용 수만 줄어듦', async () => {
    const ctx = { db, key: Buffer.alloc(32, 9) };
    const owner = await user(`guard-owner-${Date.now()}@test.local`);
    await ch('guard-char', owner.uid, 'public');
    const room = await server.createRoom(ctx, owner.uid, roomInput(['guard-char'], { password: 'guard-pass-1' }));
    // 30개 계정이 각자 1회씩 틀림 → 방 전체 실패 누적 24회 이상 → 보호 모드
    const attackers = await Promise.all(Array.from({ length: 30 }, (_, i) => user(`atk${i}-${Date.now()}@test.local`)));
    const codes = [];
    for (const a of attackers) await server.joinRoom(ctx, room.roomId, 'nope-' + a.uid, a.uid).catch(e => codes.push(e.status));
    assert.ok(codes.length === 30 && codes.every(x => x === 401), JSON.stringify(codes));
    const { createHash } = require('node:crypto');
    const roomFails = (await db.doc(`village_join_tries/${createHash('sha256').update(`r|${room.roomId}`).digest('hex')}`).get()).data().fails;
    assert.ok(roomFails >= 24, `방 전체 실패 ${roomFails}`);
    // 보호 모드에서도 정답이면 방금 가입한 계정까지 모두 입장
    for (const who of [await user(`fresh-${Date.now()}@test.local`), await user(`fresh2-${Date.now()}@test.local`), owner, admin]) {
      assert.ok((await server.joinRoom(ctx, room.roomId, 'guard-pass-1', who.uid)).token, '정답 입장 허용');
    }
    // 보호 모드에서 계정당 오답 허용은 3회(평상시 8회) — 공격 계정 하나가 더 대입하면 그 계정만 막힘
    const a0 = attackers[0];
    for (let i = 0; i < 2; i++) await assert.rejects(server.joinRoom(ctx, room.roomId, 'more-' + i, a0.uid), e => e.status === 401);
    await assert.rejects(server.joinRoom(ctx, room.roomId, 'more-x', a0.uid), e => e.status === 429);
    const m2 = await user(`member2-${Date.now()}@test.local`);
    for (let i = 0; i < 3; i++) await assert.rejects(server.joinRoom(ctx, room.roomId, 'bad-' + i, m2.uid), e => e.status === 401);
    await assert.rejects(server.joinRoom(ctx, room.roomId, 'guard-pass-1', m2.uid), e => e.status === 429, '오답 3회 넘긴 그 계정만 잠김');
    assert.ok((await server.joinRoom(ctx, room.roomId, 'guard-pass-1', attackers[1].uid)).token, '1회 틀린 다른 계정도 정답이면 입장');
    // 방 주인은 계정 한도와 무관(남이 주인을 잠글 수 없음)
    for (let i = 0; i < 9; i++) await assert.rejects(server.joinRoom(ctx, room.roomId, 'own-bad-' + i, owner.uid), e => e.status === 401);
    assert.ok((await server.joinRoom(ctx, room.roomId, 'guard-pass-1', owner.uid)).token);
    await server.deleteRoom(ctx, owner.uid, room.roomId);
    assert.equal((await db.collection('village_join_tries').where('room', '==', room.roomId).get()).size, 0, '시도 기록 정리');
  });
  await step('정상 입장은 시도 횟수를 소모하지 않음(여러 탭 입장 반복 허용)', async () => {
    const K = Buffer.alloc(32, 10);
    for (let i = 0; i < 12; i++) assert.ok((await server.joinRoom({ db, key: K }, roomA, 'secret-1', carol.uid)).token);
  });
  await step('약한 방 비밀번호·현재와 같은 비밀번호로 변경 거부', async () => {
    const weak = await user(`weak-${Date.now()}@test.local`);
    for (const pw of ['12345678', '111111111', 'password', 'aaaaaaaa', '123456789']) {
      assert.equal((await call('create', { room: roomInput(['c-admin'], { password: pw }) }, weak.idToken)).status, 400, pw);
      assert.equal((await call('password', { roomId: roomA, password: pw }, alice.idToken)).status, 400, pw);
    }
    const same = await call('password', { roomId: roomA, password: 'secret-1' }, alice.idToken);
    assert.equal(same.status, 400);
    assert.match(same.body.error, /같습니다/);
    assert.equal((await call('state', { roomId: roomA, token: tokenCarol }, carol.idToken)).status, 200, '같은 비밀번호 거부 → 다른 참가자 세션 유지');
  });
  await step('메시지 도배 제한(분당 12건 초과 429)', async () => {
    const rs = [];
    for (let i = 0; i < 14; i++) rs.push((await call('act', { roomId: roomA, token: tokenA, action: { type: 'message', actor: 'c-alice', to: 'c-admin', text: 'spam' + i } }, alice.idToken)).status);
    assert.ok(rs.includes(429), JSON.stringify(rs));
  });
  await step('비밀번호 변경 → 기존 세션 모두 폐기', async () => {
    assert.equal((await call('password', { roomId: roomA, password: 'new-pass' }, carol.idToken)).status, 403, '방 주인이 아니면 거부');
    const r = await call('password', { roomId: roomA, password: 'new-pass' }, alice.idToken);
    assert.equal(r.status, 200);
    assert.equal((await call('state', { roomId: roomA, token: tokenCarol }, carol.idToken)).status, 401);
    tokenA = r.body.token;
    assert.equal((await call('state', { roomId: roomA, token: tokenA }, alice.idToken)).status, 200);
    assert.equal((await call('join', { roomId: roomA, password: 'secret-1' }, carol.idToken)).status, 401);
  });
  await step('운영 환경의 에뮬레이터 변수는 503으로 거부', async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try { assert.equal((await call('health')).status, 503); }
    finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
  });
  await step('삭제 정리 실패 기록과 권한 있는 재시도', async () => {
    // (관리자 HTTP 생성은 앞 단계에서 분당 상한을 다 썼으므로 서버 함수를 직접 부른다)
    const id = (await server.createRoom({ db, key: Buffer.alloc(32) }, admin.uid, roomInput(['c-admin']))).roomId;
    await server.joinRoom({ db, key: Buffer.alloc(32) }, id, 'wrong-pass', bob.uid).catch(e => assert.equal(e.status, 401));
    const tries = await db.collection('village_join_tries').where('room', '==', id).get();
    assert.equal(tries.size, 2, '계정별 기록 1 + 방 전체 실패 수 1');
    assert.ok(tries.docs.every(d => d.data().expireAt.toMillis() > Date.now()), 'TTL 만료 필드');
    const original = db.recursiveDelete;
    db.recursiveDelete = async () => { throw new Error('injected'); };
    try { await assert.rejects(server.deleteRoom({ db, key: Buffer.alloc(32) }, admin.uid, id), e => e.status === 503); }
    finally { db.recursiveDelete = original; }
    assert.ok((await db.doc(`village_cleanup/${id}`).get()).exists);
    await assert.rejects(server.deleteRoom({ db, key: Buffer.alloc(32) }, bob.uid, id), e => e.status === 403);
    await server.deleteRoom({ db, key: Buffer.alloc(32) }, admin.uid, id);
    assert.equal((await db.collection('village_join_tries').where('room', '==', id).get()).size, 0);
    assert.equal((await db.doc(`village_cleanup/${id}`).get()).exists, false);
  });
  await step('삭제 권한: 다른 회원 거부, 방 주인 허용 → 세션·하위 데이터 폐기', async () => {
    // (v3 사용자 요청) 지갑·호감 문서가 실제로 있었던 방을 지워야 하위 컬렉션 정리 확인이 의미가 있다
    assert.ok((await db.collection(`village_rooms/${roomA}/econ`).get()).size > 0, '삭제 전 econ 존재');
    assert.ok((await db.collection(`village_rooms/${roomA}/bonds`).get()).size > 0, '삭제 전 bonds 존재');
    await db.doc(`village_rooms/${roomA}/houses/p0`).set({ level: 1, items: [] });
    assert.equal((await call('delete', { roomId: roomA }, carol.idToken)).status, 403);
    assert.equal((await call('delete', { roomId: roomA })).status, 401);
    assert.equal((await call('delete', { roomId: roomA }, alice.idToken)).status, 200);
    assert.equal((await call('state', { roomId: roomA, token: tokenA }, alice.idToken)).status, 401);
    assert.equal((await call('join', { roomId: roomA, password: 'new-pass' }, alice.idToken)).status, 404);
    for (const sub of ['pos', 'events', 'scores', 'limits', 'econ', 'houses', 'bonds']) assert.equal((await db.collection(`village_rooms/${roomA}/${sub}`).get()).size, 0, sub);
  });
  await step('삭제 직후 같은 가입자 재생성 허용, 다시 1개 제한', async () => {
    const r = await call('create', { room: roomInput(['c-alice']) }, alice.idToken);
    assert.equal(r.status, 200);
    roomA = r.body.roomId; tokenA = r.body.token;
    assert.equal((await call('create', { room: roomInput(['c-alice']) }, alice.idToken)).status, 409);
  });
  await step('삭제·생성 동시 경합 반복 — 가입자 보유 방은 언제나 1개 이하', async () => {
    for (let round = 0; round < 5; round++) {
      const owned = await db.collection('village_rooms').where('ownerUid', '==', alice.uid).get();
      const ops = [call('delete', { roomId: owned.docs[0]?.id ?? 'x'.repeat(20) }, alice.idToken),
        ...Array.from({ length: 4 }, () => call('create', { room: roomInput(['c-alice']) }, alice.idToken))];
      await Promise.all(ops);
      const after = await db.collection('village_rooms').where('ownerUid', '==', alice.uid).get();
      assert.ok(after.size <= 1, `round ${round}: ${after.size}개`);
    }
  });
  await step('관리자는 남의 방 삭제 가능', async () => {
    const bobRoom = (await db.collection('village_rooms').where('ownerUid', '==', bob.uid).get()).docs[0].id;
    assert.equal((await call('delete', { roomId: bobRoom }, admin.idToken)).status, 200);
    assert.equal((await call('create', { room: roomInput(['c-alice']) }, bob.idToken)).status, 200, '삭제된 뒤 bob 재생성 가능');
  });
  await step('관리자 강등 뒤에는 기존 여러 방이 있으면 새 방 거부', async () => {
    await db.doc('meta/owner').set({ uid: dave.uid, admins: [] });
    await assert.rejects(server.createRoom({ db, key: Buffer.alloc(32) }, admin.uid, roomInput(['c-admin'])), e => e.status === 409);
    await db.doc('meta/owner').set({ uid: admin.uid, admins: [] });
  });
  await step('방 생성·비밀번호 변경 요청 속도 제한(해시 CPU 증폭 방지) — 관리자도 분당 상한', async () => {
    const who = await user(`pwspam-${Date.now()}@test.local`);
    const codes = [];
    for (let i = 0; i < 17; i++) codes.push((await call('create', { room: roomInput(['c-alice'], { password: 'spam-pass-' + i }) }, who.idToken)).status);
    assert.equal(codes[0], 200);
    assert.deepEqual([...new Set(codes.slice(1, 15))], [409], '이미 방이 있으면 해시 전에 409');
    assert.equal(codes.at(-1), 429, JSON.stringify(codes));
    const mine = (await db.collection('village_rooms').where('ownerUid', '==', who.uid).get()).docs[0].id;
    const other = await user(`pwspam2-${Date.now()}@test.local`);
    const pc = [];
    for (let i = 0; i < 17; i++) pc.push((await call('password', { roomId: mine, password: 'Another-pass-' + i }, other.idToken)).status);
    assert.deepEqual([...new Set(pc.slice(0, 15))], [403], '주인이 아니면 해시 전에 403');
    assert.equal(pc.at(-1), 429);
    await server.deleteRoom({ db, key: Buffer.alloc(32) }, who.uid, mine);
  });
  await step('잘못된 입력(방 id 형식·거대 본문·필드 누락)', async () => {
    assert.equal((await call('join', { roomId: '../meta/owner', password: 'x' }, bob.idToken)).status, 400);
    assert.equal((await call('state', { roomId: { $gt: '' }, token: tokenA })).status, 400);
    const big = await handleVillage(new Request('http://localhost/api/village', { method: 'POST', body: JSON.stringify({ op: 'list', pad: 'x'.repeat(40000) }) }));
    assert.equal(big.status, 400);
    assert.equal((await call('create', { room: { name: '', era: 'modern', password: 'abcd', chars: [] } }, dave.idToken)).status, 400);
    assert.equal((await call('create', { room: roomInput(['c-alice'], { password: '1234567' }) }, dave.idToken)).status, 400);
    assert.equal((await call('password', { roomId: roomA, password: '1234567' }, alice.idToken)).status, 400);
  });

  await step('조회 요청 속도 제한(읽기 증폭 방지) — 계정별 분당 상한', async () => {
    const who = await user(`reader-${Date.now()}@test.local`);
    const codes = [];
    for (let i = 0; i < 32; i++) codes.push((await call('list', {}, who.idToken)).status);
    assert.equal(codes.filter(x => x === 200).length, 30, JSON.stringify(codes));
    assert.equal(codes.at(-1), 429);
    assert.equal((await call('list', {}, carol.idToken)).status, 200, '다른 계정은 영향 없음');
  });
  // ---- 클라이언트 SDK 직접 접근: 운영 규칙과 설치 규칙 모두에서 village_* 거부 ----
  const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc, collection, getDocs, deleteDoc } = require('firebase/firestore');
  for (const file of ['firestore.production.rules', 'firestore.rules']) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    const env = await initializeTestEnvironment({ projectId: `demo-rules-${file.replace(/\W/g, '')}`, firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(root, 'firebase', file), 'utf8') } });
    await env.withSecurityRulesDisabled(async ctx => {
      const d = ctx.firestore();
      await setDoc(doc(d, 'meta/owner'), { uid: 'owner' });
      await setDoc(doc(d, 'village_rooms/R1'), { name: 'x', pwHash: 'h', ownerUid: 'u1', status: 'active' });
      await setDoc(doc(d, 'village_rooms/R1/events/e1'), { text: 'secret' });
      await setDoc(doc(d, 'village_owner_slots/u1'), { rooms: 1 });
      await setDoc(doc(d, 'village_cleanup/R1'), { ownerUid: 'u1' });
      await setDoc(doc(d, 'posts/p1'), { visibility: 'public', data: {} });
    });
    await step(`[${file}] 클라이언트 직접 읽기·쓰기·삭제 거부(익명·회원·방 주인·관리자)`, async () => {
      for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext('u1'), env.authenticatedContext('owner')]) {
        const d = ctx.firestore();
        await assertFails(getDoc(doc(d, 'village_rooms/R1')));
        await assertFails(getDocs(collection(d, 'village_rooms')));
        await assertFails(getDoc(doc(d, 'village_rooms/R1/events/e1')));
        await assertFails(getDocs(collection(d, 'village_rooms/R1/events')));
        await assertFails(setDoc(doc(d, 'village_rooms/R2'), { ownerUid: 'u1' }));
        await assertFails(setDoc(doc(d, 'village_rooms/R1/pos/c'), { x: 1, y: 1 }));
        await assertFails(deleteDoc(doc(d, 'village_rooms/R1')));
        await assertFails(setDoc(doc(d, 'village_owner_slots/u1'), { rooms: 0 }));
        await assertFails(getDoc(doc(d, 'village_join_tries/x')));
        await assertFails(getDoc(doc(d, 'village_cleanup/R1')));
        await assertFails(deleteDoc(doc(d, 'village_cleanup/R1')));
      }
      // 대조군: 규칙이 실제로 로드되어 공개 문서는 읽힌다
      await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'posts/p1')));
    });
    await step(`[${file}] 현행 규칙의 authorId 위조 허용 재현(보안 결함)`, async () => {
      const attacker = env.authenticatedContext('attacker').firestore();
      await assertSucceeds(setDoc(doc(attacker, 'characters/forged-author'), {
        authorId: 'victim', visibility: 'public', data: { id: 'forged-author', name: 'forged' },
      }));
    });
    await env.cleanup();
  }

  const failed = results.filter(r => r[0] === 'FAIL');
  console.log(`\n마을 에뮬레이터 시험: ${results.length - failed.length}/${results.length} 통과`);
  if (failed.length) process.exitCode = 1;
  process.exit();
})().catch(e => { console.error(e); process.exit(1); });
