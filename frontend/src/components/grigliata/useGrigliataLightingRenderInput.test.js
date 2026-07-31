import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import useGrigliataLightingRenderInput from './useGrigliataLightingRenderInput';

const mockBuildDocTarget = (...segments) => ({
  kind: 'doc',
  path: segments.join('/'),
  id: segments[segments.length - 1],
});

let mockDocData = {};

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((db, ...segments) => mockBuildDocTarget(...segments)),
  onSnapshot: jest.fn((target, onNext) => {
    onNext({
      id: target.id,
      exists: () => !!mockDocData[target.path],
      data: () => mockDocData[target.path] || {},
    });

    return jest.fn();
  }),
}));

const HookProbe = ({ backgroundId = '', currentUserId = '' }) => {
  const { lightingRenderInput, isLightingRenderInputReady } = useGrigliataLightingRenderInput({
    backgroundId,
    currentUserId,
  });

  return (
    <div>
      <div data-testid="ready">{String(isLightingRenderInputReady)}</div>
      <div data-testid="background-id">{lightingRenderInput?.backgroundId || ''}</div>
      <div data-testid="light-count">{String(lightingRenderInput?.lights?.length || 0)}</div>
      <div data-testid="wall-count">{String(lightingRenderInput?.walls?.length || 0)}</div>
      <div data-testid="darkness-count">{String(lightingRenderInput?.darknessSources?.length || 0)}</div>
      <div data-testid="light-color">{lightingRenderInput?.lights?.[0]?.color || ''}</div>
    </div>
  );
};

describe('useGrigliataLightingRenderInput', () => {
  let firestore;

  beforeEach(() => {
    mockDocData = {};
    firestore = require('firebase/firestore');
    firestore.doc.mockClear().mockImplementation((db, ...segments) => mockBuildDocTarget(...segments));
    firestore.onSnapshot.mockClear().mockImplementation((target, onNext) => {
      onNext({
        id: target.id,
        exists: () => !!mockDocData[target.path],
        data: () => mockDocData[target.path] || {},
      });

      return jest.fn();
    });
  });

  test('does not subscribe without a signed-in user and active background', () => {
    render(<HookProbe backgroundId="map-1" currentUserId="" />);

    expect(firestore.onSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  test('subscribes to sanitized render input for signed-in viewers', async () => {
    mockDocData['grigliata_lighting_render_inputs/map-1'] = {
      backgroundId: 'map-1',
      scene: {
        darkness: 0.5,
        globalLight: false,
      },
      walls: [{
        x1: 0,
        y1: 0,
        x2: 70,
        y2: 0,
        blocksSight: true,
        doorType: 1,
      }],
      lights: [{
        x: 35,
        y: 35,
        brightRadiusPx: 140,
        dimRadiusPx: 0,
        color: '#abc',
        id: 'raw-light-id',
      }],
      darknessSources: [{
        id: 'raw-darkness-id',
        label: 'Raw darkness',
        x: 105,
        y: 105,
        radiusPx: 140,
        intensity: 0.5,
      }],
    };

    render(<HookProbe backgroundId="map-1" currentUserId="player-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(firestore.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_lighting_render_inputs/map-1' }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(screen.getByTestId('background-id')).toHaveTextContent('map-1');
    expect(screen.getByTestId('wall-count')).toHaveTextContent('1');
    expect(screen.getByTestId('light-count')).toHaveTextContent('1');
    expect(screen.getByTestId('darkness-count')).toHaveTextContent('1');
    expect(screen.getByTestId('light-color')).toHaveTextContent('#AABBCC');
  });

  test('ignores a stale render-input callback after switching maps', async () => {
    const listeners = [];
    firestore.onSnapshot.mockImplementation((target, onNext, onError) => {
      const listener = { target, onNext, onError };
      listeners.push(listener);
      return jest.fn();
    });
    const buildSnapshot = (backgroundId, color) => ({
      id: backgroundId,
      exists: () => true,
      data: () => ({
        backgroundId,
        scene: { darkness: 0.5, globalLight: false },
        walls: [],
        lights: [{
          id: `${backgroundId}-light`,
          x: 35,
          y: 35,
          brightRadiusPx: 140,
          dimRadiusPx: 0,
          color,
        }],
        darknessSources: [],
      }),
    });
    const findListener = (backgroundId) => listeners.find((listener) => (
      listener.target?.path === `grigliata_lighting_render_inputs/${backgroundId}`
    ));

    const { rerender } = render(
      <HookProbe backgroundId={'map-1'} currentUserId={'player-1'} />
    );
    await waitFor(() => {
      expect(findListener('map-1')).toBeDefined();
    });
    const mapOneListener = findListener('map-1');
    act(() => {
      mapOneListener.onNext(buildSnapshot('map-1', '#AA1133'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
      expect(screen.getByTestId('background-id')).toHaveTextContent('map-1');
    });

    rerender(<HookProbe backgroundId={'map-2'} currentUserId={'player-1'} />);
    await waitFor(() => {
      expect(findListener('map-2')).toBeDefined();
    });
    act(() => {
      findListener('map-2').onNext(buildSnapshot('map-2', '#224466'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
      expect(screen.getByTestId('background-id')).toHaveTextContent('map-2');
      expect(screen.getByTestId('light-color')).toHaveTextContent('#224466');
    });

    act(() => {
      mapOneListener.onNext(buildSnapshot('map-1', '#FF0000'));
    });
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
    expect(screen.getByTestId('background-id')).toHaveTextContent('map-2');
    expect(screen.getByTestId('light-color')).toHaveTextContent('#224466');
  });
});
