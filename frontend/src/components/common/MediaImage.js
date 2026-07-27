import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  acquirePrivateMediaAsset,
  normalizePrivateMediaDescriptor,
} from './privateMediaAssets';

export const MEDIA_CONTRACT_VERSION = 1;
export const MEDIA_VARIANTS = Object.freeze(['thumbnail', 'card', 'board', 'poster']);
export const MEDIA_VARIANT_FALLBACKS = Object.freeze({
  thumbnail: Object.freeze(['thumbnail', 'poster', 'card', 'original']),
  card: Object.freeze(['card', 'thumbnail', 'poster', 'original']),
  board: Object.freeze(['board', 'original']),
  poster: Object.freeze(['poster', 'thumbnail', 'original']),
  original: Object.freeze(['original']),
});

const DEFAULT_ROOT_MARGIN = '200px';
const URL_FIELDS = ['url', 'downloadUrl', 'imageUrl', 'image_url'];

const isRecord = (value) => (
  value != null && typeof value === 'object' && !Array.isArray(value)
);

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const isAllowedImageUrl = (value) => (
  /^https?:\/\//i.test(value)
  || /^blob:/i.test(value)
  || /^data:image\//i.test(value)
  || /^\/(?!\/)/.test(value)
);

const readUrl = (value) => {
  if (typeof value === 'string') {
    const candidate = value.trim();
    return isAllowedImageUrl(candidate) ? candidate : '';
  }
  if (!isRecord(value)) return '';
  for (const field of URL_FIELDS) {
    const candidate = typeof value[field] === 'string' ? value[field].trim() : '';
    if (isAllowedImageUrl(candidate)) return candidate;
  }
  return '';
};

const normalizeDescriptor = (value) => {
  const source = isRecord(value) ? value : {};
  const privateAsset = normalizePrivateMediaDescriptor(source);
  const url = readUrl(value);
  if (!url && !privateAsset) return null;
  return {
    url,
    path: privateAsset?.path || '',
    generation: privateAsset?.generation || '',
    width: privateAsset?.width || positiveNumber(source.width ?? source.imageWidth),
    height: privateAsset?.height || positiveNumber(source.height ?? source.imageHeight),
    bytes: privateAsset?.bytes || positiveNumber(source.bytes),
    contentType: privateAsset?.contentType
      || (typeof source.contentType === 'string' ? source.contentType : ''),
    privateAsset,
  };
};

const getFallbackOrder = (variant) => {
  const normalized = typeof variant === 'string' && variant.trim()
    ? variant.trim()
    : 'thumbnail';
  return MEDIA_VARIANT_FALLBACKS[normalized]
    || [normalized, 'card', 'thumbnail', 'original'];
};

const buildSrcSet = (variants, original) => {
  const descriptors = [
    ...MEDIA_VARIANTS.map((key) => normalizeDescriptor(variants[key])),
    original,
  ].filter(Boolean);
  const byWidth = new Map();
  descriptors.forEach((descriptor) => {
    if (!descriptor.width || !descriptor.url) return;
    byWidth.set(`${descriptor.width}:${descriptor.url}`, descriptor);
  });
  return Array.from(byWidth.values())
    .sort((left, right) => left.width - right.width)
    .map((descriptor) => `${descriptor.url} ${Math.round(descriptor.width)}w`)
    .join(', ');
};

const appendDescriptorCandidates = (candidates, variant, descriptor) => {
  if (!descriptor) return;
  if (descriptor.privateAsset) {
    candidates.push({
      ...descriptor,
      url: '',
      variant,
      sourceKey: `path:${descriptor.path}:${descriptor.generation}`,
    });
  }
  if (descriptor.url) {
    candidates.push({
      ...descriptor,
      path: '',
      generation: '',
      privateAsset: null,
      variant,
      sourceKey: `url:${descriptor.url}`,
    });
  }
};

const dedupeCandidates = (candidates) => {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.sourceKey || seen.has(candidate.sourceKey)) return false;
    seen.add(candidate.sourceKey);
    return true;
  });
};

