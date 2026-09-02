import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { beginAsyncResourceOwner, withAsyncResourceOwner } from "./performance/runtime";
import { auth } from "./components/firebaseConfig";
import { setRepositoryActor } from "./data/repositoryRuntime";
import { buildTask07GeneratedFamilyPrefix } from "./data/media/mediaPaths";
import { subscribeAuthProfile } from "./data/userData/userDataRepository";

export const AuthContext = createContext(undefined);
const AuthSessionContext = createContext(undefined);
const ProfileStateContext = createContext(undefined);
const ShellProfileContext = createContext(undefined);

export const SHELL_CACHE_VERSION = 1;
export const SHELL_CACHE_PREFIX = "fnd.shell.v1:";
export const SHELL_CACHE_MAX_BYTES = 5 * 1024;
export const LEGACY_USER_DATA_CACHE_KEY = "userData";

export const BOOTSTRAP_V2_ENABLED = process.env.REACT_APP_FND_BOOTSTRAP_V2 !== "0";
const PLAYER_ROLE_ALIASES = new Set(["player", "players"]);
const SHELL_CACHE_KEYS = new Set([
  "version",
  "uid",
  "updatedAt",
  "role",
  "characterId",
  "race",
  "level",
  "avatarUrl",
  "avatarMedia",
]);

const getLocalStorage = () => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (_error) {
    return null;
  }
};

export const getShellCacheKey = (uid) => `${SHELL_CACHE_PREFIX}${uid}`;

const normalizeStoredRole = (role) => {
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  return PLAYER_ROLE_ALIASES.has(normalizedRole) ? "player" : normalizedRole;
};

export const normalizeUserData = (data) => {
  if (!data || typeof data !== "object") return data;

  const normalizedRole = normalizeStoredRole(data.role);
  if (normalizedRole === data.role) return data;
  return { ...data, role: normalizedRole };
};

const normalizeShellString = (value) => (
  typeof value === "string" && value.trim() ? value.trim() : null
);

const normalizeShellLevel = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeShellMediaPositiveInteger = (value) => {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
};

const SHELL_AVATAR_CONTENT_TYPE_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

const normalizeShellMediaDescriptor = (value, expectedPrefix, { variant = null } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const path = typeof value.path === "string" ? value.path.trim() : "";
  const generation = (
    typeof value.generation === "string"
    || typeof value.generation === "number"
  ) ? String(value.generation).trim() : "";
  const contentType = typeof value.contentType === "string"
    ? value.contentType.trim().toLowerCase()
    : "";
  const bytes = normalizeShellMediaPositiveInteger(value.bytes);
  const width = normalizeShellMediaPositiveInteger(value.width);
  const height = normalizeShellMediaPositiveInteger(value.height);
  const expectedPath = variant
    ? `${expectedPrefix}${variant}`
    : `${expectedPrefix}original`;
  const contentTypeIsAllowed = variant
    ? contentType === "image/webp"
    : Boolean(SHELL_AVATAR_CONTENT_TYPE_EXTENSIONS[contentType]);
  if (
    path !== expectedPath
    || !generation
    || !contentTypeIsAllowed
    || !bytes
    || !width
    || !height
  ) {
    return null;
  }
  return {
    path,
    generation,
    contentType,
    bytes,
    width,
    height,
  };
};

const normalizeShellAvatarMedia = (uid, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const assetId = typeof value.assetId === "string" ? value.assetId.trim() : "";
  if (
    value.schemaVersion !== 1
    || value.contractVersion !== 1
    || value.kind !== "avatar"
    || value.state !== "ready"
    || !/^m_[a-f0-9]{40}$/.test(assetId)
    || !/^[1-9][0-9]*$/.test(String(value.generation || ""))
    || value.audience !== "signed-in"
    || value.ownerUid !== uid
  ) {
    return null;
  }
  let expectedPrefix;
  try {
    expectedPrefix = buildTask07GeneratedFamilyPrefix({
      audience: value.audience,
      ownerKey: value.ownerUid,
      assetId,
      sourceGeneration: value.generation,
    });
  } catch (_error) {
    return null;
  }
  const original = normalizeShellMediaDescriptor(value.original, expectedPrefix);
  if (!original) return null;
  const variants = {};
  for (const variant of ["thumbnail", "thumbnail2x", "card"]) {
    if (!value.variants?.[variant]) continue;
    const descriptor = normalizeShellMediaDescriptor(
      value.variants[variant],
      expectedPrefix,
      { variant }
    );
    if (!descriptor) return null;
    variants[variant] = descriptor;
  }
  return {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind: "avatar",
    state: value.state,
    generation: String(value.generation),
    audience: value.audience,
    ownerUid: value.ownerUid,
    original,
    variants,
  };
};

