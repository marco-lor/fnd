import { doc, onSnapshot } from '../performance/firestore';
import { db } from '../components/firebaseConfig';
import { getCallable } from './functions/callableRegistry';
import { createUserOperationId } from './userData/userDataCommands';

export const summaryCard = (s) => ({id:s.id,item_type:s.item_type,visibility:s.visibility,allowed_users:s.allowed_users,catalogVersion:s.catalogVersion,media:s.media,
  General:{Nome:s.name,prezzo:s.price,Slot:s.slot,image_url:s.imageUrl},Specific:{Hands:s.hands,Tipo:s.tipo}});
export const watchCatalogRevision = (next,error) => onSnapshot(doc(db,'catalogControl','bazaar'), snap=>{
 const m=snap.data();
 if(!m || m.state!=='active' || m.schemaVersion!==1) {error(new Error('Catalogo non disponibile: migrazione incompleta.'));return;}
 next(m.revision);
},error);
export const catalogPage = async (input) => (await getCallable('task09CatalogPage')(input)).data;
export const catalogDetail = async (itemId,revision) => (await getCallable('task09CatalogDetail')({itemId,revision})).data;
const write = async (ref,item,action,replace=false) => {
 if(ref.parent?.id!=='items' && !String(ref.path||'').startsWith('items/')) throw new Error('Expected catalog document.');
 return getCallable('task09WriteCatalogItem')({itemId:ref.id,item:item||null,action,replace,operationId:createUserOperationId('catalog')});
};
export const catalogSetDoc = (ref,item) => write(ref,item,'save',true);
export const catalogUpdateDoc = (ref,item) => write(ref,item,'save');
export const catalogDeleteDoc = (ref) => write(ref,null,'delete');
