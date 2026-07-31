const ORIGINAL_TASK07_FLAG = process.env.REACT_APP_TASK07_MEDIA_PIPELINE;
const ORIGINAL_PERF_FLAG = process.env.REACT_APP_FND_PERF;

const restoreEnvironmentValue = (name, value) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

const loadFlag = () => {
  jest.resetModules();
  return require('./mediaFeatureFlags').TASK07_MEDIA_PIPELINE_ENABLED;
};

afterEach(() => {
  restoreEnvironmentValue('REACT_APP_TASK07_MEDIA_PIPELINE', ORIGINAL_TASK07_FLAG);
  restoreEnvironmentValue('REACT_APP_FND_PERF', ORIGINAL_PERF_FLAG);
  jest.resetModules();
});

test('Task 07 media stays disabled by default', () => {
  delete process.env.REACT_APP_TASK07_MEDIA_PIPELINE;
  delete process.env.REACT_APP_FND_PERF;
  expect(loadFlag()).toBe(false);
});

test('the old dedicated flag cannot bypass the rollout control document', () => {
  process.env.REACT_APP_TASK07_MEDIA_PIPELINE = '1';
  delete process.env.REACT_APP_FND_PERF;
  expect(loadFlag()).toBe(false);
});

test('performance mode cannot bypass the rollout control document', () => {
  delete process.env.REACT_APP_TASK07_MEDIA_PIPELINE;
  process.env.REACT_APP_FND_PERF = '1';
  expect(loadFlag()).toBe(false);
});
