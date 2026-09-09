const assert = require('node:assert/strict');
const {test, before, after} = require('node:test');
const {randomUUID} = require('node:crypto');
const fRequire=require('node:module').createRequire(require('node:path').resolve(__dirname,'../../functions/package.json'));
const {initializeApp: initAdmin, deleteApp: deleteAdmin} = fRequire('firebase-admin/app');
const {getFirestore,FieldValue} = fRequire('firebase-admin/firestore');
const {migrateCatalog}=require('../../functions/lib/bazaarCatalog');
const {initializeApp, deleteApp} = require('firebase/app');
const {getAuth, connectAuthEmulator, signInWithEmailAndPassword} = require('firebase/auth');
const {getStorage, connectStorageEmulator, ref, uploadBytesResumable} = require('firebase/storage');
const {configureOwnedPerformanceEnvironment, projectId} = require('../../scripts/performance/common');
const {buildDeterministicPng, PERFORMANCE_STORAGE_BUCKET} = require('../../scripts/performance/fixtures');
configureOwnedPerformanceEnvironment();
const itemId = 'task09b-a2-media-writer';
let admin, client, db, storage, token, originalControl;
const call = async (name, data) => {
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/europe-west8/${name}`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({data}),signal:AbortSignal.timeout(120000)});
  const body = await response.json(); assert.equal(response.ok,true,JSON.stringify(body)); return body.result ?? body.data;
};
const write = (item, action='save') => call('task09WriteCatalogItem',{itemId,item,action,operationId:`a2-${randomUUID()}`});
const pause = () => new Promise(resolve=>setTimeout(resolve,250));
const consistent = () => db.runTransaction(async tx => {
  const [source, summary, meta, media] = await tx.getAll(db.doc(`items/${itemId}`),db.doc(`catalogSummaries/${itemId}`),db.doc('catalogControl/bazaar'),db.doc(`catalogMedia/${itemId}`));
  assert.equal(meta.get('state'),'active'); assert.equal(source.get('catalogVersion'),summary.get('catalogVersion'));
  assert.equal(summary.get('generation'),meta.get('generation')); assert.equal(summary.get('name'),source.get('General.Nome'));
  return {source:source.data(),summary:summary.data(),revision:meta.get('revision'),media:media.data()};
});
const upload = async (nestedTarget, expectedRevision, seed) => {
  const bytes=buildDeterministicPng({width:32,height:32,seed});
  const prepared=await call('task07PrepareMediaUpload',{ownerUid:'perf-dm',entityId:itemId,operationId:`a2-${randomUUID()}`,kind:nestedTarget?'spell':'item',referenceScope:'global-catalog',...(nestedTarget?{nestedTarget}:{}),previousAssetId:null,sourceContentType:'image/png',sourceBytes:bytes.byteLength});
  const u=prepared.upload;
  await new Promise((resolve,reject)=>uploadBytesResumable(ref(storage,u.sourcePath),bytes,{contentType:u.sourceContentType,cacheControl:u.cacheControl,contentDisposition:u.contentDisposition,customMetadata:u.sourceMetadata}).on('state_changed',()=>{},reject,resolve));
  const deadline=Date.now()+90000;
  while(true){const status=await call('task07GetMediaStatus',{assetId:u.assetId});if(status.state==='ready')break;assert.ok(Date.now()<deadline,JSON.stringify(status));assert.ok(!['failed','rejected'].includes(status.state),JSON.stringify(status));await pause();}
  const attached=await call('task07AttachMediaAsset',{assetId:u.assetId,expectedRevision});
  assert.equal(attached.revision,expectedRevision+1);return u.assetId;
};
before(async()=>{
  admin=initAdmin({projectId,storageBucket:PERFORMANCE_STORAGE_BUCKET},'task09b-a2-media-admin');db=getFirestore(admin);
  assert.equal((await db.doc('catalogControl/bazaar').get()).get('state'),'active');assert.equal((await db.doc(`items/${itemId}`).get()).exists,false);
  originalControl=(await db.doc('utils/task07_media').get()).data();
  await db.doc('utils/task07_media').set({schemaVersion:1,policyVersion:1,mode:'v1-write',enabledPurposes:['item','spell'],enabledRoles:['dm'],enabledUids:['perf-dm']});
  client=initializeApp({apiKey:'demo-api-key',projectId,storageBucket:PERFORMANCE_STORAGE_BUCKET},'task09b-a2-media-client');const auth=getAuth(client);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});storage=getStorage(client);connectStorageEmulator(storage,'127.0.0.1',9199);token=await(await signInWithEmailAndPassword(auth,'perf-dm@example.test','PerfTest!123')).user.getIdToken();
});
after(async()=>{
  if(token && (await db.doc(`items/${itemId}`).get()).exists)await write(null,'delete');
  if(originalControl)await db.doc('utils/task07_media').set(originalControl);else if(db)await db.doc('utils/task07_media').delete();
  if(client)await deleteApp(client);if(admin)await deleteAdmin(admin);
});
test('active-generation trusted save, real Task07 attach, rename, retire and crash-gap recovery stay coherent', {timeout:300000},async()=>{
  const entryId='a2-stable-spell';
  const spell={Nome:'Shield',descrizione:'Retained nested detail',costo:3,task07MediaEntryId:entryId};
  await write({item_type:'armor',General:{Nome:'A2 writer',prezzo:7,Slot:'body',spells:{Shield:spell}},Specific:{Tipo:'test'},Parametri:{Base:{},Combattimento:{},Special:{}},visibility:'all',allowed_users:[]});
  const start=await consistent();
  const nestedTarget={schemaVersion:1,kind:'catalog-item-spell',entryId,entryKey:'Shield',entryIndex:null,slot:'media'};
  const nestedAsset=await upload(nestedTarget,0,921);
  const attached=await consistent();assert.ok(attached.revision>start.revision);assert.equal(attached.source.task07EmbeddedMedia[entryId].media.assetId,nestedAsset);assert.equal(attached.summary.spells,undefined);
  const rootAsset=await upload(null,0,922);const root=await consistent();assert.equal(root.source.media.assetId,rootAsset);assert.equal(root.summary.media.assetId,rootAsset);assert.equal(root.media.media.assetId,rootAsset);
  // Reproduce a trusted pre-existing General-only alias, then migrate it.
  await db.doc(`items/${itemId}`).update({media:FieldValue.delete(),'General.media':root.source.media});
  if(process.env.TASK09B_SKIP_BULK_MIGRATION !== '1'){
  await migrateCatalog(db,'rollback');await migrateCatalog(db,'begin');let progress;
  do{progress=await migrateCatalog(db,'step');}while(progress.offset<progress.total||progress.cleanupRemaining);
  await migrateCatalog(db,'activate');
  }
  const legacy=await consistent();assert.equal(legacy.source.media,undefined);assert.equal(legacy.summary.media.assetId,rootAsset);assert.equal(legacy.media.media.assetId,rootAsset);
  await write({...legacy.source,General:{...legacy.source.General,Nome:'A2 renamed',spells:{Renamed:{...spell,Nome:'Renamed'}}}});
  const renamed=await consistent();assert.equal(renamed.source.General.spells.Renamed.task07MediaEntryId,entryId);assert.equal(renamed.source.General.spells.Renamed.descrizione,spell.descrizione);assert.equal(renamed.source.task07EmbeddedMedia[entryId].media.assetId,nestedAsset);assert.equal(renamed.media.media.assetId,rootAsset);assert.equal(renamed.source.General.media.assetId,rootAsset);assert.equal(renamed.source.media,undefined);
  await call('task07RetireMediaAsset',{assetId:rootAsset});const retired=await consistent();assert.equal(retired.source.media,undefined);assert.equal(retired.source.General.media,undefined);assert.equal(retired.summary.media,null);assert.equal(retired.media.media,null);
  // Commit removal through the actual 09B writer, then omit the browser retirement call.
  await write({...retired.source,General:{...retired.source.General,spells:{}}});
  const deadline=Date.now()+90000;let recovered;
  while(true){recovered=await consistent();const manifest=await db.doc(`media_assets/${nestedAsset}`).get();if(manifest.get('state')==='superseded' && !recovered.source.task07EmbeddedMedia?.[entryId]?.media)break;assert.ok(Date.now()<deadline,JSON.stringify({message:'nested crash-gap recovery timed out',source:recovered.source,manifest:manifest.data(),cleanup:(await db.doc('media_asset_cleanup/'+nestedAsset).get()).data()}));await pause();}
  assert.equal((await db.doc(`media_asset_cleanup/${nestedAsset}`).get()).get('state'),'pending');
  assert.equal(recovered.source.task07EmbeddedMedia[entryId].task07MediaRevision,2);
  // Idempotent late browser cleanup remains safe after trigger recovery.
  await call('task07RetireMediaAsset',{assetId:nestedAsset});await consistent();
});