import React from 'react';
import { createModuleLoader, RetryableLazyBoundary } from '../../common/lazyLoading';

const make = (importer, exportName = 'default') => createModuleLoader({
  chunkName: 'feature-foes-editor',
  importer,
  exportName,
});

const descriptors = {
  modal: make(() => import(/* webpackChunkName: "feature-foes-editor" */ './FoeFormModal')),
  parameters: make(() => import(/* webpackChunkName: "feature-foes-editor" */ './ParamEditors'), 'ParametersEditor'),
  totals: make(() => import(/* webpackChunkName: "feature-foes-editor" */ './ParamEditors'), 'ParamTotalsPreview'),
  stats: make(() => import(/* webpackChunkName: "feature-foes-editor" */ './StatsEditor')),
  tecniche: make(() => import(/* webpackChunkName: "feature-foes-editor" */ './TecnicheEditor')),
  spells: make(() => import(/* webpackChunkName: "feature-foes-editor" */ './SpellsEditor')),
};

export const FoeFormModal = (props) => (
  <RetryableLazyBoundary
    descriptor={descriptors.modal}
    fallbackLabel="Loading foe editor..."
    onClose={props.onCancel}
    componentProps={props}
  />
);

const lazyEditor = (key, label) => (props) => (
  <RetryableLazyBoundary
    descriptor={descriptors[key]}
    fallbackLabel={`Loading ${label}...`}
    componentProps={props}
  />
);

export const ParametersEditor = lazyEditor('parameters', 'parameter editor');
export const ParamTotalsPreview = lazyEditor('totals', 'parameter totals');
export const StatsEditor = lazyEditor('stats', 'stats editor');
export const TecnicheEditor = lazyEditor('tecniche', 'technique editor');
export const SpellsEditor = lazyEditor('spells', 'spell editor');
