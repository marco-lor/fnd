import React, { useEffect, useRef, useState } from 'react';
import {
  resolveMediaVideoAsset,
  useResolvedMediaSource,
} from './useResolvedMediaSource';

export { resolveMediaVideoAsset };

const MediaVideo = ({
  compatibilityMode = 'auto',
  fallback = null,
  media,
  onError,
  onLoadedData,
  preload = 'metadata',
  src = '',
  ...videoProps
}) => {
  const onErrorRef = useRef(onError);
  const reportedErrorRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  onErrorRef.current = onError;
  const source = useResolvedMediaSource(media, {
    compatibilityMode,
    fallbackSrc: src,
    kind: 'video',
    variant: 'original',
  });

  useEffect(() => {
    reportedErrorRef.current = null;
    setLoaded(false);
  }, [source.assetKey]);

  useEffect(() => {
    if (source.status !== 'error' || !source.error) return;
    if (reportedErrorRef.current === source.error) return;
    reportedErrorRef.current = source.error;
    try {
      onErrorRef.current?.(source.error);
    } catch {
      // Consumer callbacks cannot interfere with private lease cleanup.
    }
  }, [source.error, source.status]);

  if (source.status === 'error' && fallback != null) return fallback;

  const mediaState = source.status === 'error'
    ? 'error'
    : (loaded ? 'loaded' : source.status);

  return (
    <video
      {...videoProps}
      src={source.url || undefined}
      preload={preload}
      data-media-state={mediaState}
      data-media-variant="original"
      onLoadedData={(event) => {
        setLoaded(true);
        onLoadedData?.(event);
      }}
      onError={(event) => {
        setLoaded(false);
        source.advanceFallback(event);
      }}
    />
  );
};

export default React.memo(MediaVideo);
