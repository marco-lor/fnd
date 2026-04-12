import { fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataTokenActions, { TokenStatusSummaryCard } from './GrigliataTokenActions';

const buildActionState = (overrides = {}) => ({
  ownerUids: ['user-1'],
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
    ownerUid: 'user-1',
    label: 'Aldor',
    statuses: [],
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

  test('does not show status editing for multi-select manager actions', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          ownerUids: ['user-1', 'user-2'],
          showVisibilityAction: true,
          showDeadAction: true,
          statusToken: null,
        })}
        viewportSize={{ width: 1000, height: 700 }}
      />
    );

    expect(screen.queryByRole('button', { name: /edit statuses/i })).not.toBeInTheDocument();
  });

  test('toggling a status calls onUpdateTokenStatuses with the next status order', () => {
    const handleUpdateTokenStatuses = jest.fn();

    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          statusToken: {
            ownerUid: 'user-1',
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

    expect(handleUpdateTokenStatuses).toHaveBeenCalledWith('user-1', [
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
            ownerUid: 'user-1',
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
            ownerUid: 'user-1',
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

    expect(handleUpdateTokenStatuses).toHaveBeenCalledWith('user-1', []);
  });

  test('renders a stronger active marker for active statuses only', () => {
    render(
      <GrigliataTokenActions
        actionState={buildActionState({
          statusToken: {
            ownerUid: 'user-1',
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
