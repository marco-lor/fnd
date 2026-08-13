const HOSTING_RELEASE_ENVIRONMENT = Object.freeze({
  GENERATE_SOURCEMAP: 'false',
  REACT_APP_FND_PERF: '0',
});

const withForcedEnvironment = (
  sourceEnvironment,
  forcedEnvironment = HOSTING_RELEASE_ENVIRONMENT
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
  HOSTING_RELEASE_ENVIRONMENT,
  withForcedEnvironment,
};
