import { useCallback, useEffect, useMemo, useState } from 'react';
import { UNFILED_GALLERY_FOLDER_ID } from './galleryFolders';
import { UNFILED_MUSIC_FOLDER_ID } from './musicFolders';

export const GRIGLIATA_WORKSPACE_PREFERENCES_VERSION = 1;
export const GRIGLIATA_WORKSPACE_STORAGE_PREFIX = `grigliata.workspace.v${GRIGLIATA_WORKSPACE_PREFERENCES_VERSION}`;

const MANAGER_SIDEBAR_TABS = new Set(['tokens', 'dice', 'gallery', 'music', 'calibration']);
const PLAYER_SIDEBAR_TABS = new Set(['tokens', 'dice']);

const normalizeId = (value, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

export const buildGrigliataWorkspaceStorageKey = ({
  currentUserId = '',
  isManager = false,
} = {}) => {
  const normalizedUserId = normalizeId(currentUserId);
  if (!normalizedUserId) return '';

  return `${GRIGLIATA_WORKSPACE_STORAGE_PREFIX}.${encodeURIComponent(normalizedUserId)}.${isManager ? 'manager' : 'player'}`;
};

export const buildDefaultGrigliataWorkspacePreferences = ({ isManager = false } = {}) => ({
  version: GRIGLIATA_WORKSPACE_PREFERENCES_VERSION,
  selectedGalleryFolderId: UNFILED_GALLERY_FOLDER_ID,
  selectedMusicFolderId: UNFILED_MUSIC_FOLDER_ID,
  selectedBackgroundId: '',
  activeSidebarTab: 'tokens',
  role: isManager ? 'manager' : 'player',
});

export const normalizeGrigliataWorkspacePreferences = (value, {
  isManager = false,
} = {}) => {
  const defaults = buildDefaultGrigliataWorkspacePreferences({ isManager });
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowedTabs = isManager ? MANAGER_SIDEBAR_TABS : PLAYER_SIDEBAR_TABS;
  const requestedTab = candidate.activeSidebarTab === 'lighting'
    ? 'gallery'
    : normalizeId(candidate.activeSidebarTab, defaults.activeSidebarTab);

  return {
    ...defaults,
    selectedGalleryFolderId: isManager
      ? normalizeId(candidate.selectedGalleryFolderId, UNFILED_GALLERY_FOLDER_ID)
      : UNFILED_GALLERY_FOLDER_ID,
    selectedMusicFolderId: isManager
      ? normalizeId(candidate.selectedMusicFolderId, UNFILED_MUSIC_FOLDER_ID)
      : UNFILED_MUSIC_FOLDER_ID,
    selectedBackgroundId: normalizeId(candidate.selectedBackgroundId),
    activeSidebarTab: allowedTabs.has(requestedTab) ? requestedTab : defaults.activeSidebarTab,
  };
};

const resolveStorage = (storage) => {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
};

export const readGrigliataWorkspacePreferences = ({
  currentUserId = '',
  isManager = false,
  storage = null,
} = {}) => {
  const storageKey = buildGrigliataWorkspaceStorageKey({ currentUserId, isManager });
  const fallback = buildDefaultGrigliataWorkspacePreferences({ isManager });
  const resolvedStorage = resolveStorage(storage);
  if (!storageKey || !resolvedStorage) return fallback;

  try {
    const rawValue = resolvedStorage.getItem(storageKey);
    if (!rawValue) return fallback;
    return normalizeGrigliataWorkspacePreferences(JSON.parse(rawValue), { isManager });
  } catch (error) {
    return fallback;
  }
};

export const writeGrigliataWorkspacePreferences = ({
  currentUserId = '',
  isManager = false,
  preferences = null,
  storage = null,
} = {}) => {
  const storageKey = buildGrigliataWorkspaceStorageKey({ currentUserId, isManager });
  const resolvedStorage = resolveStorage(storage);
  if (!storageKey || !resolvedStorage) return false;

  try {
    resolvedStorage.setItem(
      storageKey,
      JSON.stringify(normalizeGrigliataWorkspacePreferences(preferences, { isManager }))
    );
    return true;
  } catch (error) {
    return false;
  }
};

export default function useGrigliataWorkspacePreferences({
  currentUserId = '',
  isManager = false,
} = {}) {
  const storageKey = useMemo(() => buildGrigliataWorkspaceStorageKey({
    currentUserId,
    isManager,
  }), [currentUserId, isManager]);
  const storedPreferences = useMemo(() => readGrigliataWorkspacePreferences({
    currentUserId,
    isManager,
  }), [currentUserId, isManager]);
  const [workspaceState, setWorkspaceState] = useState({
    storageKey: '',
    preferences: null,
  });
  const preferences = workspaceState.storageKey === storageKey && workspaceState.preferences
    ? workspaceState.preferences
    : storedPreferences;

  const setPreference = useCallback((field, valueOrUpdater) => {
    if (!storageKey) return;

    setWorkspaceState((currentState) => {
      const currentPreferences = currentState.storageKey === storageKey && currentState.preferences
        ? currentState.preferences
        : storedPreferences;
      const currentValue = currentPreferences[field];
      const nextValue = typeof valueOrUpdater === 'function'
        ? valueOrUpdater(currentValue)
        : valueOrUpdater;

      return {
        storageKey,
        preferences: normalizeGrigliataWorkspacePreferences({
          ...currentPreferences,
          [field]: nextValue,
        }, { isManager }),
      };
    });
  }, [isManager, storageKey, storedPreferences]);

  useEffect(() => {
    if (!storageKey) return;

    writeGrigliataWorkspacePreferences({
      currentUserId,
      isManager,
      preferences,
    });
  }, [currentUserId, isManager, preferences, storageKey]);

  const setActiveSidebarTab = useCallback(
    (valueOrUpdater) => setPreference('activeSidebarTab', valueOrUpdater),
    [setPreference]
  );
  const setSelectedBackgroundIdPreference = useCallback(
    (valueOrUpdater) => setPreference('selectedBackgroundId', valueOrUpdater),
    [setPreference]
  );
  const setSelectedGalleryFolderId = useCallback(
    (valueOrUpdater) => setPreference('selectedGalleryFolderId', valueOrUpdater),
    [setPreference]
  );
  const setSelectedMusicFolderId = useCallback(
    (valueOrUpdater) => setPreference('selectedMusicFolderId', valueOrUpdater),
    [setPreference]
  );

  return {
    storageKey,
    preferences,
    setActiveSidebarTab,
    setSelectedBackgroundIdPreference,
    setSelectedGalleryFolderId,
    setSelectedMusicFolderId,
  };
}
