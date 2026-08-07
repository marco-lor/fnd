import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';
import { runTask07ControlledWriterUpload } from './mediaWriterAdapter';

export const isTask07MusicTrackWriterEnabled = async ({
  actorUid,
  role,
  file,
}) => Boolean(
  file
  && actorUid
  && ['dm', 'webmaster'].includes(String(role || '').trim().toLowerCase())
  && await isTask07MediaV1WriteEnabled({
    purpose: 'music',
    role,
    uid: actorUid,
  })
);

/**
 * Persists one Grigliata music source through the canonical Task 07
 * lifecycle. The caller reserves the track document before preparation and
 * owns rollback only while attachment is still definitively absent.
 */
export const runTask07MusicTrackWriter = ({
  actorUid,
  role,
  trackId,
  file,
  currentTrack = null,
  prepareEntity,
  rollbackPreparedEntity,
  signal,
}) => runTask07ControlledWriterUpload({
  actorUid,
  role,
  purpose: 'music',
  ownerUid: actorUid,
  entityId: trackId,
  kind: 'music',
  referenceScope: null,
  file,
  target: currentTrack || {},
  enabled: true,
  prepareEntity,
  rollbackPreparedEntity,
  signal,
});
