import React from 'react';
import { createModuleLoader, RetryableLazyBoundary } from './lazyLoading';

const descriptor = createModuleLoader({
  chunkName: 'feature-profile-media',
  importer: () => import(/* webpackChunkName: "feature-profile-media" */ './ProfileMediaDialogs'),
});

const ProfileMediaDialogs = (props) => (
  <RetryableLazyBoundary
    descriptor={descriptor}
    fallbackLabel="Loading profile media..."
    onClose={props.onClose}
    componentProps={props}
  />
);

export default ProfileMediaDialogs;
