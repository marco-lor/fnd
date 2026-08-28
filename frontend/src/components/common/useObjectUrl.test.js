import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import useObjectUrl, { createObjectUrlLease, withObjectUrl } from './useObjectUrl';
import { recordTask08Event } from '../../performance/task08';

jest.mock('../../performance/task08', () => ({
  recordTask08Event: jest.fn(),
}));

const Preview = ({ file }) => {
  const url = useObjectUrl(file);
  return <span data-testid="preview-url">{url}</span>;
};

describe('useObjectUrl', () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let createdCount;

  beforeEach(() => {
    createdCount = 0;
    URL.createObjectURL = jest.fn(() => `blob:preview-${++createdCount}`);
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  test('leases and idempotently revokes one URL', () => {
    const urlApi = {
      createObjectURL: jest.fn(() => 'blob:leased'),
      revokeObjectURL: jest.fn(),
    };
    const lease = createObjectUrlLease({ name: 'portrait.png' }, { urlApi });
    expect(lease.url).toBe('blob:leased');
    lease.revoke();
    lease.revoke();
    expect(urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:leased');
    expect(recordTask08Event.mock.calls.map(([event]) => event.metric)).toEqual([
      'media-object-url-create',
      'media-object-url-revoke',
      'cleanup',
    ]);
  });

  test('revokes replacement and unmount URLs without leaking', async () => {
    const firstFile = new File(['first'], 'first.png', { type: 'image/png' });
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' });
    const view = render(<Preview file={firstFile} />);

    await waitFor(() => {
      expect(screen.getByTestId('preview-url')).toHaveTextContent('blob:preview-1');
    });
    view.rerender(<Preview file={secondFile} />);
    await waitFor(() => {
      expect(screen.getByTestId('preview-url')).toHaveTextContent('blob:preview-2');
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  test('does not allocate an URL for an empty selection', () => {
    const view = render(<Preview file={null} />);
    expect(screen.getByTestId('preview-url')).toHaveTextContent('');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    view.unmount();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test('withObjectUrl always revokes after success and failure', async () => {
    await expect(withObjectUrl(new Blob(['ok']), async (url) => `used:${url}`))
      .resolves.toBe('used:blob:preview-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');

    await expect(withObjectUrl(new Blob(['bad']), async () => {
      throw new Error('decode failed');
    })).rejects.toThrow('decode failed');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2');
  });
});
