import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GrigliataCombatAim from './GrigliataCombatAim';
import { canTargetToken, combatArea, combatDistance, withinCombatRange } from './combatTargeting';

const pawn = {tokenId:'caster',placementId:'map__caster',name:'Nyx',col:1,row:1,sizeSquares:2};
const target = {tokenId:'target',placementId:'map__target',name:'Talpa',col:3,row:1,sizeSquares:1};
const action = {id:'sword',kind:'weapon',mode:'single',rangeFt:5};
const tokens = [pawn,target].map(t => ({...t,renderPosition:{x:t.col*20,y:t.row*20,size:t.sizeSquares*20}}));
const props = {
  aim:{pawn,action,selection:{targetIds:[],picking:true},candidates:[{...target,distanceFt:5}],pickToken:jest.fn(),finish:jest.fn()},
  tokens,viewport:{x:100,y:100,scale:0.25},grid:{cellSizePx:20},stageSize:{width:600,height:400},setViewport:jest.fn(),
};

test('the crosshair draws its minimum screen-size halo on the actor; the target button selects the other placement', () => {
  const {rerender} = render(<GrigliataCombatAim {...props}/>);
  expect(screen.getByTestId('combat-actor-ring')).toHaveStyle({width:'54px',left:'110px',top:'110px'});
  fireEvent.click(screen.getByRole('button',{name:'Bersaglio Talpa'}));
  expect(props.aim.pickToken).toHaveBeenCalledWith(target.placementId);
  fireEvent.keyDown(window,{key:'Escape'});
  expect(props.aim.finish).toHaveBeenCalled();
  rerender(<GrigliataCombatAim {...props} aim={{...props.aim,selection:{picking:false,targetIds:[target.placementId]}}}/>);
  expect(screen.queryByTestId('combat-actor-ring')).toBeNull();
  expect(screen.getByRole('button',{name:'Bersaglio Talpa'})).toHaveAttribute('aria-pressed','true');
});

test('range measures the nearest occupied square, resurrection requires a corpse, and a farthest-edge area must fit', () => {
  expect(combatDistance(pawn,target)).toBe(5);
  expect(canTargetToken(pawn,pawn,action)).toBe(false);
  expect(canTargetToken(pawn,target,action)).toBe(true);
  const revive = {...action,allowDead:true,requireDead:true};
  expect(canTargetToken(pawn,target,revive)).toBe(false);
  expect(canTargetToken(pawn,{...target,isDead:true},revive)).toBe(true);
  const square = {...action,mode:'area',area:{shape:'square',sideSquares:3,anchor:'farthest'}};
  expect(combatArea(square,target)).toEqual({col:2,row:0,sizeSquares:3});
  expect(withinCombatRange(pawn,target,square)).toBe(false);
  expect(withinCombatRange(pawn,{col:2,row:1},square)).toBe(true);
});

test('the caption follows the ordered role and its range; without a range the list claims no range check', () => {
  const leone = {id:'leone',kind:'tecnica',mode:'multiple',maxTargets:2,rangeFt:5,
    targetRoles:['Bersaglio dell’attacco','Te o un alleato da curare'],roleRangesFt:[5,30]};
  const aim = selection => ({...props.aim,action:leone,selection:{picking:true,targetIds:[],...selection}});
  const {rerender} = render(<GrigliataCombatAim {...props} aim={aim({})}/>);
  expect(screen.getByText('Scegli bersaglio dell’attacco · 5 ft')).toBeInTheDocument();
  expect(screen.getByText('Bersagli in gittata · 1')).toBeInTheDocument();
  rerender(<GrigliataCombatAim {...props} aim={aim({targetIds:[target.placementId]})}/>);
  expect(screen.getByText('Scegli te o un alleato da curare · 30 ft')).toBeInTheDocument();
  rerender(<GrigliataCombatAim {...props} aim={aim({targetIds:[target.placementId,pawn.placementId]})}/>);
  expect(screen.getByText('Tutti i ruoli scelti')).toBeInTheDocument();
  rerender(<GrigliataCombatAim {...props} aim={{...props.aim,action:{...action,rangeFt:null}}}/>);
  expect(screen.getByText('Scegli un bersaglio')).toBeInTheDocument();
  expect(screen.getByText('Bersagli · 1')).toBeInTheDocument();
});

test('a cone asks for the pawns in the agreed cone and a resurrection explains a missing fallen pawn', () => {
  const cone = {...action,kind:'spell',mode:'area',rangeFt:15,area:{shape:'cone'}};
  const {rerender} = render(<GrigliataCombatAim {...props} aim={{...props.aim,action:cone}}/>);
  expect(screen.getByText(/Scegli le pedine nel cono concordato al tavolo/)).toBeInTheDocument();
  const revive = {...action,kind:'spell',allowDead:true,requireDead:true};
  rerender(<GrigliataCombatAim {...props} aim={{...props.aim,action:revive,candidates:[]}}/>);
  expect(screen.getByText(/il master deve prima segnarla come caduta sulla mappa/)).toBeInTheDocument();
  rerender(<GrigliataCombatAim {...props} aim={{...props.aim,action:revive}}/>);
  expect(screen.queryByText(/segnarla come caduta/)).not.toBeInTheDocument();
});
