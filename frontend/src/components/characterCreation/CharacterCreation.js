// file: ./frontend/src/components/characterCreation/CharacterCreation.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthSession, useProfileState } from "../../AuthContext";
import GlobalAuroraBackground from "../backgrounds/GlobalAuroraBackground";
import {
  deleteLegacyStoragePath,
  uploadLegacyImage,
} from "../common/legacyMediaStorage";
import useObjectUrl from "../common/useObjectUrl";
import { isTask07MediaV1WriteEnabled } from '../../data/media/mediaFeatureFlags';
import { createTask07MediaOperationOwner } from '../../data/media/mediaOperationOwner';
import {
  runCharacterCreationAvatarV1Write,
  task07ProfileRevision,
} from './characterCreationAvatarMedia';
import {
  isDefinitiveUserDataCommandError,
  updateCharacterCreation,
} from '../../data/userData/userDataCommands';
import {
  beginTask08Transition,
  recordTask08Event,
} from '../../performance/task08';
import { useCharacterCreationData } from './characterCreationData';
// Import the components for each step
import RaceSelection from "./elements/RaceSelection";
import AnimaShardSelection from "./elements/AnimaShardSelection";
import PointsDistribution from "./elements/PointsDistribution";
import CharacterDetails from "./elements/CharacterDetails";

const parseStoragePathFromUrl = (url) => {
  if (!url || typeof url !== "string") {
    return "";
  }

  try {
    const encodedPath = url.split('/o/')[1]?.split('?')[0];
    return encodedPath ? decodeURIComponent(encodedPath) : "";
  } catch {
    return "";
  }
};

