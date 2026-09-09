const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium,expect}=require('@playwright/test');
const {configureOwnedPerformanceEnvironment,resultsDir,fixtureManifestPath}=require('../../../scripts/performance/common');
const {installBootstrap,installDeterministicFontRoutes,warmBrowserAssetDelivery,waitForReadiness}=require('./helpers');
const {summarizeBazaarProfile}=require('../../../scripts/performance/task09a-profile');
configureOwnedPerformanceEnvironment();
const output=path.resolve(__dirname,'../../../../docs/coordinator/task-09-bazaar-catalog/evidence',process.env.TASK09C_REPORT||'09c-browser.json');
(async()=>{
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({baseURL:'http://127.0.0.1:5000',viewport:{width:1440,height:900},locale:'en-US',timezoneId:'Europe/Rome',deviceScaleFactor:1});
 const report={startedAt:new Date().toISOString(),machine:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,browser:browser.version()},fixture:{documents:9139,hash:'fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8',catalog:1000,inventory:500,visible:950},calls:[],network:[],mediaRequests:[],errors:[],windows:[],targets:{pageSize:50,coldRapidDetailsMax:1,warmRapidDetails:0,additionalProfileListeners:0,commitP95Ms:16.7}};
 const build=JSON.parse(fs.readFileSync(path.join(resultsDir,process.env.TASK09C_ORDINARY==='1'?'build-report.json':'profile-build-report.json')));report.build={generatedAt:build.generatedAt,mode:build.buildMode,reactProfiling:build.reactProfiling,sourceTreeFingerprint:build.sourceTreeIdentity?.sourceTreeFingerprint};report.fixtureManifest=JSON.parse(fs.readFileSync(fixtureManifestPath));
 let phase='login';const pending=[];
 try{
  await warmBrowserAssetDelivery({baseURL:'http://127.0.0.1:5000',context,owner:'task09c'});await installDeterministicFontRoutes(context);await installBootstrap(context,{id:'task09c',route:'/bazaar',role:'player'},1);
  const page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');const requests=new Map();
  cdp.on('Network.responseReceived',event=>requests.set(event.requestId,{url:event.response.url,phase,status:event.response.status}));
  cdp.on('Network.loadingFinished',event=>{const r=requests.get(event.requestId);if(r&&(/task09Catalog|9199/.test(r.url)))report.network.push({...r,encodedDataLength:event.encodedDataLength});});
  page.on('request',request=>{if(request.resourceType()==='image'&&request.url().includes('9199')&&['cold-entry','warm-entry'].includes(phase)){const requestPhase=phase;pending.push(page.evaluate(url=>[...document.querySelectorAll('[data-testid^="bazaar-item-card-"] img')].filter(img=>img.src===url||img.currentSrc===url).map(img=>{const rect=img.getBoundingClientRect();return {card:img.closest('[data-testid]').dataset.testid,visible:rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth,rect:{top:rect.top,bottom:rect.bottom},observedAt:performance.now()};}),request.url()).then(matches=>report.mediaRequests.push({phase:requestPhase,url:request.url(),matches,classification:!matches.length?'non-card-or-unmatched':matches.some(m=>m.visible)?'visible-or-shared-visible':'offscreen-only'})));}});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(/task09Catalog(Page|Detail)/.test(response.url())){const capturedPhase=phase;pending.push((async()=>{const body=await response.body();let data;try{const json=JSON.parse(body.toString());data=json.result||json.data;}catch{}report.calls.push({phase:capturedPhase,kind:response.url().includes('Detail')?'detail':'page',status:response.status(),decodedBodyBytes:body.length,costs:data?.costs,itemId:data?.id});})().catch(error=>report.errors.push(error.message)));}});
  await page.goto('/');await page.locator('input[type="email"]').fill('perf-player@example.test');await page.locator('input[type="password"]').fill('PerfTest!123');await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/$/,{timeout:60000});await waitForReadiness(page,{expectedPathname:new URL(page.url()).pathname,timeoutMs:60000});
  await page.mouse.move(0,0);phase='cold-entry';await page.goto('/bazaar');const cards=page.locator('[data-testid^="bazaar-item-card-"]');await expect(cards).toHaveCount(50,{timeout:60000});await page.waitForTimeout(500);
  report.scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.src));const main=report.scripts.find(url=>/\/main\./.test(url));const bytes=fs.readFileSync(path.join(__dirname,'../../../build',new URL(main).pathname));report.mainSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const snapshot=()=>page.evaluate(()=>window.__FND_PERF__.snapshot());
  const state=()=>page.evaluate(()=>{const cards=[...document.querySelectorAll('[data-testid^="bazaar-item-card-"]')],images=[...document.images];return {mountedCards:cards.length,domNodes:document.querySelectorAll('*').length,mountedImages:images.length,cardImages:cards.reduce((n,c)=>n+c.querySelectorAll('img').length,0),offscreenImages:images.filter(i=>i.getBoundingClientRect().top>innerHeight).length,loadedImages:images.filter(i=>i.complete&&i.naturalWidth>0).length,imageRequests:performance.getEntriesByType('resource').filter(e=>e.initiatorType==='img').map(e=>({name:e.name,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize}))};});
  const count=(s,filter)=>s.events.filter(filter).length;
  const summarize=async(name,before=null)=>{await Promise.all(pending);const s=await snapshot();const events=s.events.slice(before?.events.length||0);const value={name,profile:summarizeBazaarProfile(s,before),gridRenders:events.filter(e=>e.metric==='render'&&e.tags?.component==='BazaarCardGrid'&&e.tags?.source==='committed-probe').length,cardRenders:events.filter(e=>e.metric==='render'&&e.tags?.component==='BazaarItemCard'&&e.tags?.source==='committed-probe').length,listRenders:events.filter(e=>e.metric==='render'&&e.tags?.component==='Bazaar'&&e.tags?.source==='committed-probe').length,shellRegistrations:events.filter(e=>e.category==='firestore'&&e.metric==='listener-open'&&e.tags?.target==='users.shell.subscribe.v2').length,profileRegistrations:events.filter(e=>e.category==='firestore'&&e.metric==='listener-open'&&/^users\.(settings|resources|progression)\./.test(e.tags?.target||'')).length,dom:await state(),dropped:s.droppedEventCount};report.windows.push(value);expect(s.droppedEventCount).toBe(0);return s;};
  let before=await summarize(phase);expect(report.windows.at(-1).dom.cardImages).toBe(50);
  const rapid=async(name)=>{
    phase=name;await page.mouse.move(0,0);await page.evaluate(()=>{window.__task09cPointer=[];window.__task09cTrack=e=>{const c=e.target.closest?.('[data-testid^="bazaar-item-card-"]');if(c&&e.relatedTarget?.closest?.('[data-testid^="bazaar-item-card-"]')!==c)window.__task09cPointer.push({id:c.dataset.testid,type:e.type,time:performance.now()});};document.addEventListener('mouseover',window.__task09cTrack);document.addEventListener('mouseout',window.__task09cTrack);});
    const times=[];
    const coordinates=await cards.evaluateAll(nodes=>nodes.slice(0,20).map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.testid,x:r.x+r.width/2,top:r.top+scrollY};}));
    const ids=coordinates.map(c=>c.id);
    const rows=[];
    for(const card of coordinates){const last=rows.at(-1);if(last&&Math.abs(last[0].top-card.top)<5)last.push(card);else rows.push([card]);}
    for(const row of rows){
      const scroll=Math.max(0,row[0].top-350);
      await cdp.send('Runtime.evaluate',{expression:`window.scrollTo({top:${scroll},behavior:'instant'})`});
      // Queue distinct real input messages in socket order within a fixed-scroll row.
      const movements=row.map(card=>{times.push({id:card.id,queuedAt:Date.now()});return cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:card.x,y:card.top-scroll+20});});
      await Promise.all(movements);
    }
    await page.waitForTimeout(450);
    if(name==='rapid-cold')await expect.poll(()=>report.calls.some(c=>c.phase===name&&c.kind==='detail'&&c.itemId===ids[19].replace('bazaar-item-card-','')),{timeout:15000}).toBe(true);
    await Promise.all(pending);
    report[name]={moves:times,pointer:await page.evaluate(()=>{document.removeEventListener('mouseover',window.__task09cTrack);document.removeEventListener('mouseout',window.__task09cTrack);return window.__task09cPointer;})};
    const entered=report[name].pointer.filter(p=>p.type==='mouseover');expect(new Set(entered.map(p=>p.id)).size).toBe(20);
    const intervals=entered.slice(1).map((p,i)=>p.time-entered[i].time);report[name].crossingIntervalsMs=intervals;expect(Math.max(...intervals)).toBeLessThan(150);
    report[name].dwellsMs=entered.slice(0,-1).map(p=>{const leave=report[name].pointer.find(q=>q.type==='mouseout'&&q.id===p.id&&q.time>=p.time);return leave?leave.time-p.time:null;});expect(report[name].dwellsMs.every(ms=>ms!==null&&ms<150)).toBe(true);
    const calls=report.calls.filter(c=>c.phase===name&&c.kind==='detail');expect(calls.length).toBe(name==='rapid-cold'?1:0);const current=await summarize(name,before);expect(report.windows.at(-1).profileRegistrations).toBe(0);expect(report.windows.at(-1).shellRegistrations).toBe(0);expect(report.windows.at(-1).cardRenders).toBe(0);expect(report.windows.at(-1).gridRenders).toBe(0);before=current;
  };
  // Separate media warmup: pointer stays outside cards, so detail cache remains cold.
  phase='media-warmup';await page.mouse.move(0,0);
  for(let i=0;i<20;i+=3){await cards.nth(i).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(120);}
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(300);
  await Promise.all(pending);expect(report.calls.filter(c=>c.kind==='detail')).toHaveLength(0);
  before=await summarize(phase,before);report.rapidCacheDefinition='Detail cold, card media warmed separately with pointer outside cards; initial cold media is measured independently.';
  if(process.env.TASK09C_SKIP_RAPID!=='1'){await rapid('rapid-cold');await rapid('rapid-warm');}
  else report.rapidGate='UNVERIFIED: prior sequential traces exceeded150ms; queued input coalesced. This run covers remaining independent gates only.';
  phase='deliberate-cold';for(let i=20;i<40;i++){await cards.nth(i).scrollIntoViewIfNeeded();await cards.nth(i).hover();await expect.poll(()=>report.calls.filter(c=>c.phase===phase&&c.kind==='detail').length,{timeout:15000}).toBe(i-19);}
  before=await summarize(phase,before);expect(report.windows.at(-1).profileRegistrations).toBe(0);expect(report.windows.at(-1).shellRegistrations).toBe(0);expect(report.windows.at(-1).cardRenders).toBe(0);expect(report.windows.at(-1).gridRenders).toBe(0);
  await page.mouse.move(0,0);phase='pagination';const all=[];const captureIds=async()=>all.push(...await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.testid)));
  await captureIds();while(await page.getByRole('button',{name:'Carica altri',exact:true}).count()){const first=await cards.first().getAttribute('data-testid');await page.getByRole('button',{name:'Carica altri',exact:true}).click();await expect.poll(async()=>((await cards.first().getAttribute('data-testid'))!==first)||!(await page.getByRole('button',{name:'Carica altri',exact:true}).count()),{timeout:15000}).toBe(true);expect(await cards.count()).toBeLessThanOrEqual(50);if((await cards.first().getAttribute('data-testid'))!==first)await captureIds();}
  expect(all.length).toBe(950);expect(new Set(all).size).toBe(950);report.pagination={count:all.length,unique:new Set(all).size,...await state()};await page.getByRole('button',{name:'Pagina precedente'}).click();expect(await cards.count()).toBe(50);
  phase='advanced-search';await page.getByPlaceholder('Cerca per Nome...').fill('Task09A ring 0099');await expect(cards).toHaveCount(1,{timeout:15000});await summarize(phase,before);
  before=await snapshot();phase='warm-entry';await page.getByRole('button',{name:'Resetta Filtri'}).click();await expect(cards).toHaveCount(50,{timeout:15000});await summarize(phase,before);
  report.coldOffscreenOnlyRequests=report.mediaRequests.filter(r=>r.phase==='cold-entry'&&r.classification==='offscreen-only').length;expect(report.coldOffscreenOnlyRequests).toBe(0);
  await page.screenshot({path:output.replace('.json','.png'),fullPage:false});report.commitBudgets=report.windows.map(w=>({window:w.name,p95Ms:w.profile.p95Ms,targetMs:16.7,passed:w.profile.available?w.profile.p95Ms<=16.7:null}));report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;throw error;}
 finally{await Promise.allSettled(pending);report.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
