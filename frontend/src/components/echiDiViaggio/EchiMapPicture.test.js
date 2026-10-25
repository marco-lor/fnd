import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EchiMapPicture from './EchiMapPicture';

describe('EchiMapPicture request and coordinate surface', () => {
  const previousObserver = global.IntersectionObserver;
  let notifyIntersection;
  let disconnect;
  let observe;

  beforeEach(() => {
    disconnect = jest.fn();
    observe = jest.fn();
    global.IntersectionObserver = jest.fn((callback) => {
      notifyIntersection = callback;
      return { observe, disconnect };
    });
  });

  afterEach(() => {
    global.IntersectionObserver = previousObserver;
    jest.restoreAllMocks();
  });

  const surface = (container) => container.querySelector('[data-echi-map]');
  const activate = () => act(() => notifyIntersection([{ isIntersecting: true }]));

  test('eager map connects complete picture sources before assigning PNG fallback', () => {
    const assignments = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    jest.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function assign(value) {
      assignments.push({ connected: this.isConnected, types: [...this.parentNode.children].map((node) => node.type), value });
      descriptor.set.call(this, value);
    });
    const { container } = render(<EchiMapPicture mapId="art" alt="Mappa Artistica" eager />);
    const image = screen.getByRole('img', { name: 'Mappa Artistica' });
    expect(container.querySelector('source[type="image/avif"]')).toHaveAttribute('srcset', expect.stringContaining('704w'));
    expect(container.querySelector('source[type="image/webp"]')).toHaveAttribute('srcset', expect.stringContaining('2816w'));
    expect(image).toHaveAttribute('fetchpriority', 'high');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(image).toHaveAttribute('width', '2816');
    expect(image).toHaveAttribute('height', '1536');
    expect(assignments).toEqual([{ connected: true, types: ['image/avif', 'image/webp', undefined], value: 'mappa_art.png' }]);
    expect(surface(container)).toHaveAttribute('data-map-activation', 'active');
  });

  test('lazy map reserves exact geometry and overlays without URLs until its 320px observer activates once', () => {
    const drop = jest.fn();
    const { container, rerender } = render(
      <EchiMapPicture mapId="precisa" alt="Mappa Dettagliata" onDrop={drop}>
        <button style={{ position: 'absolute', left: '50%', top: '25%' }}>Marker</button>
      </EchiMapPicture>
    );
    const coordinates = surface(container);
    expect(coordinates.style.aspectRatio).toBe('2752 / 1536');
    expect(container.querySelector('[src], [srcset]')).toBeNull();
    expect(global.IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), { rootMargin: '320px 0px', threshold: 0 });
    expect(observe).toHaveBeenCalledWith(coordinates);
    fireEvent.drop(screen.getByRole('button', { name: 'Marker' }));
    expect(drop).toHaveBeenCalledTimes(1);
    act(() => notifyIntersection([{ isIntersecting: false }]));
    expect(container.querySelector('[src], [srcset]')).toBeNull();
    activate();
    expect(screen.getByRole('img', { name: 'Mappa Dettagliata' })).toHaveAttribute('src', 'mappa_precisa.png');
    expect(disconnect).toHaveBeenCalled();
    act(() => notifyIntersection([{ isIntersecting: false }]));
    rerender(<EchiMapPicture mapId="precisa" alt="Mappa Dettagliata"><button>Marker</button></EchiMapPicture>);
    expect(surface(container)).toBe(coordinates);
    expect(container.querySelector('picture')).not.toBeNull();
  });

  test('activates when IntersectionObserver is unavailable and cleans an inactive observer on unmount', () => {
    const lazy = render(<EchiMapPicture mapId="precisa" alt="Lazy" />);
    lazy.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    delete global.IntersectionObserver;
    const fallback = render(<EchiMapPicture mapId="art" alt="Fallback" />);
    expect(screen.getByRole('img', { name: 'Fallback' })).toHaveAttribute('src', 'mappa_art.png');
    expect(surface(fallback.container)).toHaveAttribute('data-map-activation', 'active');
  });

  test('advances AVIF then WebP then PNG then accessible terminal error without changing coordinates or overlays', () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager><button>Pin</button></EchiMapPicture>);
    const coordinates = surface(container);
    const firstImage = screen.getByRole('img');
    fireEvent.error(firstImage);
    expect(container.querySelector('source[type="image/avif"]')).toBeNull();
    expect(container.querySelector('source[type="image/webp"]')).not.toBeNull();
    fireEvent.error(screen.getByRole('img'));
    expect(container.querySelector('source')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'mappa_art.png');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('alert')).toHaveTextContent('Artistica');
    expect(container.querySelector('[src], [srcset]')).toBeNull();
    expect(surface(container)).toBe(coordinates);
    expect(coordinates.style.aspectRatio).toBe('2816 / 1536');
    expect(screen.getByRole('button', { name: 'Pin' })).toBeInTheDocument();
    fireEvent.error(firstImage);
    expect(container.querySelector('picture')).toBeNull();
  });

  test('skips an already failed WebP chosen natively when AVIF is unsupported', () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const image = screen.getByRole('img');
    Object.defineProperty(image, 'currentSrc', { value: 'https://site.test/static/media/art-2816.abc.webp' });
    fireEvent.error(image);
    expect(container.querySelector('source')).toBeNull();
    expect(surface(container)).toHaveAttribute('data-map-format', 'png');
  });

  test('decode rejection advances once and late results from an old image cannot advance a new attempt', async () => {
    const { container, unmount } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    let rejectDecode;
    const image = screen.getByRole('img');
    image.decode = () => new Promise((resolve, reject) => { rejectDecode = reject; });
    fireEvent.load(image);
    fireEvent.error(image);
    await act(async () => rejectDecode(new Error('decode failed')));
    expect(surface(container)).toHaveAttribute('data-map-format', 'webp');
    const webp = screen.getByRole('img');
    webp.decode = () => Promise.reject(new Error('bad webp'));
    fireEvent.load(webp);
    await waitFor(() => expect(surface(container)).toHaveAttribute('data-map-format', 'png'));
    const png = screen.getByRole('img');
    png.decode = () => Promise.resolve();
    fireEvent.load(png);
    await waitFor(() => expect(surface(container)).toHaveAttribute('data-map-state', 'loaded'));
    unmount();
  });
});
