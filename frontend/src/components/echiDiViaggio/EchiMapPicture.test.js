/* eslint-disable testing-library/no-node-access, testing-library/no-container -- These request lifecycle tests inspect source elements and retired DOM nodes that have no accessible query. */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EchiMapPicture from './EchiMapPicture';

describe('EchiMapPicture request and coordinate surface', () => {
  const previousObserver = global.IntersectionObserver;
  const previousResizeObserver = global.ResizeObserver;
  let notifyIntersection;
  let disconnect;
  let observe;
  let notifyResize;
  let resizeDisconnect;
  let containerWidth;

  beforeEach(() => {
    disconnect = jest.fn();
    observe = jest.fn();
    global.IntersectionObserver = jest.fn((callback) => {
      notifyIntersection = callback;
      return { observe, disconnect };
    });
    containerWidth = 686;
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: containerWidth }));
    resizeDisconnect = jest.fn();
    global.ResizeObserver = jest.fn((callback) => {
      notifyResize = callback;
      return { observe: jest.fn(), disconnect: resizeDisconnect };
    });
  });

  afterEach(() => {
    global.IntersectionObserver = previousObserver;
    global.ResizeObserver = previousResizeObserver;
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
    const { unmount } = render(<EchiMapPicture mapId="precisa" alt="Lazy" />);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    delete global.IntersectionObserver;
    const { container } = render(<EchiMapPicture mapId="art" alt="Fallback" />);
    expect(screen.getByRole('img', { name: 'Fallback' })).toHaveAttribute('src', 'mappa_art.png');
    expect(surface(container)).toHaveAttribute('data-map-activation', 'active');
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
    expect(container.querySelector('picture img')).toBe(firstImage);
  });

  test('removes only the failed WebP source when native selection skipped unsupported AVIF', () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const image = screen.getByRole('img');
    const unsupportedAvif = container.querySelector('source[type="image/avif"]');
    Object.defineProperty(image, 'currentSrc', { value: 'https://site.test/static/media/art-2816.abc.webp' });
    fireEvent.error(image);
    expect(container.querySelector('source[type="image/webp"]')).toBeNull();
    expect(container.querySelector('source[type="image/avif"]')).toBe(unsupportedAvif);
    expect(surface(container)).toHaveAttribute('data-map-format', 'png');
  });

  test('keeps the connected picture and image through fallback without reassigning the PNG URL', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const assign = jest.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function setSource(value) {
      descriptor.set.call(this, value);
    });
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const picture = container.querySelector('picture');
    const image = screen.getByRole('img');
    for (const nextFormat of ['webp', 'png', 'error']) {
      fireEvent.error(image);
      expect(surface(container)).toHaveAttribute('data-map-format', nextFormat);
      expect(container.querySelector('picture')).toBe(picture);
      expect(picture.querySelector('img')).toBe(image);
      expect(image.isConnected).toBe(true);
    }
    expect(assign).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[src], [srcset]')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Artistica');
    expect(screen.queryByRole('img')).toBeNull();
  });

  test('decode rejection advances once and late results from the previous format cannot advance again', async () => {
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

  test.each(['avif', 'webp', 'png', 'error'])('disarms the live picture on route exit from %s', (format) => {
    const { container, unmount } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const picture = container.querySelector('picture');
    const image = screen.getByRole('img');
    const failures = { avif: 0, webp: 1, png: 2, error: 3 }[format];
    for (let attempt = 0; attempt < failures; attempt += 1) fireEvent.error(image);
    expect(surface(container)).toHaveAttribute('data-map-format', format);
    unmount();
    expect(picture.querySelector('[src], [srcset]')).toBeNull();
    expect(image.isConnected).toBe(false);
  });

  test('natively selected PNG failure ends the same picture without retrying modern formats', () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const picture = container.querySelector('picture');
    const image = screen.getByRole('img');
    Object.defineProperty(image, 'currentSrc', { value: 'https://site.test/mappa_art.abc.png' });
    fireEvent.error(image);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelector('picture')).toBe(picture);
    expect(picture.querySelector('[src], [srcset]')).toBeNull();
  });

  test('ignores repeated error events from a format that already failed on the same image', () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const image = screen.getByRole('img');
    let currentSrc = 'https://site.test/art-704.avif';
    Object.defineProperty(image, 'currentSrc', { get: () => currentSrc });
    fireEvent.error(image);
    expect(surface(container)).toHaveAttribute('data-map-format', 'webp');
    fireEvent.error(image);
    expect(surface(container)).toHaveAttribute('data-map-format', 'webp');
    currentSrc = 'https://site.test/art-704.webp';
    fireEvent.error(image);
    expect(surface(container)).toHaveAttribute('data-map-format', 'png');
    fireEvent.error(image);
    expect(surface(container)).toHaveAttribute('data-map-format', 'png');
  });

  test('ignores a late load event whose selected format has already failed', () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const image = screen.getByRole('img');
    Object.defineProperty(image, 'currentSrc', { value: 'https://site.test/art-704.avif' });
    fireEvent.error(image);
    fireEvent.load(image);
    expect(surface(container)).toHaveAttribute('data-map-format', 'webp');
    expect(surface(container)).toHaveAttribute('data-map-state', 'loading');
  });

  test('keeps terminal URLs disarmed through resizing and late resize notifications after unmount', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const assign = jest.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function setSource(value) {
      descriptor.set.call(this, value);
    });
    const { container, unmount } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const picture = container.querySelector('picture');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      fireEvent.error(screen.getByRole('img'));
    }
    const requestsBeforeResize = assign.mock.calls.length;
    for (const nextWidth of [358, 1400]) {
      containerWidth = nextWidth;
      act(notifyResize);
      expect(container.querySelector('[src], [srcset]')).toBeNull();
      expect(picture.querySelector('[src], [srcset]')).toBeNull();
    }
    unmount();
    act(() => notifyResize());
    expect(assign).toHaveBeenCalledTimes(requestsBeforeResize);
  });

  test('measures a nonzero coordinate width before installing any URL and follows shell-sized container changes', () => {
    containerWidth = 0;
    const assignments = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    jest.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function assign(value) {
      assignments.push([...this.parentNode.querySelectorAll('source')].map((source) => source.getAttribute('sizes')));
      descriptor.set.call(this, value);
    });
    const { container, unmount } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    expect(container.querySelector('[src], [srcset]')).toBeNull();
    expect(surface(container).style.aspectRatio).toBe('2816 / 1536');
    containerWidth = 686;
    act(() => notifyResize());
    const image = screen.getByRole('img');
    expect(assignments).toEqual([['686px', '686px']]);
    containerWidth = 854;
    act(() => notifyResize());
    expect(container.querySelector('source[type="image/avif"]')).toHaveAttribute('sizes', '854px');
    expect(screen.getByRole('img')).toBe(image);
    expect(assignments).toHaveLength(1);
    containerWidth = 1326;
    act(() => notifyResize());
    expect(container.querySelector('source[type="image/avif"]')).toHaveAttribute('sizes', '1326px');
    unmount();
    expect(resizeDisconnect).toHaveBeenCalled();
  });

  test('uses measured initial and resized width when ResizeObserver is unavailable', () => {
    delete global.ResizeObserver;
    const { container, unmount } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    expect(container.querySelector('source')).toHaveAttribute('sizes', '686px');
    containerWidth = 854;
    fireEvent(window, new Event('resize'));
    expect(container.querySelector('source')).toHaveAttribute('sizes', '854px');
    unmount();
    fireEvent(window, new Event('resize'));
  });

  test.each([false, true])('leaves natively skipped source sizes unchanged after PNG selection (WebP failed: %s)', (webpFailed) => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const image = screen.getByRole('img');
    let currentSrc = webpFailed ? 'https://site.test/art-704.webp' : 'https://site.test/mappa_art.png';
    Object.defineProperty(image, 'currentSrc', { get: () => currentSrc });
    if (webpFailed) fireEvent.error(image);
    currentSrc = 'https://site.test/mappa_art.png';
    fireEvent.load(image);
    containerWidth = 854;
    act(notifyResize);
    expect(container.querySelector('source[type="image/avif"]')).toHaveAttribute('sizes', '686px');
    expect(surface(container)).toHaveAttribute('data-map-state', 'loaded');
    expect(screen.getByRole('img')).toBe(image);
  });

  test('remeasures the lazy surface at activation before attaching URLs when the resize delivery is pending', () => {
    const { container } = render(<EchiMapPicture mapId="precisa" alt="Dettagliata" />);
    containerWidth = 854;
    activate();
    expect(container.querySelector('source')).toHaveAttribute('sizes', '854px');
  });

  test('waits if a queued activation arrives after the surface becomes hidden', () => {
    const { container } = render(<EchiMapPicture mapId="precisa" alt="Dettagliata" />);
    containerWidth = 0;
    activate();
    expect(container.querySelector('[src], [srcset]')).toBeNull();
    containerWidth = 320;
    act(() => notifyResize());
    expect(container.querySelector('source')).toHaveAttribute('sizes', '320px');
  });

  test('ignores a superseded candidate decode rejection on the same image node', async () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const image = screen.getByRole('img');
    let currentSrc = 'https://site.test/art-704.avif';
    Object.defineProperty(image, 'currentSrc', { get: () => currentSrc });
    let rejectFirst;
    image.decode = () => new Promise((resolve, reject) => { rejectFirst = reject; });
    fireEvent.load(image);
    currentSrc = 'https://site.test/art-1408.avif';
    image.decode = () => Promise.resolve();
    fireEvent.load(image);
    await waitFor(() => expect(surface(container)).toHaveAttribute('data-map-state', 'loaded'));
    await act(async () => rejectFirst(new Error('previous candidate cancelled')));
    expect(surface(container)).toHaveAttribute('data-map-format', 'avif');
    expect(screen.getByRole('img')).toBe(image);
    expect(surface(container)).toHaveAttribute('data-map-state', 'loaded');
  });

  test('ignores an older decode success even when the current request uses the same URL', async () => {
    const { container } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const image = screen.getByRole('img');
    Object.defineProperty(image, 'currentSrc', { value: 'https://site.test/art-704.avif' });
    const resolveDecode = [];
    image.decode = () => new Promise((resolve) => { resolveDecode.push(resolve); });
    fireEvent.load(image);
    fireEvent.load(image);
    await act(async () => resolveDecode[0]());
    expect(surface(container)).toHaveAttribute('data-map-state', 'loading');
    await act(async () => resolveDecode[1]());
    expect(surface(container)).toHaveAttribute('data-map-state', 'loaded');
  });

  test.each(['resolve', 'reject'])('ignores a pending decode %s after unmount and leaves URLs disarmed', async (settlement) => {
    const { container, unmount } = render(<EchiMapPicture mapId="art" alt="Artistica" eager />);
    const picture = container.querySelector('picture');
    let settleDecode;
    const image = screen.getByRole('img');
    image.decode = () => new Promise((resolve, reject) => { settleDecode = settlement === 'resolve' ? resolve : reject; });
    fireEvent.load(image);
    unmount();
    await act(async () => settleDecode(new Error('route exited')));
    expect(picture.querySelector('[src], [srcset]')).toBeNull();
  });
});
