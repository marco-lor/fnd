import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  acquirePrivateMediaAsset,
  normalizePrivateMediaDescriptor,
} from './privateMediaAssets';
import {
  getTask07VariantCandidates,
  selectTask07VariantName,
} from '../../data/media/mediaPolicy';
import useTask07MediaReadMode from '../../data/media/useTask07MediaReadMode';

export const MEDIA_CONTRACT_VERSION = 1;
export const MEDIA_VARIANTS = Object.freeze([
  'thumbnail',
  'thumbnail2x',
  'card',
  'card2x',
  'gallery',
  'gallery2x',
  'poster',
  'poster2x',
  // Retained only for already-written candidate manifests. Active boards use original.
  'board',
]);
export const MEDIA_VARIANT_FALLBACKS = Object.freeze({
  thumbnail: Object.freeze(['thumbnail', 'thumbnail2x', 'poster', 'poster2x', 'card', 'card2x']),
  card: Object.freeze(['card', 'card2x', 'thumbnail2x', 'thumbnail', 'poster2x', 'poster']),
  gallery: Object.freeze(['gallery', 'gallery2x', 'thumbnail2x', 'thumbnail']),
  board: Object.freeze(['board', 'original']),
  poster: Object.freeze(['poster', 'poster2x', 'thumbnail2x', 'thumbnail']),
  original: Object.freeze(['original']),
});

const DEFAULT_ROOT_MARGIN = '200px';
const URL_FIELDS = ['url', 'downloadUrl', 'imageUrl', 'image_url'];
const LIST_MEDIA_VARIANTS = new Set(['thumbnail', 'card', 'gallery', 'poster']);
const DERIVATIVE_READ_STATES = new Set([
  'derivative-read',
  'v1-write',
  'canonical-only',
]);

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

const getMediaPurpose = (manifest, variants, original) => {
  const declaredKind = typeof manifest.kind === 'string' ? manifest.kind.trim() : '';
  if (declaredKind) return declaredKind;
  const path = [original, ...Object.values(variants)]
    .map((descriptor) => normalizeDescriptor(descriptor)?.path || '')
    .find(Boolean) || '';
  return path.match(/^media\/v1\/([^/]+)\//)?.[1] || '';
};

const getMediaManifest = (mediaOrEntity) => {
  const entity = isRecord(mediaOrEntity) ? mediaOrEntity : {};
  const general = isRecord(entity.General) ? entity.General : null;
  const manifest = isRecord(entity.media)
    ? entity.media
    : (isRecord(general?.media) ? general.media : (general || entity));
  return {entity, general, manifest};
};

export const getTask07MediaPurpose = (mediaOrEntity) => {
  const {manifest} = getMediaManifest(mediaOrEntity);
  const variants = isRecord(manifest.variants) ? manifest.variants : {};
  const original = normalizeDescriptor(manifest.original);
  return getMediaPurpose(manifest, variants, original);
};

const getVariantUse = (variant, purpose) => {
  if (variant === 'gallery' || (purpose === 'map' && variant !== 'original')) {
    return 'map-gallery';
  }
  return variant;
};

const getFallbackOrder = (variant, purpose) => {
  const normalized = typeof variant === 'string' && variant.trim()
    ? variant.trim()
    : 'thumbnail';
  const policyCandidates = getTask07VariantCandidates(
    purpose,
    getVariantUse(normalized, purpose)
  ).map(({ name }) => name);
  if (policyCandidates.length) return policyCandidates;
  return MEDIA_VARIANT_FALLBACKS[normalized]
    || [normalized, 'card', 'card2x', 'thumbnail', 'thumbnail2x'];
};

const buildSrcSet = (candidates) => {
  const byWidth = new Map();
  candidates.forEach((descriptor) => {
    if (
      descriptor.variant === 'legacy'
      || !descriptor.width
      || !descriptor.url
    ) return;
    byWidth.set(`${descriptor.width}:${descriptor.url}`, descriptor);
  });
  return Array.from(byWidth.values())
    .sort((left, right) => left.width - right.width)
    .map((descriptor) => `${descriptor.url} ${Math.round(descriptor.width)}w`)
    .join(', ');
};

const appendDescriptorCandidates = (
  candidates,
  variant,
  descriptor,
  { allowUrl = true } = {}
) => {
  if (!descriptor) return;
  if (descriptor.privateAsset) {
    candidates.push({
      ...descriptor,
      url: '',
      variant,
      sourceKey: `path:${descriptor.path}:${descriptor.generation}`,
    });
  }
  if (allowUrl && descriptor.url) {
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
    compatibilityMode = 'legacy',
    fallbackSrc = '',
    variant = 'thumbnail',
  } = {}
) => {
  const {entity, general, manifest} = getMediaManifest(mediaOrEntity);
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
  const purpose = getMediaPurpose(manifest, variants, original);
  const fallbackOrder = getFallbackOrder(variant, purpose);
  const schemaVersion = Number(manifest.schemaVersion) || null;
  const declaredState = typeof manifest.state === 'string'
    ? manifest.state.trim().toLowerCase()
    : '';
  const state = declaredState || 'legacy';
  const normalizedVariant = typeof variant === 'string' && variant.trim()
    ? variant.trim()
    : 'thumbnail';
  const variantUse = getVariantUse(normalizedVariant, purpose);
  const isListContract = LIST_MEDIA_VARIANTS.has(normalizedVariant)
    || variantUse === 'map-gallery';
  const canonicalOnly = compatibilityMode === 'canonical-only';
  const pending = compatibilityMode === 'pending';
  const normalizedCompatibilityMode = pending
    ? 'pending'
    : (
      DERIVATIVE_READ_STATES.has(compatibilityMode)
        ? compatibilityMode
        : 'legacy'
    );
  const canonicalReady = schemaVersion === MEDIA_CONTRACT_VERSION
    && declaredState === 'ready';
  const readsCanonical = canonicalReady
    && DERIVATIVE_READ_STATES.has(normalizedCompatibilityMode);
  const collectedCandidates = [];

  if (readsCanonical) {
    for (const key of fallbackOrder) {
      if (key === 'original' && isListContract) continue;
      const descriptor = key === 'original'
        ? original
        : normalizeDescriptor(variants[key]);
      appendDescriptorCandidates(collectedCandidates, key, descriptor, {
        allowUrl: !canonicalOnly,
      });
    }
  }

  if (!canonicalOnly && !pending) {
    // A versionless original URL is part of the old contract. A schema-v1
    // original is not: legacy/shadow readers may use only the preserved legacy
    // URL fields, while allowlisted derivative readers may use verified v1
    // descriptors and then fall back to that old URL.
    appendDescriptorCandidates(collectedCandidates, 'legacy', legacyDescriptor);
    if (canonicalReady && !readsCanonical && !legacyDescriptor) {
      // Emergency rollback for media created after v1 writes were enabled: no
      // legacy object exists, so legacy/shadow mode may read only the verified
      // canonical original (never a derivative). Existing entities continue to
      // prefer their preserved legacy reference and avoid behavior drift.
      appendDescriptorCandidates(collectedCandidates, 'original', original);
    } else if (schemaVersion !== MEDIA_CONTRACT_VERSION) {
      appendDescriptorCandidates(collectedCandidates, 'legacy', original);
    }
  }

  const candidates = dedupeCandidates(collectedCandidates);
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
    placeholderUrl: canonicalOnly ? '' : (placeholder?.url || ''),
    path: selected?.path || '',
    purpose,
    requestedVariant: normalizedVariant,
    schemaVersion,
    compatibilityMode: normalizedCompatibilityMode,
    selectedVariant: selected?.variant || '',
    srcSet: buildSrcSet(candidates),
    state,
    url: selected?.url || '',
    variantUse,
    width: selected?.width || original?.width || null,
    assetKey,
  };
};