export const resolveMediaAsset = (
  mediaOrEntity,
  {
    fallbackSrc = '',
    variant = 'thumbnail',
  } = {}
) => {
  const entity = isRecord(mediaOrEntity) ? mediaOrEntity : {};
  const general = isRecord(entity.General) ? entity.General : null;
  const manifest = isRecord(entity.media)
    ? entity.media
    : (isRecord(general?.media) ? general.media : (general || entity));
  const variants = isRecord(manifest.variants) ? manifest.variants : {};
  const legacyDescriptor = normalizeDescriptor({
    url: fallbackSrc
      || readUrl(entity)
      || readUrl(general)
      || readUrl(manifest),
    width: entity.imageWidth ?? entity.width
      ?? general?.imageWidth ?? general?.width
      ?? manifest.imageWidth ?? manifest.width,
    height: entity.imageHeight ?? entity.height
      ?? general?.imageHeight ?? general?.height
      ?? manifest.imageHeight ?? manifest.height,
  });
  const original = normalizeDescriptor(manifest.original);
  const fallbackOrder = getFallbackOrder(variant);
  const collectedCandidates = [];

  for (const key of fallbackOrder) {
    const descriptor = key === 'original'
      ? original
      : normalizeDescriptor(variants[key]);
    appendDescriptorCandidates(collectedCandidates, key, descriptor);
    if (key === 'original') {
      appendDescriptorCandidates(collectedCandidates, key, legacyDescriptor);
    }
  }

  if (!fallbackOrder.includes('original')) {
    appendDescriptorCandidates(collectedCandidates, 'original', original);
    appendDescriptorCandidates(collectedCandidates, 'original', legacyDescriptor);
  }

  const candidates = dedupeCandidates(collectedCandidates);
  const responsiveOriginal = original?.url
    ? original
    : legacyDescriptor;
  const selected = candidates[0] || null;
  const placeholder = normalizeDescriptor(manifest.placeholder);
  const assetKey = JSON.stringify(candidates.map((candidate) => ({
    sourceKey: candidate.sourceKey,
    variant: candidate.variant,
    bytes: candidate.bytes || null,
    contentType: candidate.contentType || '',
  })));

  return {
    bytes: selected?.bytes || null,
    candidates,
    contentType: selected?.contentType || '',
    generation: selected?.generation || '',
    height: selected?.height || original?.height || null,
    placeholderUrl: placeholder?.url || '',
    path: selected?.path || '',
    requestedVariant: variant,
    schemaVersion: Number(manifest.schemaVersion) || null,
    selectedVariant: selected?.variant || '',
    srcSet: buildSrcSet(variants, responsiveOriginal),
    state: typeof manifest.state === 'string' ? manifest.state : 'legacy',
    url: selected?.url || '',
    width: selected?.width || original?.width || null,
    assetKey,
  };
};

export const hasMediaAsset = (mediaOrEntity, options) => (
  Boolean(resolveMediaAsset(mediaOrEntity, options).candidates.length)
);

