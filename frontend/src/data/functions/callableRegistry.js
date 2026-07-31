import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { app } from '../../components/firebaseConfig';
import manifest from './callableManifest.json';

const performanceMode = process.env.REACT_APP_FND_PERF === '1';
const functionsByRegion = new Map();
const connectedEmulatorRegions = new Set();
const callableDelegates = new Map();
const lazyCallables = new Map();

export const CALLABLE_MANIFEST = Object.freeze(Object.fromEntries(
  Object.entries(manifest.callables).map(([logicalKey, descriptor]) => [
    logicalKey,
    Object.freeze({ ...descriptor }),
  ])
));
export const SUPPORTED_FUNCTION_REGIONS = Object.freeze([...manifest.supportedRegions]);

const requireRegion = (region) => {
  if (!SUPPORTED_FUNCTION_REGIONS.includes(region)) {
    throw new TypeError(`Unknown Firebase Functions region: ${String(region)}`);
  }
  return region;
};

export const getCallableDescriptor = (logicalKey) => {
  const descriptor = CALLABLE_MANIFEST[logicalKey];
  if (!descriptor) {
    throw new TypeError(`Unknown Firebase callable key: ${String(logicalKey)}`);
  }
  return descriptor;
};

export const getFunctionsForRegion = (region) => {
  const resolvedRegion = requireRegion(region);
  if (functionsByRegion.has(resolvedRegion)) {
    return functionsByRegion.get(resolvedRegion);
  }
  if (!app) {
    throw new Error(
      `Firebase must be initialized before invoking a callable in ${resolvedRegion}.`
    );
  }

  const functions = getFunctions(app, resolvedRegion);
  if (performanceMode && !connectedEmulatorRegions.has(resolvedRegion)) {
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectedEmulatorRegions.add(resolvedRegion);
  }
  functionsByRegion.set(resolvedRegion, functions);

  return functions;
};

const getCallableDelegate = (logicalKey) => {
  const descriptor = getCallableDescriptor(logicalKey);
  const delegateKey = `${descriptor.region}:${descriptor.functionId}`;
  if (!callableDelegates.has(delegateKey)) {
    callableDelegates.set(
      delegateKey,
      httpsCallable(
        getFunctionsForRegion(descriptor.region),
        descriptor.functionId
      )
    );
  }
  return callableDelegates.get(delegateKey);
};

// Return a stable wrapper without acquiring the optional Functions SDK service.
// The regional service, emulator connection, and callable delegate are all
// created on the first invocation.
export const getCallable = (logicalKey) => {
  getCallableDescriptor(logicalKey);
  if (!lazyCallables.has(logicalKey)) {
    lazyCallables.set(
      logicalKey,
      (...args) => getCallableDelegate(logicalKey)(...args)
    );
  }
  return lazyCallables.get(logicalKey);
};

export const __resetCallableRegistryForTests = () => {
  if (process.env.NODE_ENV !== 'test') return;
  functionsByRegion.clear();
  connectedEmulatorRegions.clear();
  callableDelegates.clear();
  lazyCallables.clear();
};
