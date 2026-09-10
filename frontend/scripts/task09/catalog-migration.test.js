'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {run, hash, encode, readSnapshot} = require('./catalog-migration');
const target = {environmentName:'staging', projectId:'fatin-test', hostingSite:'fatin-test', storageBucket:'fatin-test.firebasestorage.app'};
const production = {environmentName:'production', projectId:'fatins', hostingSite:'fatins', storageBucket:'fatins.firebasestorage.app'};
const options = {...target, mode:'inspect', action:'begin', output:'plan.json'};
function harness() {
  const events=[]; const files={};
  let state={items:[{id:'x',data:{item_type:'weapon',General:{Nome:'secret item'},Specific:{},Parametri:{}}}],catalogSummaries:[],catalogMedia:[],control:null,private:null};
  const deps={environment:{}, branch:'devs', runtime:{node:'22.22.2',icu:'78.2'}, codeHash:'a'.repeat(64),
    validatePath:p=>p, exists:p=>!!files[p], readJson:p=>files[p], writeExclusive:(p,v)=>{events.push('write:'+p); if(files[p])throw Error('exists');files[p]=v;},
    connect:async()=>{events.push('credentials');return {db:{runTransaction:async fn=>fn({})},close:async()=>events.push('close')};},
    snapshot:async()=>structuredClone(state),
    core:{isItem:d=>!!d.item_type,projectSummary:d=>({id:d.id}),compareNames:(a,b)=>a.id.localeCompare(b.id),catalogItemMedia:d=>({id:d.id})},
    migrate:async(db,action)=>db.runTransaction(async()=>{events.push('mutation');if(action==='begin')state.control={state:'building',generation:'1',icu:'78.2',offset:0};return {state:'building'};}),
  };
  return {deps,events,files,setState:s=>state=s,getState:()=>state};
}
async function planned(h) {const p=await run(options,h.deps);return {...options,mode:'apply',confirmTarget:'fatin-test',plan:'plan.json',reviewedPlanHash:p.planHash,backup:'backup.json',output:'report.json'};}
test('target, branch and emulator ambiguity fail before credentials',async()=>{
 for(const [patch,env,branch] of [[{projectId:'fatins'},{},'devs'],[{environmentName:'production'},{},'main'],[{}, {FIRESTORE_EMULATOR_HOST:'localhost:8080'},'devs'],[{}, {},'main'],[{storageBucket:undefined},{},'devs']]){
  const h=harness();h.deps.environment=env;h.deps.branch=branch;
  await assert.rejects(run({...options,...patch},h.deps));assert.deepEqual(h.events,[]);
 }
});
test('apply requires explicit action, target confirmation and reviewed hash before credentials',async()=>{
 for(const patch of [{confirmTarget:undefined},{action:undefined},{reviewedPlanHash:'b'.repeat(64)}]){
  const h=harness();const apply=await planned(h);h.events.length=0;
  await assert.rejects(run({...apply,...patch},h.deps));assert.deepEqual(h.events,[]);
 }
});

test('production inspect and apply bind credentials, plans, backups and reports to fatins on main',async()=>{
 const h=harness();h.deps.branch='main';const connect=h.deps.connect;
 h.deps.connect=async selection=>{assert.equal(selection.projectId,'fatins');assert.equal(selection.storageBucket,production.storageBucket);return connect();};
 const p=await run({...options,...production},h.deps);assert.equal(p.target,'fatins');assert.equal(h.events.includes('mutation'),false);
 const result=await run({...options,...production,mode:'apply',confirmTarget:'fatins',plan:'plan.json',reviewedPlanHash:p.planHash,backup:'backup.json',output:'report.json'},h.deps);
 assert.equal(result.target,'fatins');assert.equal(result.businessUnchanged,true);assert.equal(h.files['backup.json'].target,'fatins');
 assert.ok(h.events.indexOf('write:backup.json')<h.events.indexOf('mutation'));
});

test('production rejects mismatched targets, spoofed branches and ambient project overrides before credentials',async()=>{
 for(const [patch,env,branch] of [[{}, {},'devs'],[{projectId:'fatin-test'},{},'main'],[{hostingSite:'fatin-test'},{},'main'],[{storageBucket:target.storageBucket},{},'main'],[{}, {FND_GIT_BRANCH:'main'},'devs'],[{}, {GCLOUD_PROJECT:'fatin-test'},'main'],[{}, {FND_FIREBASE_ENVIRONMENT:'staging'},'main'],[{}, {FIRESTORE_EMULATOR_HOST:'localhost:8080'},'main']]){
  const h=harness();h.deps.environment=env;h.deps.branch=branch;
  await assert.rejects(run({...options,...production,...patch},h.deps));assert.deepEqual(h.events,[]);
 }
});

