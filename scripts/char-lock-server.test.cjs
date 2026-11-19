const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const file = path.join(__dirname, '../src/lib/characterLockServer.ts');
assert.ok(fs.existsSync(file), 'server character lock service is missing');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(code, file);
const { changeCharacterLock, openCharacter } = mod.exports;
for (const filename of ['../firebase/firestore.rules', '../src/lib/firebaseRules.ts']) {
  const text = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  assert.ok(text.includes('safeCharacterCreate(coll)'), `${filename}: locked create must use server`);
  assert.ok(text.includes('safeCharacterDelete(coll)'), `${filename}: locked character deletion must be blocked`);
  assert.ok(text.includes("'lockVersion'"), `${filename}: lock version must be allowed`);
  assert.ok(text.includes('request.resource.data.editorIds.size() == 0'), `${filename}: locked editor grants must remain empty`);
}

function memory(initial) {
  let data = structuredClone(initial); let commits = 0; let failCommit = false;
  const ref = key => ({ key });
  const db = {
    collection: name => ({ doc: id => ref(`${name}/${id}`) }),
    runTransaction: async fn => {
      const next = structuredClone(data);
      const tx = {
        get: async r => ({ exists: Object.hasOwn(data, r.key), data: () => structuredClone(data[r.key]) }),
        set: (r, value) => { next[r.key] = structuredClone(value); },
        delete: r => { delete next[r.key]; },
      };
      const result = await fn(tx);
      if (failCommit) throw Error('commit failed');
      data = next; commits++; return result;
    },
  };
  return { db, snapshot: () => structuredClone(data), commits: () => commits, fail: () => { failCommit = true; } };
}
const initial = {
  'meta/owner': { uid: 'admin', admins: ['other-admin'] },
  'characters/c1': { data: { id: 'c1', name: 'Test', own: true, visibility: 'public', thumbClass: '', thumbId: 'cover', basicHtml: 'TOP SECRET', tabs: [{ html: 'HIDDEN' }], future: { keep: true } }, authorId: 'owner', visibility: 'public', sort: 7, editorIds: ['user'], custom: 'retain-me' },
};
(async () => {
  const m = memory(initial);
  await assert.rejects(() => changeCharacterLock(m.db, 'user', 'c1', 'lock', '1234'), /관리자/);
  assert.deepEqual(m.snapshot(), initial);
  await changeCharacterLock(m.db, 'admin', 'c1', 'lock', '1234');
  let state = m.snapshot();
  assert.equal(state['characters/c1'].data.locked, true);
  assert.ok(!JSON.stringify(state['characters/c1']).includes('TOP SECRET'));
  assert.ok(!JSON.stringify(state['characters/c1']).includes('HIDDEN'));
  assert.ok(!JSON.stringify(state['characters/c1']).includes('1234'));
  assert.equal(state['char_secrets/c1'].data.character.basicHtml, 'TOP SECRET');
  assert.notEqual(state['char_secrets/c1'].data.lockHash, '1234');
  const wrong = await openCharacter(m.db, 'c1', 'wrong', false, 'ip');
  assert.equal(wrong.ok, false); assert.equal(wrong.status, 401);
  const right = await openCharacter(m.db, 'c1', '1234', false, 'ip');
  assert.equal(right.ok, true); assert.equal(right.character.basicHtml, 'TOP SECRET');
  assert.equal(right.character.lockHash, undefined);
  assert.equal(right.lockVersion, state['characters/c1'].data.lockVersion);
  const version = state['characters/c1'].data.lockVersion;
  assert.ok(typeof version === 'string' && version.length >= 16);
  await changeCharacterLock(m.db, 'other-admin', 'c1', 'changePassword', 'new password');
  assert.notEqual(m.snapshot()['characters/c1'].data.lockVersion, version);
  assert.equal((await openCharacter(m.db, 'c1', '1234', false, 'ip')).ok, false);
  assert.equal((await openCharacter(m.db, 'c1', 'new password', false, 'ip')).ok, true);
  await changeCharacterLock(m.db, 'admin', 'c1', 'unlock');
  state = m.snapshot();
  assert.equal(state['characters/c1'].data.basicHtml, 'TOP SECRET');
  assert.deepEqual(state['characters/c1'].data.future, { keep: true });
  assert.equal(state['characters/c1'].custom, 'retain-me');
  assert.equal(state['characters/c1'].sort, 7);
  assert.deepEqual(state['characters/c1'].editorIds, ['user']);
  assert.equal(state['char_secrets/c1'], undefined);
  const failed = memory(initial); failed.fail();
  await assert.rejects(() => changeCharacterLock(failed.db, 'admin', 'c1', 'lock', '1234'), /commit failed/);
  assert.deepEqual(failed.snapshot(), initial);
  const bad = memory({ ...initial, 'char_secrets/c1': { data: { unknown: true } } });
  await assert.rejects(() => changeCharacterLock(bad.db, 'admin', 'c1', 'lock', '1234'), /비밀 문서/);
  assert.deepEqual(bad.snapshot()['characters/c1'], initial['characters/c1']);
  const limited = memory(initial);
  await changeCharacterLock(limited.db, 'admin', 'c1', 'lock', '1234');
  for (let i = 0; i < 8; i++) assert.equal((await openCharacter(limited.db, 'c1', 'wrong', false, 'same-ip')).status, 401);
  assert.equal((await openCharacter(limited.db, 'c1', '1234', false, 'same-ip')).status, 429);
  const distributed = memory(initial);
  await changeCharacterLock(distributed.db, 'admin', 'c1', 'lock', '1234');
  for (let i = 0; i < 64; i++) assert.equal((await openCharacter(distributed.db, 'c1', 'wrong', false, `spoofed-${i}`)).status, 401);
  assert.equal((await openCharacter(distributed.db, 'c1', '1234', false, 'new-spoofed-ip')).status, 429);
  const member = memory({ ...initial, 'characters/c1': { ...initial['characters/c1'], visibility: 'member' } });
  await changeCharacterLock(member.db, 'admin', 'c1', 'lock', '1234');
  assert.equal((await openCharacter(member.db, 'c1', '1234', false, 'ip')).status, 403);
  assert.equal((await openCharacter(member.db, 'c1', '1234', true, 'ip')).ok, true);
  console.log('character lock server transaction tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
