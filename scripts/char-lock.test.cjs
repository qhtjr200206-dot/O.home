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
console.log('character lock split tests passed');
