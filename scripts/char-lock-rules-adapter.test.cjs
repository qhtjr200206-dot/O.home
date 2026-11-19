const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
const file=path.join(__dirname,'../src/lib/characterLockFirebase.ts');let changed=0,checks=0,ready=false,selected='';
const app={name:'ohome-character-lock',options:{projectId:'trpg-9b961',credential:{getAccessToken:async()=>({access_token:'x'})}}};
const services={
 'node:fs':{readFileSync:p=>{if(String(p).endsWith('ohome.config.json'))return JSON.stringify({kind:'firebase',projectId:app.options.projectId,databaseId:'named-db'});selected=path.basename(String(p));return 'trusted-rules';}},
 './characterLockConfig':{resolveCharacterDatabase:()=> 'named-db'},
 'firebase-admin/app':{getApps:()=>[app]}, 'firebase-admin/auth':{getAuth:()=>({verifyIdToken:async()=>({uid:'admin'})})},
 'firebase-admin/firestore':{getFirestore:()=>({})},
 './characterLockServer':{CharacterLockError:class extends Error{constructor(m,status){super(m);this.status=status}},changeCharacterLock:async()=>{changed++},openCharacter:async()=>({ok:false,status:400})},
 './characterLockRules':{assertCharacterRulesReady:async opts=>{checks++;assert.equal(opts.databaseId,'named-db');if(!ready)throw Error('unready')}},
 './characterLockHttp':{createCharacterLockHandlers:x=>x},
};
const m=new Module(file,module);m.filename=file;m.paths=module.paths;const orig=m.require.bind(m);m.require=n=>services[n]||orig(n);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);
const h=m.exports.characterLockHandlers;
(async()=>{await assert.rejects(()=>h.change('admin','id','lock','pass'),e=>e.status===503);assert.equal(changed,0);assert.equal(checks,1);ready=true;await h.change('admin','id','lock','pass');assert.equal(changed,1);assert.equal(selected,'firestore.production.rules');app.options.projectId='another-project';await h.change('admin','id','lock','pass');assert.equal(selected,'firestore.rules');assert.equal(changed,2);await h.change('admin','id','unlock');assert.equal(changed,3);console.log('rules gate before write tests passed')})().catch(e=>{console.error(e);process.exitCode=1});
