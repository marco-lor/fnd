import React from 'react';
import { render } from '@testing-library/react';
import PerformanceProfiler from './PerformanceProfiler';
import { isPerformanceEnabled, recordReactProfilerCommit } from './runtime';
import { recordTask08Event } from './task08';

jest.mock('./runtime', () => ({
  isPerformanceEnabled: jest.fn(),
  recordReactProfilerCommit: jest.fn(),
}));

jest.mock('./task08', () => ({
  recordTask08Event: jest.fn(),
}));

describe('PerformanceProfiler Task 08 render measurement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isPerformanceEnabled.mockReturnValue(true);
  });

  test('keeps the existing profiler event and adds a stable component render event', () => {
    render(
      <PerformanceProfiler id="StatsBars">
        <span>fixture</span>
      </PerformanceProfiler>
    );

    expect(recordReactProfilerCommit).toHaveBeenCalled();
    expect(recordTask08Event).toHaveBeenCalledWith({
      metric: 'render',
      tags: expect.objectContaining({
        component: 'StatsBars',
        committed: true,
      }),
    });
  });
});
