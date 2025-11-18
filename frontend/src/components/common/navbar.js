// file: ./frontend/src/components/common/navbar.js
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
import { HiMagnifyingGlassPlus } from 'react-icons/hi2';
import { LuImageUp } from 'react-icons/lu';
import { storage, db } from '../firebaseConfig';
import { ref as storageRef, deleteObject, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import NavParticleEffect from './effects/NavParticleEffect';

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, userData } = useAuth();
  
  // Loading state for logout operations
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const isActive = (path) => location.pathname === path;

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await signOut(auth);
      // AuthContext will handle clearing localStorage and state
      navigate("/");
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Rendering profile info based on userData from AuthContext
  const renderProfileInfo = () => {
    if (!userData) {
      return (
        <>
          <div className="w-20 h-20 rounded-full bg-gray-600 animate-pulse mr-3"></div>
          <div className="flex flex-col">
            <div className="h-6 w-32 bg-gray-600 animate-pulse rounded mb-1"></div>
            <div className="h-4 w-24 bg-gray-600 animate-pulse rounded"></div>
          </div>
        </>
      );
    }

    return (
      <>
        {userData.imageUrl ? (
          <div className="relative mr-3 group">
            {/* level badge outside circle to avoid clipping */}
            {userData?.stats?.level && (
              <div className="absolute bottom-0 left-0 bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm border-2 border-white">
                {userData.stats.level}
              </div>
            )}
            <div className="overflow-hidden rounded-full">
              <img
                src={userData.imageUrl}
                alt="Character Avatar"
                className="w-20 h-20 rounded-full object-cover border-2 border-white"
              />
              <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex rounded-full">
                <div
                  onClick={() => setIsPreviewOpen(true)}
                  className="w-1/2 flex justify-center items-center cursor-pointer"
                >
                  <HiMagnifyingGlassPlus className="text-white text-2xl" />
                </div>
                <div
                  onClick={() => setIsUploadOpen(true)}
                  className="w-1/2 flex justify-center items-center cursor-pointer"
                >
                  <LuImageUp className="text-white text-2xl" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative mr-3 group">
            <div className="overflow-hidden rounded-full">
              <div className="w-20 h-20 rounded-full bg-gray-500 flex items-center justify-center text-white text-xs border-2 border-white">
                No Img
              </div>
              <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex rounded-full">
                <div className="w-1/2 flex justify-center items-center">
                  <HiMagnifyingGlassPlus className="text-white text-2xl" />
                </div>
                <div className="w-1/2 flex justify-center items-center">
                  <LuImageUp className="text-white text-2xl" />
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col">
          <h1 className="text-xl md:text-2xl font-bold text-white">
            {userData?.characterId || (user && user.email) || "User"}
          </h1>
          <p className="text-sm text-gray-300">
            {userData?.race || 'No Race'}
          </p>
        </div>
      </>
    );
  };

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0] || null);
    setUploadError('');
  };

  const handleUpload = async () => {
    if (!selectedFile || !user) return;
    setIsUploading(true);
    // delete old image
    if (userData?.imagePath) {
      try {
        await deleteObject(storageRef(storage, userData.imagePath));
      } catch (err) {
        console.error('Old image deletion failed:', err);
      }
    }
    // upload new image
    try {
      // construct filename same as CharacterCreation: characterId_uid_timestamp
      const characterId = userData?.characterId || (user && user.email.split('@')[0]);
      const safeName = characterId.replace(/\s+/g, '_');
      const safeFileName = `${safeName}_${user.uid}_${Date.now()}`;
      const imagePath = `characters/${safeFileName}`;
      const fileRef = storageRef(storage, imagePath);
      await uploadBytes(fileRef, selectedFile);
      const url = await getDownloadURL(fileRef);
      // update both URL and storage path
      await updateDoc(doc(db, 'users', user.uid), { imageUrl: url, imagePath });
      setIsUploadOpen(false);
      setSelectedFile(null);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <header className="w-full bg-[rgba(40,40,60,0.8)] p-3 grid grid-cols-1 md:grid-cols-3 items-center sticky top-0 z-50 backdrop-blur-sm">
        {/* Left Column: Profile Picture and Character Name */}
        <div className="flex items-center justify-center md:justify-start mb-4 md:mb-0">
          {renderProfileInfo()}
        </div>

        {/* Center Column: Navigation Buttons */}
        <nav className="flex justify-center flex-wrap gap-2 md:gap-4">
          <NavParticleEffect active={isActive("/home")}>
            <button
              onClick={() => navigate("/home")}
              className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                isActive("/home")
                  ? "bg-[#FFA500] text-white font-semibold shadow-md"
                  : "bg-transparent text-white hover:bg-[#e69500]"
              }`}
            >
              Home
            </button>
          </NavParticleEffect>
          <NavParticleEffect active={isActive("/bazaar")}>
            <button
              onClick={() => navigate("/bazaar")}
              className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                isActive("/bazaar")
                  ? "bg-[#FFA500] text-white font-semibold shadow-md"
                  : "bg-transparent text-white hover:bg-[#e69500]"
              }`}
            >
              Bazaar
            </button>
          </NavParticleEffect>
          <NavParticleEffect active={isActive("/combat")}>
            <button
              onClick={() => navigate("/combat")}
              className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                isActive("/combat")
                  ? "bg-[#FFA500] text-white font-semibold shadow-md"
                  : "bg-transparent text-white hover:bg-[#e69500]"
              }`}
            >
              Combat
            </button>
          </NavParticleEffect>
          <NavParticleEffect active={isActive("/tecniche-spell")}>
            <button
              onClick={() => navigate("/tecniche-spell")}
              className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                isActive("/tecniche-spell")
                  ? "bg-[#FFA500] text-white font-semibold shadow-md"
                  : "bg-transparent text-white hover:bg-[#e69500]"
              }`}
            >
              Tecniche | Spell
            </button>
          </NavParticleEffect>
          <NavParticleEffect active={isActive("/codex")}>
            <button
              onClick={() => navigate("/codex")}
              className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                isActive("/codex")
                  ? "bg-[#FFA500] text-white font-semibold shadow-md"
                  : "bg-transparent text-white hover:bg-[#e69500]"
              }`}
            >
              Codex
            </button>
          </NavParticleEffect>
          <NavParticleEffect active={isActive("/echi-di-viaggio")}>
            <button
              onClick={() => navigate("/echi-di-viaggio")}
              className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                isActive("/echi-di-viaggio")
                  ? "bg-[#FFA500] text-white font-semibold shadow-md"
                  : "bg-transparent text-white hover:bg-[#e69500]"
              }`}
            >
              Echi di Viaggio
            </button>
          </NavParticleEffect>
          {userData?.role === "dm" && (
            <NavParticleEffect active={isActive("/dm-dashboard")}>
              <button
                onClick={() => navigate("/dm-dashboard")}
                className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                  isActive("/dm-dashboard")
                    ? "bg-[#FFA500] text-white font-semibold shadow-md"
                    : "bg-transparent text-white hover:bg-[#e69500]"
                }`}
              >
                DM Dashboard
              </button>
            </NavParticleEffect>
          )}
          {userData?.role === "dm" && (
            <NavParticleEffect active={isActive("/foes-hub")}>
              <button
                onClick={() => navigate("/foes-hub")}
                className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                  isActive("/foes-hub")
                    ? "bg-[#FFA500] text-white font-semibold shadow-md"
                    : "bg-transparent text-white hover:bg-[#e69500]"
                }`}
              >
                Foes Hub
              </button>
            </NavParticleEffect>
          )}
          {userData?.role === "webmaster" && (
            <NavParticleEffect active={isActive("/admin")}>
              <button
                onClick={() => navigate("/admin")}
                className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
                  isActive("/admin")
                    ? "bg-[#FFA500] text-white font-semibold shadow-md"
                    : "bg-transparent text-white hover:bg-[#e69500]"
                }`}
              >
                Admin
              </button>
            </NavParticleEffect>
          )}
        </nav>

        {/* Right Column: Logout Button */}
        <div className="flex items-center justify-center md:justify-end gap-3 mt-4 md:mt-0 md:mr-4">
          <button
            className="bg-[#8B0000] text-white px-3 py-1 md:px-4 md:py-2 rounded-[5px] cursor-pointer transition-colors duration-300 hover:bg-[#B22222] text-sm md:text-base font-medium disabled:opacity-75"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </header>
      {isPreviewOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={() => setIsPreviewOpen(false)}
        >
          <img
            src={userData?.imageUrl}
            alt="Profile Preview"
            className="max-w-full max-h-full rounded-lg"
          />
        </div>
      )}
      {isUploadOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm">
            <h2 className="text-xl text-white mb-4">Upload New Profile Image</h2>
            <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
              <p className="text-white">Uploading a new image will permanently delete your previous one.</p>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="block w-full text-white mb-4"
            />
            {uploadError && <p className="text-red-500 mb-2">{uploadError}</p>}
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => { setIsUploadOpen(false); setSelectedFile(null); }}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                disabled={isUploading}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