export const projectShellProfile = (uid, userData) => ({
  version: SHELL_CACHE_VERSION,
  uid,
  updatedAt: Date.now(),
  role: normalizeStoredRole(userData?.role) || null,
  characterId: normalizeShellString(userData?.characterId),
  race: normalizeShellString(userData?.race),
  level: normalizeShellLevel(userData?.summary?.level),
  avatarUrl: normalizeShellString(userData?.imageUrl),
  avatarMedia: normalizeShellAvatarMedia(uid, userData?.media),
});

const sameShellProfile = (left, right) => (
  !!left
  && !!right
  && left.uid === right.uid
  && left.role === right.role
  && left.characterId === right.characterId
  && left.race === right.race
  && left.level === right.level
  && left.avatarUrl === right.avatarUrl
  && (left.avatarMedia?.assetId || null) === (right.avatarMedia?.assetId || null)
);

export const validateShellCache = (value, expectedUid) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !SHELL_CACHE_KEYS.has(key))) return null;
  if (value.version !== SHELL_CACHE_VERSION || value.uid !== expectedUid) return null;
  if (!Number.isFinite(value.updatedAt) || value.updatedAt <= 0) return null;

  const nullableStrings = ["role", "characterId", "race", "avatarUrl"];
  if (nullableStrings.some((key) => value[key] !== null && typeof value[key] !== "string")) {
    return null;
  }
  if (value.level !== null && !Number.isFinite(value.level)) return null;
  const hasAvatarMedia = Object.prototype.hasOwnProperty.call(value, "avatarMedia");
  const avatarMedia = normalizeShellAvatarMedia(expectedUid, value.avatarMedia);
  if (hasAvatarMedia && value.avatarMedia !== null && !avatarMedia) return null;
  const normalizedValue = hasAvatarMedia
    ? {
      ...value,
      avatarMedia,
    }
    : value;

  const serialized = JSON.stringify(normalizedValue);
  if (new Blob([serialized]).size >= SHELL_CACHE_MAX_BYTES) return null;
  return normalizedValue;
};

export const readShellCache = (uid, storageApi = getLocalStorage()) => {
  if (!uid || !storageApi) return null;
  const key = getShellCacheKey(uid);

  try {
    const serialized = storageApi.getItem(key);
    if (!serialized || new Blob([serialized]).size >= SHELL_CACHE_MAX_BYTES) {
      if (serialized) storageApi.removeItem(key);
      return null;
    }

    const parsed = validateShellCache(JSON.parse(serialized), uid);
    if (!parsed) storageApi.removeItem(key);
    return parsed;
  } catch (_error) {
    try {
      storageApi.removeItem(key);
    } catch (_storageError) {
      // Storage is an optional warm-start optimization.
    }
    return null;
  }
};

export const writeShellCache = (profile, storageApi = getLocalStorage()) => {
  if (!profile?.uid || !storageApi) return false;
  const validated = validateShellCache(profile, profile.uid);
  if (!validated) return false;

  const serialized = JSON.stringify(validated);
  if (new Blob([serialized]).size >= SHELL_CACHE_MAX_BYTES) return false;

  try {
    storageApi.setItem(getShellCacheKey(profile.uid), serialized);
    return true;
  } catch (_error) {
    return false;
  }
};

export const removeShellCache = (uid, storageApi = getLocalStorage()) => {
  if (!uid || !storageApi) return;
  try {
    storageApi.removeItem(getShellCacheKey(uid));
  } catch (_error) {
    // Storage is an optional warm-start optimization.
  }
};

