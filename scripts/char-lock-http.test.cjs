const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
function load(file, deps = {}) {
  assert.ok(fs.existsSync(file), `${path.basename(file)} is missing`);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths;
  const original = mod.require.bind(mod); mod.require = name => deps[name] || original(name); mod._compile(code, file); return mod.exports;
}
const base = path.join(__dirname, '../src/lib');
const service = load(path.join(base, 'characterLockServer.ts'));
const { createCharacterLockHandlers } = load(path.join(base, 'characterLockHttp.ts'), { './characterLockServer': service });
const calls = [];
const handlers = createCharacterLockHandlers({
  verify: async token => { if (token !== 'valid-token') throw Error('bad token'); return 'admin'; },
  change: async (...args) => { calls.push(args); },
  open: async (...args) => ({ ok: true, character: { id: args[0], basicHtml: 'body' }, lockVersion: 'v1' }),
});
const req = (body, auth) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
(async () => {
  let r = await handlers.lock(req({ id: 'c1', action: 'lock', password: '1234' }));
  assert.equal(r.status, 401); assert.equal(calls.length, 0);
  r = await handlers.lock(req({ id: 'c1', action: 'lock', password: '1234' }, 'bad'));
  assert.equal(r.status, 401); assert.equal(calls.length, 0);
  r = await handlers.lock(req({ id: 'c1', action: 'changePassword', password: '1234' }, 'valid-token'));
  assert.equal(r.status, 200); assert.deepEqual(calls[0], ['admin', 'c1', 'changePassword', '1234']);
  assert.ok(!(await r.text()).includes('1234'));
  r = await handlers.lock(req({ id: '../bad', action: 'lock', password: '1234' }, 'valid-token'));
  assert.equal(r.status, 400);
  r = await handlers.unlock(req({ id: 'c1', password: '1234' }));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { char: { id: 'c1', basicHtml: 'body' }, lockVersion: 'v1' });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const multibyte = await handlers.unlock(req({id: 'c1', password: '1234', padding: '가'.repeat(1400)}));
  assert.equal(multibyte.status, 400, 'limit must count UTF-8 bytes, not characters');
  for (const handler of [handlers.unlock, handlers.lock]) {
    let pulls = 0, cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        pulls++;
        if (pulls > 6) { controller.close(); return; }
        controller.enqueue(new Uint8Array(2048).fill(0x61));
      },
      cancel() { cancelled = true; },
    });
    const streamed = new Request('http://localhost/api', {method: 'POST', headers: {authorization: 'Bearer valid-token', 'content-length': '1'}, body: stream, duplex: 'half'});
    const response = await handler(streamed);
    assert.equal(response.status, 400);
    assert.ok(pulls <= 4, `read ${pulls} chunks after limit`);
    assert.ok(cancelled, 'oversized stream not cancelled');
  }
  console.log('character lock HTTP contract tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
