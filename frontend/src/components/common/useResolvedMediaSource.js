import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getTask07MediaPurpose,
  resolveMediaAsset,
} from './MediaImage';
import { retainImageAssetDrawable } from './imageAssets/imageAssetRegistry';
import {
  acquirePrivateMediaAsset,
  acquirePrivateVideoAsset,
  getPrivateMediaDrawableIdentity,
  isPrivateMediaCapacityPressureError,
  normalizePrivateVideoDescriptor,
  PRIVATE_MEDIA_CROSSFADE_PROTECTION_MS,
  subscribePrivateMediaCapacity,
} from './privateMediaAssets';
import useTask07MediaReadMode from '../../data/media/useTask07MediaReadMode';

export { PRIVATE_MEDIA_CROSSFADE_PROTECTION_MS };

const VIDEO_URL_FIELDS = [
  'url',
  'downloadUrl',
  'videoUrl',
  'video_url',
  'imageUrl',
  'image_url',
];
const DERIVATIVE_READ_MODES = new Set([
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

const isAllowedVideoUrl = (value) => (
  /^https?:\/\//i.test(value)
  || /^blob:/i.test(value)
  || /^data:video\/(?:mp4|webm)(?:;|,)/i.test(value)
  || /^\/(?!\/)/.test(value)
);

const readVideoUrl = (value) => {
  if (typeof value === 'string') {
    const candidate = value.trim();
    return isAllowedVideoUrl(candidate) ? candidate : '';
  }
  if (!isRecord(value)) return '';
  for (const field of VIDEO_URL_FIELDS) {
    const candidate = typeof value[field] === 'string'
      ? value[field].trim()
      : '';
    if (isAllowedVideoUrl(candidate)) return candidate;
  }
  return '';
};

const normalizeVideoDescriptor = (value) => {
  const source = isRecord(value) ? value : {};
  const privateAsset = normalizePrivateVideoDescriptor(source);
  const url = readVideoUrl(value);
  if (!privateAsset && !url) return null;
  return {
    url,
    path: privateAsset?.path || '',
    generation: privateAsset?.generation || '',
    bytes: privateAsset?.bytes || positiveNumber(source.bytes),
    contentType: privateAsset?.contentType
      || (typeof source.contentType === 'string' ? source.contentType : ''),
    width: privateAsset?.width || positiveNumber(source.width ?? source.imageWidth),
    height: privateAsset?.height || positiveNumber(source.height ?? source.imageHeight),
    privateAsset,
  };
};

const appendVideoCandidates = (
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

export const resolveMediaVideoAsset = (
  mediaOrEntity,
  {
    compatibilityMode = 'legacy',
    fallbackSrc = '',
  } = {}
) => {
  const entity = isRecord(mediaOrEntity) ? mediaOrEntity : {};
  const general = isRecord(entity.General) ? entity.General : null;
  const manifest = isRecord(entity.videoMedia)
    ? entity.videoMedia
    : (
      isRecord(general?.videoMedia)
        ? general.videoMedia
        : (
          isRecord(entity.media)
            ? entity.media
            : (isRecord(general?.media) ? general.media : (general || entity))
        )
    );
  const original = normalizeVideoDescriptor(manifest.original);
  const legacy = normalizeVideoDescriptor({
    url: fallbackSrc
      || readVideoUrl(entity)
      || readVideoUrl(general)
      || readVideoUrl(manifest),
    width: entity.imageWidth ?? entity.width
      ?? general?.imageWidth ?? general?.width
      ?? manifest.imageWidth ?? manifest.width,
    height: entity.imageHeight ?? entity.height
      ?? general?.imageHeight ?? general?.height
      ?? manifest.imageHeight ?? manifest.height,
  });
  const schemaVersion = Number(manifest.schemaVersion) || null;
  const state = typeof manifest.state === 'string'
    ? manifest.state.trim().toLowerCase()
    : '';
  const canonicalOnly = compatibilityMode === 'canonical-only';
  const pending = compatibilityMode === 'pending';
  const readsCanonical = schemaVersion === 1
    && state === 'ready'
    && DERIVATIVE_READ_MODES.has(compatibilityMode);
  const collectedCandidates = [];
  if (readsCanonical) {
    appendVideoCandidates(collectedCandidates, 'original', original, {
      allowUrl: !canonicalOnly,
    });
  }
  if (!canonicalOnly && !pending) {
    appendVideoCandidates(collectedCandidates, 'legacy', legacy);
    if (schemaVersion === 1 && state === 'ready' && !readsCanonical && !legacy) {
      // A v1-only video has no legacy object to restore. Rollback modes may use
      // the validated canonical original but never a poster/derivative.
      appendVideoCandidates(collectedCandidates, 'original', original);
    } else if (schemaVersion !== 1) {
      appendVideoCandidates(collectedCandidates, 'legacy', original);
    }
  }
  const candidates = dedupeCandidates(collectedCandidates);
  const selected = candidates[0] || null;
  const assetKey = JSON.stringify(candidates.map((candidate) => ({
    sourceKey: candidate.sourceKey,
    bytes: candidate.bytes || null,
    contentType: candidate.contentType || '',
  })));

  return {
    assetKey: `video:${assetKey}`,
    bytes: selected?.bytes || null,
    candidates,
    contentType: selected?.contentType || '',
    generation: selected?.generation || '',
    height: selected?.height || null,
    path: selected?.path || '',
    selectedVariant: 'original',
    url: selected?.url || '',
    width: selected?.width || null,
  };
};

export const resolveMediaSourceAsset = (
  media,
  {
    compatibilityMode = 'legacy',
    fallbackSrc = '',
    kind = 'image',
    variant = 'board',
  } = {}
) => {
  if (kind === 'video') {
    return resolveMediaVideoAsset(media, {compatibilityMode, fallbackSrc});
  }
  const asset = resolveMediaAsset(media, {
    compatibilityMode,
    fallbackSrc,
    variant,
  });
  return {
    ...asset,
    assetKey: `image:${asset.assetKey}`,
  };
};

const createSourceError = (value, fallbackMessage) => {
  if (value instanceof Error) return value;
  const error = new Error(fallbackMessage);
  if (value !== undefined) error.cause = value;
  return error;
};

const getImmediateSource = (asset, cursorIndex) => {
  const candidate = asset.candidates[cursorIndex];
  if (!candidate) {
    return {
      assetKey: asset.assetKey,
      cursorIndex,
      candidateIndex: -1,
      status: 'idle',
      error: null,
      isPrivate: false,
      sourceKey: '',
      url: '',
      variant: asset.selectedVariant || '',
      width: asset.width || null,
      height: asset.height || null,
    };
  }
  if (candidate.url) {
    return {
      assetKey: asset.assetKey,
      cursorIndex,
      candidateIndex: cursorIndex,
      status: 'ready',
      error: null,
      isPrivate: false,
      sourceKey: candidate.sourceKey,
      url: candidate.url,
      variant: candidate.variant,
      width: candidate.width || asset.width || null,
      height: candidate.height || asset.height || null,
    };
  }
  return {
    assetKey: asset.assetKey,
    cursorIndex,
    candidateIndex: cursorIndex,
    status: 'loading',
    error: null,
    isPrivate: true,
    sourceKey: candidate.sourceKey,
    url: '',
    variant: candidate.variant,
    width: candidate.width || asset.width || null,
    height: candidate.height || asset.height || null,
  };
};

const releaseLeaseHandle = (lease, delayMs = 0) => {
  lease?.release({ delayMs });
};

// Waits between capacity-pressure retries when no capacity notification wakes
// the consumer first. Retries never download: admission is checked first.
export const PRIVATE_MEDIA_CAPACITY_RETRY_DELAYS_MS = Object.freeze([
  1_000, 2_000, 5_000, 15_000, 30_000,
]);

// Identity of everything a resolution attempt reads, so a new media object with
// the same immutable candidates (e.g. a moved token) does not re-acquire.
const getAssetResolutionIdentity = (asset) => JSON.stringify([
  asset.assetKey,
  asset.selectedVariant || '',
  asset.width || null,
  asset.height || null,
  asset.candidates.map((candidate) => [
    candidate.sourceKey,
    candidate.variant || '',
    candidate.url || '',
    candidate.privateAsset || null,
    candidate.width || null,
    candidate.height || null,
  ]),
]);

export const useResolvedMediaSource = (
  media,
  {
    compatibilityMode = 'auto',
    fallbackSrc = '',
    kind = 'image',
    maxDrawableEdge = 0,
    purpose: purposeOverride = '',
    releaseDelayMs = 0,
    retryCapacityPressure = false,
    variant = 'board',
  } = {}
) => {
  const inferredPurpose = useMemo(() => {
    if (kind !== 'video') return getTask07MediaPurpose(media);
    const entity = isRecord(media) ? media : {};
    const general = isRecord(entity.General) ? entity.General : null;
    const manifest = isRecord(entity.videoMedia)
      ? entity.videoMedia
      : (
        isRecord(general?.videoMedia)
          ? general.videoMedia
          : (
            isRecord(entity.media)
              ? entity.media
              : (isRecord(general?.media) ? general.media : entity)
          )
      );
    return typeof manifest.kind === 'string' ? manifest.kind.trim() : '';
  }, [kind, media]);
  const purpose = (
    (typeof purposeOverride === 'string' ? purposeOverride.trim() : '')
    || inferredPurpose
  );
  const readerMode = useTask07MediaReadMode({
    override: compatibilityMode,
    purpose,
  });
  const resolvedAsset = useMemo(() => resolveMediaSourceAsset(media, {
    compatibilityMode: readerMode,
    fallbackSrc,
    kind,
    variant,
  }), [fallbackSrc, kind, media, readerMode, variant]);
  const assetIdentity = getAssetResolutionIdentity(resolvedAsset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const asset = useMemo(() => resolvedAsset, [assetIdentity]);
  const [cursor, setCursor] = useState({ assetKey: '', index: 0 });
  const [sourceState, setSourceState] = useState(null);
  const privateLeaseRef = useRef(null);
  const cursorIndex = cursor.assetKey === asset.assetKey ? cursor.index : 0;
  const drawableEdge = kind === 'video' ? 0 : Math.max(0, Math.floor(Number(maxDrawableEdge) || 0));
  // A source resolved for another drawable bound (e.g. a portrait resolution
  // change) is not reused: its URL may already be revoked for the new bound.
  // Memoized so an immediate (placeholder) source keeps one identity per
  // asset/cursor/edge: advanceFallback and consumer effects stay stable.
  const source = useMemo(() => (
    sourceState?.assetKey === asset.assetKey
    && sourceState.cursorIndex === cursorIndex
    && (sourceState.drawableEdge || 0) === drawableEdge
  ) ? sourceState : { ...getImmediateSource(asset, cursorIndex), drawableEdge }, [
    asset,
    cursorIndex,
    drawableEdge,
    sourceState,
  ]);

  useEffect(() => {
    let cancelled = false;
    let currentLease = null;
    let releaseReusedDrawable = null;
    let stopWaitingForCapacity = null;
    let capacityRetryCount = 0;

    if (!asset.candidates.length) {
      setSourceState({ ...getImmediateSource(asset, cursorIndex), drawableEdge });
      return undefined;
    }

    // Bounded, non-busy wait: one pending wake-up per consumer, triggered by
    // the first capacity notification or the backoff timer, whichever is first.
    const waitForCapacity = (resume) => {
      const delayMs = PRIVATE_MEDIA_CAPACITY_RETRY_DELAYS_MS[Math.min(
        PRIVATE_MEDIA_CAPACITY_RETRY_DELAYS_MS.length - 1,
        capacityRetryCount
      )];
      capacityRetryCount += 1;
      let timer = null;
      let unsubscribe = null;
      const stop = () => {
        if (stopWaitingForCapacity !== stop) return false;
        stopWaitingForCapacity = null;
        unsubscribe?.();
        clearTimeout(timer);
        return true;
      };
      const wake = () => {
        if (stop() && !cancelled) resume();
      };
      stopWaitingForCapacity = stop;
      unsubscribe = subscribePrivateMediaCapacity(wake);
      timer = setTimeout(wake, delayMs);
    };

    const resolveCandidate = async () => {
      let lastError = null;
      let pressured = false;
      for (
        let candidateIndex = cursorIndex;
        candidateIndex < asset.candidates.length;
        candidateIndex += 1
      ) {
        const candidate = asset.candidates[candidateIndex];
        if (candidate.privateAsset && drawableEdge > 0) {
          // A bounded drawable already decoded from these exact bytes, under
          // the current auth scope, needs no new download or decode even if
          // the blob it came from was evicted and its URL revoked. Anything
          // else (other scope, metadata, a failed fetch) takes the normal
          // authenticated path below, in candidate order.
          const identity = getPrivateMediaDrawableIdentity(candidate.privateAsset);
          const reused = identity
            ? retainImageAssetDrawable(identity, { maxEdge: drawableEdge })
            : null;
          if (reused) {
            releaseReusedDrawable = reused.release;
            setSourceState({
              assetKey: asset.assetKey,
              cursorIndex,
              candidateIndex,
              drawableEdge,
              status: 'ready',
              error: null,
              isPrivate: true,
              reusedDrawable: true,
              sourceKey: candidate.sourceKey,
              url: reused.src,
              variant: candidate.variant,
              width: candidate.width || asset.width || null,
              height: candidate.height || asset.height || null,
            });
            return;
          }
        }
        if (candidate.privateAsset) {
          try {
            currentLease = kind === 'video'
              ? acquirePrivateVideoAsset(candidate.privateAsset)
              : acquirePrivateMediaAsset(candidate.privateAsset, {
                maxDrawableEdge: drawableEdge,
              });
            const result = await currentLease.promise;
            if (cancelled) {
              currentLease.release();
              return;
            }
            privateLeaseRef.current = currentLease;
            setSourceState({
              assetKey: asset.assetKey,
              cursorIndex,
              candidateIndex,
              drawableEdge,
              status: 'ready',
              error: null,
              isPrivate: true,
              sourceKey: candidate.sourceKey,
              url: result.url,
              variant: candidate.variant,
              width: candidate.width || asset.width || null,
              height: candidate.height || asset.height || null,
            });
            return;
          } catch (error) {
            currentLease?.release();
            currentLease = null;
            if (cancelled) return;
            lastError = error;
            pressured = pressured || isPrivateMediaCapacityPressureError(error);
            continue;
          }
        }

        if (candidate.url) {
          setSourceState({
            assetKey: asset.assetKey,
            cursorIndex,
            candidateIndex,
            drawableEdge,
            status: 'ready',
            error: null,
            isPrivate: false,
            sourceKey: candidate.sourceKey,
            url: candidate.url,
            variant: candidate.variant,
            width: candidate.width || asset.width || null,
            height: candidate.height || asset.height || null,
          });
          return;
        }
      }

      if (cancelled) return;
      if (retryCapacityPressure && pressured) {
        // A valid candidate is only blocked by budget pressure from other
        // referenced media: keep the placeholder and retry, never settle on a
        // permanent error (there may be no legacy fallback at all).
        setSourceState({
          ...getImmediateSource(asset, cursorIndex),
          drawableEdge,
          status: 'loading',
          error: null,
          url: '',
        });
        waitForCapacity(() => {
          void resolveCandidate();
        });
        return;
      }
      setSourceState({
        ...getImmediateSource(asset, cursorIndex),
        drawableEdge,
        status: 'error',
        error: lastError || new Error('No usable media source is available.'),
        url: '',
      });
    };

    void resolveCandidate();
    return () => {
      cancelled = true;
      stopWaitingForCapacity?.();
      releaseReusedDrawable?.();
      releaseLeaseHandle(currentLease, releaseDelayMs);
      if (privateLeaseRef.current === currentLease) {
        privateLeaseRef.current = null;
      }
    };
  }, [
    asset,
    cursorIndex,
    drawableEdge,
    kind,
    releaseDelayMs,
    retryCapacityPressure,
  ]);

  // Lets a consumer that has already decoded its own drawable (e.g. a bounded
  // token portrait) return the compressed blob to the shared private budget.
  // The resolved URL stays in state; the record stays cached until evicted.
  const releasePrivateLease = useCallback(() => {
    const lease = privateLeaseRef.current;
    if (!lease) return;
    privateLeaseRef.current = null;
    lease.release();
  }, []);

  const advanceFallback = useCallback((error) => {
    const nextIndex = source.candidateIndex + 1;
    privateLeaseRef.current?.release();
    privateLeaseRef.current = null;
    if (nextIndex > 0 && nextIndex < asset.candidates.length) {
      setCursor({ assetKey: asset.assetKey, index: nextIndex });
      return true;
    }
    setSourceState({
      ...source,
      status: 'error',
      error: createSourceError(error, 'The media source failed to load.'),
      url: '',
    });
    return false;
  }, [asset.assetKey, asset.candidates.length, source]);

  return {
    ...source,
    advanceFallback,
    releasePrivateLease,
    assetKey: asset.assetKey,
    candidateCount: asset.candidates.length,
    hasFallback: source.candidateIndex + 1 < asset.candidates.length,
    selectedVariant: source.variant || asset.selectedVariant || variant,
  };
};
