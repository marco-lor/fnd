import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Bazaar from './Bazaar';
import FiltersSection from './elements/FiltersSection';
import { applyBazaarCatalogSemantics } from '../../data/bazaarCatalogContract';
import { useAuth, useAuthSession } from '../../AuthContext';
import { useShellLayout } from '../common/shellLayout';
import { onSnapshot } from '../../performance/firestore';
import { useResources } from '../../data/userData/userDataHooks';
import { acquireItem } from './elements/acquireItem';
import { createUserOperationId } from '../../data/userData/userDataCommands';
import PurchaseConfirmModal from './elements/PurchaseConfirmModal';
import ComparisonPanel from './elements/comparisonComponent';

// Exercise the production summary hook with the current server semantic source.
jest.mock('../../data/bazaarCatalogRepository', () => {
  const core = require('../../../functions/src/bazaarCatalogCore.ts');
  const actual = jest.requireActual('../../data/bazaarCatalogRepository');
  let rows=[], revision=0;
  return {...actual,
    watchCatalogRevision: (next,error) => require('../../performance/firestore').onSnapshot({}, snapshot=>{
      rows=[]; snapshot.forEach(d=>rows.push({id:d.id,...d.data(),catalogVersion:1})); next(++revision);
    },error),
    catalogDetail: async id=>rows.find(r=>r.id===id),
    catalogPage: async input=>{
      const summaries=rows.map((r,i)=>core.projectSummary(r,1,i));
      const all=core.evaluateSummaries(summaries,input.filters);
      const offset=input.cursor?.offset||0;
      return {revision:input.revision,rows:all.slice(offset,offset+50),cursor:offset+50<all.length?{offset:offset+50}:null,facets:input.facets?core.facetValues(summaries):null};
    },
  };
});

jest.mock('../../performance/PerformanceProfiler',()=>({__esModule:true,default:({children})=>children,usePerformanceRenderProbe:jest.fn()}));

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
  useAuthSession: jest.fn(),
}));

jest.mock('../../data/userData/userDataHooks', () => ({
  useResources: jest.fn(),
}));

jest.mock('../../data/userData/userDataCommands', () => ({
  createUserOperationId: jest.fn(() => 'purchase-flow-fixed'),
}));

jest.mock('../common/shellLayout', () => ({
  useShellLayout: jest.fn(),
}));

jest.mock('../common/paramMetadata', () => ({
  SPECIAL_PARAM_SCHEMA_IDS: [],
}));

jest.mock('./elements/addWeapon', () => ({
  AddWeaponOverlay: jest.fn(() => null),
}));

jest.mock('./elements/addArmatura', () => ({
  AddArmaturaOverlay: jest.fn(() => null),
}));

jest.mock('./elements/addAccessorio', () => ({
  AddAccessorioOverlay: jest.fn(() => null),
}));

jest.mock('./elements/addConsumabile', () => ({
  AddConsumabileOverlay: jest.fn(() => null),
}));

jest.mock('./elements/comparisonComponent', () => ({
  __esModule: true,
  default: jest.fn(({ item }) => item ? <div data-testid="comparison-panel-content">{item.General?.Nome}</div> : <div data-testid="bazaar-detail-placeholder"/>),
}));
jest.mock('./elements/PurchaseConfirmModal', () => jest.fn(({ onConfirm, onClose }) => (
  <div data-testid="purchase-confirm-modal">
    <button type="button" onClick={onConfirm}>Confirm purchase</button>
    <button type="button" onClick={onClose}>Close purchase</button>
  </div>
)));
jest.mock('./elements/FiltersSection', () => jest.fn(() => <div data-testid="filters-section" />));

jest.mock('../firebaseConfig', () => ({
  db: {},
}));
jest.mock('../firebaseStorage', () => ({ storage: {} }));

jest.mock('../../performance/firestore', () => ({
  and: jest.fn(),
  collection: jest.fn((db, path) => ({ path })),
  doc: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  getDoc: jest.fn(() => Promise.resolve({
    exists: () => false,
    data: () => ({}),
  })),
  onSnapshot: jest.fn((target, onNext) => {
    onNext({
      forEach: (callback) => {
        callback({
          id: 'weapon-1',
          data: () => ({
            General: {
              Nome: 'Spada Lunga',
              Slot: 'Mano',
              prezzo: 10,
            },
            Parametri: {
              Base: {},
              Combattimento: {},
              Special: {},
            },
            Specific: {
              Hands: 1,
              Tipo: 'Taglio',
            },
            item_type: 'weapon',
          }),
        });
      },
    });
    return () => {};
  }),
  or: jest.fn(),
  query: jest.fn((base) => base),
  where: jest.fn(),
}));