function CharacterCreation() {
  // Basic state
  const [currentStep, setCurrentStep] = useState(1); // Track the current step
  const [characterName, setCharacterName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [error, setError] = useState("");
  const imagePreview = useObjectUrl(imageFile);
  const [loading, setLoading] = useState(false);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [stepCommandBusy, setStepCommandBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [accountCreatedMessage, setAccountCreatedMessage] = useState("");
  
  // Selection states for different steps
  const [selectedRace, setSelectedRace] = useState(null);
  const [selectedAnima, setSelectedAnima] = useState(null);
  
  const navigate = useNavigate();
  const location = useLocation();
  const { user, repositoryAccessGeneration = 0 } = useAuthSession() || {};
  const {
    userData,
    profileUid,
    profileStatus,
  } = useProfileState() || {};
  const profileReady = Boolean(
    user
    && profileStatus === 'fresh'
    && profileUid === user.uid
  );
  const characterCreationData = useCharacterCreationData({
    uid: user?.uid,
    repositoryAccessGeneration,
    enabled: profileReady,
  });
  const sharedData = {
    codex: characterCreationData.codex,
    codexStatus: characterCreationData.codexStatus,
    codexError: characterCreationData.codexError,
    varie: characterCreationData.varie,
    varieStatus: characterCreationData.varieStatus,
    varieError: characterCreationData.varieError,
  };
  const actorOwnershipUid = profileReady ? user.uid : null;
  const [wizardActorUid, setWizardActorUid] = useState(null);
  const avatarOperationOwnerRef = useRef(null);
  const componentMountedRef = useRef(true);
  const stepCommandBusyRef = useRef(false);
  const pendingAvatarAttemptRef = useRef(null);
  const legacyUploadEntriesRef = useRef(new Set());
  const selectionMutationProofRef = useRef({
    scopeKey: null,
    race: null,
    anima: null,
  });
  const selectedRaceRef = useRef(null);
  const selectedAnimaRef = useRef(null);
  const pendingStepTransitionRef = useRef(null);
  const navigationLockRef = useRef(false);
  const navigationScopeRef = useRef(null);
  const renderedNavigationScopeRef = useRef(null);
  const previousNavigationScopeRef = useRef(null);
  const wizardActorUidRef = useRef(null);
  const hasEstablishedActorRef = useRef(false);
  const activeRevisitWindowRef = useRef(null);
  const consumedSuccessMessageRef = useRef(false);
  const pendingSuccessActorUidRef = useRef(null);
  stepCommandBusyRef.current = stepCommandBusy;
  const wizardActorReady = Boolean(
    profileReady
    && wizardActorUid
    && wizardActorUid === user?.uid
  );

  const currentNavigationScope = [
    user?.uid || '',
    profileReady ? 'owned' : 'unowned',
    repositoryAccessGeneration,
  ].join(':');
  if (renderedNavigationScopeRef.current !== currentNavigationScope) {
    previousNavigationScopeRef.current = renderedNavigationScopeRef.current;
    renderedNavigationScopeRef.current = currentNavigationScope;
    navigationScopeRef.current = currentNavigationScope;
  }
  if (selectionMutationProofRef.current.scopeKey !== currentNavigationScope) {
    selectionMutationProofRef.current = {
      scopeKey: currentNavigationScope,
      race: null,
      anima: null,
    };
  }

  const acquireNavigation = useCallback(() => {
    if (navigationLockRef.current) return false;
    const navigationToken = Symbol('character-creation-navigation');
    navigationLockRef.current = navigationToken;
    if (componentMountedRef.current) setNavigationBusy(true);
    return navigationToken;
  }, []);

  const releaseNavigation = useCallback((navigationToken = null) => {
    if (navigationToken && navigationLockRef.current !== navigationToken) return;
    navigationLockRef.current = null;
    if (componentMountedRef.current) setNavigationBusy(false);
  }, []);

  const handleStepCommandBusyChange = useCallback((busy) => {
    stepCommandBusyRef.current = Boolean(busy);
    if (componentMountedRef.current) {
      setStepCommandBusy(Boolean(busy));
    }
  }, []);

  const registerLegacyUpload = useCallback((path, ownership = {}) => {
    if (!path) return null;
    const entry = {
      path,
      committed: false,
      completionOutcomeUncertain: false,
      completionMayHaveCommitted: false,
      file: ownership.file || null,
      imageUrl: null,
      intentKey: ownership.intentKey || null,
      cleanupPromise: null,
      uploadPromise: null,
      completionPromise: null,
    };
    Object.defineProperties(entry, {
      scopeKey: {
        value: ownership.scopeKey || null,
        enumerable: true,
        writable: false,
      },
      submissionToken: {
        value: ownership.submissionToken || null,
        enumerable: true,
        writable: true,
      },
    });
    legacyUploadEntriesRef.current.add(entry);
    return entry;
  }, []);

  const commitLegacyUpload = useCallback((entry) => {
    if (!entry) return;
    entry.committed = true;
    legacyUploadEntriesRef.current.delete(entry);
  }, []);

  const cleanupLegacyUpload = useCallback((entry) => {
    if (
      !entry
      || entry.committed
      || entry.completionOutcomeUncertain
      || entry.completionMayHaveCommitted
    ) return Promise.resolve(false);
    if (!entry.cleanupPromise) {
      const ownershipPromises = [entry.uploadPromise, entry.completionPromise]
        .filter(Boolean)
        .map((promise) => Promise.resolve(promise).catch(() => undefined));
      entry.cleanupPromise = Promise.all(ownershipPromises)
        .then(() => {
          if (
            entry.committed
            || entry.completionOutcomeUncertain
            || entry.completionMayHaveCommitted
          ) return false;
          return deleteLegacyStoragePath(entry.path);
        })
        .catch((cleanupError) => {
          if (cleanupError?.code === 'storage/object-not-found') return true;
          console.warn("Character avatar rollback cleanup failed:", cleanupError);
          return false;
        })
        .finally(() => {
          if (!entry.completionOutcomeUncertain && !entry.completionMayHaveCommitted) {
            legacyUploadEntriesRef.current.delete(entry);
          }
        });
    }
    return entry.cleanupPromise;
  }, []);

  const cleanupPendingLegacyUploads = useCallback((ownership = {}) => {
    const entries = Array.from(legacyUploadEntriesRef.current).filter((entry) => (
      (ownership.scopeKey == null || entry.scopeKey === ownership.scopeKey)
      && (ownership.submissionToken == null || entry.submissionToken === ownership.submissionToken)
    ));
    return Promise.all(entries.map((entry) => cleanupLegacyUpload(entry)));
  }, [cleanupLegacyUpload]);

  const findResumableLegacyUpload = useCallback((intentKey, file) => (
    Array.from(legacyUploadEntriesRef.current).find((entry) => (
      entry.intentKey === intentKey
      && entry.file === file
      && entry.completionMayHaveCommitted
      && typeof entry.imageUrl === 'string'
      && entry.imageUrl
    )) || null
  ), []);

  const cleanupAllLegacyUploads = useCallback(() => (
    cleanupPendingLegacyUploads()
  ), [cleanupPendingLegacyUploads]);

  const closeRevisitWindow = useCallback(() => {
    const activeRevisitWindow = activeRevisitWindowRef.current;
    if (!activeRevisitWindow) return;
    recordTask08Event({
      metric: 'step-revisit-window-end',
      tags: activeRevisitWindow,
    });
    activeRevisitWindowRef.current = null;
  }, []);

  const finishOwnedTransition = useCallback((transition, outcome) => {
    if (!transition || transition.finished) return false;
    transition.finished = true;
    if (pendingStepTransitionRef.current === transition) {
      pendingStepTransitionRef.current = null;
    }
    try {
      transition.finish(outcome);
    } finally {
      releaseNavigation(transition.navigationToken);
    }
    return true;
  }, [releaseNavigation]);

  const fencePendingWork = useCallback((reason, ownedScope = currentNavigationScope) => {
    const pendingStepTransition = pendingStepTransitionRef.current;
    if (pendingStepTransition) {
      finishOwnedTransition(pendingStepTransition, 'cancelled');
    } else {
      releaseNavigation();
    }
    avatarOperationOwnerRef.current?.cancel(reason);
    pendingAvatarAttemptRef.current = null;
    void cleanupPendingLegacyUploads({ scopeKey: ownedScope });
    closeRevisitWindow();
  }, [
    cleanupPendingLegacyUploads,
    closeRevisitWindow,
    finishOwnedTransition,
    currentNavigationScope,
    releaseNavigation,
  ]);

  useEffect(() => {
    const previousScope = previousNavigationScopeRef.current;
    if (!previousScope || previousScope === currentNavigationScope) return;
    const previousUid = previousScope.split(':')[0];
    const currentUid = currentNavigationScope.split(':')[0];
    fencePendingWork(
      previousUid !== currentUid || currentNavigationScope.includes(':unowned:')
        ? 'The authenticated Character Creation account changed.'
        : 'The authenticated Character Creation repository scope changed.',
      previousScope
    );
    if (componentMountedRef.current) {
      setLoading(false);
      setError('');
    }
  }, [currentNavigationScope, fencePendingWork]);

  useEffect(() => {
    const previousActorUid = wizardActorUidRef.current;
    if (previousActorUid === actorOwnershipUid) return;
    if (previousActorUid !== null) {
      consumedSuccessMessageRef.current = true;
    }
    wizardActorUidRef.current = actorOwnershipUid;
    setWizardActorUid(actorOwnershipUid);
    setCurrentStep(1);
    setSelectedRace(null);
    setSelectedAnima(null);
    selectedRaceRef.current = null;
    selectedAnimaRef.current = null;
    selectionMutationProofRef.current = {
      scopeKey: currentNavigationScope,
      race: null,
      anima: null,
    };
    if (actorOwnershipUid) {
      const routeEmail = typeof location.state?.email === 'string'
        ? location.state.email
        : '';
      const routeBelongsToCurrentUser = !user?.email || routeEmail === user.email;
      const actorEmail = hasEstablishedActorRef.current
        ? user?.email
        : (routeBelongsToCurrentUser
          ? (routeEmail || user?.email)
          : user?.email);
      setCharacterName(
        typeof actorEmail === 'string' && actorEmail
          ? actorEmail.split('@')[0]
          : ''
      );
      hasEstablishedActorRef.current = true;
    } else {
      setCharacterName('');
    }
    setImageFile(null);
    setError('');
    setLoading(false);
    setNavigationBusy(false);
    stepCommandBusyRef.current = false;
    setStepCommandBusy(false);
    pendingAvatarAttemptRef.current = null;
    setAccountCreatedMessage('');
    if (actorOwnershipUid) {
      // Profile readiness can follow the one-time route initialization effect.
      // The actor gate already prevents stale wizard content, so do not put a
      // newly-owned route back into an initialization state that has no
      // subsequent initializer to clear it.
      setInitializing(false);
    }
  }, [actorOwnershipUid, currentNavigationScope, location.state?.email, user?.email]);

  useEffect(() => {
    componentMountedRef.current = true;
    const owner = createTask07MediaOperationOwner();
    avatarOperationOwnerRef.current = owner;
    return () => {
      componentMountedRef.current = false;
      owner.dispose('Character Creation was unmounted.');
      closeRevisitWindow();
      const pendingStepTransition = pendingStepTransitionRef.current;
      finishOwnedTransition(pendingStepTransition, 'cancelled');
      releaseNavigation();
      pendingAvatarAttemptRef.current = null;
      void cleanupAllLegacyUploads();
      recordTask08Event({
        metric: 'cleanup',
        tags: { kind: 'character-avatar-operation' },
      });
      if (avatarOperationOwnerRef.current === owner) {
        avatarOperationOwnerRef.current = null;
      }
    };
  }, [
    cleanupPendingLegacyUploads,
    cleanupAllLegacyUploads,
    closeRevisitWindow,
    finishOwnedTransition,
    releaseNavigation,
  ]);

  // Total number of steps in the character creation process
  const totalSteps = 4; // Now we have 4 steps: Race, Anima, Points Distribution, Details

  // Check if character creation is already completed
  const checkCharacterCreationStatus = useCallback(() => {
    if (
      user
      && profileReady
      && profileUid === user.uid
      && userData?.flags?.characterCreationDone === true
    ) {
      console.log("Character creation already completed, redirecting to home");
      navigate("/home");
    }
  }, [navigate, profileReady, profileUid, user, userData?.flags?.characterCreationDone]);

  // If no user is logged in, navigate to login page
  useEffect(() => {
    if (!user && !initializing) {
      navigate("/");
    } else if (user && !initializing) {
      // Check if the user has already completed character creation
      checkCharacterCreationStatus();
    }
  }, [user, navigate, initializing, checkCharacterCreationStatus]);

  useEffect(() => {
    const pendingStepTransition = pendingStepTransitionRef.current;
    if (!pendingStepTransition || pendingStepTransition.targetStep !== currentStep) return;
    finishOwnedTransition(pendingStepTransition, 'success');
  }, [currentStep, finishOwnedTransition]);

  // Initialize state based on passed data from login or user email
  useEffect(() => {
    const initializeData = async () => {
      const routeEmail = typeof location.state?.email === 'string'
        ? location.state.email
        : '';
      const routeBelongsToCurrentUser = !user?.email || routeEmail === user.email;
      const defaultEmail = !hasEstablishedActorRef.current && routeBelongsToCurrentUser
        ? (routeEmail || user?.email)
        : user?.email;
      if (!hasEstablishedActorRef.current && typeof defaultEmail === 'string' && defaultEmail) {
        setCharacterName(defaultEmail.split("@")[0]);
      }
      setInitializing(false);
    };
    initializeData();
  }, [location.state?.email, user?.email]);

  useEffect(() => {
    const routeState = location.state;
    const carriedSuccessMessage = routeState && typeof routeState === "object"
      ? routeState.successMessage
      : null;
    if (
      consumedSuccessMessageRef.current
      || typeof carriedSuccessMessage !== "string"
      || !carriedSuccessMessage
    ) {
      return;
    }

    if (user?.uid && pendingSuccessActorUidRef.current === null) {
      pendingSuccessActorUidRef.current = user.uid;
    }
    if (!profileReady || !user?.uid) return;
    if (
      pendingSuccessActorUidRef.current
      && pendingSuccessActorUidRef.current !== user.uid
    ) {
      consumedSuccessMessageRef.current = true;
      pendingSuccessActorUidRef.current = null;
      setAccountCreatedMessage("");
      const remainingState = { ...routeState };
      delete remainingState.successMessage;
      navigate(location.pathname, {
        replace: true,
        state: Object.keys(remainingState).length ? remainingState : null,
      });
      return;
    }

    consumedSuccessMessageRef.current = true;
    pendingSuccessActorUidRef.current = null;
    setAccountCreatedMessage(carriedSuccessMessage);
    const remainingState = { ...routeState };
    delete remainingState.successMessage;
    navigate(location.pathname, {
      replace: true,
      state: Object.keys(remainingState).length ? remainingState : null,
    });
  }, [location.pathname, location.state, navigate, profileReady, user?.uid]);

  // Handle image selection and preview
  const handleImageChange = useCallback((e) => {
    if (
      !componentMountedRef.current
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;
    const selectedFile = e?.target?.files?.[0] || null;
    avatarOperationOwnerRef.current?.cancel(
      'The Character Creation avatar selection changed.'
    );
    pendingAvatarAttemptRef.current = null;
    void cleanupPendingLegacyUploads({ scopeKey: currentNavigationScope });
    if (selectedFile) {
      if (typeof selectedFile.type !== 'string' || !selectedFile.type.startsWith('image/')) {
        setError("Please select a valid image file.");
        setImageFile(null); // Clear invalid file
        if (e?.target) e.target.value = '';
        return;
      }
      setImageFile(selectedFile);
    } else {
      setImageFile(null);
    }
  }, [cleanupPendingLegacyUploads, currentNavigationScope]);

  // Update selected race state when a race is selected
  const handleRaceSelect = useCallback((race) => {
    if (
      !componentMountedRef.current
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;
    if (selectedRaceRef.current?.id !== race?.id) {
      selectionMutationProofRef.current.race = null;
    }
    selectedRaceRef.current = race;
    setSelectedRace(race);
    setError(""); // Clear any errors when a race is selected
  }, []);

  // Update selected anima state when an anima shard is selected
  const handleAnimaSelect = useCallback((anima) => {
    if (
      !componentMountedRef.current
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;
    if (selectedAnimaRef.current?.name !== anima?.name) {
      selectionMutationProofRef.current.anima = null;
    }
    selectedAnimaRef.current = anima;
    setSelectedAnima(anima);
    setError(""); // Clear any errors when an anima is selected
  }, []);

  const handleCharacterNameChange = useCallback((event) => {
    if (
      !componentMountedRef.current
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;
    const nextName = typeof event === 'string' ? event : event?.target?.value;
    if (typeof nextName === 'string') setCharacterName(nextName);
  }, []);

  // Step navigation functions
  const nextStep = async () => {
    if (
      !componentMountedRef.current
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;
    const navigationScope = currentNavigationScope;

    // Validation for current step before proceeding
    if (currentStep === 1 && !selectedRace) {
      setError("Please select a race before proceeding.");
      return;
    }
    
    if (currentStep === 2 && !selectedAnima) {
      setError("Please select an Anima Shard before proceeding.");
      return;
    }

    const navigationToken = acquireNavigation();
    if (!navigationToken) return;

    const revisitWindow = activeRevisitWindowRef.current;
    if (revisitWindow && revisitWindow.toStep === currentStep) {
      recordTask08Event({
        metric: 'step-revisit-window-end',
        tags: revisitWindow,
      });
      activeRevisitWindowRef.current = null;
    }

    const fromStep = currentStep;
    const toStep = currentStep + 1;
    let finishTransition;
    try {
      finishTransition = beginTask08Transition('character-step', {
        fromStep,
        toStep,
        step: toStep,
        kind: 'forward',
      });
    } catch (err) {
      if (
        componentMountedRef.current
        && navigationScopeRef.current === navigationScope
        && navigationLockRef.current === navigationToken
      ) {
        setError("Failed to start Character Creation navigation: " + (err?.message || "Unknown error"));
      }
      releaseNavigation(navigationToken);
      return;
    }
    const pendingTransition = {
      targetStep: toStep,
      finish: finishTransition,
      navigationToken,
      finished: false,
    };
    pendingStepTransitionRef.current = pendingTransition;
    const isCurrentTransition = () => (
      componentMountedRef.current
      && navigationScopeRef.current === navigationScope
      && pendingStepTransitionRef.current === pendingTransition
      && navigationLockRef.current === navigationToken
    );

    // Persist race selection on first step
    if (currentStep === 1) {
      try {
        const race = selectedRace.id;
        if (selectionMutationProofRef.current.race !== race) {
          await updateCharacterCreation({
            action: 'selectRace',
            race,
            retryKey: `character-race:${user.uid}:${race}`,
            retryScope: `character-creation:${currentNavigationScope}:race`,
          });
        }
        if (
          !componentMountedRef.current
           || navigationScopeRef.current !== navigationScope
           || pendingStepTransitionRef.current !== pendingTransition
           || navigationLockRef.current !== navigationToken
         ) {
           finishOwnedTransition(pendingTransition, 'cancelled');
           return;
         }
        selectionMutationProofRef.current.race = race;
      } catch (err) {
        if (!isCurrentTransition()) {
          finishOwnedTransition(pendingTransition, 'cancelled');
          return;
        }
        setError("Failed to save race selection and reset parameters: " + (err?.message || "Unknown error"));
        finishOwnedTransition(pendingTransition, 'failure');
        return;
      }
    }
    // Persist Anima shard inside AltriParametri on second step
    if (currentStep === 2) {
      try {
        const anima = selectedAnima.name;
        if (selectionMutationProofRef.current.anima !== anima) {
          await updateCharacterCreation({
            action: 'selectAnima',
            anima,
            retryKey: `character-anima:${user.uid}:${anima}`,
            retryScope: `character-creation:${currentNavigationScope}:anima`,
          });
        }
        if (
          !componentMountedRef.current
           || navigationScopeRef.current !== navigationScope
           || pendingStepTransitionRef.current !== pendingTransition
           || navigationLockRef.current !== navigationToken
         ) {
           finishOwnedTransition(pendingTransition, 'cancelled');
           return;
         }
        selectionMutationProofRef.current.anima = anima;
      } catch (err) {
        if (!isCurrentTransition()) {
          finishOwnedTransition(pendingTransition, 'cancelled');
          return;
        }
        setError("Failed to save Anima Shard selection and reset parameters: " + (err?.message || "Unknown error"));
        finishOwnedTransition(pendingTransition, 'failure');
        return;
      }
    }

    if (!isCurrentTransition()) {
      finishOwnedTransition(pendingTransition, 'cancelled');
      return;
    }

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
      setError(""); // Clear any errors when moving to next step
    } else {
      finishOwnedTransition(pendingTransition, 'success');
    }
  };

  const prevStep = (event) => {
    // Browsers deliver the second click of a physical double-click after the
    // first step has committed. Its detail identifies the same click burst,
    // so the synchronous ownership guard must reject it even if React has
    // already released the first transition's lock.
    if (event?.detail > 1) return;
    if (
      !componentMountedRef.current
      || currentStep <= 1
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;
    const navigationScope = currentNavigationScope;
    const navigationToken = acquireNavigation();
    if (!navigationToken) return;

    const previousWindow = activeRevisitWindowRef.current;
    if (previousWindow) {
      recordTask08Event({
        metric: 'step-revisit-window-end',
        tags: previousWindow,
      });
    }
    const fromStep = currentStep;
    const toStep = currentStep - 1;
    const revisitWindow = { fromStep, toStep };
    activeRevisitWindowRef.current = revisitWindow;
    recordTask08Event({
      metric: 'step-revisit-window-start',
      tags: revisitWindow,
    });
    recordTask08Event({
      metric: 'step-revisit',
      tags: revisitWindow,
    });

    try {
      const finishTransition = beginTask08Transition('character-step', {
        ...revisitWindow,
        step: toStep,
        kind: 'revisit',
      });
      const pendingTransition = {
        targetStep: toStep,
        finish: finishTransition,
        navigationToken,
        finished: false,
      };
      pendingStepTransitionRef.current = pendingTransition;
      if (
        !componentMountedRef.current
        || navigationScopeRef.current !== navigationScope
        || navigationLockRef.current !== navigationToken
      ) {
        finishOwnedTransition(pendingTransition, 'cancelled');
        return;
      }
      setCurrentStep(toStep);
      setError(""); // Clear any errors when moving back
    } catch (err) {
      if (
        !componentMountedRef.current
        || navigationScopeRef.current !== navigationScope
        || navigationLockRef.current !== navigationToken
      ) {
        releaseNavigation(navigationToken);
        return;
      }
      activeRevisitWindowRef.current = previousWindow || null;
      setError("Failed to move to the previous Character Creation step: " + (err?.message || "Unknown error"));
      releaseNavigation(navigationToken);
    }
  };

  // Handle form submission to create/update character
  const handleSubmit = async (e) => {
    if (e) {
      e.preventDefault(); // Prevent default form submission
    }

    // Only proceed with final submission if we're on the last step
    if (currentStep !== totalSteps) {
      return nextStep(); // Just move to next step if not on the final step
    }

    if (
      !componentMountedRef.current
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;

    // Validations
    if (!user) { setError("No authenticated user found. Please login again."); return; }
    if (!characterName.trim()) { setError("Please enter a character name."); return; }
    if (!selectedRace) { setError("Please select a race for your character."); return; }
    if (!selectedAnima) { setError("Please select an Anima Shard for your character."); return; }

    const navigationToken = acquireNavigation();
    if (!navigationToken) return;
    const navigationScope = currentNavigationScope;

    setLoading(true);
    setError("");
    let avatarLease = null;
    let legacyUploadEntry = null;
    const isCurrentSubmission = () => (
      componentMountedRef.current
      && navigationScopeRef.current === navigationScope
      && navigationLockRef.current === navigationToken
      && (
        !avatarLease
        || typeof avatarLease.isCurrent !== 'function'
        || avatarLease.isCurrent()
      )
    );
    const cleanupSubmission = () => (
      cleanupPendingLegacyUploads({
        scopeKey: navigationScope,
        submissionToken: navigationToken,
      })
    );
    const ensureCurrentSubmission = () => {
      if (isCurrentSubmission()) return true;
      void cleanupSubmission();
      return false;
    };

    try {
      const characterBaseData = {
        characterId: characterName.trim(),
      };

      const finalizeCharacterDocument = async () => {
        if (!isCurrentSubmission()) return;
        await updateCharacterCreation({
          action: 'complete',
          ...characterBaseData,
          retryKey: `character-complete:${user.uid}:${characterBaseData.characterId}`,
          retryScope: `character-creation:${currentNavigationScope}:complete`,
        });
      };

      const actorRole = typeof userData?.role === 'string'
        ? userData.role.trim().toLowerCase()
        : 'player';
      if (imageFile) {
        const owner = avatarOperationOwnerRef.current;
        if (!owner || owner.isDisposed()) {
          if (componentMountedRef.current) setLoading(false);
          releaseNavigation(navigationToken);
          return;
        }
        avatarLease = owner.start(
          'A newer Character Creation avatar operation replaced this one.'
        );
      }
      const writesTask07Avatar = !!imageFile && await isTask07MediaV1WriteEnabled({
        purpose: 'avatar',
        role: actorRole,
        uid: user.uid,
      });
      if (!ensureCurrentSubmission()) return;

      if (writesTask07Avatar) {
        const adapter = await import(
          /* webpackChunkName: "feature-task07-media" */
          '../../data/media/mediaConsumerAdapter'
        );
        if (!ensureCurrentSubmission()) return;

        const pendingAttempt = pendingAvatarAttemptRef.current;
        const reusesPendingAttempt = pendingAttempt?.file === imageFile
          && pendingAttempt.uid === user.uid;
        const expectedRevision = reusesPendingAttempt
          ? pendingAttempt.expectedRevision
          : task07ProfileRevision(userData);
        const previousAssetId = reusesPendingAttempt
          ? pendingAttempt.previousAssetId
          : adapter.getTask07PreviousAssetId(userData);
        pendingAvatarAttemptRef.current = {
          expectedRevision,
          file: imageFile,
          previousAssetId,
          uid: user.uid,
        };

        const prepareEntity = async () => {
          await updateCharacterCreation({
            action: 'initialize',
            retryKey: `character-profile-initialize:${user.uid}`,
            retryScope: `character-creation:${currentNavigationScope}:initialize`,
          });
        };
        const rollbackPreparedEntity = async () => {};

        const outcome = await runCharacterCreationAvatarV1Write({
          actorUid: user.uid,
          expectedRevision,
          file: imageFile,
          finalizeCharacter: finalizeCharacterDocument,
          prepareEntity,
          previousAssetId,
          rollbackPreparedEntity,
          runConsumerUpload: adapter.runTask07ConsumerUpload,
          runWithReceipt: adapter.runWithTask07MediaOperationReceipt,
          signal: avatarLease.signal,
        });
        if (!ensureCurrentSubmission()) return;
        if (adapter.task07ConsumerNeedsAttention(outcome)) {
          const attention = outcome.characterFinalizationFailed
            ? 'Profile image was attached, but character completion was not saved. Select Create Character again without changing the selected image; do not upload it again.'
            : adapter.describeTask07ConsumerOutcome(outcome, 'Profile image');
          setError(attention);
          setLoading(false);
          return;
        }
        pendingAvatarAttemptRef.current = null;
        navigate("/home");
        return;
      }

      const characterUpdateData = { ...characterBaseData };
      // Preserve the legacy path for rollback modes and submissions without a
      // new avatar. V1 attachment deliberately leaves these fields untouched.
      if (imageFile) {
        const fileIdentity = [
          imageFile.name || '',
          imageFile.size || 0,
          imageFile.type || '',
          imageFile.lastModified || 0,
        ].join(':');
        const legacyIntentKey = `${navigationScope}:${characterBaseData.characterId}:${fileIdentity}`;
        const resumableEntry = findResumableLegacyUpload(legacyIntentKey, imageFile);
        if (resumableEntry) {
          legacyUploadEntry = resumableEntry;
          legacyUploadEntry.submissionToken = navigationToken;
          legacyUploadEntry.completionOutcomeUncertain = false;
          characterUpdateData.imageUrl = legacyUploadEntry.imageUrl;
          characterUpdateData.imagePath = legacyUploadEntry.path;
        } else {
          const safeFileName = `${characterName.trim().replace(/\s+/g, '_')}_${user.uid}_${Date.now()}`;
          const imagePath = `characters/${safeFileName}`;
          legacyUploadEntry = registerLegacyUpload(imagePath, {
            file: imageFile,
            intentKey: legacyIntentKey,
            scopeKey: navigationScope,
            submissionToken: navigationToken,
          });
          const uploadPromise = Promise.resolve(uploadLegacyImage(imagePath, imageFile, {
            signal: avatarLease?.signal,
          }));
          legacyUploadEntry.uploadPromise = uploadPromise;
          const { downloadUrl: imageUrl } = await uploadPromise;
          legacyUploadEntry.imageUrl = imageUrl;
          characterUpdateData.imageUrl = imageUrl;
          characterUpdateData.imagePath = imagePath;
        }
      } else if (userData?.imageUrl) {
        const existingImageUrl = userData.imageUrl;
        const existingImagePath = userData.imagePath || parseStoragePathFromUrl(existingImageUrl);
        characterUpdateData.imageUrl = existingImageUrl;
        if (existingImagePath) {
          characterUpdateData.imagePath = existingImagePath;
        }
      }

      if (!ensureCurrentSubmission()) return;

      if (legacyUploadEntry) {
        legacyUploadEntry.completionOutcomeUncertain = false;
      }
      const completionPromise = Promise.resolve(updateCharacterCreation({
        action: 'complete',
        characterId: characterBaseData.characterId,
        profile: Object.fromEntries(Object.entries(characterUpdateData)
          .filter(([key]) => key === 'imageUrl' || key === 'imagePath')),
        retryKey: `character-complete:${user.uid}:${characterBaseData.characterId}`,
        retryScope: `character-creation:${currentNavigationScope}:complete`,
      }));
      if (legacyUploadEntry) {
        // Resolve the cleanup boundary only after the authoritative metadata
        // command has settled. A stale owner must not delete an object while
        // its already-started completion command can still commit it.
        legacyUploadEntry.completionPromise = completionPromise.then(
          () => {
            commitLegacyUpload(legacyUploadEntry);
          },
          (completionError) => {
            const definitive = typeof isDefinitiveUserDataCommandError === 'function'
              && isDefinitiveUserDataCommandError(completionError);
            if (!definitive) {
              // An unavailable/ambiguous completion may already have
              // committed metadata that references this object. Keep the
              // object and its retry identity until an explicit retry settles.
              legacyUploadEntry.completionOutcomeUncertain = true;
              legacyUploadEntry.completionMayHaveCommitted = true;
            }
            throw completionError;
          }
        );
        await legacyUploadEntry.completionPromise;
      } else {
        await completionPromise;
      }
      if (!isCurrentSubmission()) return;

      pendingAvatarAttemptRef.current = null;
      navigate("/home"); // Navigate on success
    } catch (error) {
      const submissionStillOwnsWork = isCurrentSubmission();
      await cleanupSubmission();
      if (!submissionStillOwnsWork) return;
      console.error("Error in character creation/update:", error);
      if (componentMountedRef.current && navigationScopeRef.current === navigationScope) {
        setError(`Character creation failed: ${error?.message || "Unknown error"}`);
        setLoading(false); // Keep user on page to see error
      }
    } finally {
      const owner = avatarOperationOwnerRef.current;
      const cancelledWithoutReplacement = avatarLease
        && !avatarLease.isCurrent()
        && !owner?.hasActiveOperation();
      avatarLease?.release();
      if (cancelledWithoutReplacement && componentMountedRef.current) {
        setLoading(false);
      }
      releaseNavigation(navigationToken);
    }
  };

  // Handle cancel action
  const handleCancel = () => {
    if (
      !componentMountedRef.current
      || navigationLockRef.current
      || stepCommandBusyRef.current
    ) return;
    avatarOperationOwnerRef.current?.cancel(
      'Character Creation was cancelled.'
    );
    pendingAvatarAttemptRef.current = null;
    void cleanupPendingLegacyUploads({ scopeKey: currentNavigationScope });
    navigate("/");
  };

  // Progress indicator for multi-step form
  const renderProgressBar = () => (
    <div className="w-full mb-6">
      <div className="flex justify-between mb-2">
        {[...Array(totalSteps)].map((_, index) => (
          <div
            key={index}
            className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
              currentStep > index + 1
                ? "bg-green-600 text-white"
                : currentStep === index + 1
                ? "bg-blue-600 text-white border-2 border-blue-300"
                : "bg-gray-700 text-gray-400"
            }`}
          >
            {currentStep > index + 1 ? (
              // Checkmark for completed steps
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            ) : (
              // Step number
              index + 1
            )}
          </div>
        ))}
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-in-out"
          style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
        ></div>
      </div>
      <div className="flex justify-between mt-1 text-xs text-gray-400">
        <div>Race Selection</div>
        <div>Anima Shard</div>
        <div>Points Distribution</div>
        <div>Character Details</div>
      </div>
    </div>
  );

  // --- Render Logic ---

  const renderStatusPanel = (message, action = null) => (
    <div className="relative w-screen h-screen">
      <GlobalAuroraBackground density={120} />
      <div className="relative z-10 flex justify-center items-center h-full p-4">
        <div className="text-white text-xl bg-[rgba(0,0,0,0.6)] p-6 rounded text-center">
          <h1 className="text-2xl mb-4 text-[#D4AF37]">Character Creation</h1>
          <div role="status" aria-live="polite">{message}</div>
          {action}
        </div>
      </div>
    </div>
  );

  // Show initializing state
  if (initializing) {
    return (
  <div className="relative w-screen h-screen">
        <GlobalAuroraBackground density={120} />
        <div className="relative z-10 flex justify-center items-center h-full">
          <div className="text-white text-xl bg-[rgba(0,0,0,0.6)] p-4 rounded">Initializing...</div>
        </div>
      </div>
    );
  }

  if (!profileReady) {
    return renderStatusPanel(
      profileStatus === 'error' || profileStatus === 'missing'
        ? 'Character profile is unavailable. Please return to login and try again.'
        : 'Waiting for character profile...'
    );
  }

  if (!wizardActorReady) {
    return renderStatusPanel('Preparing Character Creation...');
  }

  if (currentStep === 1 && sharedData.codexStatus === 'error') {
    return renderStatusPanel(
      'Race data could not be loaded. Please retry.',
      <button
        type="button"
        onClick={characterCreationData.retryCodex}
        className="mt-4 px-6 py-3 bg-blue-700 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
      >
        Retry
      </button>
    );
  }

  if (
    currentStep === 1
    && (sharedData.codexStatus === 'idle' || sharedData.codexStatus === 'loading')
  ) {
    return renderStatusPanel('Loading race data...');
  }

  const controlsDisabled = loading || navigationBusy || stepCommandBusy;

  // Step 1: Race Selection content
  const renderStep1 = () => (
    <div className="mb-6">
      <RaceSelection 
        user={user}
        codexData={sharedData.codex}
        codexStatus={sharedData.codexStatus}
        selectedRace={selectedRace}
        onRaceSelect={handleRaceSelect}
        disabled={controlsDisabled}
      />
    </div>
  );

  // Step 2: Anima Shard Selection content
  const renderStep2 = () => (
    <div className="mb-6">
      <AnimaShardSelection 
        user={user}
        varieData={sharedData.varie}
        varieStatus={sharedData.varieStatus}
        varieError={sharedData.varieError}
        selectedAnima={selectedAnima}
        onAnimaSelect={handleAnimaSelect}
        onRetry={characterCreationData.retryVarie}
        disabled={controlsDisabled}
      />
    </div>
  );
  // Step 3: Points Distribution content
  const renderStep3 = () => (
    <div className="mb-6">
      <PointsDistribution
        varieData={sharedData.varie}
        varieStatus={sharedData.varieStatus}
        varieError={sharedData.varieError}
        onRetry={characterCreationData.retryVarie}
        disabled={controlsDisabled}
        onBusyChange={handleStepCommandBusyChange}
      />
    </div>
  );
  // Step 4: Character Details content - now using the CharacterDetails component
  const renderStep4 = () => (
    <div className="mb-6">
      <CharacterDetails 
        characterName={characterName}
        setCharacterName={handleCharacterNameChange}
        imageFile={imageFile}
        imagePreview={imagePreview}
        handleImageChange={handleImageChange}
        selectedRace={selectedRace}
        selectedAnima={selectedAnima}
        error={error}
        disabled={controlsDisabled}
      />
    </div>
  );

  // Navigation buttons based on current step
  const renderNavigationButtons = () => (
    <div className="flex flex-col sm:flex-row justify-center space-y-3 sm:space-y-0 sm:space-x-4 w-full mt-4">
      <button
        type="button"
        onClick={handleCancel}
        className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-500 transition-colors duration-300 w-full sm:w-auto sm:flex-1 sm:max-w-[200px] disabled:opacity-50"
        disabled={controlsDisabled}
        aria-busy={controlsDisabled || undefined}
      >
        Cancel
      </button>
      
      {currentStep > 1 && (
        <button
          type="button"
          onClick={prevStep}
          className="px-6 py-3 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors duration-300 w-full sm:w-auto sm:flex-1 sm:max-w-[200px] disabled:opacity-50"
          disabled={controlsDisabled}
          aria-busy={controlsDisabled || undefined}
        >
          Back
        </button>
      )}
      
      {currentStep < totalSteps ? (
        <button
          type="button" 
          onClick={nextStep}
          className="px-6 py-3 bg-blue-700 text-white rounded-md hover:bg-blue-600 transition-colors duration-300 w-full sm:w-auto sm:flex-1 sm:max-w-[200px] disabled:opacity-50"
          disabled={controlsDisabled || (currentStep === 1 && !selectedRace) || (currentStep === 2 && !selectedAnima)}
          aria-busy={controlsDisabled || undefined}
        >
          Next
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          className="px-6 py-3 bg-blue-700 text-white rounded-md hover:bg-blue-600 transition-colors duration-300 w-full sm:w-auto sm:flex-1 sm:max-w-[200px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          disabled={controlsDisabled || !selectedRace || !selectedAnima || !characterName.trim()}
          aria-busy={controlsDisabled || undefined}
        >
          {/* Show loading indicator or text */}
          {loading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating...
            </>
          ) : "Create Character"}
        </button>
      )}
    </div>
  );

  // Render dynamic content based on the current step
  const renderStepContent = () => {
    switch(currentStep) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      default:
        return <div>Unknown step</div>;
    }
  };

  // Main component JSX structure
  return (
  <div className="relative w-screen h-screen">
      <GlobalAuroraBackground density={140} />
      <div className="relative z-10 flex justify-center items-center h-full p-4">
        <div className="bg-[rgba(40,40,60,0.85)] p-6 md:p-8 rounded-[15px] text-center w-full md:w-[80%] max-w-none shadow-[0_4px_15px_rgba(100,100,200,0.2)] border border-[rgba(150,150,255,0.2)] overflow-y-auto max-h-[95vh]">
          {/* Title */}
          <h1 className="text-2xl mb-4 text-[#D4AF37]" style={{ textShadow: "0 0 8px rgba(255,215,0,0.4)" }}>
            Character Creation {currentStep > 1 && `- Step ${currentStep} of ${totalSteps}`}
          </h1>
          
          {/* Subtitle */}
          <p className="text-white mb-6 text-sm md:text-base">
            {currentStep === 1 
              ? "Welcome to Etherium! Choose a race to begin your adventure."
              : currentStep === 2
              ? "Select an Anima Shard to empower your character with special bonuses."
              : currentStep === 3
              ? "Distribute your points to define your character's abilities."
              : "Fill in your character details to bring them to life."}
          </p>

          {accountCreatedMessage && (
            <div
              data-testid="account-created-success"
              role="status"
              aria-live="polite"
              className="mb-6 rounded border border-emerald-400/40 bg-emerald-900/30 p-3 text-sm text-emerald-100"
            >
              {accountCreatedMessage}
            </div>
          )}

          {/* Progress Bar */}
          {renderProgressBar()}

          {/* Main content container */}
          <div key={wizardActorUid || 'unowned'} className="flex flex-col items-center w-full">
            {/* Dynamic step content */}
            {renderStepContent()}

            {/* Error Display Area - now only for general errors */}
            {error && (
              <div className="w-full mb-4 p-3 bg-red-900/60 border border-red-700 rounded text-white text-sm shadow-md">
                {error}
              </div>
            )}

            {/* Navigation Buttons */}
            {renderNavigationButtons()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CharacterCreation;
