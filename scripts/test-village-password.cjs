// Isolated KDF tests; no database, network or production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const filename = require('node:path').resolve(__dirname, '../src/lib/village/password.ts');
const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { hashRoomPassword, verifyRoomPassword } = mod.exports;
(async () => {
  const first = await hashRoomPassword('한글🔒 secure password');
  const second = await hashRoomPassword('한글🔒 secure password');
  assert.notEqual(first, second);
  assert(await verifyRoomPassword('한글🔒 secure password', first));
  assert.equal(await verifyRoomPassword('wrong', first), false);
  for (const record of ['', first + 'x', first.toUpperCase(), 'scrypt-v1$' + '0'.repeat(32) + '$' + '0'.repeat(127), null]) {
    assert.equal(await verifyRoomPassword('anything', record), false);
  }
  for (const password of ['', 'a'.repeat(1025), null]) {
    assert.equal(await verifyRoomPassword(password, first), false);
    await assert.rejects(hashRoomPassword(password));
  }
  const limit = 'a'.repeat(1024);
  assert(await verifyRoomPassword(limit, await hashRoomPassword(limit)));
  assert.equal(await verifyRoomPassword('가'.repeat(342), first), false);
  console.log('room password KDF: salt, verification, malformed records, input bounds passed');
})().catch(error => { console.error(error); process.exitCode = 1; });