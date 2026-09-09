#!/usr/bin/env node
'use strict';
// Staging only. One reviewed action per invocation; never restores backups.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {resolveOperatorTarget, FRONTEND_ROOT} = require('../firebase-operator-target');
const {createFirebaseCliAdcFile} = require('../firebase-cli-admin-credential');
const ACTIONS = ['begin','step','activate','rollback'];
const RESULTS = path.join(FRONTEND_ROOT, 'performance-results');
const GIT_SAFE = 'safe.directory=' + path.resolve(FRONTEND_ROOT, '..').replace(/\\/g, '/');
function safeFailure(error) {
 const known = new Set(['Reviewed state changed in transaction.','Source business fields changed.','Activation verification failed.','Projection incomplete or source changed; restart migration.','Begin migration first.','Catalog migration is incomplete or incompatible.']);
 return {message:known.has(error?.message)?error.message:'Operator or SDK failure; details suppressed.',code:Number.isInteger(error?.code)&&error.code>=0&&error.code<=16?error.code: error?.code==='failed-precondition'?'failed-precondition':null};
}
const runtimeIdentity = () => ({node:process.versions.node,icu:process.versions.icu});
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
// Typed, review-only backup representation. Maps are tagged too, avoiding collisions.
function encode(v) {
 if(v === undefined) return {type:'undefined'};
 if(v === null || typeof v === 'string' || typeof v === 'boolean')return v;
 if(typeof v === 'number')return Number.isFinite(v)?v:{type:'number',value:String(v)};
 if(Buffer.isBuffer(v) || v instanceof Uint8Array)return {type:'bytes',value:Buffer.from(v).toString('base64')};
 if(v instanceof Date)return {type:'date',value:v.toISOString()};
 if(Array.isArray(v))return {type:'array',value:v.map(encode)};
 if(v && typeof v.toMillis === 'function' && Number.isInteger(v.seconds))return {type:'timestamp',seconds:v.seconds,nanoseconds:v.nanoseconds};
 if(v && v.constructor?.name === 'GeoPoint')return {type:'geopoint',latitude:v.latitude,longitude:v.longitude};
 if(v && typeof v.path === 'string' && v.firestore)return {type:'reference',path:v.path};
 if(v && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null))return {type:'map',value:Object.fromEntries(Object.keys(v).sort().map(k=>[k,encode(v[k])]))};
 throw Error('Unsupported backup value; no migration performed.');
}
async function readSnapshot(db, tx) {
 const s={};
 for(const name of ['items','catalogSummaries','catalogMedia']) {
  const q=await tx.get(db.collection(name));s[name]=q.docs.map(d=>({id:d.id,data:d.data()})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 }
 for(const [key,name] of [['control','catalogControl/bazaar'],['private','catalogPrivate/bazaar']]) {const d=await tx.get(db.doc(name));s[key]=d.exists?d.data():null;}
 return s;
}
const businessHash = s => hash(encode(s.items.map(({id,data})=>({id,data:Object.fromEntries(Object.entries(data).filter(([k])=>k!=='catalogVersion'))}))));
const stateHash = s => hash(encode(s));
function summary(s,core) {
 const rows=s.items.filter(d=>core.isItem(d.data,d.id));
 const expected=rows.map(d=>core.projectSummary({...d.data,id:d.id},d.data.catalogVersion||1,0)).sort(core.compareNames);
 expected.forEach((d,i)=>d.rank=i*1024);
 const current=s.catalogSummaries.filter(d=>d.data.generation===s.control?.generation).map(d=>d.data);
 const expectedMedia=rows.map(d=>({id:d.id,data:core.catalogItemMedia({...d.data,id:d.id})})).sort((a,b)=>a.id<b.id?-1:1);
 const actual=current.map(({generation,...d})=>d).sort(core.compareNames);
 const control=s.control?Object.fromEntries(['schemaVersion','collation','icu','state','generation','revision','offset','total'].filter(k=>s.control[k]!==undefined).map(k=>[k,s.control[k]])):null;
 return {sourceCount:s.items.length,itemCount:rows.length,businessHash:businessHash(s),stateHash:stateHash(s),
  namespaces:{items:s.items.length,catalogSummaries:s.catalogSummaries.length,catalogMedia:s.catalogMedia.length,'catalogControl/bazaar':!!s.control,'catalogPrivate/bazaar':!!s.private},
  control,summaryCount:current.length,summaryComplete:hash(encode(actual))===hash(encode(expected)),mediaComplete:hash(encode(s.catalogMedia))===hash(encode(expectedMedia))};
}
function validatePath(p) {
 if(typeof p!=='string'||!p)throw Error('Explicit output path required under performance-results.');
 const full=path.resolve(FRONTEND_ROOT,p), rel=path.relative(RESULTS,full);
 if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||path.extname(full)!=='.json')throw Error('Artifacts must be JSON files under ignored performance-results.');
 // Reject junction/symlink traversal before creating any directory or credential.
 let cursor=path.dirname(full);
 while(cursor!==FRONTEND_ROOT) {if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('Artifact symlink rejected.');cursor=path.dirname(cursor);}
 if(fs.existsSync(full)&&fs.lstatSync(full).isSymbolicLink())throw Error('Artifact symlink rejected.');
 execFileSync('git',['-c',GIT_SAFE,'check-ignore','--quiet','--',full],{cwd:FRONTEND_ROOT,stdio:'pipe'});
 return full;
}
function writeExclusive(p,v) {
 validatePath(p);fs.mkdirSync(path.dirname(p),{recursive:true});
 const fd=fs.openSync(p,'wx',0o600);
 try {fs.writeFileSync(fd,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function codeIdentity() {
 const entries=[];
 for(const base of ['functions/src','functions/lib']) {
  const walk=dir=>{for(const e of fs.readdirSync(path.join(FRONTEND_ROOT,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.isFile())entries.push([p,crypto.createHash('sha256').update(fs.readFileSync(path.join(FRONTEND_ROOT,p))).digest('hex')]);}};walk(base);
 }
 for(const p of ['scripts/task09/catalog-migration.js','scripts/firebase-operator-target.js','scripts/firebase-environment.js','scripts/firebase-cli-admin-credential.js'])entries.push([p,crypto.createHash('sha256').update(fs.readFileSync(path.join(FRONTEND_ROOT,p))).digest('hex')]);
 return hash(entries);
}
async function connect() {
 const req=createRequire(path.join(FRONTEND_ROOT,'functions/package.json'));
 const {initializeApp,deleteApp}=req('firebase-admin/app');const {getFirestore}=req('firebase-admin/firestore');
 const previous=process.env.GOOGLE_APPLICATION_CREDENTIALS;
 const tempRoot=fs.realpathSync(os.tmpdir());
 const adc=await createFirebaseCliAdcFile({projectId:'fatin-test',cwd:FRONTEND_ROOT,tempDirectory:tempRoot});
 const rel=path.relative(tempRoot,path.resolve(adc.filePath));
 if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Invalid temporary credential location.');
 let app;
 const close=async()=>{try{if(app)await deleteApp(app);}finally{if(previous===undefined)delete process.env.GOOGLE_APPLICATION_CREDENTIALS;else process.env.GOOGLE_APPLICATION_CREDENTIALS=previous;adc.cleanup();}};
 try{process.env.GOOGLE_APPLICATION_CREDENTIALS=adc.filePath;app=initializeApp({projectId:'fatin-test',storageBucket:'fatin-test.firebasestorage.app'},'task09-staging-'+process.pid);return {db:getFirestore(app),close};}catch(e){await close();throw e;}
}
function guard(o,env,branch) {
 if(o.environmentName!=='staging')throw Error('This operator is staging-only.');
 if(Object.keys(env).some(k=>/EMULATOR|FIREBASE_CONFIG/.test(k)&&env[k]))throw Error('Ambiguous emulator or Firebase configuration rejected.');
 for(const [key,value] of Object.entries({FND_GIT_BRANCH:'devs',GITHUB_HEAD_REF:'devs',GITHUB_REF_NAME:'devs',BRANCH_NAME:'devs',GCLOUD_PROJECT:'fatin-test',GOOGLE_CLOUD_PROJECT:'fatin-test',FND_FIREBASE_ENVIRONMENT:'staging',FND_FIREBASE_PROJECT_ID:'fatin-test',FND_FIREBASE_HOSTING_SITE:'fatin-test',FND_FIREBASE_STORAGE_BUCKET:'fatin-test.firebasestorage.app'}))if(env[key]&&env[key]!==value)throw Error('Ambiguous Firebase environment rejected.');
 if(branch!=='devs')throw Error('Staging operator requires actual devs branch.');
 resolveOperatorTarget({options:o,environment:{FND_GIT_BRANCH:branch},cwd:FRONTEND_ROOT});
 if(!['inspect','apply'].includes(o.mode)||!ACTIONS.includes(o.action))throw Error('Use inspect or apply with an explicit begin, step, activate or rollback action.');
 if(o.mode==='apply'&&(o.confirmTarget!=='fatin-test'||!o.plan||!/^[a-f0-9]{64}$/.test(o.reviewedPlanHash||'')))throw Error('Apply requires target confirmation, plan and reviewed plan hash.');
}
async function run(o, injected={}) {
 const env=injected.environment||process.env;
 const branch=injected.branch??execFileSync('git',['-c',GIT_SAFE,'rev-parse','--abbrev-ref','HEAD'],{cwd:FRONTEND_ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 guard(o,env,branch);
 const runtime=injected.runtime||runtimeIdentity();if(!runtime.node.startsWith('22.')||!runtime.icu)throw Error('Node 22 and ICU identity required.');
 const checkPath=injected.validatePath||validatePath, write=injected.writeExclusive||writeExclusive;
 const output=checkPath(o.output);const backup=o.mode==='apply'?checkPath(o.backup):null;
 if(backup===output)throw Error('Separate backup/report paths required.');
 const exists=injected.exists||fs.existsSync;
 if(exists(output)||(backup&&exists(backup)))throw Error('Output or backup already exists; choose new artifact paths.');
 const codeHash=injected.codeHash||codeIdentity();
 let plan;
 if(o.mode==='apply') {
  const planPath=checkPath(o.plan);if(planPath===output||planPath===backup)throw Error('Separate plan/backup/report paths required.');
  plan=(injected.readJson||(p=>JSON.parse(fs.readFileSync(p,'utf8'))))(planPath);
  const {planHash,...body}=plan||{};
  if(planHash!==o.reviewedPlanHash||hash(body)!==planHash||plan.action!==o.action||plan.codeHash!==codeHash||hash(plan.runtime)!==hash(runtime)||plan.target!=='fatin-test'||plan.schemaVersion!==1)throw Error('Reviewed plan mismatch.');
 }
 const core=injected.core||require('../../functions/lib/bazaarCatalogCore');
 const migrate=injected.migrate||require('../../functions/lib/bazaarCatalog').migrateCatalog;
 const snapshot=injected.snapshot||readSnapshot;
 const connection=await (injected.connect||connect)();const {db}=connection;
 try {
  const before=await db.runTransaction(tx=>snapshot(db,tx),{readOnly:true});const beforeReport=summary(before,core);
  if(before.control?.state==='building'&&before.control.icu!==runtime.icu)throw Error('Building generation ICU differs; review rollback/rebuild.');
  if(o.mode==='inspect') {
   const body={schemaVersion:1,target:'fatin-test',action:o.action,runtime,codeHash,...beforeReport};const result={...body,planHash:hash(body)};write(output,result);return result;
  }
  if(beforeReport.stateHash!==plan.stateHash)throw Error('Reviewed source or projection changed; inspect again.');
  write(backup,{schemaVersion:1,target:'fatin-test',action:o.action,planHash:plan.planHash,runtime,codeHash,stateHash:beforeReport.stateHash,snapshot:encode(before)});
  let phase='transaction';
  try {
   const guardedDb=Object.create(db);
   guardedDb.runTransaction=(fn,opts)=>db.runTransaction(async tx=>{
    const locked=await snapshot(db,tx);
    if(stateHash(locked)!==plan.stateHash)throw Error('Reviewed state changed in transaction.');
    return fn(tx);
   },opts);
   await migrate(guardedDb,o.action);
   phase='post-verification';
   const after=summary(await db.runTransaction(tx=>snapshot(db,tx),{readOnly:true}),core);
   const businessUnchanged=after.businessHash===beforeReport.businessHash&&after.sourceCount===beforeReport.sourceCount;
   if(!businessUnchanged)throw Error('Source business fields changed.');
   if(o.action==='activate'&&(after.control?.state!=='active'||after.control?.icu!==runtime.icu||after.control?.generation!==beforeReport.control?.generation||!after.summaryComplete||!after.mediaComplete))throw Error('Activation verification failed.');
   const report={status:'verified',action:o.action,target:'fatin-test',planHash:plan.planHash,runtime,codeHash,before:beforeReport,after,businessUnchanged};write(output,report);return report;
  } catch(e) {
   // Preserve exact remote state for an explicit fresh inspect/resume. Never print SDK errors.
   try{write(output,{status:'failed',phase,action:o.action,target:'fatin-test',planHash:plan.planHash,runtime,codeHash,before:beforeReport,error:safeFailure(e),recovery:'Backup retained. Inspect before retry; outcome may be committed.'});}catch(_reportError){}
   throw Error('Migration failed; backup retained. Inspect current state before retry.');
  }
 }finally{await connection.close();}
}
function parse(argv) {
 const names={'--environment':'environmentName','--project':'projectId','--site':'hostingSite','--bucket':'storageBucket','--mode':'mode','--action':'action','--output':'output','--backup':'backup','--plan':'plan','--confirm-target':'confirmTarget','--reviewed-plan-hash':'reviewedPlanHash'};
 const o={mode:'inspect',action:'begin'};const seen=new Set();
 for(let i=0;i<argv.length;i++){const key=names[argv[i]];if(!key||seen.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Invalid or duplicate argument.');seen.add(key);o[key]=argv[++i];}
 if(o.mode==='apply'&&!seen.has('action'))throw Error('Apply requires explicit action.');return o;
}
if(require.main===module)Promise.resolve().then(()=>run(parse(process.argv.slice(2)))).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Staging catalog operator failed. Check target, reviewed plan, retained artifacts and current state; SDK details suppressed.');process.exitCode=1;});
module.exports={run,parse,hash,encode,readSnapshot,businessHash,validatePath,summary};
