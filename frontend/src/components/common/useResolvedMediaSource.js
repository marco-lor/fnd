import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resolveMediaAsset } from './MediaImage';
import {
  acquirePrivateMediaAsset,
  acquirePrivateVideoAsset,
  normalizePrivateVideoDescriptor,
  PRIVATE_MEDIA_CROSSFADE_PROTECTION_MS,
} from './privateMediaAssets';

export { PRIVATE_MEDIA_CROSSFADE_PROTECTION_MS };

const VIDEO_URL_FIELDS = ['url', 'downloadUrl', 'imageUrl', 'image_url'];

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
  || /^data:video\/mp4(?:;|,)/i.test(value)
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

const appendVideoCandidates = (candidates, descriptor) => {
  if (!descriptor) return;
  if (descriptor.privateAsset) {
    candidates.push({
      ...descriptor,
      url: '',
      variant: 'original',
      sourceKey: `path:${descriptor.path}:${descriptor.generation}`,
    });
  }
  if (descriptor.url) {
    candidates.push({
      ...descriptor,
      path: '',
      generation: '',
      privateAsset: null,
      variant: 'original',
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
  { fallbackSrc = '' } = {}
) => {
  const entity = isRecord(mediaOrEntity) ? mediaOrEntity : {};
  const general = isRecord(entity.General) ? entity.General : null;
  const manifest = isRecord(entity.media)
    ? entity.media
    : (isRecord(general?.media) ? general.media : (general || entity));
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
  const collectedCandidates = [];
  appendVideoCandidates(collectedCandidates, original);
  appendVideoCandidates(collectedCandidates, legacy);
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
    fallbackSrc = '',
    kind = 'image',
    variant = 'board',
  } = {}
) => {
  if (kind === 'video') {
    return resolveMediaVideoAsset(media, { fallbackSrc });
  }
  const asset = resolveMediaAsset(media, { fallbackSrc, variant });
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

const releaseLease = (lease, delayMs = 0) => {
  lease?.release({ delayMs });
};

export const useResolvedMediaSource = (
  media,
  {
    fallbackSrc = '',
    kind = 'image',
    releaseDelayMs = 0,
    variant = 'board',
  } = {}
) => {
  const asset = useMemo(() => resolveMediaSourceAsset(media, {
    fallbackSrc,
    kind,
    variant,
  }), [fallbackSrc, kind, media, variant]);
  const [cursor, setCursor] = useState({ assetKey: '', index: 0 });
  const [sourceState, setSourceState] = useState(null);
  const privateLeaseRef = useRef(null);
  const cursorIndex = cursor.assetKey === asset.assetKey ? cursor.index : 0;
  const source = (
    sourceState?.assetKey === asset.assetKey
    && sourceState.cursorIndex === cursorIndex
  ) ? sourceState : getImmediateSource(asset, cursorIndex);

  useEffect(() => {
    let cancelled = false;
    let currentLease = null;
    let lastError = null;

    if (!asset.candidates.length) {
      setSourceState(getImmediateSource(asset, cursorIndex));
      return undefined;
    }

    const resolveCandidate = async () => {
      for (
        let candidateIndex = cursorIndex;
        candidateIndex < asset.candidates.length;
        candidateIndex += 1
      ) {
        const candidate = asset.candidates[candidateIndex];
        if (candidate.privateAsset) {
          try {
            currentLease = kind === 'video'
              ? acquirePrivateVideoAsset(candidate.privateAsset)
              : acquirePrivateMediaAsset(candidate.privateAsset);
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
            continue;
          }
        }

        if (candidate.url) {
          setSourceState({
            assetKey: asset.assetKey,
            cursorIndex,
            candidateIndex,
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

      if (!cancelled) {
        setSourceState({
          ...getImmediateSource(asset, cursorIndex),
          status: 'error',
          error: lastError || new Error('No usable media source is available.'),
          url: '',
        });
      }
    };

    void resolveCandidate();
    return () => {
      cancelled = true;
      releaseLease(currentLease, releaseDelayMs);
      if (privateLeaseRef.current === currentLease) {
        privateLeaseRef.current = null;
      }
    };
  }, [
    asset,
    cursorIndex,
    kind,
    releaseDelayMs,
  ]);

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
    assetKey: asset.assetKey,
    candidateCount: asset.candidates.length,
    hasFallback: source.candidateIndex + 1 < asset.candidates.length,
    selectedVariant: source.variant || asset.selectedVariant || variant,
  };
};
