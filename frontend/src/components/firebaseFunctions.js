import { getFunctionsForRegion } from '../data/functions/callableRegistry';

// Compatibility export for code outside the current source tree. New modules
// should acquire a lazy callable wrapper from callableRegistry instead.
export const functions = getFunctionsForRegion('europe-west1');