jest.mock('./elements/acquireItem', () => ({
  acquireItem: jest.fn(() => Promise.resolve({ success: true, newGold: 90 })),
}));

describe('Bazaar layout', () => {
  beforeEach(() => {
    localStorage.removeItem('bazaar.filters');
    PurchaseConfirmModal.mockImplementation(({ onConfirm, onClose }) => (
      <div data-testid="purchase-confirm-modal">
        <button type="button" onClick={onConfirm}>Confirm purchase</button>
        <button type="button" onClick={onClose}>Close purchase</button>
      </div>
    ));
    ComparisonPanel.mockImplementation(({item})=>item ? <div data-testid="comparison-panel-content">{item.General?.Nome}</div> : <div data-testid="bazaar-detail-placeholder"/>);
    createUserOperationId.mockReturnValue('purchase-flow-fixed');
    acquireItem.mockResolvedValue({ success: true, newGold: 90 });
    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
      },
      userData: {
        role: 'dm',
        stats: {
          gold: 100,
        },
      },
    });
    useAuthSession.mockReturnValue({ repositoryAccessGeneration: 0 });
    useResources.mockReturnValue({
      data: { stats: { gold: 100 } },
      status: 'fresh',
    });
    useShellLayout.mockReturnValue({
      topInset: 96,
    });
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({
        forEach: (callback) => {
          callback({
            id: 'weapon-1',
            data: () => ({
              General: {
                Nome: 'Spada Lunga',
                Slot: 'Mano',
                prezzo: 10,
              },
              Parametri: {
                Base: {},
                Combattimento: {},
                Special: {},
              },
              Specific: {
                Hands: 1,
                Tipo: 'Taglio',
              },
              item_type: 'weapon',
            }),
          });
        },
      });
      return () => {};
    });
  });

  test('hover keeps the card list render count stable and filter persistence is debounced',async()=>{
    const probe=require('../../performance/PerformanceProfiler').usePerformanceRenderProbe;
    render(<Bazaar/>);const card=await screen.findByTestId('bazaar-item-card-weapon-1');
    await act(async()=>{});const renders=()=>probe.mock.calls.filter(([id])=>id==='BazaarItemCard').length;
    const before=renders();fireEvent.mouseEnter(card);await waitFor(()=>expect(screen.getByTestId('comparison-panel-content')).toHaveTextContent('Spada Lunga'));expect(renders()).toBe(before);
    fireEvent.mouseLeave(card);expect(renders()).toBe(before);
    const write=jest.spyOn(Storage.prototype,'setItem');write.mockClear();
    fireEvent.change(screen.getByPlaceholderText('Cerca per Nome...'),{target:{value:'no'}});
    fireEvent.change(screen.getByPlaceholderText('Cerca per Nome...'),{target:{value:'no match'}});
    expect(write).not.toHaveBeenCalled();await waitFor(()=>expect(JSON.parse(localStorage.getItem('bazaar.filters')).searchTerm).toBe('no match'));
    expect(write.mock.calls.filter(([key])=>key==='bazaar.filters')).toHaveLength(1);write.mockRestore();
  });

  test('failed third page keeps page two and retry returns to page one',async()=>{
    const rows=Array.from({length:120},(_,i)=>({id:`retry-page-${i}`,General:{Nome:`Item ${String(i).padStart(3,'0')}`},Specific:{},Parametri:{},item_type:'weapon',visibility:'all'}));
    onSnapshot.mockImplementation((_target,next)=>{next({forEach:visit=>rows.forEach(({id,...data})=>visit({id,data:()=>data}))});return ()=>{};});
    const repo=require('../../data/bazaarCatalogRepository');const original=repo.catalogPage;
    const spy=jest.spyOn(repo,'catalogPage').mockImplementation(input=>input.cursor?.offset===100?Promise.reject(new Error('page three unavailable')):original(input));
    try {
      render(<Bazaar/>);await screen.findByTestId('bazaar-item-card-retry-page-0');fireEvent.click(screen.getByText('Carica altri'));await screen.findByTestId('bazaar-item-card-retry-page-50');
      fireEvent.click(screen.getByText('Carica altri'));await screen.findByText('Riprova');expect(screen.getByTestId('bazaar-item-card-retry-page-50')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Riprova'));await screen.findByTestId('bazaar-item-card-retry-page-0');expect(screen.getByText('Pagina 1')).toBeInTheDocument();expect(screen.queryAllByTestId(/^bazaar-item-card-/)).toHaveLength(50);
    } finally {spy.mockRestore();}
  });

  test('mounted cards stay bounded as pages accumulate and previous page remains accessible',async()=>{
    const rows=Array.from({length:120},(_,i)=>({id:`page-${i}`,General:{Nome:`Item ${String(i).padStart(3,'0')}`},Specific:{},Parametri:{},item_type:'weapon',visibility:'all'}));
    onSnapshot.mockImplementation((_target,next)=>{next({forEach:visit=>rows.forEach(({id,...data})=>visit({id,data:()=>data}))});return ()=>{};});
    render(<Bazaar/>);await waitFor(()=>expect(screen.queryAllByTestId(/^bazaar-item-card-/)).toHaveLength(50));
    fireEvent.click(screen.getByText('Carica altri'));await waitFor(()=>expect(screen.getByTestId('bazaar-item-card-page-50')).toBeInTheDocument());
    expect(screen.queryAllByTestId(/^bazaar-item-card-/)).toHaveLength(50);
    fireEvent.click(screen.getByText('Pagina precedente'));expect(screen.getByTestId('bazaar-item-card-page-0')).toBeInTheDocument();
  });

  test('renders the comparison panel inside the content layout using shell offsets', async () => {
    render(<Bazaar />);

    const panel = await screen.findByTestId('bazaar-comparison-panel');

    expect(screen.getByTestId('bazaar-detail-placeholder')).toBeInTheDocument();
    expect(panel.style.top).toBe('120px');
    expect(panel.style.getPropertyValue('--bazaar-comparison-panel-height')).toBe('calc(100vh - 144px)');
    expect(panel.className).toContain('xl:sticky');
    expect(panel.className).not.toContain('fixed');
    expect(await screen.findByTestId('bazaar-item-card-weapon-1')).toBeInTheDocument();
    expect(screen.getByText('Spada Lunga')).toBeInTheDocument();
    expect(screen.getByText('Slot: Mano')).toBeInTheDocument();
    expect(screen.getByText('Tipo: Taglio')).toBeInTheDocument();
    expect(screen.getByText('Hands: 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acquire' })).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  test('shows the real detail panel on hover and restores the placeholder on mouse leave', async () => {
    render(<Bazaar />);

    const itemCard = await screen.findByTestId('bazaar-item-card-weapon-1');
    expect(screen.getByTestId('bazaar-detail-placeholder')).toBeInTheDocument();

    fireEvent.mouseEnter(itemCard);
    await waitFor(() => expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument());

    fireEvent.mouseLeave(itemCard);
    expect(await screen.findByTestId('bazaar-detail-placeholder')).toBeInTheDocument();
  });

  test('locks and unlocks the detail panel when the tile is clicked', async () => {
    render(<Bazaar />);

    const itemCard = await screen.findByTestId('bazaar-item-card-weapon-1');

    fireEvent.click(itemCard);
    await waitFor(() => expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument());

    fireEvent.mouseLeave(itemCard);
    expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument();

    fireEvent.click(itemCard);
    await waitFor(() => expect(screen.queryByTestId('bazaar-detail-placeholder')).not.toBeInTheDocument());

    fireEvent.mouseLeave(itemCard);
    expect(await screen.findByTestId('bazaar-detail-placeholder')).toBeInTheDocument();
  });

  test('keeps one actor-scoped retry key for the confirmed purchase flow', async () => {
    render(<Bazaar />);

    fireEvent.click(await screen.findByRole('button', { name: 'Acquire' }));
    await waitFor(() => expect(createUserOperationId).toHaveBeenCalledWith('purchase-flow'));
    await waitFor(() => expect(PurchaseConfirmModal).toHaveBeenCalled());
    const modalProps = PurchaseConfirmModal.mock.calls.at(-1)[0];
    await act(async () => {
      await modalProps.onConfirm();
    });

    await waitFor(() => expect(acquireItem).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'weapon-1' }),
      undefined,
      'user-1:purchase-flow-fixed'
    ));
  });

  test.each([
    ['loading resources', { data: null, status: 'loading' }],
    ['a missing V2 resources document', {
      data: null,
      status: 'missing',
    }],
  ])('disables purchase without falling back to legacy gold for %s', async (_label, resourceState) => {
    useResources.mockReturnValue(resourceState);

    render(<Bazaar />);

    const purchaseButton = await screen.findByRole('button', { name: 'Unavailable' });
    expect(purchaseButton).toBeDisabled();
    fireEvent.click(purchaseButton);
    expect(createUserOperationId).not.toHaveBeenCalled();
    expect(acquireItem).not.toHaveBeenCalled();
    expect(PurchaseConfirmModal).not.toHaveBeenCalled();
  });

  test('masks the previous catalog and closes its purchase flow on an auth scope change', async () => {
    let subscriptionCount = 0;
    onSnapshot.mockImplementation((target, onNext) => {
      subscriptionCount += 1;
      if (subscriptionCount === 1) {
        onNext({
          forEach: (callback) => callback({
            id: 'weapon-1',
            data: () => ({
              General: { Nome: 'Spada Lunga', Slot: 'Mano', prezzo: 10 },
              Parametri: { Base: {}, Combattimento: {}, Special: {} },
              Specific: { Hands: 1, Tipo: 'Taglio' },
              item_type: 'weapon',
            }),
          }),
        });
      }
      return () => {};
    });

    const { rerender } = render(<Bazaar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acquire' }));
    expect(await screen.findByTestId('purchase-confirm-modal')).toBeInTheDocument();

    useAuth.mockReturnValue({
      user: { uid: 'user-2' },
      userData: { role: 'dm', stats: { gold: 100 } },
    });
    useAuthSession.mockReturnValue({ repositoryAccessGeneration: 1 });
    rerender(<Bazaar />);

    await waitFor(() => {
      expect(screen.queryByTestId('bazaar-item-card-weapon-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('purchase-confirm-modal')).not.toBeInTheDocument();
    });
  });

  test('closes a pending purchase when the item leaves the authorized catalog', async () => {
    let publishCatalog;
    onSnapshot.mockImplementation((target, onNext) => {
      publishCatalog = onNext;
      onNext({
        forEach: (callback) => callback({
          id: 'weapon-1',
          data: () => ({
            General: { Nome: 'Spada Lunga', Slot: 'Mano', prezzo: 10 },
            Parametri: { Base: {}, Combattimento: {}, Special: {} },
            Specific: { Hands: 1, Tipo: 'Taglio' },
            item_type: 'weapon',
          }),
        }),
      });
      return () => {};
    });

    render(<Bazaar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acquire' }));
    expect(await screen.findByTestId('purchase-confirm-modal')).toBeInTheDocument();

    act(() => publishCatalog({ forEach: () => {} }));

    await waitFor(() => expect(screen.queryByTestId('purchase-confirm-modal')).not.toBeInTheDocument());
    expect(acquireItem).not.toHaveBeenCalled();
  });

  test.each([
    {}, { searchTerm: '   ' }, { searchTerm: 'ALPHA' }, { searchTerm: ' Alpha ' },
    { selectedSlot: ['hand', 'ring'], selectedTipo: ['wood'], selectedHands: ['1', '2'] },
    { selectedSpecialParams: ['zero', 'nested'], onlyAffordable: true },
    { selectedCombatParams: ['Attacco', 'Difesa'], selectedBaseParams: ['Forza'] },
    { searchTerm: 'BeyondPage', selectedSlot: ['late-only'] },
  ])('summary reader pages match the complete 09A oracle for %p', async (filters) => {
    const rows = Array.from({ length: 65 }, (_, index) => ({
      id: `parity-${String(index).padStart(3, '0')}`, item_type: 'weapon', visibility: 'all',
      General: { Nome: index === 64 ? 'BeyondPage Alpha' : index < 4 ? ['éclair', '!Alpha', 'Éclair', 'zebra'][index] : `Alpha ${index}`, Slot: index === 64 ? 'late-only' : ['hand', 'ring', 'body'][index % 3], prezzo: index % 2 ? String(index) : index, Costo: 999 },
      Specific: { Hands: index % 2 + 1, Tipo: index % 2 ? 'wood' : 'steel' },
      Parametri: { Special: { zero: index % 2 ? false : 0, nested: { value: index % 3 ? '' : 0 } }, Base: { Forza: { 1: index } }, Combattimento: { Attacco: { 1: String(index % 7) }, Difesa: { 1: 2 } } },
    }));
    useResources.mockReturnValue({ data: { stats: { gold: 20 } }, status: 'fresh' });
    localStorage.setItem('bazaar.filters', JSON.stringify(filters));
    onSnapshot.mockImplementation((target, next) => {
      next({ forEach: (visit) => rows.forEach(({ id, ...data }) => visit({ id, data: () => data })) });
      return () => {};
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      render(<Bazaar />);
      const expected = applyBazaarCatalogSemantics(rows, { ...filters, userGold: 20 }, { uid: 'user-1', role: 'dm' }).map(row => row.id);
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
      const seen=[];
      const capture=()=>seen.push(...screen.queryAllByTestId(/^bazaar-item-card-/).map(card=>card.dataset.testid.replace('bazaar-item-card-','')));
      capture();
      while(screen.queryByText('Carica altri')) {
        fireEvent.click(screen.getByText('Carica altri'));
        await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
        expect(screen.queryAllByTestId(/^bazaar-item-card-/).length).toBeLessThanOrEqual(50);
        capture();
      }
      expect(seen).toEqual(expected);
      await act(async () => { await FiltersSection.mock.calls.at(-1)[0].onOpenFilter(); });
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
      await waitFor(() => expect(FiltersSection.mock.calls.at(-1)[0].slots).toContain('late-only'));
    } finally {
      log.mockRestore();
      localStorage.removeItem('bazaar.filters');
    }
  });

  test('a pinned detail stays visible when search excludes its card', async () => {
    render(<Bazaar />);
    fireEvent.click(await screen.findByTestId('bazaar-item-card-weapon-1'));
    await waitFor(()=>expect(screen.getByTestId('comparison-panel-content')).toHaveTextContent('Spada Lunga'));
    fireEvent.change(screen.getByPlaceholderText('Cerca per Nome...'), {target:{value:'no match'}});
    await waitFor(()=>expect(screen.queryByTestId('bazaar-item-card-weapon-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('comparison-panel-content')).toHaveTextContent('Spada Lunga');
  });
  test('uncertain purchase keeps the exact retry identity across an unrelated catalog revision', async () => {
    let publish;
    const row={General:{Nome:'Spada',prezzo:10},Specific:{Hands:1},Parametri:{Base:{},Combattimento:{},Special:{}},item_type:'weapon',visibility:'all'};
    const snapshot={forEach:visit=>visit({id:'weapon-1',data:()=>row})};
    onSnapshot.mockImplementation((_target,next)=>{publish=next;next(snapshot);return()=>{};});
    acquireItem.mockResolvedValueOnce({error:'Response lost',retryable:true}).mockResolvedValueOnce({success:true,newGold:90});
    render(<Bazaar />);
    fireEvent.click(await screen.findByRole('button',{name:'Acquire'}));
    fireEvent.click(await screen.findByRole('button',{name:'Confirm purchase'}));
    await waitFor(()=>expect(acquireItem).toHaveBeenCalledTimes(1));
    await act(async()=>{publish(snapshot);});
    fireEvent.click(await screen.findByRole('button',{name:'Confirm purchase'}));
    await waitFor(()=>expect(acquireItem).toHaveBeenCalledTimes(2));
    expect(acquireItem.mock.calls[0][3]).toBe(acquireItem.mock.calls[1][3]);
    expect(createUserOperationId).toHaveBeenCalledTimes(1);
  });

  test('revision during an in-flight purchase cannot cancel its intent', async () => {
    let publish, complete;
    const row={General:{Nome:'Spada',prezzo:10},Specific:{Hands:1},Parametri:{Base:{},Combattimento:{},Special:{}},item_type:'weapon',visibility:'all'};
    const snapshot={forEach:visit=>visit({id:'weapon-1',data:()=>row})};
    onSnapshot.mockImplementation((_target,next)=>{publish=next;next(snapshot);return()=>{};});
    acquireItem.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    render(<Bazaar />);
    fireEvent.click(await screen.findByRole('button',{name:'Acquire'}));
    fireEvent.click(await screen.findByRole('button',{name:'Confirm purchase'}));
    await waitFor(()=>expect(acquireItem).toHaveBeenCalledTimes(1));
    await act(async()=>{publish({forEach:()=>{}});});
    const cancel=await screen.findByRole('button',{name:'Annulla acquisto'});
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(createUserOperationId).toHaveBeenCalledTimes(1);
    await act(async()=>{complete({success:true,newGold:90});});
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Annulla acquisto'})).not.toBeInTheDocument());
  });

});
