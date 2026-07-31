const HOSTING_COMPATIBILITY_ENVIRONMENT = Object.freeze({
  GENERATE_SOURCEMAP: 'false',
  REACT_APP_FND_PERF: '0',
  REACT_APP_FND_USER_DATA_ROLLOUT_CONFIG: '0',
  REACT_APP_FND_USER_DATA_STAGE: 'legacy-read',
});

const withForcedEnvironment = (
  sourceEnvironment,
  forcedEnvironment = HOSTING_COMPATIBILITY_ENVIRONMENT
) => {
  const forcedKeys = new Set(
    Object.keys(forcedEnvironment).map((key) => key.toUpperCase())
  );
  const cleanedEnvironment = Object.fromEntries(
    Object.entries(sourceEnvironment || {}).filter(([key]) => (
      !forcedKeys.has(key.toUpperCase())
    ))
  );
  return {
    ...cleanedEnvironment,
    ...forcedEnvironment,
  };
};

module.exports = {
  HOSTING_COMPATIBILITY_ENVIRONMENT,
  withForcedEnvironment,
};