test('production rejects staging plans and wrong target confirmations before credentials',async()=>{
 for(const wrong of ['plan','confirmation']) {
  const h=harness();const stagingPlan=await run(options,h.deps);h.deps.branch='main';
  const productionPlan=await run({...options,...production,output:'production-plan.json'},h.deps);h.events.length=0;
  await assert.rejects(run({...options,...production,mode:'apply',confirmTarget:wrong==='confirmation'?'fatin-test':'fatins',plan:wrong==='plan'?'plan.json':'production-plan.json',reviewedPlanHash:wrong==='plan'?stagingPlan.planHash:productionPlan.planHash,backup:'backup.json',output:'report.json'},h.deps));
  assert.deepEqual(h.events,[]);
 }
});
test('inspect never mutates and exposes no catalog or private payload',async()=>{
 const h=harness();h.getState().private={cursorSecret:'PRIVATESECRET'};const p=await run(options,h.deps);
 assert.equal(p.sourceCount,1);assert.equal(h.events.includes('mutation'),false);
 assert.equal(JSON.stringify(p).includes('secret item'),false);assert.equal(JSON.stringify(p).includes('PRIVATESECRET'),false);
});
test('changed source and code refuse before mutation and backup',async()=>{
 for(const change of ['source','code']) {const h=harness();const a=await planned(h);h.events.length=0;
 if(change==='source')h.getState().items[0].data.General.Nome='changed';else h.deps.codeHash='b'.repeat(64);
 await assert.rejects(run(a,h.deps));assert.equal(h.events.includes('mutation'),false);assert.equal(h.files['backup.json'],undefined);}
});
test('exclusive backup precedes mutation; existing backup prevents mutation',async()=>{
 const h=harness();const a=await planned(h);await run(a,h.deps);
 assert.ok(h.events.indexOf('write:backup.json')<h.events.indexOf('mutation'));assert.equal(h.files['report.json'].businessUnchanged,true);
 const j=harness();const b=await planned(j);j.files['backup.json']={existing:true};await assert.rejects(run(b,j.deps));assert.equal(j.events.includes('mutation'),false);
});
test('transaction fence detects change after backup',async()=>{
 const h=harness();const a=await planned(h);const write=h.deps.writeExclusive;h.deps.writeExclusive=(p,v)=>{write(p,v);if(p==='backup.json')h.getState().items[0].data.General.Nome='race';};
 await assert.rejects(run(a,h.deps));assert.equal(h.events.includes('mutation'),false);assert.equal(h.files['report.json'].status,'failed');
});
test('migration failure retains backup, sanitized report, closes connection, permits fresh resume plan',async()=>{
 const h=harness();const a=await planned(h);h.deps.migrate=async()=>{throw Error('PRIVATESECRET credential');};
 await assert.rejects(run(a,h.deps),/Migration failed/);assert.ok(h.files['backup.json']);assert.equal(JSON.stringify(h.files['report.json']).includes('PRIVATESECRET'),false);assert.equal(h.events.at(-1),'close');
 const p=await run({...options,output:'resume.json'},h.deps);assert.ok(p.planHash);
});
test('canonical business hash excludes only top-level catalogVersion; typed values retain identity',()=>{
 assert.equal(hash([{id:'x',data:{n:1}}]),hash([{data:{n:1},id:'x'}]));
 assert.notEqual(hash(encode(new Date(0))),hash(encode('1970-01-01T00:00:00.000Z')));
});
test('snapshot reads only affected namespaces within transaction',async()=>{
 const seen=[];const db={collection:p=>({path:p}),doc:p=>({path:p})};
 const tx={get:async ref=>{seen.push(ref.path);return ref.path.includes('/')?{exists:false}:{docs:[]};}};
 await readSnapshot(db,tx);assert.deepEqual(seen,['items','catalogSummaries','catalogMedia','catalogControl/bazaar','catalogPrivate/bazaar']);
});

test('CLI defaults read-only and requires explicit apply action',()=>{
 const {parse}=require('./catalog-migration');assert.equal(parse([]).mode,'inspect');
 assert.throws(()=>parse(['--mode','apply']));assert.throws(()=>parse(['--unknown','x']));assert.throws(()=>parse(['--mode','inspect','--mode','apply']));
});
test('business hash preserves nested version changes but ignores top-level migration version',()=>{
 const {businessHash}=require('./catalog-migration');const h=harness();const before=businessHash(h.getState());
 h.getState().items[0].data.catalogVersion=4;assert.equal(businessHash(h.getState()),before);
 h.getState().items[0].data.General.catalogVersion=4;assert.notEqual(businessHash(h.getState()),before);
});
test('artifact path rejects traversal and coordinator evidence',()=>{
 const {validatePath}=require('./catalog-migration');
 for(const p of ['../docs/coordinator/backup.json','performance-results/../../backup.json','performance-results','performance-results/backup.txt'])assert.throws(()=>validatePath(p));
});
test('building generation ICU mismatch refuses mutation',async()=>{
 const h=harness();h.getState().control={state:'building',icu:'77.1'};
 await assert.rejects(run(options,h.deps),/ICU/);assert.equal(h.events.includes('mutation'),false);
});

test('existing report fails before credentials and mutation',async()=>{
 const h=harness();const a=await planned(h);h.files['report.json']={existing:true};h.events.length=0;
 await assert.rejects(run(a,h.deps),/already exists/);assert.deepEqual(h.events,[]);assert.equal(h.files['backup.json'],undefined);
});

