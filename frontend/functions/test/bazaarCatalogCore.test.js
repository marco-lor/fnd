const test = require('node:test');
const assert = require('node:assert/strict');
const {projectSummary, compareNames, allocateRank, evaluateSummaries, facetValues} = require('../lib/bazaarCatalogCore');
const item = (id, name, extra = {}) => ({id, item_type:'arma', visibility:'all', General:{Nome:name,prezzo:'12',Slot:'mano',spells:{secret:{payload:'large'}}}, Specific:{Hands:1,Tipo:'spada'}, Parametri:{Base:{Forza:{1:'3',20:999}},Combattimento:{},Special:{zero:0,no:false}}, ...extra});
test('summary whitelist excludes detail and preserves zero, level one and prezzo', () => {
 const s = projectSummary(item('a','Árma'),1,10);
 assert.equal(s.General,undefined); assert.equal(s.Parametri,undefined);
 assert.equal(s.price,12); assert.deepEqual(s.special,['zero']); assert.deepEqual(s.base,{Forza:3});
 assert.equal(JSON.stringify(s).includes('secret'),false);
});
test('materialized rank preserves localeCompare punctuation, accents and binary ID ties', () => {
 const rows = ['é','E','!a','a','à','Á','z'].map((n,i)=>projectSummary(item(String(i),n),1,i));
 const sorted = rows.slice().sort(compareNames);
 sorted.forEach((s,i)=>{s.rank = i*1024;});
 const fresh = projectSummary(item('new','ä'),1,0);
 fresh.rank = allocateRank(sorted,fresh);
 assert.deepEqual([...sorted,fresh].sort((a,b)=>a.rank-b.rank).map(s=>s.id), [...sorted,fresh].sort(compareNames).map(s=>s.id));
 assert.throws(()=>allocateRank([{...fresh,id:'a',name:'a',rank:1},{...fresh,id:'c',name:'c',rank:1+Number.EPSILON}],{...fresh,name:'b'}), /rebuild/);
});
test('advanced filtering is complete, raw substring preserved and summed stats ordered', () => {
 const rows=Array.from({length:65},(_,i)=>projectSummary(item(String(i),i===64?' rare ':'item '+i),1,i));
 assert.deepEqual(evaluateSummaries(rows,{searchTerm:' rare '}).map(s=>s.id),['64']);
 assert.equal(evaluateSummaries(rows,{selectedSpecialParams:['zero']}).length,65);
 assert.equal(evaluateSummaries(rows,{onlyAffordable:true,userGold:11}).length,0);
 assert.deepEqual(facetValues(rows).special,['zero']);
});
const {reconcileCatalogEdit}=require('../lib/bazaarCatalogEdit');
test('ordinary text edit preserves existing nested media identity and server registry',()=>{
 const old={General:{spells:{Flame:{Nome:'Flame',task07MediaEntryId:'entry_1'}}},task07EmbeddedMedia:{entry_1:{media:{assetId:'trusted'}}}};
 const result=reconcileCatalogEdit(old,{General:{spells:{Flame:{Nome:'Flame',Descrizione:'edited',task07MediaEntryId:'entry_1'}}},task07EmbeddedMedia:{evil:{}}});
 assert.equal(result.General.spells.Flame.task07MediaEntryId,'entry_1');
 assert.deepEqual(result.task07EmbeddedMedia,old.task07EmbeddedMedia);
 assert.equal(result.General.spells.Flame.Descrizione,'edited');
});
test('new stable embedded IDs survive preparation while duplicate bound identities are rejected',()=>{
 const next=reconcileCatalogEdit({}, {General:{spells:{New:{Nome:'New',task07MediaEntryId:'entry_new'}}}});
 assert.equal(next.General.spells.New.task07MediaEntryId,'entry_new');
 const old={General:{spells:{Old:{task07MediaEntryId:'entry_old'}}},task07EmbeddedMedia:{entry_old:{media:{assetId:'trusted'}}}};
 assert.throws(()=>reconcileCatalogEdit(old,{General:{spells:{Old:{task07MediaEntryId:'entry_old'},Forged:{task07MediaEntryId:'entry_old'}}}}),/Duplicate/);
});
test('canonical-only card and confirmation thumbnails survive whitelist projection',()=>{
 const s=projectSummary(item('canonical','Canonical',{media:{assetId:'m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',variants:{thumbnail:{path:'thumb'},thumbnail2x:{path:'thumb2'},card:{path:'card'},original:{path:'full'}},original:{path:'full'}}}),1,0);
 assert.equal(s.media.variants.thumbnail.path,'thumb');assert.equal(s.media.variants.card.path,'card');assert.equal(s.media.original,undefined);assert.equal(s.media.variants.original,undefined);
});

test('trusted General.media survives summary and text edit while forged aliases remain stripped',()=>{
 const descriptor={assetId:`m_${'c'.repeat(40)}`,variants:{thumbnail:{path:'thumb'},card:{path:'card'}}};
 const legacy=item('legacy','Legacy',{General:{Nome:'Legacy',prezzo:4,media:descriptor},task07MediaRevision:3});
 assert.equal(projectSummary(legacy,1,0).media?.assetId,descriptor.assetId);
 const edited=reconcileCatalogEdit(legacy,{General:{Nome:'Renamed',media:{assetId:`m_${'d'.repeat(40)}`}}});
 assert.equal(projectSummary(edited,2,0).media?.assetId,descriptor.assetId);
 assert.deepEqual(edited.General.media,descriptor);
 assert.equal(reconcileCatalogEdit({}, {General:{Nome:'Forged',media:descriptor}}).General.media,undefined);
});
test('catalog media alias policy follows Task07 scan without merging descriptors or General revisions',()=>{
 const {catalogItemMedia}=require('../lib/bazaarCatalogCore');
 const root={assetId:`m_${'a'.repeat(40)}`,variants:{card:{path:'root'}}};
 const alias={...root,variants:{thumbnail:{path:'alias'}}};
 assert.deepEqual(catalogItemMedia({id:'a',General:{media:alias,task07MediaRevision:8,mediaUpdatedAt:'legacy'}}),{id:'a',media:alias,task07MediaRevision:0,mediaUpdatedAt:null});
 assert.deepEqual(catalogItemMedia({id:'a',media:root,General:{media:alias},task07MediaRevision:3,mediaUpdatedAt:'root'}),{id:'a',media:root,task07MediaRevision:3,mediaUpdatedAt:'root'});
 assert.equal(catalogItemMedia({media:root,General:{media:{assetId:`m_${'b'.repeat(40)}`}}}).media,null);
 assert.equal(catalogItemMedia({media:root,General:{media:'malformed'}}).media,null);
 const trusted={General:{media:alias,task07MediaRevision:8,mediaUpdatedAt:'legacy'}};
 const edit=reconcileCatalogEdit(trusted,{General:{Nome:'Edit',media:null,task07MediaRevision:900,mediaUpdatedAt:'forged'}});
 assert.deepEqual(edit.General,{Nome:'Edit',...trusted.General});
});test('summary preserves actual fixture root imageUrl fallback and General override',()=>{
 const fixture=item('fixture','Fixture',{imageUrl:'https://fixture/image.png'});
 assert.equal(projectSummary(fixture,1,0).imageUrl,fixture.imageUrl);
 fixture.General.image_url='https://override/image.png';assert.equal(projectSummary(fixture,1,0).imageUrl,fixture.General.image_url);
});
