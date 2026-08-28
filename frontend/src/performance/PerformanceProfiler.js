import React, { Profiler, useEffect, useRef } from 'react';
import { isPerformanceEnabled, recordReactProfilerCommit } from './runtime';
import { recordTask08Event } from './task08';

export default function PerformanceProfiler({ id, children }) {
  const committedRenderCount = useRef(0);

  useEffect(() => {
    if (!isPerformanceEnabled()) return;
    committedRenderCount.current += 1;
    recordTask08Event({
      metric: 'render',
      tags: {
        component: id,
        phase: committedRenderCount.current === 1 ? 'mount' : 'update',
        committed: true,
        commitId: `${id}:${committedRenderCount.current}`,
      },
    });
  });

  if (!isPerformanceEnabled()) return children;
  const handleRender = (
    profilerId,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    recordReactProfilerCommit(
      profilerId,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    );
    recordTask08Event({
      metric: 'render',
      tags: { component: profilerId, phase },
    });
  };
  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  );
}
