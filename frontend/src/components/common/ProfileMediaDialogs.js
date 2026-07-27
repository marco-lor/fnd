import React from 'react';
import MediaImage from './MediaImage';

const ProfileMediaDialogs = ({
  mode,
  imageUrl,
  media,
  isUploading,
  onClose,
  onFileChange,
  onUpload,
  selectedFile,
  uploadError,
}) => {
  if (mode === 'preview') {
    return (
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black bg-opacity-75"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Profile image preview"
      >
        <MediaImage
          src={imageUrl}
          media={media}
          variant="board"
          alt="Profile Preview"
          width={1200}
          height={1200}
          loading="eager"
          fetchPriority="high"
          className="max-h-full max-w-full rounded-lg"
        />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black bg-opacity-75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-upload-title"
    >
      <div className="w-full max-w-sm rounded-lg bg-gray-800 p-6 shadow-lg">
        <h2 id="profile-upload-title" className="mb-4 text-xl text-white">Upload New Profile Image</h2>
        <div className="mb-4 rounded border border-red-700 bg-red-900 bg-opacity-25 p-4">
          <p className="text-white">
            Your previous image remains available until the new upload is saved successfully.
          </p>
        </div>
        <input
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="mb-4 block w-full text-white"
        />
        {uploadError ? <p className="mb-2 text-red-500">{uploadError}</p> : null}
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-gray-500 px-4 py-2 text-white transition-colors hover:bg-gray-600"
            disabled={isUploading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onUpload}
            disabled={!selectedFile || isUploading}
            className="rounded bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileMediaDialogs;
