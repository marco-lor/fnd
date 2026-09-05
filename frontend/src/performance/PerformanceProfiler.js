import React, { Profiler, useEffect, useRef } from 'react';
import { isPerformanceEnabled, recordReactProfilerCommit } from './runtime';
import { recordTask08Event } from './task08';

export const usePerformanceRenderProbe = (id, { enabled = true } = {}) => {
  const committedRenderCount = useRef(0);

  useEffect(() => {
    if (!enabled || !isPerformanceEnabled()) return;
    committedRenderCount.current += 1;
    recordTask08Event({
      metric: 'render',
      tags: {
        component: id,
        phase: committedRenderCount.current === 1 ? 'mount' : 'update',
        committed: true,
        authoritative: true,
        source: 'committed-probe',
        commitId: `${id}:${committedRenderCount.current}`,
      },
    });
  });
};

export default function PerformanceProfiler({ id, children, committedProbeOwner = 'wrapper' }) {
  usePerformanceRenderProbe(id, { enabled: committedProbeOwner === 'wrapper' });

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
      tags: {
        component: profilerId,
        phase,
        committed: true,
        authoritative: false,
        source: 'react-profiler',
      },
    });
  };
  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  );
}
