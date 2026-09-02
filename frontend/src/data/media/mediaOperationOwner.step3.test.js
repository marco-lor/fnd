import { createTask07MediaOperationOwner } from './mediaOperationOwner';

describe('Task 07 media ownership used by Character Creation', () => {
  test('cancels the replaced lease and releases the current lease exactly once', () => {
    const owner = createTask07MediaOperationOwner();
    const first = owner.start('replacement');
    const second = owner.start('replacement');

    expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
    expect(owner.hasActiveOperation()).toBe(true);

    second.release();
    second.release();
    expect(owner.hasActiveOperation()).toBe(false);
  });

  test('cancels active work on selection change, cancellation, and unmount disposal', () => {
    const owner = createTask07MediaOperationOwner();
    const first = owner.start('selection changed');
    expect(owner.cancel('cancelled')).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(owner.hasActiveOperation()).toBe(false);

    const second = owner.start('next attempt');
    expect(owner.dispose('route unmounted')).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(owner.isDisposed()).toBe(true);
    expect(owner.dispose('duplicate cleanup')).toBe(false);
  });
});
