import React from 'react';
import { createModuleLoader, RetryableLazyBoundary } from '../../common/lazyLoading';

const itemDetailsDescriptor = createModuleLoader({
  chunkName: 'feature-home-item-details',
  importer: () => import(/* webpackChunkName: "feature-home-item-details" */ './ItemDetailsModal'),
});

const consumableDescriptor = createModuleLoader({
  chunkName: 'feature-home-consumable-dialog',
  importer: () => import(/* webpackChunkName: "feature-home-consumable-dialog" */ './ConfirmUseConsumableModal'),
});

export const LazyItemDetailsModal = (props) => (
  <RetryableLazyBoundary
    descriptor={itemDetailsDescriptor}
    fallbackLabel="Loading item details..."
    componentProps={props}
    onClose={props.onClose}
  />
);

export const LazyConfirmUseConsumableModal = (props) => (
  <RetryableLazyBoundary
    descriptor={consumableDescriptor}
    fallbackLabel="Loading consumable confirmation..."
    componentProps={props}
    onClose={props.onCancel || props.onClose}
  />
);

