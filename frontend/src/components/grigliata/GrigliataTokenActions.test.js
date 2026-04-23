import { fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataTokenActions, { TokenStatusSummaryCard } from './GrigliataTokenActions';

const buildActionState = (overrides = {}) => ({
  tokenIds: ['token-1'],
  buttonSize: 44,
  toolbarWidth: 52,
  toolbarHeight: 60,
  toolbarPosition: { left: 24, top: 18 },
  showVisibilityAction: false,
  showDeadAction: false,
  nextIsVisibleToPlayers: false,
  nextIsDead: true,
  visibilityTitle: 'Hide selected token from players',
  deadStateTitle: 'Mark selected token as dead',
  statusToken: {
    tokenId: 'token-1',
    label: 'Aldor',
    statuses: [],
  },
  sizeToken: {
    tokenId: 'token-1',
    label: 'Aldor',
    sizeSquares: 1,
  },
  ...overrides,
});

describe('GrigliataTokenActions', () => {
  test('shows the status button for a single selected token', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState()}
        viewportSize={{ width: 1000, height: 700 }}
      />
    );

    expect(screen.getByRole('button', { name: /edit statuses for aldor/i })).toBeInTheDocument();
  });

  test('shows the size button for a single selected token', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState()}
        viewportSize={{ width: 1000, height: 700 }}
      />
    );

    expect(screen.getByRole('button', { name: /resize aldor/i })).toBeInTheDocument();
  });

  test('does not show status editing for multi-select manager actions', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          tokenIds: ['token-1', 'token-2'],
          showVisibilityAction: true,
          showDeadAction: true,
          statusToken: null,
          sizeToken: null,
        })}
        viewportSize={{ width: 1000, height: 700 }}
      />
    );

    expect(screen.queryByRole('button', { name: /edit statuses/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resize/i })).not.toBeInTheDocument();
  });

  test('toggling a status calls onUpdateTokenStatuses with the next status order', () => {
    const handleUpdateTokenStatuses = jest.fn();

    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          statusToken: {
            tokenId: 'token-1',
            label: 'Aldor',
            statuses: ['burning', 'sleeping'],
          },
        })}
        viewportSize={{ width: 1000, height: 700 }}
        onUpdateTokenStatuses={handleUpdateTokenStatuses}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit statuses for aldor/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Marked' }));

    expect(handleUpdateTokenStatuses).toHaveBeenCalledWith('token-1', [
      'marked',
      'burning',
      'sleeping',
    ]);
  });

  test('shows a clear-all action in the open popover', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          statusToken: {
            tokenId: 'token-1',
            label: 'Aldor',
            statuses: ['burning'],
          },
        })}
        viewportSize={{ width: 1000, height: 700 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit statuses for aldor/i }));

    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
  });

  test('disables clear-all when there are no active statuses', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState()}
        viewportSize={{ width: 1000, height: 700 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit statuses for aldor/i }));

    expect(screen.getByRole('button', { name: /clear all/i })).toBeDisabled();
  });

  test('clear-all calls onUpdateTokenStatuses with an empty array', () => {
    const handleUpdateTokenStatuses = jest.fn();

    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          statusToken: {
            tokenId: 'token-1',
            label: 'Aldor',
            statuses: ['burning', 'sleeping'],
          },
        })}
        viewportSize={{ width: 1000, height: 700 }}
        onUpdateTokenStatuses={handleUpdateTokenStatuses}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit statuses for aldor/i }));
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));

    expect(handleUpdateTokenStatuses).toHaveBeenCalledWith('token-1', []);
  });

  test('renders a stronger active marker for active statuses only', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          statusToken: {
            tokenId: 'token-1',
            label: 'Aldor',
            statuses: ['burning'],
          },
        })}
        viewportSize={{ width: 1000, height: 700 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit statuses for aldor/i }));

    const burningButton = screen.getByRole('button', { name: 'Burning' });
    const sleepingButton = screen.getByRole('button', { name: 'Sleeping' });

    expect(burningButton).toHaveAttribute('data-active', 'true');
    expect(within(burningButton).getByTestId('status-active-burning')).toBeInTheDocument();
    expect(sleepingButton).toHaveAttribute('data-active', 'false');
    expect(within(sleepingButton).queryByText('Active')).not.toBeInTheDocument();
  });

  test('opens the popover upward and caps its height when there is not enough room below', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          toolbarPosition: { left: 180, top: 270 },
        })}
        viewportSize={{ width: 640, height: 360 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit statuses for aldor/i }));

    expect(screen.getByTestId('token-status-popover')).toHaveStyle({
      bottom: '70px',
      maxHeight: '248px',
    });
  });

  test('preset size buttons call onSetSelectedTokenSize with the requested footprint', () => {
    const handleSetSelectedTokenSize = jest.fn();

    render(
      <GrigliataTokenActions
        actionState={buildActionState()}
        viewportSize={{ width: 1000, height: 700 }}
        onSetSelectedTokenSize={handleSetSelectedTokenSize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /resize aldor/i }));
    fireEvent.click(screen.getByRole('button', { name: /set token size to 3 by 3/i }));

    expect(handleSetSelectedTokenSize).toHaveBeenCalledWith('token-1', 3);
  });

  test('custom size input clamps values into the supported range', () => {
    const handleSetSelectedTokenSize = jest.fn();

    render(
      <GrigliataTokenActions
        actionState={buildActionState()}
        viewportSize={{ width: 1000, height: 700 }}
        onSetSelectedTokenSize={handleSetSelectedTokenSize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /resize aldor/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /token size in squares/i }), {
      target: { value: '12' },
    });
    fireEvent.blur(screen.getByRole('spinbutton', { name: /token size in squares/i }));

    expect(handleSetSelectedTokenSize).toHaveBeenCalledWith('token-1', 9);
  });

  test('commits a typed custom size before outside dismissal closes the popover', () => {
    const handleSetSelectedTokenSize = jest.fn();

    render(
      <GrigliataTokenActions
        actionState={buildActionState()}
        viewportSize={{ width: 1000, height: 700 }}
        onSetSelectedTokenSize={handleSetSelectedTokenSize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /resize aldor/i }));

    const input = screen.getByRole('spinbutton', { name: /token size in squares/i });
    fireEvent.change(input, {
      target: { value: '6' },
    });
    fireEvent.pointerDown(document.body);

    expect(handleSetSelectedTokenSize).toHaveBeenCalledWith('token-1', 6);
    expect(handleSetSelectedTokenSize).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('token-size-popover')).not.toBeInTheDocument();
  });

  test('keeps the size controls in a scrollable body when height is capped', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          toolbarPosition: { left: 180, top: 270 },
        })}
        viewportSize={{ width: 640, height: 360 }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /resize aldor/i }));

    expect(screen.getByTestId('token-size-popover')).toHaveStyle({
      bottom: '70px',
      maxHeight: '248px',
    });
    expect(screen.getByTestId('token-size-popover-body')).toHaveClass('overflow-y-auto');
  });
});

describe('TokenStatusSummaryCard', () => {
  test('lists every applied status in the overflow card', () => {
    render(
      <TokenStatusSummaryCard
        statuses={['burning', 'sleeping', 'marked', 'poisoned']}
      />
    );

    expect(screen.getByText('Burning')).toBeInTheDocument();
    expect(screen.getByText('Sleeping')).toBeInTheDocument();
    expect(screen.getByText('Marked')).toBeInTheDocument();
    expect(screen.getByText('Poisoned')).toBeInTheDocument();
  });
});