function fingerprintFixture({placeholder=false,escape=false}={}) {
 const root=path.resolve('fixture');let runtime='compiled version 1';
 const filePath=path.join(root,'functions/lib/catalog.js');
 const fsImpl={
  readdirSync:dir=>dir.endsWith(path.join('functions','lib'))?[{name:'catalog.js',isFile:()=>!placeholder,isDirectory:()=>false}]:[],
  statSync:()=>({isFile:()=>true,isDirectory:()=>false}),
  realpathSync:p=>escape&&p===filePath?path.resolve('outside/catalog.js'):p,
  readFileSync:p=>Buffer.from(p===filePath?runtime:'fixed source'),
 };
 return {root,fsImpl,changeRuntime:()=>{runtime='compiled version 2';}};
}

test('code identity includes OneDrive cloud files and is stable across placeholder hydration',()=>{
 const {codeIdentity}=require('./catalog-migration');const normal=fingerprintFixture();const cloud=fingerprintFixture({placeholder:true});
 const first=codeIdentity(cloud);assert.equal(first,codeIdentity(normal));
 cloud.changeRuntime();assert.notEqual(codeIdentity(cloud),first);
});

test('code identity rejects links escaping the reviewed source root',()=>{
 const {codeIdentity}=require('./catalog-migration');
 assert.throws(()=>codeIdentity(fingerprintFixture({placeholder:true,escape:true})),/outside|link|root/i);
});

// Real migration library; Firestore is an in-memory transaction mock, never connected.
for (const migrationTarget of [target, production]) test(`${migrationTarget.environmentName}: real migrateCatalog begin, interrupted-step resume, activate and rollback preserve business fields`,async()=>{
 const core=require('../../functions/lib/bazaarCatalogCore');
 const {migrateCatalog}=require('../../functions/lib/bazaarCatalog');
 const docs=new Map();
 for(let i=0;i<151;i++)docs.set('items/'+String(i).padStart(3,'0'),{item_type:'weapon',General:{Nome:'Item '+i},Specific:{},Parametri:{},visibility:'all',inventorySentinel:{quantity:i}});
 docs.set('items/schema_weapon',{schema:true});docs.set('catalogMedia/orphan',{media:null});
 const doc=p=>({path:p,id:p.split('/').at(-1)});
 const collection=p=>({path:p,where:(field,op,value)=>({...collection(p),filter:[field,value]}),orderBy:()=>collection(p)});
 const snap=(p,data)=>({id:p.split('/').at(-1),exists:data!==undefined,ref:doc(p),data:()=>structuredClone(data),get:k=>data?.[k]});
 const db={doc,collection,runTransaction:async fn=>{
  const writes=[];
  const tx={get:async ref=>{
   if(ref.path.includes('/'))return snap(ref.path,docs.get(ref.path));
   const found=[...docs].filter(([p,d])=>p.startsWith(ref.path+'/')&&(!ref.filter||d[ref.filter[0]]===ref.filter[1])).sort(([a],[b])=>a<b?-1:1).map(([p,d])=>snap(p,d));return {docs:found,size:found.length};
  },set:(r,d)=>writes.push(()=>docs.set(r.path,structuredClone(d))),update:(r,d)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...structuredClone(d)})),delete:r=>writes.push(()=>docs.delete(r.path))};
  const result=await fn(tx);writes.forEach(f=>f());return result;
 }};
 const h=harness();h.deps.core=core;h.deps.migrate=migrateCatalog;h.deps.snapshot=readSnapshot;h.deps.connect=async()=>({db,close:async()=>{}});h.deps.runtime={node:process.versions.node,icu:process.versions.icu};
 h.deps.branch=migrationTarget.environmentName==='production'?'main':'devs';
 async function act(action,index){const p=await run({...options,...migrationTarget,action,output:'plan'+index+'.json'},h.deps);return run({...options,...migrationTarget,mode:'apply',action,confirmTarget:migrationTarget.projectId,plan:'plan'+index+'.json',reviewedPlanHash:p.planHash,backup:'backup'+index+'.json',output:'report'+index+'.json'},h.deps);}
 const begin=await act('begin',0);assert.equal(begin.after.control.state,'building');
 const first=await act('step',1);assert.equal(first.after.control.offset,150);
 // Separate invocation/review resumes at persisted offset without restarting generation.
 const second=await act('step',2);assert.equal(second.after.control.offset,151);assert.equal(second.after.control.generation,first.after.control.generation);
 const active=await act('activate',3);assert.equal(active.after.control.state,'active');assert.equal(active.after.summaryComplete,true);assert.equal(active.after.mediaComplete,true);assert.equal(active.after.sourceCount,152);assert.equal(active.businessUnchanged,true);
 const rollback=await act('rollback',4);assert.equal(rollback.after.control.state,'inactive');assert.equal(rollback.businessUnchanged,true);assert.equal(docs.get('items/050').inventorySentinel.quantity,50);
 assert.equal(JSON.stringify(h.files['report3.json']).includes('Item 50'),false);
});
