import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import PerformanceProfiler, { usePerformanceRenderProbe } from './PerformanceProfiler';
import { isPerformanceEnabled, recordReactProfilerCommit } from './runtime';
import { recordTask08Event } from './task08';

jest.mock('./runtime', () => ({
  isPerformanceEnabled: jest.fn(),
  recordReactProfilerCommit: jest.fn(),
}));

jest.mock('./task08', () => ({
  recordTask08Event: jest.fn(),
}));

const RenderProbeFixture = ({ value }) => {
  usePerformanceRenderProbe('StatsBars');
  return <span>{value}</span>;
};

const LocalStateProbeFixture = () => {
  usePerformanceRenderProbe('StatsBars');
  const [value, setValue] = React.useState(0);
  return <button onClick={() => setValue((current) => current + 1)}>{value}</button>;
};

const authoritativeRenderCalls = () => recordTask08Event.mock.calls.filter(([event]) => (
  event.metric === 'render'
  && event.tags?.authoritative === true
  && event.tags?.committed === true
));

describe('PerformanceProfiler Task 08 render measurement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isPerformanceEnabled.mockReturnValue(true);
  });

  test('records exactly one authoritative event when wrapper and child probe are mounted together', () => {
    render(
      <PerformanceProfiler id="StatsBars" committedProbeOwner="child">
        <RenderProbeFixture value="fixture" />
      </PerformanceProfiler>
    );

    expect(recordReactProfilerCommit).toHaveBeenCalled();
    expect(authoritativeRenderCalls()).toHaveLength(1);
    expect(authoritativeRenderCalls()[0][0]).toEqual({
      metric: 'render',
      tags: expect.objectContaining({
        component: 'StatsBars',
        committed: true,
        authoritative: true,
      }),
    });
  });

  test('records one authoritative child event for a local update while its wrapper stays stable', () => {
    const { getByRole } = render(
      <PerformanceProfiler id="StatsBars" committedProbeOwner="child">
        <LocalStateProbeFixture />
      </PerformanceProfiler>
    );
    recordTask08Event.mockClear();

    fireEvent.click(getByRole('button'));

    expect(authoritativeRenderCalls()).toHaveLength(1);
    expect(authoritativeRenderCalls()[0][0]).toEqual({
      metric: 'render',
      tags: expect.objectContaining({
        component: 'StatsBars',
        committed: true,
        authoritative: true,
      }),
    });
  });

  test('keeps wrapper-only profiling as one authoritative committed event', () => {
    render(
      <PerformanceProfiler id="WrapperOnly">
        <span>fixture</span>
      </PerformanceProfiler>
    );

    expect(authoritativeRenderCalls()).toHaveLength(1);
    expect(authoritativeRenderCalls()[0][0].tags).toEqual(expect.objectContaining({
      component: 'WrapperOnly',
      authoritative: true,
      committed: true,
    }));
  });
});
