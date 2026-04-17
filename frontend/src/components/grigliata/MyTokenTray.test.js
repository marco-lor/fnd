import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FOE_LIBRARY_DRAG_TYPE, TRAY_DRAG_MIME } from './constants';
import MyTokenTray from './MyTokenTray';

const renderTray = (props = {}) => {
  const {
    currentUserToken,
    customTokens,
    activeMapName = 'Sunken Ruins',
    hasActiveMap = activeMapName !== '',
    ...restProps
  } = props;

  const resolvedCurrentUserToken = currentUserToken === null
    ? null
    : {
      tokenId: 'user-1',
      ownerUid: 'user-1',
      tokenType: 'character',
      label: 'Aldor',
      imageUrl: 'https://example.com/token.png',
      imagePath: 'tokens/aldor.png',
      placed: false,
      col: 0,
      row: 0,
      isHiddenByManager: false,
      ...currentUserToken,
    };

  return render(
    <MyTokenTray
      currentUserToken={resolvedCurrentUserToken}
      customTokens={customTokens || []}
      activeMapName={activeMapName}
      hasActiveMap={hasActiveMap}
      {...restProps}
    />
  );
};

const createDataTransfer = () => ({
  setData: jest.fn(),
  effectAllowed: '',
});

describe('MyTokenTray', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', {
      writable: true,
      value: jest.fn(),
    });
  });

  test('shows a single tray-level drag and drop instruction', () => {
    renderTray({
      customTokens: [{
        tokenId: 'token-2',
        ownerUid: 'user-1',
        tokenType: 'custom',
        label: 'Wolf',
        imageUrl: 'https://example.com/wolf.png',
        imagePath: 'grigliata/tokens/user-1/wolf.png',
        placed: true,
        col: 2,
        row: 3,
        isHiddenByManager: false,
      }],
    });

    expect(screen.getByText('Drag and drop tokens onto the active map to place or reposition them.')).toBeInTheDocument();
    expect(screen.getByText('Placed in Sunken Ruins')).toBeInTheDocument();
    expect(screen.queryByText(/Your main character token stays pinned first/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag this portrait onto the active map/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag this custom token onto the active map/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/On Sunken Ruins at/i)).not.toBeInTheDocument();
  });

  test('hides the dm character card while keeping custom token controls visible', () => {
    renderTray({
      currentUserId: 'user-1',
      isManager: true,
      currentUserToken: null,
      customTokens: [{
        tokenId: 'token-2',
        ownerUid: 'user-1',
        tokenType: 'custom',
        label: 'Wolf',
        imageUrl: 'https://example.com/wolf.png',
        imagePath: 'grigliata/tokens/user-1/wolf.png',
        placed: false,
        col: 0,
        row: 0,
        isHiddenByManager: false,
      }],
    });

    expect(screen.queryByText('Aldor')).not.toBeInTheDocument();
    expect(screen.getByText('Wolf')).toBeInTheDocument();
    expect(screen.getByText('Foes Hub')).toBeInTheDocument();
    expect(screen.getByText('Add Custom Token')).toBeInTheDocument();
  });

  test('shows the hidden-by-dm state and disables dragging for the main token', () => {
    renderTray({
      currentUserToken: {
        isHiddenByManager: true,
      },
    });

    expect(screen.getByText('Hidden on Sunken Ruins by the DM')).toBeInTheDocument();
    expect(screen.getByText(/The DM is currently hiding or controlling this token on the active map/i)).toBeInTheDocument();
    expect(screen.getByText('Aldor').closest('[draggable]')).toHaveAttribute('draggable', 'false');
  });

  test('shows map-selection guidance and disables dragging when no active map is selected', () => {
    renderTray({
      activeMapName: '',
      hasActiveMap: false,
    });

    expect(screen.getByText('Select an active map to place or reposition tokens.')).toBeInTheDocument();
    expect(screen.getByText('Select a map to place this token')).toBeInTheDocument();
    expect(screen.getByText('Select a map first. Token positions are saved independently for each map.')).toBeInTheDocument();
    expect(screen.getByText('Aldor').closest('[draggable]')).toHaveAttribute('draggable', 'false');
  });

  test('shows upload guidance when the main token has no image', () => {
    renderTray({
      currentUserToken: {
        imageUrl: '',
        imagePath: '',
      },
    });

    expect(screen.getByText('No Img')).toBeInTheDocument();
    expect(screen.getByText(/Upload a profile image from the navbar first/i)).toBeInTheDocument();
    expect(screen.getByText('Aldor').closest('[draggable]')).toHaveAttribute('draggable', 'false');
  });

  test('shows upload guidance when a custom token has no image', () => {
    renderTray({
      customTokens: [{
        tokenId: 'token-2',
        ownerUid: 'user-1',
        tokenType: 'custom',
        label: 'Wolf',
        imageUrl: '',
        imagePath: '',
        placed: false,
        col: 0,
        row: 0,
        isHiddenByManager: false,
      }],
    });

    expect(screen.getByText(/Upload an image for this custom token before dragging it onto the map/i)).toBeInTheDocument();
    expect(screen.getByText('Wolf').closest('[draggable]')).toHaveAttribute('draggable', 'false');
  });

  test('populates token-aware drag data and forwards drag lifecycle callbacks', () => {
    const onDragStart = jest.fn();
    const onDragEnd = jest.fn();
    renderTray({ onDragStart, onDragEnd });

    const dragTarget = screen.getByText('Aldor').closest('[draggable]');
    const dataTransfer = createDataTransfer();
    const expectedPayload = JSON.stringify({
      type: 'grigliata-token',
      tokenId: 'user-1',
      ownerUid: 'user-1',
      uid: 'user-1',
    });

    fireEvent.dragStart(dragTarget, { dataTransfer });
    fireEvent.dragEnd(dragTarget);

    expect(dataTransfer.setData).toHaveBeenCalledWith(TRAY_DRAG_MIME, expectedPayload);
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', expectedPayload);
    expect(dataTransfer.effectAllowed).toBe('copyMove');
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  test('prevents drag start when the tray token cannot be dragged', () => {
    const onDragStart = jest.fn();
    renderTray({
      currentUserToken: {
        isHiddenByManager: true,
      },
      onDragStart,
    });

    const dragTarget = screen.getByText('Aldor').closest('[draggable]');
    const dragStartEvent = createEvent.dragStart(dragTarget);
    const dataTransfer = createDataTransfer();

    Object.defineProperty(dragStartEvent, 'dataTransfer', {
      value: dataTransfer,
      configurable: true,
    });
    dragStartEvent.preventDefault = jest.fn();

    fireEvent(dragTarget, dragStartEvent);

    expect(dragStartEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
  });

  test('creates a custom token through the tray form', async () => {
    const onCreateCustomToken = jest.fn(() => Promise.resolve(true));
    const file = new File(['wolf'], 'wolf.png', { type: 'image/png' });
    renderTray({ onCreateCustomToken });

    fireEvent.change(screen.getByPlaceholderText('Summoned Wolf'), {
      target: { value: 'Summoned Wolf' },
    });
    fireEvent.change(screen.getByLabelText('Image'), {
      target: { files: [file] },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create token/i }));
    });

    await waitFor(() => {
      expect(onCreateCustomToken).toHaveBeenCalledWith({
        label: 'Summoned Wolf',
        imageFile: file,
      });
    });
  });

  test('remounts the create image input after a successful custom token creation', async () => {
    const onCreateCustomToken = jest.fn(() => Promise.resolve(true));
    const file = new File(['wolf'], 'wolf.png', { type: 'image/png' });

    renderTray({ onCreateCustomToken });

    const originalInput = screen.getByLabelText('Image');
    fireEvent.change(screen.getByPlaceholderText('Summoned Wolf'), {
      target: { value: 'Summoned Wolf' },
    });
    fireEvent.change(originalInput, {
      target: { files: [file] },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create token/i }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Image')).not.toBe(originalInput);
    });
  });

  test('edits a custom token from the tray', async () => {
    const onUpdateCustomToken = jest.fn(() => Promise.resolve(true));
    const replacementFile = new File(['dire-wolf'], 'dire-wolf.png', { type: 'image/png' });

    renderTray({
      customTokens: [{
        tokenId: 'token-2',
        ownerUid: 'user-1',
        tokenType: 'custom',
        label: 'Wolf',
        imageUrl: 'https://example.com/wolf.png',
        imagePath: 'grigliata/tokens/user-1/wolf.png',
        placed: true,
        col: 2,
        row: 3,
        isHiddenByManager: false,
      }],
      onUpdateCustomToken,
    });

    fireEvent.click(screen.getByRole('button', { name: /edit wolf/i }));
    fireEvent.change(screen.getByDisplayValue('Wolf'), {
      target: { value: 'Dire Wolf' },
    });
    fireEvent.change(screen.getByLabelText('Replace Image'), {
      target: { files: [replacementFile] },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    await waitFor(() => {
      expect(onUpdateCustomToken).toHaveBeenCalledWith({
        tokenId: 'token-2',
        label: 'Dire Wolf',
        imageFile: replacementFile,
      });
    });
  });

  test('remounts the edit image input after saving a custom token edit', async () => {
    const onUpdateCustomToken = jest.fn(() => Promise.resolve(true));
    const replacementFile = new File(['dire-wolf'], 'dire-wolf.png', { type: 'image/png' });

    renderTray({
      customTokens: [{
        tokenId: 'token-2',
        ownerUid: 'user-1',
        tokenType: 'custom',
        label: 'Wolf',
        imageUrl: 'https://example.com/wolf.png',
        imagePath: 'grigliata/tokens/user-1/wolf.png',
        placed: true,
        col: 2,
        row: 3,
        isHiddenByManager: false,
      }],
      onUpdateCustomToken,
    });

    fireEvent.click(screen.getByRole('button', { name: /edit wolf/i }));
    const originalInput = screen.getByLabelText('Replace Image');
    fireEvent.change(originalInput, {
      target: { files: [replacementFile] },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('Replace Image')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /edit wolf/i }));

    expect(screen.getByLabelText('Replace Image')).not.toBe(originalInput);
  });

  test('deletes a custom token from the tray', () => {
    const onDeleteCustomToken = jest.fn(() => Promise.resolve(true));

    renderTray({
      customTokens: [{
        tokenId: 'token-2',
        ownerUid: 'user-1',
        tokenType: 'custom',
        label: 'Wolf',
        imageUrl: 'https://example.com/wolf.png',
        imagePath: 'grigliata/tokens/user-1/wolf.png',
        placed: true,
        col: 2,
        row: 3,
        isHiddenByManager: false,
      }],
      onDeleteCustomToken,
    });

    fireEvent.click(screen.getByRole('button', { name: /delete wolf/i }));
    expect(onDeleteCustomToken).toHaveBeenCalledWith(expect.objectContaining({
      tokenId: 'token-2',
      label: 'Wolf',
    }));
  });

  test('renders the dm foes hub subsection and emits foe-library drag payloads', () => {
    const onDragStart = jest.fn();
    const onDragEnd = jest.fn();

    renderTray({
      isManager: true,
      currentUserId: 'user-1',
      foeLibrary: [{
        id: 'foe-1',
        name: 'Test One',
        category: 'Beast',
        rank: 'Elite',
        dadoAnima: 'd10',
        stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
      }],
      onDragStart,
      onDragEnd,
    });

    expect(screen.getByText('Foes Hub')).toBeInTheDocument();
    expect(screen.getByText('Test One')).toBeInTheDocument();

    const dragTarget = screen.getByTestId('foe-library-card-foe-1');
    const dataTransfer = createDataTransfer();
    const expectedPayload = JSON.stringify({
      type: FOE_LIBRARY_DRAG_TYPE,
      foeId: 'foe-1',
      ownerUid: 'user-1',
      uid: 'user-1',
    });

    fireEvent.dragStart(dragTarget, { dataTransfer });
    fireEvent.dragEnd(dragTarget);

    expect(dataTransfer.setData).toHaveBeenCalledWith(TRAY_DRAG_MIME, expectedPayload);
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', expectedPayload);
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  test('renders foe parametri groups collapsed by default and toggles them independently', async () => {
    renderTray({
      isManager: true,
      selectedFoeToken: {
        tokenId: 'foe-token-1',
        label: 'Test One',
        category: 'Beast',
        rank: 'Elite',
        dadoAnima: 'd10',
        notes: 'Alpha foe',
        stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
        Parametri: {
          Base: { Forza: { Tot: 7 } },
          Combattimento: { Attacco: { Tot: 5 } },
        },
        spells: [{ name: 'Hex' }],
        tecniche: [{ name: 'Claw' }],
      },
    });

    const baseToggle = screen.getByRole('button', { name: 'Expand Base parameters' });
    const combattimentoToggle = screen.getByRole('button', { name: 'Expand Combattimento parameters' });

    expect(baseToggle).toHaveAttribute('aria-expanded', 'false');
    expect(combattimentoToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Forza')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Attacco')).not.toBeInTheDocument();

    fireEvent.click(baseToggle);

    expect(baseToggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByLabelText('Forza')).toBeInTheDocument();
    expect(screen.queryByLabelText('Attacco')).not.toBeInTheDocument();

    fireEvent.click(combattimentoToggle);

    expect(combattimentoToggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByLabelText('Attacco')).toBeInTheDocument();
    expect(screen.getByLabelText('Forza')).toBeInTheDocument();

    fireEvent.click(baseToggle);

    await waitFor(() => {
      expect(screen.queryByLabelText('Forza')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Attacco')).toBeInTheDocument();
  });

  test('renders and saves the selected foe token details after expanding a parametri group', async () => {
    const onUpdateFoeToken = jest.fn(() => Promise.resolve(true));

    renderTray({
      isManager: true,
      selectedFoeToken: {
        tokenId: 'foe-token-1',
        label: 'Test One',
        category: 'Beast',
        rank: 'Elite',
        dadoAnima: 'd10',
        notes: 'Alpha foe',
        stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
        Parametri: {
          Base: { Forza: { Tot: 7 } },
          Combattimento: { Attacco: { Tot: 5 } },
        },
        spells: [{ name: 'Hex' }],
        tecniche: [{ name: 'Claw' }],
      },
      onUpdateFoeToken,
    });

    expect(screen.getByText('Selected Foe')).toBeInTheDocument();
    expect(screen.getByText('Hex')).toBeInTheDocument();
    expect(screen.getByText('Claw')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Base parameters' }));

    expect(await screen.findByLabelText('Forza')).toHaveValue(7);
    fireEvent.change(screen.getByLabelText('Foe Name'), { target: { value: 'Test One Prime' } });
    fireEvent.change(screen.getByLabelText('Current HP'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('Forza'), { target: { value: '9' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save foe/i }));
    });

    expect(onUpdateFoeToken).toHaveBeenCalledWith(expect.objectContaining({
      tokenId: 'foe-token-1',
      label: 'Test One Prime',
      Parametri: expect.objectContaining({
        Base: expect.objectContaining({
          Forza: expect.objectContaining({ Tot: 9 }),
        }),
      }),
      stats: expect.objectContaining({ hpCurrent: 42, hpTotal: 60 }),
    }));
  });

  test('does not render the shared music control inside the token tray', () => {
    renderTray();

    expect(screen.queryByRole('button', { name: /mute music/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unmute music/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/shared grigliata music/i)).not.toBeInTheDocument();
  });
});
