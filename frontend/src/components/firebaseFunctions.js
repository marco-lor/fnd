import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { app } from './firebaseConfig';

const performanceMode = process.env.REACT_APP_FND_PERF === '1';

export const functions = getFunctions(app, 'europe-west1');

if (performanceMode) {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