const orderPrivateCandidatesForRenderedSize = (asset, renderedWidth) => {
  if (
    !LIST_MEDIA_VARIANTS.has(asset.requestedVariant)
    && asset.variantUse !== 'map-gallery'
  ) return asset.candidates;
  const privateCandidates = asset.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.privateAsset && candidate.variant !== 'original');
  if (privateCandidates.length < 2) return asset.candidates;

  const devicePixelRatio = typeof window !== 'undefined'
    ? Number(window.devicePixelRatio) || 1
    : 1;
  const selectedVariant = selectTask07VariantName({
    purpose: asset.purpose,
    use: asset.variantUse,
    renderedWidth,
    devicePixelRatio,
  });
  const targetWidth = (positiveNumber(renderedWidth) || privateCandidates[0].candidate.width || 1)
    * Math.min(2, Math.max(1, devicePixelRatio));
  const selected = privateCandidates.find(({ candidate }) => candidate.variant === selectedVariant)
    || privateCandidates
      .filter(({ candidate }) => positiveNumber(candidate.width))
      .sort((left, right) => left.candidate.width - right.candidate.width)
      .find(({ candidate }) => candidate.width >= targetWidth)
    || privateCandidates[privateCandidates.length - 1];

  return [
    selected.candidate,
    ...asset.candidates.filter((_candidate, index) => index !== selected.index),
  ];
};

export const hasMediaAsset = (mediaOrEntity, options) => (
  Boolean(
    resolveMediaAsset(mediaOrEntity, options).candidates.length
    || (
      (!options?.compatibilityMode || options.compatibilityMode === 'auto')
      && resolveMediaAsset(mediaOrEntity, {
        ...options,
        compatibilityMode: 'derivative-read',
      }).candidates.length
    )
  )
);

const MediaImage = ({
  alt,
  className = '',
  compatibilityMode = 'auto',
  decoding = 'async',
  fallback = null,
  fetchPriority,
  height,
  loading = 'lazy',
  media,
  mediaPurpose = '',
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
  const purpose = useMemo(() => (
    (typeof mediaPurpose === 'string' ? mediaPurpose.trim() : '')
    || getTask07MediaPurpose(media)
  ), [media, mediaPurpose]);
  const readerMode = useTask07MediaReadMode({
    override: compatibilityMode,
    purpose,
  });
  const asset = useMemo(() => resolveMediaAsset(media, {
    compatibilityMode: readerMode,
    fallbackSrc: src,
    variant,
  }), [media, readerMode, src, variant]);
  const assetRef = useRef(asset);
  assetRef.current = asset;
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
    const currentAsset = assetRef.current;
    if (!activated || !currentAsset.candidates.length) {
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
      const measuredWidth = positiveNumber(imageRef.current?.getBoundingClientRect?.().width)
        || positiveNumber(width)
        || currentAsset.width;
      const orderedCandidates = orderPrivateCandidatesForRenderedSize(currentAsset, measuredWidth);

      for (
        let candidateIndex = fallbackStartIndex;
        candidateIndex < orderedCandidates.length;
        candidateIndex += 1
      ) {
        const candidate = orderedCandidates[candidateIndex];
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
    fallbackStartIndex,
    width,
  ]);

  if (failure && fallback != null) return fallback;
  if (readerMode !== 'pending' && !asset.candidates.length && fallback != null) {
    return fallback;
  }

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
