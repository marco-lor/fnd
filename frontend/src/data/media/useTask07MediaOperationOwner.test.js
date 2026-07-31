import React, { StrictMode } from 'react';
import { render } from '@testing-library/react';
import useTask07MediaOperationOwner from './useTask07MediaOperationOwner';

const OwnerHarness = ({ onOwner }) => {
  const owner = useTask07MediaOperationOwner();
  onOwner(owner);
  return null;
};

describe('useTask07MediaOperationOwner', () => {
  test('keeps one stable facade through StrictMode and aborts replacement/unmount work', () => {
    let currentOwner = null;
    const onOwner = (owner) => {
      currentOwner = owner;
    };
    const view = render(
      <StrictMode>
        <OwnerHarness onOwner={onOwner} />
      </StrictMode>
    );
    const stableFacade = currentOwner;
    const first = currentOwner.start('first upload');
    const second = currentOwner.start('replacement upload');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    view.rerender(
      <StrictMode>
        <OwnerHarness onOwner={onOwner} />
      </StrictMode>
    );
    expect(currentOwner).toBe(stableFacade);

    view.unmount();
    expect(second.signal.aborted).toBe(true);
  });
});
