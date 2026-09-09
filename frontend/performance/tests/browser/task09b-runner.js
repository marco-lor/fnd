const fs=require('node:fs');
const path=require('node:path');
const {chromium,expect}=require('@playwright/test');
const {configureOwnedPerformanceEnvironment}=require('../../../scripts/performance/common');
const {installBootstrap,installDeterministicFontRoutes,warmBrowserAssetDelivery,waitForReadiness}=require('./helpers');
configureOwnedPerformanceEnvironment();
const output=path.resolve(__dirname,'../../../../docs/coordinator/task-09-bazaar-catalog/evidence/09b-browser.json');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({baseURL:'http://127.0.0.1:5000',viewport:{width:1440,height:900},locale:'en-US',timezoneId:'Europe/Rome',deviceScaleFactor:1});
 const report={startedAt:new Date().toISOString(),costs:[],errors:[],checks:[]};let phase='login';
 try{
  await warmBrowserAssetDelivery({baseURL:'http://127.0.0.1:5000',context,owner:'task09b'});
  await installDeterministicFontRoutes(context);await installBootstrap(context,{id:'task09b',route:'/bazaar',role:'player'},1);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',async response=>{if(response.url().includes('task09CatalogPage')){try{const b=await response.json();report.costs.push({phase,status:response.status(),...(b.result||b.data)?.costs});}catch{}}});
  await page.goto('/');await page.locator('input[type="email"]').fill('perf-player@example.test');await page.locator('input[type="password"]').fill('PerfTest!123');await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/$/,{timeout:60000});await waitForReadiness(page,{expectedPathname:new URL(page.url()).pathname,timeoutMs:60000});
  phase='default-cold';await page.goto('/bazaar');const cards=page.locator('[data-testid^="bazaar-item-card-"]');await expect(cards).toHaveCount(50,{timeout:60000});
  report.checks.push({phase,cards:await cards.count(),domNodes:await page.locator('*').count()});
  phase='later-page';await page.getByRole('button',{name:'Carica altri'}).click();await expect(cards).toHaveCount(100);expect(new Set(await cards.evaluateAll(rows=>rows.map(r=>r.dataset.testid))).size).toBe(100);
  const pinned=cards.first();await pinned.click();await expect(page.locator('[data-testid="bazaar-comparison-panel"]')).toBeVisible({timeout:15000});
  phase='advanced-cold';await page.getByPlaceholder('Cerca per Nome...').fill('Task09A ring 0099');await expect.poll(()=>report.costs.some(c=>c.phase===phase&&c.mode==='advanced-scan')).toBe(true);
  phase='default-warm';await page.getByPlaceholder('Cerca per Nome...').fill('');await expect(cards).toHaveCount(50);
  phase='facets';await page.getByRole('button',{name:'Aggiungi filtro...'}).first().click();await expect(page.getByRole('button',{name:'weapon',exact:true})).toBeVisible({timeout:15000});await page.getByRole('button',{name:'weapon',exact:true}).click();
  await expect(page.getByRole('button',{name:'weapon ✕',exact:true})).toBeVisible();report.checks.push({phase,selected:true});
  await page.getByRole('button',{name:'Resetta Filtri'}).click();await expect(cards).toHaveCount(50);
  await page.screenshot({path:output.replace('.json','.png'),fullPage:false});report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;throw error;}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2));await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
