import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import FiltersSection from './FiltersSection';
jest.mock('../../common/paramMetadata',()=>({getParamDisplayName:v=>v}));
test('first dropdown opens without loaded facets and stays mounted when complete options arrive',()=>{
 const props={onOpenFilter:jest.fn(),onToggleItemType:jest.fn(),onResetFilters:jest.fn(),setOnlyAffordable:jest.fn()};
 for(const key of ['slots','hands','tipos','itemTypes','specialParams','combatParams','baseParams'])props[key]=['All'];
 for(const key of ['selectedSlot','selectedHands','selectedTipo','selectedItemType','selectedSpecialParams','selectedCombatParams','selectedBaseParams'])props[key]=['All'];
 const {rerender}=render(<FiltersSection {...props}/>);
 const trigger=screen.getAllByText('Aggiungi filtro...')[0];fireEvent.click(trigger);expect(props.onOpenFilter).toHaveBeenCalledTimes(1);
 rerender(<FiltersSection {...props} optionsLoading/>);expect(screen.getByRole('status')).toHaveTextContent('Caricamento opzioni');
 rerender(<FiltersSection {...props} itemTypes={['All','late-only']}/>);
 expect(screen.getByRole('button',{name:'late-only'})).toBeInTheDocument();expect(screen.getAllByText('Aggiungi filtro...')[0]).toBe(trigger);
 fireEvent.click(screen.getByRole('button',{name:'late-only'}));expect(props.onToggleItemType).toHaveBeenCalledWith('late-only');
});
