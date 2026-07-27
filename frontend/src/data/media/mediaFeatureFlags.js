export const TASK07_MEDIA_PIPELINE_ENABLED = (
  process.env.REACT_APP_TASK07_MEDIA_PIPELINE === '1'
  || process.env.REACT_APP_FND_PERF === '1'
);