const useRequiredContext = (context, hookName) => {
  const value = useContext(context);
  if (value === undefined) {
    throw new Error(`${hookName} must be used within AuthProvider.`);
  }
  return value;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("checking");
  const [authError, setAuthError] = useState(null);
  const [userData, setUserData] = useState(null);
  const [profileUid, setProfileUid] = useState(null);
  const [profileStatus, setProfileStatus] = useState("idle");
  const [profileError, setProfileError] = useState(null);
  const [shellState, setShellState] = useState({ profile: null, source: "none" });
  const [authAttempt, setAuthAttempt] = useState(0);
  const [authObserverRevision, setAuthObserverRevision] = useState(0);
  const [repositoryAccessGeneration, setRepositoryAccessGeneration] = useState(0);
  const userSnapshotUnsubscribe = useRef(null);
  const currentUserRef = useRef(null);
  const shellProfileRef = useRef(null);
  const userDataRef = useRef(null);
  const repositoryAccessScopeRef = useRef(null);

  const setRepositoryAccessScope = useCallback((uidOrNull, accessScope, { publish = true } = {}) => {
    const normalizedUid = uidOrNull || null;
    const nextScope = `${normalizedUid || 'anonymous'}:${accessScope}`;
    if (repositoryAccessScopeRef.current === nextScope) return;
    repositoryAccessScopeRef.current = nextScope;
    const generation = setRepositoryActor(normalizedUid);
    if (publish) setRepositoryAccessGeneration(generation);
    return generation;
  }, []);

  useEffect(() => {
    userDataRef.current = userData;
  }, [userData]);

  const clearProfileListener = useCallback(() => {
    if (userSnapshotUnsubscribe.current) {
      userSnapshotUnsubscribe.current();
      userSnapshotUnsubscribe.current = null;
    }
  }, []);

  const setShellProfile = useCallback((profile, source) => {
    shellProfileRef.current = profile;
    setShellState((previous) => {
      if (previous.source === source && sameShellProfile(previous.profile, profile)) {
        return previous;
      }
      return { profile, source };
    });
  }, []);

  const subscribeToProfile = useCallback((currentUser, { hydrateCache = false } = {}) => {
    clearProfileListener();
    setUserData(null);
    setProfileUid(null);
    setProfileError(null);

    let cachedProfile = null;
    if (hydrateCache && BOOTSTRAP_V2_ENABLED) {
      cachedProfile = readShellCache(currentUser.uid);
    }

    if (cachedProfile) {
      setShellProfile(cachedProfile, "cached");
      setProfileStatus("cached");
    } else {
      shellProfileRef.current = null;
      setShellState({ profile: null, source: "none" });
      setProfileStatus("loading");
    }

    userSnapshotUnsubscribe.current = subscribeAuthProfile(
      currentUser.uid,
      {
        next: (profileData) => {
          if (currentUserRef.current?.uid !== currentUser.uid) return;

          if (!profileData) {
            setRepositoryAccessScope(currentUser.uid, "profile-missing");
            setUserData(null);
            setProfileUid(null);
            setShellProfile(null, "none");
            setProfileStatus("missing");
            setProfileError(null);
            removeShellCache(currentUser.uid);
            return;
          }

          const nextUserData = normalizeUserData(profileData);
          setRepositoryAccessScope(
            currentUser.uid,
            `profile-role-${nextUserData?.role || 'unknown'}`
          );
          const nextShellProfile = projectShellProfile(currentUser.uid, nextUserData);
          const shellChanged = !sameShellProfile(shellProfileRef.current, nextShellProfile);

          setUserData(nextUserData);
          setProfileUid(currentUser.uid);
          setShellProfile(nextShellProfile, "fresh");
          setProfileStatus("fresh");
          setProfileError(null);
          if (shellChanged && BOOTSTRAP_V2_ENABLED) writeShellCache(nextShellProfile);
        },
        error: (error) => {
          if (currentUserRef.current?.uid !== currentUser.uid) return;
          setRepositoryAccessScope(currentUser.uid, "profile-error");
          console.error("Error fetching user data:", error);
          setUserData(null);
          setProfileUid(null);
          setProfileStatus("error");
          setProfileError(error || new Error("Unable to load the authenticated profile."));
          if (shellProfileRef.current) setShellProfile(shellProfileRef.current, "cached");
        },
      }
    );
  }, [clearProfileListener, setRepositoryAccessScope, setShellProfile]);

  useEffect(() => {
    const storageApi = getLocalStorage();
    try {
      storageApi?.removeItem(LEGACY_USER_DATA_CACHE_KEY);
    } catch (_error) {
      // Ignore localStorage failures; auth remains fully functional in memory.
    }

    setAuthStatus("checking");
    setAuthError(null);

    const releaseInitialAuthResourceOwner = beginAsyncResourceOwner("shell");
    let initialAuthOwnershipReleased = false;
    const releaseInitialAuthOwnership = () => {
      if (initialAuthOwnershipReleased) return;
      initialAuthOwnershipReleased = true;
      releaseInitialAuthResourceOwner();
    };
    let unsubscribeAuth;
    try {
      unsubscribeAuth = withAsyncResourceOwner("shell", () => onAuthStateChanged(
        auth,
        (currentUser) => withAsyncResourceOwner("shell", () => {
          setAuthObserverRevision((revision) => revision + 1);
          clearProfileListener();
          setRepositoryAccessScope(currentUser?.uid || null, "auth-transition");
          currentUserRef.current = currentUser;
          setUser(currentUser);
          setAuthError(null);

          if (!currentUser) {
            setAuthStatus("anonymous");
            setUserData(null);
            setProfileUid(null);
            setProfileStatus("idle");
            setProfileError(null);
            setShellProfile(null, "none");
            releaseInitialAuthOwnership();
            return;
          }

          setAuthStatus("authenticated");
          subscribeToProfile(currentUser, { hydrateCache: true });
          releaseInitialAuthOwnership();
        }),
        (error) => withAsyncResourceOwner("shell", () => {
          setAuthObserverRevision((revision) => revision + 1);
          clearProfileListener();
          setRepositoryAccessScope(null, "auth-error");
          currentUserRef.current = null;
          setUser(null);
          setAuthStatus("error");
          setAuthError(error || new Error("Unable to determine authentication state."));
          setUserData(null);
          setProfileUid(null);
          setProfileStatus("idle");
          setProfileError(null);
          setShellProfile(null, "none");
          releaseInitialAuthOwnership();
        })
      ));
    } catch (error) {
      releaseInitialAuthOwnership();
      throw error;
    }

    return () => {
      releaseInitialAuthOwnership();
      unsubscribeAuth?.();
      clearProfileListener();
      setRepositoryAccessScope(null, "unmounted", { publish: false });
    };
  }, [
    authAttempt,
    clearProfileListener,
    setRepositoryAccessScope,
    setShellProfile,
    subscribeToProfile,
  ]);

  const retryAuth = useCallback(() => setAuthAttempt((attempt) => attempt + 1), []);

  const retryProfile = useCallback(() => {
    if (currentUserRef.current) {
      subscribeToProfile(currentUserRef.current, { hydrateCache: false });
    }
  }, [subscribeToProfile]);

  const logout = useCallback(async () => {
    const activeUid = currentUserRef.current?.uid;
    await signOut(auth);
    if (activeUid) removeShellCache(activeUid);
  }, []);

  const getCurrentProfile = useCallback(() => userDataRef.current, []);

  const authReady = authStatus !== "checking";
  const profileFresh = profileStatus === "fresh";
  const loading = !authReady || (authStatus === "authenticated" && ![
    "fresh",
    "missing",
    "error",
  ].includes(profileStatus));

  const sessionValue = useMemo(() => ({
    user,
    authStatus,
    authReady,
    authError,
    logout,
    retryAuth,
    getCurrentProfile,
    authObserverRevision,
    repositoryAccessGeneration,
  }), [
    user,
    authStatus,
    authReady,
    authError,
    logout,
    retryAuth,
    getCurrentProfile,
    authObserverRevision,
    repositoryAccessGeneration,
  ]);

  const profileValue = useMemo(() => ({
    userData,
    profileUid,
    profileStatus,
    profileFresh,
    profileError,
    retryProfile,
  }), [userData, profileUid, profileStatus, profileFresh, profileError, retryProfile]);

  const shellValue = useMemo(() => ({
    shellProfile: shellState.profile,
    shellSource: shellState.source,
    shellProfileFresh: shellState.source === "fresh",
  }), [shellState]);

  const compatibilityValue = useMemo(() => ({
    user,
    userData,
    loading,
    authStatus,
    profileStatus,
    authReady,
    profileFresh,
    logout,
  }), [
    user,
    userData,
    loading,
    authStatus,
    profileStatus,
    authReady,
    profileFresh,
    logout,
  ]);

  return (
    <AuthSessionContext.Provider value={sessionValue}>
      <ProfileStateContext.Provider value={profileValue}>
        <ShellProfileContext.Provider value={shellValue}>
          <AuthContext.Provider value={compatibilityValue}>
            {children}
          </AuthContext.Provider>
        </ShellProfileContext.Provider>
      </ProfileStateContext.Provider>
    </AuthSessionContext.Provider>
  );
};

export const useAuth = () => useRequiredContext(AuthContext, "useAuth");
export const useOptionalAuth = () => useContext(AuthContext);
export const useAuthSession = () => useRequiredContext(AuthSessionContext, "useAuthSession");
export const useProfileState = () => useRequiredContext(ProfileStateContext, "useProfileState");
export const useShellProfile = () => useRequiredContext(ShellProfileContext, "useShellProfile");
