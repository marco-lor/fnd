const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const fs=require('node:fs');const path=require('node:path');
const {configureOwnedPerformanceEnvironment,projectId}=require('../../scripts/performance/common');
configureOwnedPerformanceEnvironment();
const fRequire=require('node:module').createRequire(path.resolve(__dirname,'../../functions/package.json'));
const {initializeApp,deleteApp}=fRequire('firebase-admin/app');const {getFirestore}=fRequire('firebase-admin/firestore');
const {migrateCatalog,synchronizeCatalogMedia}=require('../../functions/lib/bazaarCatalog');
const {projectSummary,evaluateSummaries,visible,compareNames}=require('../../functions/lib/bazaarCatalogCore');
let app,db,tokens={},source,revision;const costs=[];
async function call(name,data,role='perf-player',error){
 const response=await fetch(`http://127.0.0.1:5001/${projectId}/europe-west8/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(role?{Authorization:`Bearer ${tokens[role]}`}:{})},body:JSON.stringify({data})});
 const body=await response.json();if(error){assert.equal(body.error?.status,error,JSON.stringify(body));return body.error;}
 assert.equal(response.ok,true,JSON.stringify(body));return body.result??body.data;
}
const meta=async()=>{revision=(await db.doc('catalogControl/bazaar').get()).get('revision');return revision;};
const page=(filters={},extra={},role='perf-player')=>call('task09CatalogPage',{filters,revision,accessGeneration:'test-generation',...extra},role);
const fixtureItem=(name)=>({item_type:'weapon',General:{Nome:name,prezzo:4,Slot:'ring'},Specific:{Tipo:'test',Hands:1},Parametri:{Base:{Forza:{1:3}},Combattimento:{},Special:{zero:0}},visibility:'all',allowed_users:[]});
const write=(itemId,item,operationId,action='save',role='perf-dm',error)=>call('task09WriteCatalogItem',{itemId,item,operationId,action},role,error);
before(async()=>{
 app=initializeApp({projectId},'task09b-integration');db=getFirestore(app);
 for(const uid of ['perf-player','perf-dm','perf-webmaster']){
  const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${uid}@example.test`,password:'PerfTest!123',returnSecureToken:true})});
  const data=await response.json();assert.ok(data.idToken,JSON.stringify(data));tokens[uid]=data.idToken;
 }
 source=(await db.collection('items').get()).docs.filter(d=>d.get('item_type')).map(d=>({id:d.id,...d.data()}));assert.equal(source.length,1000);
});
after(async()=>{fs.writeFileSync(path.resolve(__dirname,'../../../docs/coordinator/task-09-bazaar-catalog/evidence/09b-query-costs.json'),JSON.stringify({fixtureItems:1000,inventory:500,costs},null,2));await deleteApp(app);});
test('migration freezes writers, resumes, detects corruption, activates and is bounded per step',async()=>{
 await migrateCatalog(db,'rollback');await meta();await call('task09CatalogPage',{revision},'perf-player','FAILED_PRECONDITION');
 const start=await migrateCatalog(db,'begin');const first=await migrateCatalog(db,'step');assert.equal(first.processed,150);
 const resumed=await migrateCatalog(db,'begin');assert.equal(resumed.generation,start.generation);assert.equal(resumed.offset,150);
 await write('task09b-frozen',fixtureItem('frozen'),'task09b-frozen','save','perf-dm','FAILED_PRECONDITION');
 await assert.rejects(migrateCatalog(db,'activate'),/incomplete/);
 let progress=first;while(progress.offset<progress.total)progress=await migrateCatalog(db,'step');
 const ref=db.doc('catalogSummaries/item-0000');const good=(await ref.get()).data();await ref.update({price:99999});
 await assert.rejects(migrateCatalog(db,'activate'),/incomplete/);await ref.set(good);
 assert.equal((await migrateCatalog(db,'activate')).total,1000);await meta();
});
test('default cold/warm costs and complete stable cursor pages match ICU name and binary ID order',async()=>{
 const cold=await page();const warm=await page();costs.push({window:'default-cold',...cold.costs},{window:'default-warm',...warm.costs});
 assert.equal(cold.rows.length,50);assert.equal(cold.costs.summaryDocuments,50);assert.equal(cold.costs.metadataDocuments,4);assert.equal(cold.facets,null);
 assert.ok(cold.rows.every(r=>!r.General&&!r.Parametri&&!r.spells));
 const rows=[...cold.rows];let cursor=cold.cursor;while(cursor){const more=await page({}, {cursor});rows.push(...more.rows);cursor=more.cursor;}
 const expected=source.filter(d=>visible(d,'perf-player','player')).map(d=>projectSummary(d,1,0)).sort(compareNames).map(d=>d.id);
 assert.equal(expected.length,950);assert.equal(new Set(rows.map(d=>d.id)).size,950);assert.deepEqual(rows.map(d=>d.id),expected);
 await call('task09CatalogPage',{revision,filters:{},cursor:{...cold.cursor,rank:cold.cursor.rank+1},accessGeneration:'test-generation'},'perf-player','FAILED_PRECONDITION');
 await call('task09CatalogPage',{revision,filters:{},cursor:cold.cursor,accessGeneration:'other-generation'},'perf-player','FAILED_PRECONDITION');
});
test('complete advanced scans and facets, including restored cold filters and actor separation',async()=>{
 const cases=[{searchTerm:'Item 0999'},{searchTerm:'  '},{selectedSpecialParams:['zero'],selectedSlot:['ring','body']},{selectedBaseParams:['Forza'],selectedCombatParams:['Attacco']},{onlyAffordable:true,userGold:5}];
 const projected=source.filter(d=>visible(d,'perf-player','player')).map(d=>projectSummary(d,1,0));
 for(const filters of cases){let result=await page(filters);costs.push({window:'advanced-cold',filters,...result.costs});const warm=await page(filters);costs.push({window:'advanced-warm',filters,...warm.costs});const rows=[...result.rows];while(result.cursor){result=await page(filters,{cursor:result.cursor});rows.push(...result.rows);}assert.deepEqual(rows.map(d=>d.id),evaluateSummaries(projected,filters).map(d=>d.id));}
 const facets=await page({}, {facets:true});assert.equal(facets.costs.summaryDocuments,950);assert.ok(facets.facets.slots.length>1);costs.push({window:'facets',...facets.costs});
 const dm=await page({}, {facets:true},'perf-dm');assert.equal(dm.costs.summaryDocuments,1000);
 const wm=await page({}, {facets:true},'perf-webmaster');assert.ok(wm.costs.summaryDocuments<1000);
 await call('task09CatalogPage',{revision},null,'UNAUTHENTICATED');
 const denied=source.find(d=>!visible(d,'perf-player','player'));await call('task09CatalogDetail',{itemId:denied.id,revision},'perf-player','PERMISSION_DENIED');
 assert.ok((await call('task09CatalogDetail',{itemId:denied.id,revision},'perf-dm')).General);
});
test('concurrent atomic editor writes, replay, visibility/delete revisions, media-only projection isolation',async()=>{
 const before=(await db.doc('catalogMedia/item-0000').get()).updateTime.toMillis();
 const oldCursor=(await page()).cursor;
 const item={...fixtureItem('!Concurrent'),id:'conflicting-client-id'};
 await Promise.all([write('task09b-a',item,'task09b-create-a'),write('task09b-b',item,'task09b-create-b')]);
 const a=(await db.doc('catalogSummaries/task09b-a').get()).data(),b=(await db.doc('catalogSummaries/task09b-b').get()).data();assert.ok(a.rank<b.rank);
 assert.equal((await db.doc('items/task09b-a').get()).get('id'),undefined);
 await db.doc('items/task09b-a').update({id:'conflicting-legacy-id'});await meta();assert.equal((await call('task09CatalogDetail',{itemId:'task09b-a',revision},'perf-player')).id,'task09b-a');
 const replay=await write('task09b-a',item,'task09b-create-a');assert.equal(replay.catalogVersion,1);
 await meta();await call('task09CatalogPage',{revision,filters:{},cursor:oldCursor,accessGeneration:'test-generation'},'perf-player','FAILED_PRECONDITION');
 await write('task09b-a',{...item,General:{...item.General,Nome:'zzReordered',prezzo:99}},'task09b-change-a');
 await write('task09b-b',{...item,visibility:'custom',allowed_users:['perf-dm']},'task09b-hide-b');await meta();
 assert.equal((await page({searchTerm:'Concurrent'})).rows.length,0);
 assert.equal((await db.doc('catalogMedia/item-0000').get()).updateTime.toMillis(),before);
 const ref=db.doc('items/task09b-a');
 await db.runTransaction(async tx=>{const d=await tx.get(ref);const patch={media:{assetId:'m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',variants:{card:{path:'test-card'}}},task07MediaRevision:1};await synchronizeCatalogMedia(tx,db,ref,d.data(),patch);tx.update(ref,patch);});
 assert.equal((await db.doc('catalogMedia/task09b-a').get()).get('media.assetId'),'m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
 assert.equal((await db.doc('catalogSummaries/task09b-a').get()).get('media.variants.card.path'),'test-card');
 await write('task09b-a',null,'task09b-delete-a','delete');await write('task09b-b',null,'task09b-delete-b','delete');
 assert.equal((await db.doc('catalogMedia/task09b-a').get()).exists,false);assert.equal((await db.doc('catalogSummaries/task09b-a').get()).exists,false);
 await meta();
});
