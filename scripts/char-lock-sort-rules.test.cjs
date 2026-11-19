// End-to-end Firestore rules + actual list diff regression for locked sort moves.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const Module = require('node:module');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firestore = require(require.resolve('firebase/firestore', {paths:[require.resolve('@firebase/rules-unit-testing')]}));
const { doc, getDoc, setDoc, writeBatch } = firestore;
const root = path.join(__dirname, '..');
function load(rel) {
  const file = path.join(root, rel);
  assert.ok(fs.existsSync(file), `${rel}: locked sort filtering missing`);
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths;
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
  return mod.exports;
}
const {diffList} = load('src/lib/backend/types.ts');
const {ensureNoLockedWrites} = load('src/lib/charLockClient.ts');
async function actualBackend(db, uid) {
  const file = path.join(root, 'src/lib/backend/firebaseBackend.ts');
  const mod = new Module(file, module); mod.filename=file; mod.paths=module.paths;
  const overrides = {
    './types': load('src/lib/backend/types.ts'),
    './firebaseReadSets': load('src/lib/backend/firebaseReadSets.ts'),
    './characterSort': load('src/lib/backend/characterSort.ts'),
    '../visFloor': {visFloorOf:()=> 'public'},
    'firebase/app': {getApps:()=>[],initializeApp:()=>({})},
    'firebase/auth': {getAuth:()=>({currentUser:{uid}}),onAuthStateChanged:()=>()=>{}},
    'firebase/firestore': {...firestore,initializeFirestore:()=>db,getFirestore:()=>db},
    'firebase/storage': {getStorage:()=>({})},
  };
  const original=mod.require.bind(mod); mod.require=name=>overrides[name] || original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
  return mod.exports.createFirebaseBackend({kind:'firebase',apiKey:'test',authDomain:'test',projectId:'demo-ohome-char-sort',storageBucket:'test',appId:'test'});
}
const locked = {id:'locked',name:'Cover',own:true,visibility:'public',thumbClass:'',locked:true,lockStub:true,lockVersion:'v1'};
const remove = {id:'remove',name:'Remove'};
const normal = {id:'normal',name:'Normal'};
const prev = [remove, locked, normal], next = [locked, normal];
const changes = diffList(prev, next);
assert.deepEqual(changes.moves.map(x => x.id), ['locked', 'normal']);
assert.doesNotThrow(()=>ensureNoLockedWrites(prev,next));
async function run(file) {
  const env = await initializeTestEnvironment({projectId:'demo-ohome-char-sort', firestore:{rules:fs.readFileSync(path.join(root,file),'utf8')}});
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c=>{
      const db=c.firestore();
      await setDoc(doc(db,'meta/owner'),{uid:'admin',admins:[]});
      for (const [index,item] of prev.entries()) await setDoc(doc(db,'characters',item.id),{data:item,authorId:item.locked?'admin':'member',visibility:'public',editorIds:[],sort:index,updatedAt:1});
    });
    const member=env.authenticatedContext('member').firestore();
    const admin=env.authenticatedContext('admin').firestore();
    let batch=writeBatch(member);
    for(const move of changes.moves) batch.update(doc(member,'characters',move.id),{sort:move.sort,updatedAt:2});
    await assertFails(batch.commit());
    assert.equal((await assertSucceeds(getDoc(doc(member,'characters','normal')))).data().sort,2);
    console.log(`${file}: original member batch rejected as reproduced`);
    const {filterLockedCharacterMoves}=load('src/lib/backend/characterSort.ts');
    const filtered=filterLockedCharacterMoves('characters',changes.moves,next,false,prev);
    // A pure deletion does not require reindexing. Preserve every surviving
    // sort value so locked and unlocked rows never acquire duplicate ranks.
    assert.deepEqual(filtered,[]);
    assert.deepEqual(filterLockedCharacterMoves('characters',changes.moves,next,true,prev),changes.moves);
    assert.deepEqual(filterLockedCharacterMoves('other',changes.moves,next,false,prev),changes.moves);
    const reordered = [normal, remove, locked];
    assert.throws(() => filterLockedCharacterMoves('characters',diffList(prev,reordered).moves,reordered,false,prev), /관리자/);
    const be = await actualBackend(member, 'member');
    await assert.rejects(be.syncList('characters', prev, reordered, 'member'), /관리자/);
    assert.equal((await assertSucceeds(getDoc(doc(member,'characters','normal')))).data().sort,2);
    await assertSucceeds(be.syncList('characters', prev, next, 'member'));
    await env.withSecurityRulesDisabled(async c => {
      assert.equal((await getDoc(doc(c.firestore(),'characters','remove'))).exists(), false);
    });
    const docLocked=(await assertSucceeds(getDoc(doc(member,'characters','locked')))).data();
    assert.deepEqual(docLocked.data,locked); assert.equal(docLocked.sort,1);
    assert.equal((await assertSucceeds(getDoc(doc(member,'characters','normal')))).data().sort,2);
    const edited = {...normal, name:'Edited'};
    await assertSucceeds(be.syncList('characters', next, [locked, edited], 'member'));
    assert.equal((await assertSucceeds(getDoc(doc(member,'characters','normal')))).data().sort,2, 'editing must preserve sort gaps');
    const corrupt=writeBatch(member);corrupt.update(doc(member,'characters','locked'),{'data.basicHtml':'leak'});await assertFails(corrupt.commit());
    const adminBe = await actualBackend(admin, 'admin');
    await assertSucceeds(adminBe.syncList('characters', [locked, edited], [edited, locked], 'admin'));
    assert.equal((await assertSucceeds(getDoc(doc(admin,'characters','normal')))).data().sort,0);
    assert.equal((await assertSucceeds(getDoc(doc(admin,'characters','locked')))).data().sort,1);
    assert.throws(()=>ensureNoLockedWrites(prev,[{...locked,name:'tamper'},normal]));
    console.log(`${file}: non-admin delete, safety and admin sort passed`);
  } finally { await env.cleanup(); }
}
const test = require('node:test');
test('Firestore character sort regression (emulator)', {
  skip: process.env.FIRESTORE_EMULATOR_HOST ? false : 'Firestore emulator not running; use firebase emulators:exec',
}, async () => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Firestore emulator must use a loopback host');
  await run('firebase/firestore.rules');
  await run('firebase/firestore.production.rules');
});
