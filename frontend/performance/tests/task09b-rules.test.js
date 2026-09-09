const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {getDoc,getDocs,doc,collection,query,where,or,and,orderBy,limit,documentId,setDoc}=require('firebase/firestore');
const {configureOwnedPerformanceEnvironment,projectId}=require('../../scripts/performance/common');configureOwnedPerformanceEnvironment();
let env,generation,all,allowed,denied;
before(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')}});
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();generation=(await getDoc(doc(db,'catalogControl/bazaar'))).data().generation;
  const rows=(await getDocs(collection(db,'catalogSummaries'))).docs.map(d=>({id:d.id,...d.data()}));
  all=rows.find(d=>d.visibility==='all');allowed=rows.find(d=>d.visibility==='custom'&&d.allowed_users.includes('perf-player'));denied=rows.find(d=>d.visibility==='custom'&&!d.allowed_users.includes('perf-player'));
 });
});
after(()=>env.cleanup());
test('anonymous denial and exact player/custom/DM/webmaster detail and summary scope',async()=>{
 for(const prefix of ['items','catalogSummaries']){
  const anon=env.unauthenticatedContext().firestore();await assertFails(getDoc(doc(anon,prefix,all.id)));
  const player=env.authenticatedContext('perf-player').firestore();await assertSucceeds(getDoc(doc(player,prefix,all.id)));await assertSucceeds(getDoc(doc(player,prefix,allowed.id)));await assertFails(getDoc(doc(player,prefix,denied.id)));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('perf-dm').firestore(),prefix,denied.id)));
  await assertFails(getDoc(doc(env.authenticatedContext('perf-webmaster').firestore(),prefix,denied.id)));
 }
});
test('indexed summary visibility query is bounded and source/projection client writes are denied',async()=>{
 const player=env.authenticatedContext('perf-player').firestore();
 const q=query(collection(player,'catalogSummaries'),and(where('generation','==',generation),or(where('visibility','==','all'),and(where('visibility','==','custom'),where('allowed_users','array-contains','perf-player')))),orderBy('rank'),limit(50));
 const rows=await assertSucceeds(getDocs(q));assert.equal(rows.size,50);
 const dm=env.authenticatedContext('perf-dm').firestore();for(const prefix of ['items','catalogSummaries','catalogMedia'])await assertFails(setDoc(doc(dm,prefix,all.id),{name:'forged'}));
 await assertFails(getDoc(doc(player,'catalogPrivate/bazaar')));
 const indexes=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../firestore.indexes.json'))).indexes.filter(i=>i.collectionGroup==='catalogSummaries');assert.equal(indexes.length,3);
 assert.ok(indexes.some(i=>i.fields.some(f=>f.fieldPath==='allowed_users'&&f.arrayConfig==='CONTAINS')));
});
test('retained mixed visible/hidden/deleted ID batch exposes only narrow media to active users',async()=>{
 const player=env.authenticatedContext('perf-player').firestore();
 const rows=await assertSucceeds(getDocs(query(collection(player,'catalogMedia'),where(documentId(),'in',[all.id,denied.id,'task09b-deleted-id']))));assert.equal(rows.size,2);
 for(const d of rows.docs){assert.deepEqual(Object.keys(d.data()).sort(),['id','media','mediaUpdatedAt','task07MediaRevision']);}
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'catalogMedia',all.id)));
});
