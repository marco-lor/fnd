import React from 'react';
import { createModuleLoader, RetryableLazyBoundary } from '../../common/lazyLoading';

const descriptor = (chunkName, importer, exportName = 'default') => createModuleLoader({
  chunkName,
  importer,
  exportName,
});

const descriptors = {
  addTecnica: descriptor('feature-dm-technique-editors', () => import(/* webpackChunkName: "feature-dm-technique-editors" */ './buttons/addTecnicaPersonale'), 'AddTecnicaPersonaleOverlay'),
  editTecnica: descriptor('feature-dm-technique-editors', () => import(/* webpackChunkName: "feature-dm-technique-editors" */ './buttons/editTecnicaPersonale'), 'EditTecnicaPersonale'),
  delTecnica: descriptor('feature-dm-technique-editors', () => import(/* webpackChunkName: "feature-dm-technique-editors" */ './buttons/delTecnicaPersonale'), 'DelTecnicaPersonale'),
  addSpell: descriptor('feature-dm-spell-editors', () => import(/* webpackChunkName: "feature-dm-spell-editors" */ './buttons/addSpell'), 'AddSpellOverlay'),
  editSpell: descriptor('feature-dm-spell-editors', () => import(/* webpackChunkName: "feature-dm-spell-editors" */ './buttons/editSpell'), 'EditSpellOverlay'),
  delSpell: descriptor('feature-dm-spell-editors', () => import(/* webpackChunkName: "feature-dm-spell-editors" */ './buttons/delSpell'), 'DelSpellOverlay'),
  addLingua: descriptor('feature-dm-language-editors', () => import(/* webpackChunkName: "feature-dm-language-editors" */ './buttons/addLinguaPersonale'), 'AddLinguaPersonaleOverlay'),
  delLingua: descriptor('feature-dm-language-editors', () => import(/* webpackChunkName: "feature-dm-language-editors" */ './buttons/delLinguaPersonale'), 'DelLinguaPersonaleOverlay'),
  addConoscenza: descriptor('feature-dm-knowledge-editors', () => import(/* webpackChunkName: "feature-dm-knowledge-editors" */ './buttons/addConoscenzaPersonale'), 'AddConoscenzaPersonaleOverlay'),
  editConoscenza: descriptor('feature-dm-knowledge-editors', () => import(/* webpackChunkName: "feature-dm-knowledge-editors" */ './buttons/editConoscenzaPersonale'), 'EditConoscenzaPersonaleOverlay'),
  delConoscenza: descriptor('feature-dm-knowledge-editors', () => import(/* webpackChunkName: "feature-dm-knowledge-editors" */ './buttons/delConoscenzaPersonale'), 'DelConoscenzaPersonaleOverlay'),
  addProfessione: descriptor('feature-dm-profession-editors', () => import(/* webpackChunkName: "feature-dm-profession-editors" */ './buttons/addProfessionePersonale'), 'AddProfessionePersonaleOverlay'),
  editProfessione: descriptor('feature-dm-profession-editors', () => import(/* webpackChunkName: "feature-dm-profession-editors" */ './buttons/editProfessionePersonale'), 'EditProfessionePersonaleOverlay'),
  delProfessione: descriptor('feature-dm-profession-editors', () => import(/* webpackChunkName: "feature-dm-profession-editors" */ './buttons/delProfessionePersonale'), 'DelProfessionePersonaleOverlay'),
  gold: descriptor('feature-dm-gold-dialog', () => import(/* webpackChunkName: "feature-dm-gold-dialog" */ './playerInfo/overlays/GoldAdjustmentOverlay')),
  editVarie: descriptor('feature-dm-misc-item-editors', () => import(/* webpackChunkName: "feature-dm-misc-item-editors" */ './playerInfo/overlays/EditVarieItemOverlay')),
  addVarie: descriptor('feature-dm-misc-item-editors', () => import(/* webpackChunkName: "feature-dm-misc-item-editors" */ './playerInfo/overlays/AddVarieItemOverlay')),
};

const lazyOverlay = (key, label) => (props) => (
  <RetryableLazyBoundary
    descriptor={descriptors[key]}
    fallbackLabel={`Loading ${label}...`}
    componentProps={props}
    onClose={() => props.onClose?.(false)}
  />
);

export const AddTecnicaPersonaleOverlay = lazyOverlay('addTecnica', 'technique editor');
export const EditTecnicaPersonale = lazyOverlay('editTecnica', 'technique editor');
export const DelTecnicaPersonale = lazyOverlay('delTecnica', 'technique editor');
export const AddSpellOverlay = lazyOverlay('addSpell', 'spell editor');
export const EditSpellOverlay = lazyOverlay('editSpell', 'spell editor');
export const DelSpellOverlay = lazyOverlay('delSpell', 'spell editor');
export const AddLinguaPersonaleOverlay = lazyOverlay('addLingua', 'language editor');
export const DelLinguaPersonaleOverlay = lazyOverlay('delLingua', 'language editor');
export const AddConoscenzaPersonaleOverlay = lazyOverlay('addConoscenza', 'knowledge editor');
export const EditConoscenzaPersonaleOverlay = lazyOverlay('editConoscenza', 'knowledge editor');
export const DelConoscenzaPersonaleOverlay = lazyOverlay('delConoscenza', 'knowledge editor');
export const AddProfessionePersonaleOverlay = lazyOverlay('addProfessione', 'profession editor');
export const EditProfessionePersonaleOverlay = lazyOverlay('editProfessione', 'profession editor');
export const DelProfessionePersonaleOverlay = lazyOverlay('delProfessione', 'profession editor');
export const GoldAdjustmentOverlay = lazyOverlay('gold', 'gold adjustment');
export const EditVarieItemOverlay = lazyOverlay('editVarie', 'miscellaneous item editor');
export const AddVarieItemOverlay = lazyOverlay('addVarie', 'miscellaneous item editor');

