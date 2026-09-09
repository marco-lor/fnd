import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import PurchaseConfirmModal from './PurchaseConfirmModal';
import {projectSummary} from '../../../../functions/src/bazaarCatalogCore.ts';
import {resolveMediaAsset} from '../../common/MediaImage';
jest.mock('../../firebaseConfig',()=>({db:{}}));
jest.mock('../../firebaseStorage',()=>({storage:{}}));
test('discloses current-server charging and permits an uncertain receipt retry with depleted gold',()=>{
 const confirm=jest.fn();render(<PurchaseConfirmModal item={{General:{Nome:'Item',prezzo:10}}} userGold={0} retryUncertain onConfirm={confirm} onClose={()=>{}}/>);
 expect(screen.getByText(/prezzo attuale sul server/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Verifica acquisto precedente'}));expect(confirm).toHaveBeenCalledTimes(1);
});
test('canonical-only summary supports both card and thumbnail resolution without original detail',()=>{
 const thumb={path:'media_assets/v1/signed-in/item/m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/1/thumbnail',generation:'1',bytes:100,contentType:'image/webp',width:80,height:80};
 const s=projectSummary({id:'item',item_type:'arma',General:{Nome:'Item'},Specific:{},Parametri:{},media:{assetId:'m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',kind:'item',schemaVersion:1,state:'ready',variants:{thumbnail:thumb,thumbnail2x:thumb,card:thumb},original:{url:'https://example.test/full.webp'}}},1,0);
 for(const variant of ['card','thumbnail'])expect(resolveMediaAsset({media:s.media},{variant,compatibilityMode:'canonical-only'}).candidates.length).toBeGreaterThan(0);
 expect(s.media.original).toBeUndefined();
});
