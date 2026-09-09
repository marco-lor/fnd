// Separate writer-only schema window; never rewrites the 09A item baseline on apply.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {configureOwnedPerformanceEnvironment,projectId}=require('./common');configureOwnedPerformanceEnvironment();
const {initializeApp,deleteApp}=require('firebase-admin/app');const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const backup=path.resolve(__dirname,'../../../docs/coordinator/task-09-bazaar-catalog/evidence/09b-a2-writer-backup.json');
const encode=v=>v?.toMillis?{__timestamp:[v.seconds,v.nanoseconds]}:Array.isArray(v)?v.map(encode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)])):v;
const decode=v=>v?.__timestamp?new Timestamp(...v.__timestamp):Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):v;
(async()=>{const app=initializeApp({projectId},'task09b-a2-writer-fixture'),db=getFirestore(app);try{
 const itemRef=db.doc('items/item-0001'),schemaRef=db.doc('utils/schema_armatura');const action=process.argv[2];
 if(action==='apply'){
  if(fs.existsSync(backup))throw Error('Writer backup exists; reconcile first');
  const item=(await itemRef.get()).data(),schema=(await schemaRef.get()).data();
  if(item?.task09aFixture?.marker!=='task09a-v1')throw Error('Expected unchanged 09A overlay');
  fs.writeFileSync(backup,JSON.stringify({projectId,item:encode(item),schema:encode(schema),createdAt:new Date().toISOString()},null,2));
  const fields={...item.General,Nome:'',prezzo:0,Slot:['body','ring'],spells:{}};
  await schemaRef.set({General:fields,Specific:{...item.Specific},Parametri:{Base:item.Parametri?.Base||{},Combattimento:item.Parametri?.Combattimento||{},Special:item.Parametri?.Special||{}}});
  console.log(JSON.stringify({applied:true,backup,itemChanged:false,itemId:'item-0001',schemaPath:schemaRef.path}));
 }else if(action==='restore'||action==='prepare'){
  const saved=JSON.parse(fs.readFileSync(backup));if(saved.projectId!==projectId)throw Error('Wrong project');
  const writerItem=decode(saved.item);if(action==='prepare'){for(const fields of Object.values(writerItem.Parametri||{})){for(const [key,values] of Object.entries(fields)){if(values&&typeof values==='object'&&!Array.isArray(values)){fields[key]=Object.fromEntries(Object.entries(values).map(([level,value])=>[level,typeof value==='number'?String(value):value]));}}}}
  const auth=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'perf-dm@example.test',password:'PerfTest!123',returnSecureToken:true})});const token=(await auth.json()).idToken;if(!token)throw Error('Demo login failed');
  const response=await fetch(`http://127.0.0.1:5001/${projectId}/europe-west8/task09WriteCatalogItem`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({data:{itemId:'item-0001',item:writerItem,replace:true,action:'save',operationId:`a2-restore-${randomUUID()}`}})});if(!response.ok)throw Error(await response.text());
  if(action==='prepare'){console.log(JSON.stringify({prepared:true,itemId:'item-0001',change:'numeric level values to editor formula strings',backup}));return;}
  await schemaRef.set(decode(saved.schema));
  const restored=encode((await itemRef.get()).data());delete restored.catalogVersion;const expected={...saved.item};delete expected.catalogVersion;
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  if(JSON.stringify(canonical(restored))!==JSON.stringify(canonical(expected)))throw Error('Item restoration mismatch');
  console.log(JSON.stringify({restored:true,exactExceptMonotonicCatalogVersion:true,backupRetained:backup}));
 }else throw Error('Use apply|prepare|restore');
}finally{await deleteApp(app);}})().catch(error=>{console.error(error);process.exitCode=1;});