import React from 'react';
import { canPrefetchModules, createModuleLoader, RetryableLazyBoundary } from '../common/lazyLoading';

export const BAZAAR_EDITOR_DESCRIPTORS = Object.freeze({
  weapon: createModuleLoader({
    chunkName: 'feature-bazaar-weapon-editor', exportName: 'AddWeaponOverlay',
    importer: () => import(/* webpackChunkName: "feature-bazaar-weapon-editor" */ './elements/addWeapon'),
  }),
  armatura: createModuleLoader({
    chunkName: 'feature-bazaar-armatura-editor', exportName: 'AddArmaturaOverlay',
    importer: () => import(/* webpackChunkName: "feature-bazaar-armatura-editor" */ './elements/addArmatura'),
  }),
  accessorio: createModuleLoader({
    chunkName: 'feature-bazaar-accessorio-editor', exportName: 'AddAccessorioOverlay',
    importer: () => import(/* webpackChunkName: "feature-bazaar-accessorio-editor" */ './elements/addAccessorio'),
  }),
  consumabile: createModuleLoader({
    chunkName: 'feature-bazaar-consumabile-editor', exportName: 'AddConsumabileOverlay',
    importer: () => import(/* webpackChunkName: "feature-bazaar-consumabile-editor" */ './elements/addConsumabile'),
  }),
});

export const prefetchBazaarEditor = (kind) => {
  if (!canPrefetchModules()) return Promise.resolve(null);
  return BAZAAR_EDITOR_DESCRIPTORS[kind]?.preload() || Promise.resolve(null);
};

const buildLazyEditor = (descriptor, label) => (props) => (
  <RetryableLazyBoundary
    descriptor={descriptor}
    fallbackLabel={`Loading ${label} editor...`}
    componentProps={props}
    onClose={() => props.onClose?.(false)}
  />
);

export const AddWeaponOverlay = buildLazyEditor(BAZAAR_EDITOR_DESCRIPTORS.weapon, 'weapon');
export const AddArmaturaOverlay = buildLazyEditor(BAZAAR_EDITOR_DESCRIPTORS.armatura, 'armor');
export const AddAccessorioOverlay = buildLazyEditor(BAZAAR_EDITOR_DESCRIPTORS.accessorio, 'accessory');
export const AddConsumabileOverlay = buildLazyEditor(BAZAAR_EDITOR_DESCRIPTORS.consumabile, 'consumable');
