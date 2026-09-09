import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ComparisonPanel from './comparisonComponent';
import { AuthContext } from '../../../AuthContext';

jest.mock('../../../AuthContext', () => ({ AuthContext: require('react').createContext({}) }));
jest.mock('../../../data/userData/userDataHooks', () => ({
  useProgression: () => ({ data: { Parametri: { Base: { Forza: { Tot: 4 } }, Combattimento: {} } } }),
}));
jest.mock('../../../performance/firestore', () => ({ deleteDoc: jest.fn(), doc: jest.fn() }));
jest.mock('../../firebaseConfig', () => ({ db: {} }));
jest.mock('../../common/legacyMediaStorage', () => ({ createLegacyStorageCleanup: jest.fn() }));
jest.mock('../../../data/userDirectoryRepository', () => ({ getUserDirectoryPage: jest.fn() }));
jest.mock('../../../data/configRepository', () => ({
  getSchema: jest.fn(async () => ({})), getVarie: async () => ({}),
}));
jest.mock('../lazyBazaarEditors', () => ({}));
jest.mock('../../common/MediaImage', () => ({ __esModule: true, default: () => null, hasMediaAsset: () => false }));
jest.mock('../../common/MediaVideo', () => () => null);

beforeEach(()=>require('../../../data/configRepository').getSchema.mockResolvedValue({}));

describe('ComparisonPanel stored parameter values', () => {
  test.each([[3, '(3)'], [0, '(0)'], ['Forza + 2', '(6)']])(
    'renders and evaluates stored value %p without losing zero or formulas', async (value, result) => {
      render(
        <AuthContext.Provider value={{ user: { uid: 'player' }, userData: { role: 'player' } }}>
          <ComparisonPanel item={{ id: 'numeric-item', item_type: 'weapon', General: { Nome: 'Numeric item' }, Specific: {}, Parametri: { Base: { Forza: { 1: value } } } }} />
        </AuthContext.Provider>
      );
      await waitFor(() => expect(screen.queryByText('Caricamento campi specifici...')).not.toBeInTheDocument());
      expect(screen.getByText(result)).toBeInTheDocument();
    }
  );
});

const {getUserDirectoryPage}=require('../../../data/userDirectoryRepository');
const {getSchema}=require('../../../data/configRepository');
test('stable panel accepts null and follows directory cursors, clearing item dialogs and names',async()=>{
 getUserDirectoryPage.mockResolvedValueOnce({items:[{id:'first',label:'First'}],hasMore:true,cursor:{id:'first'}}).mockResolvedValueOnce({items:[{id:'later',label:'Later'}],hasMore:false,cursor:null});
 const view=(item)=><AuthContext.Provider value={{user:{uid:'dm'},userData:{role:'dm'}}}><ComparisonPanel item={item} scopeKey="dm:0" /></AuthContext.Provider>;
 const {rerender}=render(view(null));expect(screen.getByTestId('bazaar-detail-placeholder')).toBeInTheDocument();
 rerender(view({id:'custom',item_type:'weapon',visibility:'custom',allowed_users:['later','deleted'],General:{Nome:'Custom'}}));
 await waitFor(()=>expect(screen.getByText(/Later, deleted/)).toBeInTheDocument());expect(getUserDirectoryPage).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByTitle('Elimina Oggetto'));expect(screen.getByText('Elimina')).toBeInTheDocument();
 rerender(view({id:'other',General:{Nome:'Other'}}));expect(screen.queryByText('Elimina')).not.toBeInTheDocument();expect(screen.queryByText(/Later, deleted/)).not.toBeInTheDocument();
});
test('late schema results cannot replace a new item type schema',async()=>{
 let resolve;getSchema.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce({Specific:{NewField:{}}});
 const {rerender}=render(<ComparisonPanel item={{id:'old',item_type:'weapon'}} scopeKey="schema:0" />);
 rerender(<ComparisonPanel item={{id:'new',item_type:'armatura',Specific:{NewField:'new-value'}}} scopeKey="schema:0" />);
 await waitFor(()=>expect(screen.getByText('new-value')).toBeInTheDocument());await act(async()=>resolve({Specific:{OldField:{}}}));expect(screen.getByText('new-value')).toBeInTheDocument();
});

test('manager actor changes fence directory replies and ordinary players never read directory',async()=>{
 const pending=[];getUserDirectoryPage.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const item={id:'restricted',visibility:'custom',allowed_users:['someone'],General:{Nome:'Restricted'}};
 const view=(uid,role)=><AuthContext.Provider value={{user:{uid},userData:{role}}}><ComparisonPanel item={item} scopeKey={`${uid}:0`} /></AuthContext.Provider>;
 const {rerender}=render(view('dm-a','dm'));expect(pending).toHaveLength(1);
 rerender(view('dm-b','dm'));expect(pending).toHaveLength(2);
 await act(async()=>pending[0]({items:[{id:'someone',label:'Old actor name'}],hasMore:false}));expect(screen.queryByText('Old actor name')).not.toBeInTheDocument();
 await act(async()=>pending[1]({items:[{id:'someone',label:'Current name'}],hasMore:false}));expect(screen.getByText('Current name')).toBeInTheDocument();
 rerender(view('player','player'));expect(pending).toHaveLength(2);expect(screen.queryByText('Current name')).not.toBeInTheDocument();
});
