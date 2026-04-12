import { render, screen } from '@testing-library/react';
import MyTokenTray from './MyTokenTray';

const renderTray = (props = {}) => {
  const { currentUserToken, ...restProps } = props;

  return render(
    <MyTokenTray
      currentUserToken={{
        ownerUid: 'user-1',
        label: 'Aldor',
        imageUrl: 'https://example.com/token.png',
        imagePath: 'tokens/aldor.png',
        placed: false,
        col: 0,
        row: 0,
        isHiddenByManager: false,
        ...currentUserToken,
      }}
      activeMapName="Sunken Ruins"
      {...restProps}
    />
  );
};

describe('MyTokenTray', () => {
  test('shows the hidden-by-dm state and disables dragging', () => {
    renderTray({
      currentUserToken: {
        isHiddenByManager: true,
      },
    });

    expect(screen.getByText('Hidden on Sunken Ruins by the DM')).toBeInTheDocument();
    expect(screen.getByText(/The DM is currently hiding or controlling your token on this map/i)).toBeInTheDocument();
    expect(screen.getByText('Aldor').closest('[draggable]')).toHaveAttribute('draggable', 'false');
  });

  test('shows the placed state when the token has a visible placement', () => {
    renderTray({
      currentUserToken: {
        placed: true,
        col: 3,
        row: 8,
      },
    });

    expect(screen.getByText('On Sunken Ruins at 3, 8')).toBeInTheDocument();
    expect(screen.getByText(/Drag this portrait onto the active map to place or reposition your round token/i)).toBeInTheDocument();
    expect(screen.getByText('Aldor').closest('[draggable]')).toHaveAttribute('draggable', 'true');
  });

  test('shows the unplaced state when the token is available but not yet on the map', () => {
    renderTray();

    expect(screen.getByText('Not placed on Sunken Ruins yet')).toBeInTheDocument();
    expect(screen.getByText(/Drag this portrait onto the active map to place or reposition your round token/i)).toBeInTheDocument();
    expect(screen.getByText('Aldor').closest('[draggable]')).toHaveAttribute('draggable', 'true');
  });
});