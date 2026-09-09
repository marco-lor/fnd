import {act,renderHook,waitFor} from '@testing-library/react';
import {useBazaarCatalog} from './useBazaarCatalog';
import {watchCatalogRevision,catalogPage} from './bazaarCatalogRepository';
jest.mock('./bazaarCatalogRepository',()=>({watchCatalogRevision:jest.fn(),catalogPage:jest.fn(),catalogDetail:jest.fn(),summaryCard:s=>s}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
let publish;
beforeEach(()=>{jest.resetAllMocks();watchCatalogRevision.mockImplementation(next=>{publish=next;next(1);return jest.fn();});});
test('default reads one bounded page and facets are deferred and survive query changes',async()=>{
 catalogPage.mockImplementation(async input=>({revision:input.revision,rows:[{id:input.filters.searchTerm||'first'}],cursor:null,facets:input.facets?{slots:['late-only']}:null}));
 const {result,rerender}=renderHook(({filters})=>useBazaarCatalog('u:0:player','u',filters),{initialProps:{filters:{}}});
 await waitFor(()=>expect(result.current.rows).toHaveLength(1));
 expect(catalogPage).toHaveBeenCalledTimes(1);expect(catalogPage.mock.calls[0][0].facets).toBeUndefined();
 await act(async()=>{await result.current.loadFacets();});await waitFor(()=>expect(result.current.facets?.slots).toEqual(['late-only']));
 rerender({filters:{searchTerm:'rare'}});await waitFor(()=>expect(result.current.rows[0]?.id).toBe('rare'));
 expect(result.current.facets.slots).toEqual(['late-only']);expect(watchCatalogRevision).toHaveBeenCalledTimes(1);
});
test('revision clears historical pages and discards an in-flight old page',async()=>{
 const later=deferred();
 catalogPage.mockImplementation(input=>input.cursor?later.promise:Promise.resolve({revision:input.revision,rows:[{id:'first-'+input.revision}],cursor:{offset:50}}));
 const {result}=renderHook(()=>useBazaarCatalog('u:0:player','u',{}));
 await waitFor(()=>expect(result.current.rows[0]?.id).toBe('first-1'));
 act(()=>{void result.current.loadMore();});act(()=>publish(2));
 await waitFor(()=>expect(result.current.rows[0]?.id).toBe('first-2'));
 await act(async()=>later.resolve({revision:1,rows:[{id:'stale'}],cursor:null}));
 expect(result.current.rows.map(r=>r.id)).toEqual(['first-2']);
});
test('UID/access generation/query changes mask old results and ignore late replies',async()=>{
 const pending=deferred();catalogPage.mockReturnValue(pending.promise);
 const {result,rerender}=renderHook(({scope,uid,filters})=>useBazaarCatalog(scope,uid,filters),{initialProps:{scope:'a:0:player',uid:'a',filters:{}}});
 await waitFor(()=>expect(catalogPage).toHaveBeenCalled());
 rerender({scope:'b:1:player',uid:'b',filters:{searchTerm:'new'}});
 expect(result.current.rows).toEqual([]);
 await act(async()=>pending.resolve({revision:0,rows:[{id:'denied'}],cursor:null}));
 expect(result.current.rows).toEqual([]);
});

test('Retry replaces a failed revision subscription and recovers rows',async()=>{
 let fail;
 const unsubscribe=jest.fn();
 watchCatalogRevision.mockImplementationOnce((_next,error)=>{fail=error;return unsubscribe;}).mockImplementationOnce(next=>{next(2);return jest.fn();});
 catalogPage.mockResolvedValue({revision:2,rows:[{id:'recovered'}],cursor:null});
 const {result}=renderHook(()=>useBazaarCatalog('u:0:player','u',{}));
 act(()=>fail(new Error('listener unavailable')));
 expect(result.current.error).toBe('listener unavailable');
 act(()=>result.current.retry());
 await waitFor(()=>expect(watchCatalogRevision).toHaveBeenCalledTimes(2));
 expect(unsubscribe).toHaveBeenCalledTimes(1);
 await waitFor(()=>expect(result.current.rows[0]?.id).toBe('recovered'));
 expect(result.current.error).toBeNull();
});

test('failed next page retains current rows and retry recovers first page',async()=>{
 catalogPage.mockImplementation(input=>input.cursor?Promise.reject(new Error('next failed')):Promise.resolve({revision:1,rows:[{id:'first'}],cursor:{offset:50}}));
 const {result}=renderHook(()=>useBazaarCatalog('paging:0','paging',{}));
 await waitFor(()=>expect(result.current.rows).toHaveLength(1));
 let loaded;await act(async()=>{loaded=await result.current.loadMore();});expect(loaded).toBe(false);expect(result.current.rows[0].id).toBe('first');expect(result.current.error).toBe('next failed');
 await act(async()=>result.current.retry());expect(result.current.rows[0].id).toBe('first');expect(result.current.error).toBeNull();
});

test('exact page multiple terminal probe preserves last rows without advancing the UI',async()=>{
 catalogPage.mockImplementation(input=>Promise.resolve({revision:1,rows:input.cursor?[]:[{id:'last'}],cursor:input.cursor?null:{offset:50}}));
 const {result}=renderHook(()=>useBazaarCatalog('terminal:0','terminal',{}));await waitFor(()=>expect(result.current.rows).toHaveLength(1));
 let advanced;await act(async()=>{advanced=await result.current.loadMore();});expect(advanced).toBe(false);expect(result.current.rows[0].id).toBe('last');expect(result.current.cursor).toBeNull();
});
