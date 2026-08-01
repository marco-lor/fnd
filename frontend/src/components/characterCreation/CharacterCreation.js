// file: ./frontend/src/components/characterCreation/CharacterCreation.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../AuthContext";
import GlobalAuroraBackground from "../backgrounds/GlobalAuroraBackground";
import { uploadLegacyImage } from "../common/legacyMediaStorage";
import useObjectUrl from "../common/useObjectUrl";
import { isTask07MediaV1WriteEnabled } from '../../data/media/mediaFeatureFlags';
import { createTask07MediaOperationOwner } from '../../data/media/mediaOperationOwner';
import {
  runCharacterCreationAvatarV1Write,
  task07ProfileRevision,
} from './characterCreationAvatarMedia';
import { updateCharacterCreation } from '../../data/userData/userDataCommands';
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
  const [initializing, setInitializing] = useState(true);
  
  // Selection states for different steps
  const [selectedRace, setSelectedRace] = useState(null);
  const [selectedAnima, setSelectedAnima] = useState(null);
  
  const navigate = useNavigate();
  const location = useLocation();
  const { user, userData } = useAuth();
  const avatarOperationOwnerRef = useRef(null);
  const componentMountedRef = useRef(true);
  const pendingAvatarAttemptRef = useRef(null);

  useEffect(() => {
    componentMountedRef.current = true;
    const owner = createTask07MediaOperationOwner();
    avatarOperationOwnerRef.current = owner;
    return () => {
      componentMountedRef.current = false;
      owner.dispose('Character Creation was unmounted.');
      if (avatarOperationOwnerRef.current === owner) {
        avatarOperationOwnerRef.current = null;
      }
    };
  }, []);

  // Total number of steps in the character creation process
  const totalSteps = 4; // Now we have 4 steps: Race, Anima, Points Distribution, Details

  // Check if character creation is already completed
  const checkCharacterCreationStatus = useCallback(() => {
    if (user && userData?.flags?.characterCreationDone === true) {
      console.log("Character creation already completed, redirecting to home");
      navigate("/home");
    }
  }, [user, userData?.flags?.characterCreationDone, navigate]);

  // If no user is logged in, navigate to login page
  useEffect(() => {
    if (!user && !initializing) {
      navigate("/");
    } else if (user && !initializing) {
      // Check if the user has already completed character creation
      checkCharacterCreationStatus();
    }
  }, [user, navigate, initializing, checkCharacterCreationStatus]);

  // Initialize state based on passed data from login or user email
  useEffect(() => {
    const initializeData = async () => {
      if (location.state?.email) {
        const emailPrefix = location.state.email.split("@")[0];
        setCharacterName(emailPrefix);
      } else if (user?.email) {
        const defaultName = user.email.split("@")[0];
        setCharacterName(defaultName);
      }
      setInitializing(false);
    };
    initializeData();
  }, [location.state, user]);

  // Handle image selection and preview
  const handleImageChange = (e) => {
    const selectedFile = e.target.files[0];
    avatarOperationOwnerRef.current?.cancel(
      'The Character Creation avatar selection changed.'
    );
    pendingAvatarAttemptRef.current = null;
    if (selectedFile) {
      if (!selectedFile.type.startsWith('image/')) {
          setError("Please select a valid image file.");
          setImageFile(null); // Clear invalid file
          return;
      }
      setImageFile(selectedFile);
    } else {
        setImageFile(null);
    }
  };

  // Update selected race state when a race is selected
  const handleRaceSelect = (race) => {
    setSelectedRace(race);
    setError(""); // Clear any errors when a race is selected
  };

  // Update selected anima state when an anima shard is selected
  const handleAnimaSelect = (anima) => {
    setSelectedAnima(anima);
    setError(""); // Clear any errors when an anima is selected
  };

  // Step navigation functions
  const nextStep = async () => {
    // Validation for current step before proceeding
    if (currentStep === 1 && !selectedRace) {
      setError("Please select a race before proceeding.");
      return;
    }
    
    if (currentStep === 2 && !selectedAnima) {
      setError("Please select an Anima Shard before proceeding.");
      return;
    }

    // Persist race selection on first step
    if (currentStep === 1) {
      try {
        await updateCharacterCreation({
          action: 'selectRace',
          race: selectedRace.id,
          retryKey: `character-race:${user.uid}:${selectedRace.id}`,
        });
      } catch (err) {
        setError("Failed to save race selection and reset parameters: " + err.message);
        return;
      }
    }
    // Persist Anima shard inside AltriParametri on second step
    if (currentStep === 2) {
      try {
        await updateCharacterCreation({
          action: 'selectAnima',
          anima: selectedAnima.name,
          retryKey: `character-anima:${user.uid}:${selectedAnima.name}`,
        });
      } catch (err) {
        setError("Failed to save Anima Shard selection and reset parameters: " + err.message);
        return;
      }
    }

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
      setError(""); // Clear any errors when moving to next step
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setError(""); // Clear any errors when moving back
    }
  };

  // Handle form submission to create/update character
  const handleSubmit = async (e) => {
    if (e) {
      e.preventDefault(); // Prevent default form submission
    }

    // Only proceed with final submission if we're on the last step
    if (currentStep !== totalSteps) {
      nextStep(); // Just move to next step if not on the final step
      return;
    }

    // Validations
    if (!user) { setError("No authenticated user found. Please login again."); return; }
    if (!characterName.trim()) { setError("Please enter a character name."); return; }
    if (!selectedRace) { setError("Please select a race for your character."); return; }
    if (!selectedAnima) { setError("Please select an Anima Shard for your character."); return; }

    setLoading(true);
    setError("");
    let avatarLease = null;

    try {
      const characterBaseData = {
        characterId: characterName.trim(),
      };

      const finalizeCharacterDocument = async () => {
        await updateCharacterCreation({
          action: 'complete',
          ...characterBaseData,
          retryKey: `character-complete:${user.uid}:${characterBaseData.characterId}`,
        });
      };

      const actorRole = typeof userData?.role === 'string'
        ? userData.role.trim().toLowerCase()
        : 'player';
      if (imageFile) {
        const owner = avatarOperationOwnerRef.current;
        if (!owner || owner.isDisposed()) {
          if (componentMountedRef.current) setLoading(false);
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
      if (avatarLease && !avatarLease.isCurrent()) return;

      if (writesTask07Avatar) {
        const adapter = await import(
          /* webpackChunkName: "feature-task07-media" */
          '../../data/media/mediaConsumerAdapter'
        );
        if (!avatarLease.isCurrent()) return;

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
        if (!avatarLease.isCurrent()) return;
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

      avatarLease?.release();
      avatarLease = null;

      const characterUpdateData = { ...characterBaseData };
      // Preserve the legacy path for rollback modes and submissions without a
      // new avatar. V1 attachment deliberately leaves these fields untouched.
      if (imageFile) {
        const safeFileName = `${characterName.trim().replace(/\s+/g, '_')}_${user.uid}_${Date.now()}`;
        const imagePath = `characters/${safeFileName}`;
        const { downloadUrl: imageUrl } = await uploadLegacyImage(imagePath, imageFile);
        characterUpdateData.imageUrl = imageUrl;
        characterUpdateData.imagePath = imagePath;
      } else if (userData?.imageUrl) {
        const existingImageUrl = userData.imageUrl;
        const existingImagePath = userData.imagePath || parseStoragePathFromUrl(existingImageUrl);
        characterUpdateData.imageUrl = existingImageUrl;
        if (existingImagePath) {
          characterUpdateData.imagePath = existingImagePath;
        }
      }

      await updateCharacterCreation({
        action: 'complete',
        characterId: characterBaseData.characterId,
        profile: Object.fromEntries(Object.entries(characterUpdateData)
          .filter(([key]) => key === 'imageUrl' || key === 'imagePath')),
        retryKey: `character-complete:${user.uid}:${characterBaseData.characterId}`,
      });

      pendingAvatarAttemptRef.current = null;
      navigate("/home"); // Navigate on success
    } catch (error) {
      console.error("Error in character creation/update:", error);
      if (componentMountedRef.current) {
        if (!avatarLease || avatarLease.isCurrent()) {
          setError(`Character creation failed: ${error.message}`);
        }
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
    }
  };

  // Handle cancel action
  const handleCancel = () => {
    avatarOperationOwnerRef.current?.cancel(
      'Character Creation was cancelled.'
    );
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

  // Step 1: Race Selection content
  const renderStep1 = () => (
    <div className="mb-6">
      <RaceSelection 
        user={user}
        selectedRace={selectedRace}
        onRaceSelect={handleRaceSelect}
      />
    </div>
  );

  // Step 2: Anima Shard Selection content
  const renderStep2 = () => (
    <div className="mb-6">
      <AnimaShardSelection 
        user={user}
        selectedAnima={selectedAnima}
        onAnimaSelect={handleAnimaSelect}
      />
    </div>
  );
  // Step 3: Points Distribution content
  const renderStep3 = () => (
    <div className="mb-6">
      <PointsDistribution />
    </div>
  );
  // Step 4: Character Details content - now using the CharacterDetails component
  const renderStep4 = () => (
    <div className="mb-6">
      <CharacterDetails 
        characterName={characterName}
        setCharacterName={setCharacterName}
        imageFile={imageFile}
        imagePreview={imagePreview}
        handleImageChange={handleImageChange}
        selectedRace={selectedRace}
        selectedAnima={selectedAnima}
        error={error}
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
        disabled={loading}
      >
        Cancel
      </button>
      
      {currentStep > 1 && (
        <button
          type="button"
          onClick={prevStep}
          className="px-6 py-3 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors duration-300 w-full sm:w-auto sm:flex-1 sm:max-w-[200px] disabled:opacity-50"
          disabled={loading}
        >
          Back
        </button>
      )}
      
      {currentStep < totalSteps ? (
        <button
          type="button" 
          onClick={nextStep}
          className="px-6 py-3 bg-blue-700 text-white rounded-md hover:bg-blue-600 transition-colors duration-300 w-full sm:w-auto sm:flex-1 sm:max-w-[200px] disabled:opacity-50"
          disabled={loading || (currentStep === 1 && !selectedRace) || (currentStep === 2 && !selectedAnima)}
        >
          Next
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          className="px-6 py-3 bg-blue-700 text-white rounded-md hover:bg-blue-600 transition-colors duration-300 w-full sm:w-auto sm:flex-1 sm:max-w-[200px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          disabled={loading || !selectedRace || !selectedAnima || !characterName.trim()}
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

          {/* Progress Bar */}
          {renderProgressBar()}

          {/* Main content container */}
          <div className="flex flex-col items-center w-full">
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
