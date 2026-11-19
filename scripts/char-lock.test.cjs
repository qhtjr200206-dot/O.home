// Standalone tests for the character lock's public/secret boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const file = path.join(__dirname, '../src/lib/charLock.ts');
assert.ok(fs.existsSync(file), 'character lock public/secret split is not implemented');
const source = fs.readFileSync(file, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = new Module(file, module);
mod.filename = file;
mod.paths = module.paths;
mod._compile(compiled, file);
const { splitCharacters } = mod.exports;

const character = {
  id: 'c1', name: '이름', slug: 'character', secId: 'one', own: true,
  thumbId: 'cover', thumbCrop: { x: 1 }, thumbClass: 'cover-class', visibility: 'public',
  sub: 'private-sub', basicHtml: 'private-body', tabs: [{ html: 'private-tab' }],
  arts: ['private-art'], grants: [{ userId: 'private-user' }], auProfiles: { key: { basicHtml: 'private-au' } },
  locked: true, lockHash: 'private-hash', lockSalt: 'private-salt', lockIter: 500,
};
const { pub, sec } = splitCharacters([character]);
assert.equal(pub.length, 1);
assert.equal(sec.length, 1);
assert.deepEqual(Object.keys(pub[0]).sort(), ['id', 'locked', 'lockStub', 'name', 'own', 'secId', 'slug', 'thumbClass', 'thumbCrop', 'thumbId', 'visibility'].sort());
assert.equal(pub[0].name, character.name);
for (const value of ['private-sub', 'private-body', 'private-tab', 'private-art', 'private-user', 'private-au', 'private-hash', 'private-salt']) {
  assert.ok(!JSON.stringify(pub).includes(value), `public document leaked ${value}`);
}
assert.equal(sec[0].visibility, 'private');
assert.equal(sec[0].character.basicHtml, character.basicHtml);
assert.equal(sec[0].lockHash, character.lockHash);
assert.equal(sec[0].character.lockHash, undefined);
const stubResult = splitCharacters([pub[0]]);
assert.deepEqual(stubResult.sec, [{ id: 'c1', keep: true }]);
const unlocked = { ...character, locked: false };
assert.deepEqual(splitCharacters([unlocked]), { pub: [unlocked], sec: [] });
const merged = mod.exports.mergeCharacters(pub, sec);
assert.equal(merged[0].basicHtml, 'private-body');
assert.equal(merged[0].lockHash, 'private-hash');
const missing = mod.exports.mergeCharacters(pub, []);
assert.equal(missing[0].lockStub, true);
assert.equal(missing[0].basicHtml, '');
assert.deepEqual(missing[0].tabs, []);
const rules = fs.readFileSync(path.join(__dirname, '../firebase/firestore.rules'), 'utf8');
const embedded = fs.readFileSync(path.join(__dirname, '../src/lib/firebaseRules.ts'), 'utf8');
for (const [name, text] of [['file', rules], ['embedded', embedded]]) {
  assert.match(text, /match \/char_secrets\/\{[^}]+\}\s*\{\s*allow read, write: if isAdmin\(\);/, `${name}: character secrets must be admin-only`);
  assert.match(text, /function safeCharacterWrite\(/, `${name}: locked character writes must be guarded`);
  assert.match(text, /keys\(\)\.hasOnly\(\[\s*'id', 'name', 'own'/, `${name}: public locked character allowlist missing`);
  assert.match(text, /safeCharacterWrite\(coll\)/, `${name}: write guard must be used`);
  assert.match(text, /safeCharacterUpdate\(coll\)/, `${name}: stale clients must not unlock`);
}
console.log('character lock split, merge, and rule tests passed');
