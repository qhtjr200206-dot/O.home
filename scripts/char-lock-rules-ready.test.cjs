const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const file = path.join(__dirname, '../src/lib/characterLockRules.ts');
assert.ok(fs.existsSync(file), 'live Firestore rules readiness verification is missing');
const m = new Module(file, module); m.filename=file; m.paths=module.paths;
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const { assertCharacterRulesReady } = m.exports;
const rules = fs.readFileSync(path.join(__dirname, '../firebase/firestore.production.rules'), 'utf8').replace(/\r\n/g,'\n');
const text = fs.readFileSync(path.join(__dirname, '../src/lib/firebaseRules.ts'), 'utf8').replace(/\r\n/g,'\n');
const embedded = text.match(/export const FIRESTORE_RULES = `([\s\S]*?)`;/)[1];
assert.notEqual(rules.trim(), embedded.trim(), 'production and installation policies must be separate');
const contentList = rules.match(/function isContent\(name\)\s*\{\s*return name in \[([\s\S]*?)\];/)[1];
const collections = [...contentList.matchAll(/'([^']+)'/g)].map(x => x[1]);
assert.deepEqual(collections, ['posts','guestbook','characters','relations','gallery','roadview','trpg_logs','trpg_chars','dotori','playlog','rp_rooms','threads','diary','memos','commissions','applicants','trpg_log_bodies','moods']);
assert.match(rules, /match \/rel_secrets\/\{docId\}\s*\{\s*allow read, create, update, delete: if isAdmin\(\);/);
assert.ok(!rules.includes('request.auth.uid in resource.data.editorIds'), 'must not expand existing editor privileges');
// Remove only the explicitly scoped character changes, then compare the exact
// normalized production baseline. A change elsewhere requires a fresh review.
const reverted = rules
  .replace(/    \/\/ 이전 클라이언트[\s\S]*?(?=    \/\/ ── 소유자)/, '')
  .replace(/    \/\/ 잠금 캐릭터의 비밀 문서[\s\S]*?(?=    \/\/ ── 콘텐츠)/, '')
  .replace('isContent(coll) && safeCharacterCreate(coll) && safeCharacterWrite(coll) && (signedIn()', 'isContent(coll) && (signedIn()')
  .replace(/      allow update: if isContent\(coll\) && safeCharacterWrite\(coll\) && safeCharacterUpdate\(coll\)\n        && signedIn\(\)\n        && \(resource.data.authorId == request.auth.uid \|\| isAdmin\(\)\);\n      allow delete: if isContent\(coll\) && safeCharacterDelete\(coll\)/, '      allow update, delete: if isContent(coll)');
assert.equal(require('node:crypto').createHash('sha256').update(reverted.trim()).digest('hex'), '0b1063403bae526c0a12f1ad20f0d12540861da130e9bae87ef83cfb529cac39', 'non-character live rules changed');
const now = Date.parse('2026-11-20T12:00:00Z');
function fake(opts={}) {
  const urls=[];
  return { urls, fetcher: async url => {
    urls.push(url);
    if (opts.fail) throw new Error('unavailable');
    const body = urls.length===1 ? {rulesetName:opts.rulesetName || 'projects/p/rulesets/a', updateTime:opts.updateTime || '2026-11-20T11:00:00Z'} : {source:{files:[{content:opts.source || rules}]}};
    return {ok:true,json:async()=>body};
  }};
}
(async()=>{
  let f=fake(); await assertCharacterRulesReady({projectId:'p',databaseId:'(default)',token:'test',expectedRules:rules,fetcher:f.fetcher,now});
  assert.ok(f.urls[0].endsWith('/projects/p/releases/cloud.firestore'));
  f=fake(); await assertCharacterRulesReady({projectId:'p',databaseId:'named-db',token:'test',expectedRules:rules,fetcher:f.fetcher,now});
  assert.ok(f.urls[0].endsWith('/projects/p/releases/cloud.firestore/named-db'));
  for (const opts of [{source:embedded}, {source:rules+'\nallow read: if true;'}, {fail:true}, {rulesetName:'projects/other/rulesets/a'}, {updateTime:'2026-11-20T11:59:59Z'}]) {
    f=fake(opts);
    await assert.rejects(()=>assertCharacterRulesReady({projectId:'p',databaseId:'(default)',token:'test',expectedRules:rules,fetcher:f.fetcher,now}));
  }
  console.log('rules readiness fail-closed tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