const MediaImage = ({
  alt,
  className = '',
  decoding = 'async',
  fallback = null,
  fetchPriority,
  height,
  loading = 'lazy',
  media,
  onError,
  onLoad,
  rootMargin = DEFAULT_ROOT_MARGIN,
  sizes,
  src = '',
  style,
  variant = 'thumbnail',
  width,
  ...imageProps
}) => {
  const imageRef = useRef(null);
  const onErrorRef = useRef(onError);
  const privateLeaseRef = useRef(null);
  onErrorRef.current = onError;
  const asset = useMemo(() => resolveMediaAsset(media, {
    fallbackSrc: src,
    variant,
  }), [media, src, variant]);
  const eager = loading === 'eager' || fetchPriority === 'high';
  const [activatedAssetKey, setActivatedAssetKey] = useState('');
  const [resolvedSource, setResolvedSource] = useState(null);
  const [failure, setFailure] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [placeholderFailed, setPlaceholderFailed] = useState(false);
  const [fallbackCursor, setFallbackCursor] = useState({
    assetKey: '',
    index: 0,
  });
  const activated = eager || activatedAssetKey === asset.assetKey;
  const fallbackStartIndex = fallbackCursor.assetKey === asset.assetKey
    ? fallbackCursor.index
    : 0;

  useEffect(() => {
    setFailure(null);
    setLoaded(false);
    setResolvedSource(null);
    setPlaceholderFailed(false);
    setFallbackCursor({ assetKey: asset.assetKey, index: 0 });

    if (!asset.candidates.length) {
      setActivatedAssetKey('');
      return undefined;
    }
    if (
      eager
      || typeof IntersectionObserver === 'undefined'
      || !imageRef.current
    ) {
      setActivatedAssetKey(asset.assetKey);
      return undefined;
    }

    setActivatedAssetKey('');
    const observer = new IntersectionObserver((entries) => {
      const isWithinLoadMargin = entries.some((entry) => (
        entry.isIntersecting || entry.intersectionRatio > 0
      ));
      setActivatedAssetKey((currentAssetKey) => {
        if (isWithinLoadMargin) return asset.assetKey;
        return currentAssetKey === asset.assetKey ? '' : currentAssetKey;
      });
    }, { rootMargin });
    observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, [asset.assetKey, asset.candidates.length, eager, rootMargin]);

  useEffect(() => {
    if (!activated || !asset.candidates.length) {
      setLoaded(false);
      setResolvedSource(null);
      return undefined;
    }

    let cancelled = false;
    let currentLease = null;
    setFailure(null);
    setLoaded(false);
    setResolvedSource(null);

    const resolveCandidate = async () => {
      let lastError = null;

      for (
        let candidateIndex = fallbackStartIndex;
        candidateIndex < asset.candidates.length;
        candidateIndex += 1
      ) {
        const candidate = asset.candidates[candidateIndex];
        if (candidate.privateAsset) {
          try {
            currentLease = acquirePrivateMediaAsset(candidate.privateAsset);
            const privateResult = await currentLease.promise;
            if (cancelled) {
              currentLease.release();
              return;
            }
            privateLeaseRef.current = currentLease;
            setResolvedSource({
              candidateIndex,
              height: candidate.height,
              isPrivate: true,
              url: privateResult.url,
              variant: candidate.variant,
              width: candidate.width,
            });
            return;
          } catch (error) {
            currentLease?.release();
            currentLease = null;
            if (cancelled) return;
            lastError = error;
            continue;
          }
        }

        if (candidate.url) {
          setResolvedSource({
            candidateIndex,
            height: candidate.height,
            isPrivate: false,
            url: candidate.url,
            variant: candidate.variant,
            width: candidate.width,
          });
          return;
        }
      }

      if (!cancelled) {
        const finalError = lastError || new Error('No usable media source is available.');
        setFailure(finalError);
        try {
          onErrorRef.current?.(finalError);
        } catch {
          // Consumer error callbacks cannot break shared cache cleanup.
        }
      }
    };

    void resolveCandidate();
    return () => {
      cancelled = true;
      currentLease?.release();
      if (privateLeaseRef.current === currentLease) {
        privateLeaseRef.current = null;
      }
    };
  }, [
    activated,
    asset.assetKey,
    asset.candidates,
    fallbackStartIndex,
  ]);

  if (failure && fallback != null) return fallback;

  const requestedUrl = resolvedSource?.url || '';
  const renderedUrl = activated
    ? (requestedUrl || (!placeholderFailed ? asset.placeholderUrl : ''))
    : '';
  const renderedWidth = positiveNumber(width)
    || resolvedSource?.width
    || asset.width
    || undefined;
  const renderedHeight = positiveNumber(height)
    || resolvedSource?.height
    || asset.height
    || undefined;
  const mediaState = failure
    ? 'error'
    : (
      loaded
        ? 'loaded'
        : (activated && asset.candidates.length ? 'loading' : 'deferred')
    );
  const intrinsicStyle = renderedWidth && renderedHeight
    ? { aspectRatio: `${renderedWidth} / ${renderedHeight}` }
    : {};
  const canUseResponsiveUrlSources = Boolean(
    requestedUrl
    && !resolvedSource?.isPrivate
    && resolvedSource?.candidateIndex === 0
    && asset.srcSet
  );

  return (
    <img
      {...imageProps}
      ref={imageRef}
      src={renderedUrl || undefined}
      srcSet={canUseResponsiveUrlSources ? asset.srcSet : undefined}
      sizes={canUseResponsiveUrlSources ? sizes : undefined}
      alt={alt}
      width={renderedWidth}
      height={renderedHeight}
      loading={loading}
      decoding={decoding}
      fetchpriority={fetchPriority}
      className={className}
      style={{ ...intrinsicStyle, ...style }}
      data-media-state={mediaState}
      data-media-variant={
        resolvedSource?.variant
        || asset.selectedVariant
        || asset.requestedVariant
      }
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        if (!resolvedSource && asset.placeholderUrl) {
          setPlaceholderFailed(true);
          return;
        }

        if (resolvedSource?.isPrivate) {
          privateLeaseRef.current?.release();
          privateLeaseRef.current = null;
        }

        const nextIndex = (resolvedSource?.candidateIndex ?? -1) + 1;
        if (
          nextIndex > 0
          && nextIndex < asset.candidates.length
        ) {
          setFallbackCursor({
            assetKey: asset.assetKey,
            index: nextIndex,
          });
          return;
        }

        setFailure(event);
        onError?.(event);
      }}
    />
  );
};

export default React.memo(MediaImage);
