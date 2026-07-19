import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { app } from './firebaseConfig';

const performanceMode = process.env.REACT_APP_FND_PERF === '1';

export const storage = getStorage(app);

if (performanceMode) {
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

