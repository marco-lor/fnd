import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  canPrefetchModules,
  createModuleLoader,
  isChunkLoadError,
  RetryableLazyBoundary,
} from './lazyLoading';

describe('lazy loading infrastructure', () => {
  test('coalesces preload calls and adapts a named export', async () => {
    const NamedView = () => <div>Named view</div>;
    const importer = jest.fn().mockResolvedValue({ NamedView });
    const descriptor = createModuleLoader({ importer, exportName: 'NamedView', chunkName: 'feature-test' });
    const [first, second] = await Promise.all([descriptor.preload(), descriptor.preload()]);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(first.default).toBe(NamedView);
    expect(second.default).toBe(NamedView);
  });

  test.each([
    [null, true],
    [{ saveData: true, effectiveType: '4g' }, false],
    [{ saveData: false, effectiveType: 'slow-2g' }, false],
    [{ saveData: false, effectiveType: '2g' }, false],
    [{ saveData: false, effectiveType: '3g' }, true],
  ])('evaluates prefetch connection policy', (connection, expected) => {
    expect(canPrefetchModules(connection)).toBe(expected);
  });

  test('recognizes common dynamic chunk failures', () => {
    expect(isChunkLoadError(Object.assign(new Error('Loading chunk 12 failed.'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('ordinary render failure'))).toBe(false);
  });

  test('retries a rejected chunk with a fresh lazy component', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const importer = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Loading chunk feature failed.'), { name: 'ChunkLoadError' }))
      .mockResolvedValue({ default: () => <div>Recovered view</div> });
    const descriptor = createModuleLoader({ importer, chunkName: 'feature-retry' });

    render(<RetryableLazyBoundary descriptor={descriptor} fallbackLabel="Loading test..." />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh application' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.getByText('Recovered view')).toBeInTheDocument());
    expect(importer).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    error.mockRestore();
  });

  test('replaces a resolved lazy view when its route descriptor changes', async () => {
    const first = createModuleLoader({
      chunkName: 'route-first',
      importer: jest.fn().mockResolvedValue({ default: () => <div>First route</div> }),
    });
    const second = createModuleLoader({
      chunkName: 'route-second',
      importer: jest.fn().mockResolvedValue({ default: () => <div>Second route</div> }),
    });
    const view = render(<RetryableLazyBoundary descriptor={first} fallbackLabel="Loading first..." />);

    expect(await screen.findByText('First route')).toBeInTheDocument();
    view.rerender(<RetryableLazyBoundary descriptor={second} fallbackLabel="Loading second..." />);

    expect(await screen.findByText('Second route')).toBeInTheDocument();
    expect(screen.queryByText('First route')).not.toBeInTheDocument();
  });
});
