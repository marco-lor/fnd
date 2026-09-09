#!/usr/bin/env node
// Deliberately emulator-only. No credentials/default-project fallback.
const {configureOwnedPerformanceEnvironment,assertPerformanceProject,projectId}=require('./common');
configureOwnedPerformanceEnvironment();assertPerformanceProject(projectId);
const functionsRequire=require('node:module').createRequire(require('node:path').resolve(__dirname,'../../functions/package.json'));
const {initializeApp,deleteApp}=functionsRequire('firebase-admin/app');
const {getFirestore}=functionsRequire('firebase-admin/firestore');
const {migrateCatalog}=require('../../functions/lib/bazaarCatalog');
async function main(){
 const action=process.argv[2];
 if(!['begin','step','activate','rollback','run'].includes(action))throw new Error('Use begin, step, activate, rollback or run.');
 const app=initializeApp({projectId},'task09-migration');
 try{
  const db=getFirestore(app);
  if(action!=='run')console.log(JSON.stringify(await migrateCatalog(db,action)));
  else{
   if((await db.doc('catalogControl/bazaar').get()).get('state')==='active'){console.log(JSON.stringify(await migrateCatalog(db,'activate')));return;}
   console.log(JSON.stringify(await migrateCatalog(db,'begin')));
   let result;do{result=await migrateCatalog(db,'step');console.log(JSON.stringify(result));}while(result.offset<result.total||result.cleanupRemaining);
   console.log(JSON.stringify(await migrateCatalog(db,'activate')));
  }
 }finally{await deleteApp(app);}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
