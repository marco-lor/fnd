const fs=require('node:fs'),path=require('node:path');
const {chromium,expect}=require('@playwright/test');
const {configureOwnedPerformanceEnvironment,projectId}=require('../../../scripts/performance/common');
const {installBootstrap,installDeterministicFontRoutes,warmBrowserAssetDelivery,waitForReadiness}=require('./helpers');
const {initializeApp,deleteApp}=require('firebase-admin/app');const {getFirestore}=require('firebase-admin/firestore');
configureOwnedPerformanceEnvironment();
const output=path.resolve(__dirname,'../../../../docs/coordinator/task-09-bazaar-catalog/evidence/09b-a2-editor-browser.json');
(async()=>{
 const admin=initializeApp({projectId},'task09b-a2-browser-audit'),db=getFirestore(admin);const before=(await db.doc('items/item-0001').get()).data();
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({baseURL:'http://127.0.0.1:5000',viewport:{width:1440,height:900},locale:'en-US',timezoneId:'Europe/Rome'});
 const report={startedAt:new Date().toISOString(),errors:[],consoleErrors:[],writerResponses:[]};
 try{
  await warmBrowserAssetDelivery({baseURL:'http://127.0.0.1:5000',context,owner:'task09b-a2'});await installDeterministicFontRoutes(context);await installBootstrap(context,{id:'task09b-a2',route:'/bazaar',role:'dm'},1);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('response',async r=>{if(r.url().includes('task09WriteCatalogItem'))report.writerResponses.push({status:r.status(),body:await r.json()});});
  await page.goto('/');await page.locator('input[type="email"]').fill('perf-dm@example.test');await page.locator('input[type="password"]').fill('PerfTest!123');await page.locator('form button[type="submit"]').click();await expect(page).not.toHaveURL(/\/$/,{timeout:60000});await waitForReadiness(page,{expectedPathname:new URL(page.url()).pathname,timeoutMs:60000});
  await page.goto('/bazaar');await expect(page.locator('[data-testid^="bazaar-item-card-"]')).toHaveCount(50,{timeout:60000});await page.getByPlaceholder('Cerca per Nome...').fill('0001');await page.getByTestId('bazaar-item-card-item-0001').click();await expect(page.getByRole('button',{name:'Modifica Oggetto',exact:true})).toBeVisible({timeout:30000});await page.getByRole('button',{name:'Modifica Armatura',exact:true}).click();
  await expect(page.getByRole('button',{name:'Salva Modifiche',exact:true})).toBeVisible({timeout:30000});await expect(page.getByText('Struttura parametri nello schema incompleta.')).toHaveCount(0);
  await page.screenshot({path:output.replace('.json','.png'),fullPage:false});await page.getByRole('button',{name:'Salva Modifiche',exact:true}).click();await expect.poll(()=>report.writerResponses.length,{timeout:30000}).toBe(1);expect(report.writerResponses[0].status).toBe(200);await expect(page.getByRole('button',{name:'Salva Modifiche',exact:true})).toHaveCount(0,{timeout:30000});
  const after=(await db.doc('items/item-0001').get()).data();const summary=(await db.doc('catalogSummaries/item-0001').get()).data();
  for(const [name,spell] of Object.entries(before.General.spells)){if(spell&&typeof spell==='object'){expect(after.General.spells[name]).toMatchObject({...spell,Nome:spell.Nome||name});}}
  expect(after.catalogVersion).toBe(before.catalogVersion+1);expect(summary.catalogVersion).toBe(after.catalogVersion);expect(report.errors).toEqual([]);
  report.status='passed';report.beforeVersion=before.catalogVersion;report.afterVersion=after.catalogVersion;report.retainedSpells=after.General.spells;
 }catch(e){report.status='failed';report.failure=e.stack;throw e;}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2));await context.close();await browser.close();await deleteApp(admin);}
})().catch(e=>{console.error(e);process.exitCode=1;});