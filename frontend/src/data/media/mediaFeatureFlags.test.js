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

test('the dedicated flag enables Task 07 without performance mode', () => {
  process.env.REACT_APP_TASK07_MEDIA_PIPELINE = '1';
  delete process.env.REACT_APP_FND_PERF;
  expect(loadFlag()).toBe(true);
});

test('demo performance mode continues to exercise Task 07', () => {
  delete process.env.REACT_APP_TASK07_MEDIA_PIPELINE;
  process.env.REACT_APP_FND_PERF = '1';
  expect(loadFlag()).toBe(true);
});
