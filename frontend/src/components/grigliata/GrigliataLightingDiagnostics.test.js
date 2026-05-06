import React from 'react';
import { render, screen } from '@testing-library/react';
import GrigliataLightingDiagnostics from './GrigliataLightingDiagnostics';

describe('GrigliataLightingDiagnostics', () => {
  test('summarizes DM lighting and selected token vision state', () => {
    render(
      <GrigliataLightingDiagnostics
        lights={[{
          id: 'light-1',
          enabled: true,
          x: 0,
          y: 0,
          brightRadiusPx: 70,
          dimRadiusPx: 140,
        }, {
          id: 'light-2',
          enabled: false,
          x: 0,
          y: 0,
          brightRadiusPx: 70,
          dimRadiusPx: 140,
        }]}
        walls={[{
          id: 'wall-1',
          wallType: 'wall',
          x1: 0,
          y1: 0,
          x2: 70,
          y2: 0,
          blocksSight: true,
        }, {
          id: 'wall-2',
          wallType: 'door',
          x1: 70,
          y1: 0,
          x2: 140,
          y2: 0,
          blocksSight: true,
        }, {
          id: 'wall-3',
          wallType: 'window',
          x1: 140,
          y1: 0,
          x2: 210,
          y2: 0,
          blocksSight: true,
        }]}
        selectedToken={{
          tokenId: 'token-1',
          visionEnabled: false,
          visionRadiusSquares: 9,
        }}
      />
    );

    expect(screen.getByTestId('lighting-diagnostics-panel')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-diagnostics-active-lights')).toHaveTextContent('1');
    expect(screen.getByTestId('lighting-diagnostics-disabled-lights')).toHaveTextContent('1');
    expect(screen.getByTestId('lighting-diagnostics-wall-counts')).toHaveTextContent('Wall 1');
    expect(screen.getByTestId('lighting-diagnostics-wall-counts')).toHaveTextContent('Door 1');
    expect(screen.getByTestId('lighting-diagnostics-wall-counts')).toHaveTextContent('Window 1');
    expect(screen.getByTestId('lighting-diagnostics-token-vision')).toHaveTextContent('Disabled, 9 squares');
  });

  test('renders nothing when hidden', () => {
    render(
      <GrigliataLightingDiagnostics
        isVisible={false}
        lights={[{ id: 'light-1', enabled: true }]}
        walls={[]}
        selectedToken={null}
      />
    );

    expect(screen.queryByTestId('lighting-diagnostics-panel')).not.toBeInTheDocument();
  });
});
