import {useEffect,useRef,useState,useCallback} from 'react';
import {watchCatalogRevision,catalogPage,summaryCard,catalogDetail} from './bazaarCatalogRepository';
const EMPTY=Object.freeze([]);
export function useBazaarCatalog(scopeKey,uid,filters) {
 const filterKey=JSON.stringify(filters);
 const [subscriptionAttempt,setSubscriptionAttempt]=useState(0);
 const [meta,setMeta]=useState({scope:null,revision:null,error:null});
 const [state,setState]=useState({key:null,rows:[],cursor:null,loading:true,error:null});
 const [facetState,setFacetState]=useState({identity:null,data:null,loading:false});
 const revision=meta.scope===scopeKey?meta.revision:null;
 const identity=scopeKey+':'+revision;
 const key=identity+':'+filterKey;
 const current=useRef({key,identity,scopeKey,revision});
 current.current={key,identity,scopeKey,revision};
 const sequence=useRef(0);
 const facetSequence=useRef(0);
 const invalidateRequests=useCallback(()=>{sequence.current++;facetSequence.current++;},[]);
 useEffect(()=>{
  let live=true;
  if(!uid)return undefined;
  const unsubscribe=watchCatalogRevision(r=>{
   if(!live||current.current.scopeKey!==scopeKey)return;
   current.current.revision=r;
   setMeta({scope:scopeKey,revision:r,error:null});
  },e=>{
   if(!live||current.current.scopeKey!==scopeKey)return;
   current.current.revision=null;invalidateRequests();
   setMeta({scope:scopeKey,revision:null,error:e.message});
  });
  return()=>{live=false;invalidateRequests();unsubscribe();};
 },[scopeKey,uid,subscriptionAttempt,invalidateRequests]);
 const load=useCallback(async(cursor=null)=>{
  if(revision===null)return;
  const token=++sequence.current;
  setState(s=>s.key===key?{...s,loading:true,error:null}:{key,rows:[],cursor:null,loading:true,error:null});
  try {
   const result=await catalogPage({filters:JSON.parse(filterKey),accessGeneration:scopeKey,revision,cursor});
   if(current.current.key!==key||current.current.revision!==revision||token!==sequence.current||result.revision!==revision)return;
   setState(s=>({key,rows:cursor?[...s.rows,...result.rows.map(summaryCard)]:result.rows.map(summaryCard),cursor:result.cursor,loading:false,error:null,costs:result.costs}));
   return result.rows.length > 0;
  } catch(e) {
   if(current.current.key!==key||current.current.revision!==revision||token!==sequence.current)return;
   setState(s=>cursor&&s.key===key?{...s,loading:false,error:e.message}:{key,rows:[],cursor:null,loading:false,error:e.message});
   return false;
  }
 },[key,filterKey,scopeKey,revision]);
 useEffect(()=>{sequence.current++;if(revision!==null)load();},[load,revision]);
 const loadFacets=useCallback(async()=>{
  if(revision===null || (facetState.identity===identity && (facetState.data||facetState.loading)))return;
  const token=++facetSequence.current;
  setFacetState({identity,data:null,loading:true});
  try {
   const result=await catalogPage({filters:{},accessGeneration:scopeKey,revision,facets:true});
   if(current.current.identity!==identity||current.current.revision!==revision||token!==facetSequence.current)return;
   setFacetState({identity,data:result.facets,loading:false,costs:result.costs});
  }catch(e){if(current.current.identity===identity&&token===facetSequence.current)setFacetState({identity,data:null,loading:false,error:e.message});}
 },[identity,revision,scopeKey,facetState]);
 const visible=state.key===key?state:{rows:EMPTY,cursor:null,loading:!!uid,error:null};
 return {...visible,queryKey:key,error:meta.scope===scopeKey&&meta.error?meta.error:visible.error,facets:facetState.identity===identity?facetState.data:null,facetsLoading:facetState.identity===identity&&facetState.loading,facetsError:facetState.identity===identity?facetState.error:null,loadMore:()=>load(visible.cursor),loadFacets,retry:()=>{if(revision===null){setMeta({scope:scopeKey,revision:null,error:null});setSubscriptionAttempt(n=>n+1);}else load();},revision};
}
// One bounded cache shared by panel and purchase, never across access/revision boundaries.
const DETAIL_CAPACITY = 64;
let detailBoundary = null;
const details = new Map();
function loadDetail(id, scopeKey, revision) {
 const boundary=JSON.stringify([scopeKey,revision]);
 if(detailBoundary!==boundary){details.clear();detailBoundary=boundary;}
 const cached=details.get(id);
 if(cached){details.delete(id);details.set(id,cached);return cached;}
 const promise=catalogDetail(id,revision).then(value=>{
  if(!value || value.id!==id)throw new Error('Risposta dettaglio non valida.');
  return value;
 }).catch(error=>{if(detailBoundary===boundary&&details.get(id)===promise)details.delete(id);throw error;});
 details.set(id,promise);
 while(details.size>DETAIL_CAPACITY)details.delete(details.keys().next().value);
 return promise;
}
export function useBazaarDetail(item,scopeKey,revision,delay=0) {
 const key=item&&revision!==null?JSON.stringify([scopeKey,revision,item.id]):null;
 const current=useRef(key);current.current=key;
 const [state,setState]=useState({key:null,item:null,error:null});
 useEffect(()=>{
  let active=true;
  // Clear revoked cached data even when no detail is selected.
  const boundary=JSON.stringify([scopeKey,revision]);
  if(detailBoundary!==boundary){details.clear();detailBoundary=boundary;}
  if(!key)return undefined;
  const load=()=>loadDetail(item.id,scopeKey,revision).then(detail=>{
   if(active&&current.current===key)setState({key,item:detail,error:null});
  }).catch(e=>{if(active&&current.current===key)setState({key,item:null,error:e.message});});
  const timer=delay>0?setTimeout(load,delay):null;
  if(!timer)load();
  return()=>{active=false;if(timer)clearTimeout(timer);};
 },[key,item?.id,scopeKey,revision,delay]);
 return key&&state.key===key?state:{item:null,error:null};
}
