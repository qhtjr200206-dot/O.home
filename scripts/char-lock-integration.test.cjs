const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
function load(name,deps={}){const file=path.join(__dirname,'../src/lib',name+'.ts');const m=new Module(file,module);m.filename=file;m.paths=module.paths;const original=m.require.bind(m);m.require=n=>deps[n]||original(n);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file);return m.exports;}
const server=load('characterLockServer');const {createCharacterLockHandlers}=load('characterLockHttp',{'./characterLockServer':server});const client=load('charLockClient');
let docs={'meta/owner':{uid:'admin'},'characters/c':{data:{id:'c',name:'Cover',own:true,visibility:'public',thumbClass:'',basicHtml:'hidden'},visibility:'public',sort:0}};
const db={collection:c=>({doc:id=>({key:c+'/'+id})}),runTransaction:async f=>{const next=structuredClone(docs);const tx={get:async r=>({exists:Object.hasOwn(docs,r.key),data:()=>structuredClone(docs[r.key])}),set:(r,v)=>{next[r.key]=structuredClone(v)},delete:r=>{delete next[r.key]}};const out=await f(tx);docs=next;return out;}};
const h=createCharacterLockHandlers({verify:async()=> 'admin',change:(uid,id,a,p)=>server.changeCharacterLock(db,uid,id,a,p),open:(id,p,auth,ip)=>server.openCharacter(db,id,p,auth,ip)});
global.fetch=async (url,opts)=>h.unlock(new Request('http://localhost'+url,opts));
(async()=>{
  await server.changeCharacterLock(db,'admin','c','lock','pass');
  const publicRow=()=>structuredClone(docs['characters/c'].data);
  assert.equal((await client.openCharacter('c','pass')).ok,true);
  assert.equal(client.mergeCharacterReads([publicRow()],[])[0].basicHtml,'hidden');
  await server.changeCharacterLock(db,'admin','c','changePassword','changed');
  assert.equal(client.mergeCharacterReads([publicRow()],[])[0].lockStub,true);
  assert.equal(client.openedCharacter('c'),undefined);
  assert.equal((await client.openCharacter('c','pass')).ok,false);
  assert.equal((await client.openCharacter('c','changed')).ok,true);
  assert.equal(client.mergeCharacterReads([publicRow()],[])[0].basicHtml,'hidden');
  await server.changeCharacterLock(db,'admin','c','unlock');
  await server.changeCharacterLock(db,'admin','c','lock','again');
  assert.equal(client.mergeCharacterReads([publicRow()],[])[0].lockStub,true);
  console.log('character lock HTTP/client transaction integration passed');
})().catch(e=>{console.error(e);process.exitCode=1});
