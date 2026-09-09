import {act,renderHook} from '@testing-library/react';
import {useBazaarDetail} from './useBazaarCatalog';
import {catalogDetail} from './bazaarCatalogRepository';
jest.mock('./bazaarCatalogRepository',()=>({catalogDetail:jest.fn()}));
beforeEach(()=>{jest.clearAllMocks();jest.useFakeTimers();catalogDetail.mockImplementation(async id=>({id,General:{Nome:id}}));});
afterEach(()=>jest.useRealTimers());
test('rapid hover crossings wait 150ms, final cold detail is shared with immediate purchase and warm revisit',async()=>{
 const {result,rerender}=renderHook(({id,delay})=>useBazaarDetail(id?{id}:null,'hover-actor:0',1,delay),{initialProps:{id:null,delay:150}});
 for(let i=0;i<20;i++){rerender({id:'item-'+i,delay:150});act(()=>jest.advanceTimersByTime(20));}
 expect(catalogDetail).toHaveBeenCalledTimes(0);
 await act(async()=>jest.advanceTimersByTime(150));
 expect(result.current.item.id).toBe('item-19');expect(catalogDetail).toHaveBeenCalledTimes(1);
 const purchase=renderHook(()=>useBazaarDetail({id:'item-19'},'hover-actor:0',1));
 await act(async()=>{});expect(purchase.result.current.item.id).toBe('item-19');expect(catalogDetail).toHaveBeenCalledTimes(1);
 rerender({id:null,delay:150});rerender({id:'item-19',delay:150});await act(async()=>jest.advanceTimersByTime(150));expect(catalogDetail).toHaveBeenCalledTimes(1);
});

test('concurrent consumers share pending work and old actor/revision replies are masked',async()=>{
 const pending=[];catalogDetail.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const first=renderHook(({scope,revision})=>useBazaarDetail({id:'shared'},scope,revision),{initialProps:{scope:'dedup:0',revision:1}});
 const second=renderHook(()=>useBazaarDetail({id:'shared'},'dedup:0',1));
 expect(catalogDetail).toHaveBeenCalledTimes(1);second.unmount();
 first.rerender({scope:'dedup:1',revision:2});expect(first.result.current.item).toBeNull();
 await act(async()=>pending[0]({id:'shared',secret:'old'}));expect(first.result.current.item).toBeNull();
 await act(async()=>pending[1]({id:'wrong'}));expect(first.result.current.item).toBeNull();expect(first.result.current.error).toBeTruthy();
});
test('64-entry cache evicts least recently used details and retries rejected reads',async()=>{
 const {result,rerender}=renderHook(({id})=>useBazaarDetail({id},'capacity:0',1),{initialProps:{id:'entry-0'}});
 await act(async()=>{});
 for(let i=1;i<=64;i++){rerender({id:'entry-'+i});await act(async()=>{});}
 expect(catalogDetail).toHaveBeenCalledTimes(65);
 rerender({id:'entry-1'});await act(async()=>{});expect(catalogDetail).toHaveBeenCalledTimes(65);
 rerender({id:'entry-0'});await act(async()=>{});expect(catalogDetail).toHaveBeenCalledTimes(66);
 catalogDetail.mockRejectedValueOnce(new Error('temporary'));rerender({id:'retry'});await act(async()=>{});expect(result.current.error).toBe('temporary');
 rerender({id:'entry-0'});await act(async()=>{});rerender({id:'retry'});await act(async()=>{});expect(result.current.item.id).toBe('retry');expect(catalogDetail).toHaveBeenCalledTimes(68);
});
