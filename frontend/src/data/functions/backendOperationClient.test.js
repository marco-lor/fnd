import {
  BackendOperationError,
  callBackendOperationAndWait,
  createBackendOperationId,
  getBackendOperationView,
  waitForBackendOperation,
} from './backendOperationClient';

jest.mock('./callableRegistry', () => ({
  getCallable: jest.fn(() => jest.fn()),
}));

describe('backend operation client', () => {
  test('creates valid, prefixed operation ids', () => {
    const operationId = createBackendOperationId('delete npc');

    expect(operationId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/);
    expect(operationId).toMatch(/^delete-npc-/);
  });

  test('unwraps both direct and nested callable operation views', () => {
    const operation = { operationId: 'operation-123', status: 'pending' };

    expect(getBackendOperationView({ data: operation })).toBe(operation);
    expect(getBackendOperationView({ data: { operation } })).toBe(operation);
  });

  test('polls until an operation completes', async () => {
    const statusCallable = jest.fn()
      .mockResolvedValueOnce({ data: { status: 'running' } })
      .mockResolvedValueOnce({
        data: {
          status: 'completed',
          progress: { succeeded: 3 },
        },
      });

    const operation = await waitForBackendOperation('operation-123', {
      initialOperation: { status: 'pending' },
      pollIntervalMs: 0,
      statusCallable,
      timeoutMs: 1000,
    });

    expect(statusCallable).toHaveBeenCalledTimes(2);
    expect(operation.status).toBe('completed');
    expect(operation.progress.succeeded).toBe(3);
  });

  test('surfaces terminal backend state with the operation attached', async () => {
    await expect(waitForBackendOperation('operation-123', {
      initialOperation: {
        status: 'paused',
        retryable: true,
        errorClass: 'dependency',
      },
    })).rejects.toEqual(expect.objectContaining({
      name: 'BackendOperationError',
      operation: expect.objectContaining({ status: 'paused' }),
    }));
  });

  test('passes a stable supplied id through invocation and polling', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { status: 'completed', progress: { succeeded: 1 } },
    });

    const operation = await callBackendOperationAndWait(
      callable,
      { field: 'lock_param_base', value: true },
      { operationId: 'stable-operation-123' }
    );

    expect(callable).toHaveBeenCalledWith({
      field: 'lock_param_base',
      value: true,
      operationId: 'stable-operation-123',
    });
    expect(operation.status).toBe('completed');
  });

  test('resumes a retryable replay before polling it again', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: {
        status: 'paused',
        replayed: true,
        retryable: true,
      },
    });
    const resumeCallable = jest.fn().mockResolvedValue({
      data: { status: 'pending', replayed: true, retryable: false },
    });
    const statusCallable = jest.fn().mockResolvedValue({
      data: { status: 'completed', progress: { succeeded: 2 } },
    });

    const operation = await callBackendOperationAndWait(callable, {}, {
      operationId: 'stable-operation-123',
      pollIntervalMs: 0,
      resumeCallable,
      statusCallable,
    });

    expect(resumeCallable).toHaveBeenCalledWith({
      operationId: 'stable-operation-123',
    });
    expect(statusCallable).toHaveBeenCalledTimes(1);
    expect(operation.status).toBe('completed');
  });

  test('rejects invalid ids before calling status', async () => {
    const statusCallable = jest.fn();

    await expect(waitForBackendOperation('short', {
      statusCallable,
    })).rejects.toBeInstanceOf(TypeError);
    expect(statusCallable).not.toHaveBeenCalled();
  });

  test('exports a dedicated operation error type', () => {
    expect(new BackendOperationError('failed', { status: 'failed' }))
      .toBeInstanceOf(Error);
  });
});
