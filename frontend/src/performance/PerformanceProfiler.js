import React, { Profiler } from 'react';
import { isPerformanceEnabled, recordReactProfilerCommit } from './runtime';

export default function PerformanceProfiler({ id, children }) {
  if (!isPerformanceEnabled()) return children;
  return (
    <Profiler id={id} onRender={recordReactProfilerCommit}>
      {children}
    </Profiler>
  );
}
