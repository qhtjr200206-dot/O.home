const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const file = path.join(__dirname, '../src/lib/transfer.ts');
const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths;
const mocks = {
  './backend': {CONTENT_COLLECTIONS:['characters', 'rel_secrets'], COLLECTION_OF:{}},
  './blobStore': {allBlobs:async()=>new Map()}, './settingStore': {SETTING_KEYS:[]},
};
mod.require = name => mocks[name] ?? module.require(name);
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {dumpAll, findOrphanFiles, loadAll} = mod.exports;
const url='https://firebasestorage.googleapis.com/v0/b/test/o/hidden?token=x';
const locked={id:'c1',locked:true};
const secret={id:'c1',character:{artUrl:url},lockHash:'hash',lockSalt:'salt',lockAlgorithm:'scrypt-v1',original:{}};
function backend(mode) {return {fetchList:async c => {if(c==='char_secrets') {if(mode==='error') throw Error('denied'); return mode==='missing'?[]:[secret];} return c==='characters'?[locked]:[];}, fetchAllSettings:async()=>({}), listMembers:async()=>[], listFiles:async()=>[{ref:url,size:1},{ref:'unused',size:1}]};}
(async()=>{
  const snap=await dumpAll(backend('ok'));
  assert.deepEqual(snap.collections.char_secrets,[secret]);
  assert.deepEqual((await findOrphanFiles(backend('ok'))).map(x=>x.ref),['unused']);
  await assert.rejects(findOrphanFiles(backend('error')),/char_secrets/);
  await assert.rejects(findOrphanFiles(backend('missing')),/char_secrets/);
  assert.throws(()=>mod.exports.requireCompleteSnapshot({failed:['char_secrets']}), /char_secrets/);
  await assert.rejects(loadAll(null,snap,async()=>null),/잠금/);
  for (const kind of ['firebase', 'supabase']) {
    const old = {kind, currentUser:async()=>({id:'admin',role:'admin'}), fetchList:async c=>{if(c==='char_secrets') throw Error('unavailable'); return c==='characters'?[{id:'open',name:'open'}]:[];}, fetchAllSettings:async()=>({}), listMembers:async()=>[], listFiles:async()=>[{ref:'unused',size:1}]};
    const oldSnap = await dumpAll(old);
    assert.ok(!oldSnap.failed?.includes('char_secrets'), `${kind}: no locks should remain usable`);
    assert.deepEqual((await findOrphanFiles(old)).map(f=>f.ref), ['unused']);
    assert.doesNotThrow(()=>mod.exports.requireCompleteSnapshot(oldSnap));
    const writes=[];
    await loadAll({syncList:async c=>writes.push(c)},oldSnap,async()=>null);
    assert.deepEqual(writes,['characters']);
    const lockedOld={...old,fetchList:async c=>{if(c==='char_secrets') throw Error('denied');return c==='characters'?[locked]:[];}};
    assert.ok((await dumpAll(lockedOld)).failed.includes('char_secrets'));
    let authCalls=0;
    const switched={...old,currentUser:async()=>++authCalls===1?{id:'admin',role:'admin'}:{id:'other',role:'admin'}};
    assert.ok((await dumpAll(switched)).failed.includes('char_secrets'));
    const unknownAuth={...old,currentUser:async()=>{throw Error('offline');}};
    assert.ok((await dumpAll(unknownAuth)).failed.includes('char_secrets'));
    const unknown={...old,fetchList:async c=>{if(c==='characters'||c==='char_secrets') throw Error('denied');return [];}};
    assert.ok((await dumpAll(unknown)).failed.includes('char_secrets'));
    await assert.rejects(findOrphanFiles(unknown),/char_secrets/);
    const nonadmin={...old,currentUser:async()=>({id:'member',role:'member'})};
    assert.ok((await dumpAll(nonadmin)).failed.includes('char_secrets'));
    const corrupt={...old,fetchList:async c=>{if(c==='char_secrets') throw Error('denied');return c==='characters'?[{id:'x',locked:'unknown'}]:[];}};
    assert.ok((await dumpAll(corrupt)).failed.includes('char_secrets'));
  }
  console.log('character lock backup tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
