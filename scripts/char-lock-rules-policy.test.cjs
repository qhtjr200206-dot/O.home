const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const livePath = 'firebase/firestore.production.rules';
assert.ok(fs.existsSync(path.join(__dirname, '..', livePath)), 'production-specific rules file missing');
const live = read(livePath);
const setup = read('firebase/firestore.rules');
const embedded = read('src/lib/firebaseRules.ts').match(/export const FIRESTORE_RULES = `([\s\S]*?)`;/)[1];
assert.equal(setup.trim(), embedded.trim());
assert.notEqual(setup.trim(), live.trim());
function list(s) { return [...s.match(/function isContent\(name\)\s*\{\s*return name in \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]); }
for (const collection of ['comments', 'qa_answers', 'rp_messages', 'notifications']) {
  assert.ok(list(setup).includes(collection), `setup must preserve ${collection}`);
  assert.ok(!list(live).includes(collection), `production must not expand ${collection}`);
}
// Captured from the f755841 installation template, excluding rel_secrets,
// which is deliberately moved to its administrator-only match below.
const baselineCollections = ['posts','guestbook','characters','relations','gallery','roadview','trpg_logs','trpg_log_bodies','trpg_chars','dotori','playlog','rp_rooms','threads','diary','memos','commissions','applicants','moods','comments','qa_answers','rp_messages','notifications'];
assert.deepEqual(list(setup), baselineCollections, 'installation content collection list must preserve HEAD baseline');
assert.ok(setup.includes("(signedIn() || coll in ['guestbook', 'comments', 'notifications'])"), 'setup guest create policy must be preserved');
assert.ok(setup.includes('request.auth.uid in resource.data.editorIds'), 'setup must preserve editor access');
assert.ok(!live.includes('request.auth.uid in resource.data.editorIds'), 'production must not expand editor access');
// rel_secrets retains author access in installation rules; production is admin-only.
const setupRel = setup.match(/match \/rel_secrets\/\{docId\}\s*\{([\s\S]*?)\n\s*\}/)[1];
assert.match(setupRel, /resource.data.authorId == request.auth.uid/);
assert.match(setupRel, /request.resource.data.visibility == 'private'/);
assert.match(setupRel, /request.resource.data.authorId == resource.data.authorId/);
assert.match(live, /match \/rel_secrets\/\{docId\}\s*\{\s*allow read, create, update, delete: if isAdmin\(\);/);
for (const rules of [setup, live]) {
  assert.ok(!list(rules).includes('rel_secrets'));
  assert.match(rules, /match \/char_secrets\/\{docId\}\s*\{\s*allow read, write: if isAdmin\(\);/);
  for (const guard of ['safeCharacterCreate(coll)', 'safeCharacterUpdate(coll)', 'safeCharacterDelete(coll)']) assert.ok(rules.includes(guard));
}
const adapter = read('src/lib/characterLockFirebase.ts');
assert.ok(adapter.includes("'firestore.production.rules'"), 'readiness must use production-specific rules');
const next = read('next.config.ts');
assert.match(next, /outputFileTracingIncludes/);
assert.ok(next.includes('firebase/firestore.production.rules'), 'server trace must include production rules');
console.log('installation and production rules policy tests passed');
