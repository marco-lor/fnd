import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import { saveSpellForUser, saveTecnicaForUser } from "../../common/userOwnedMedia";

const MEDIA_CONFIG = {
  spell: {
    title: "Modifica Media Spell",
    saveLabel: "Salva Media",
    accentClass: "from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500",
    save: saveSpellForUser,
  },
  tecnica: {
    title: "Modifica Media Tecnica",
    saveLabel: "Salva Media",
    accentClass: "from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500",
    save: saveTecnicaForUser,
  },
};

function MediaPreview({ kind, previewUrl, onClear }) {
  if (!previewUrl) {
    return (
      <div className="mt-2 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs">
        No {kind}
      </div>
    );
  }

  return (
    <div className="mt-2 relative max-w-xs">
      {kind === "Image" ? (
        <img
          src={previewUrl}
          alt="Preview"
          className="w-24 h-24 object-cover rounded border border-gray-600"
        />
      ) : (
        <video
          src={previewUrl}
          controls
          className="w-full max-h-48 rounded border border-gray-600"
        />
      )}
      <button
        type="button"
        onClick={onClear}
        className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center -mt-1 -mr-1"
      >
        &times;
      </button>
    </div>
  );
}

export default function PersonalMediaEditor({
  userId,
  userLabel,
  itemType,
  itemName,
  itemData,
  onClose,
}) {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(itemData?.image_url || null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(itemData?.video_url || null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [videoRemoved, setVideoRemoved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const config = useMemo(() => MEDIA_CONFIG[itemType], [itemType]);

  useEffect(() => {
    setImageFile(null);
    setVideoFile(null);
    setImagePreviewUrl(itemData?.image_url || null);
    setVideoPreviewUrl(itemData?.video_url || null);
    setImageRemoved(false);
    setVideoRemoved(false);
  }, [itemData]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      if (videoPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [imagePreviewUrl, videoPreviewUrl]);

  const updatePreview = (event, mediaType) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (mediaType === "image") {
      if (imagePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      setImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
      setImageRemoved(false);
      return;
    }

    if (videoPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setVideoRemoved(false);
  };

  const clearImage = () => {
    if (imagePreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl(null);
    setImageRemoved(true);
  };

  const clearVideo = () => {
    if (videoPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoRemoved(true);
  };

  const handleSave = async () => {
    if (!config) {
      onClose(false);
      return;
    }

    setIsSaving(true);

    try {
      await config.save({
        userId,
        originalName: itemName,
        entryData: {
          ...itemData,
          Nome: itemData?.Nome || itemName,
        },
        imageFile,
        videoFile,
        removeImage: imageRemoved,
        removeVideo: videoRemoved,
      });

      onClose(true);
    } catch (error) {
      console.error(`Error updating ${itemType} media:`, error);
      alert(`Errore durante il salvataggio dei media della ${itemType}.`);
      onClose(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (!config) {
    return null;
  }

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-70 z-[9999] p-4">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-2xl border border-gray-700">
        <h2 className="text-xl text-white mb-1">{config.title}</h2>
        <p className="text-gray-300 text-sm mb-1">Elemento: {itemData?.Nome || itemName}</p>
        <p className="text-gray-400 mb-4">Giocatore: {userLabel || "Utente"}</p>

        {showConfirmation ? (
          <div className="text-white">
            <p className="mb-4">Confermi l'aggiornamento di immagine e video per questo elemento?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                disabled={isSaving}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSave}
                className={`px-4 py-2 text-white rounded transition-colors bg-gradient-to-r ${config.accentClass}`}
                disabled={isSaving}
              >
                {isSaving ? "Salvataggio..." : "Conferma"}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setShowConfirmation(true);
            }}
          >
            <div className="rounded-lg bg-gray-700/40 border border-gray-700 p-4 mb-5">
              <p className="text-sm text-gray-200">
                Questo pannello permette di modificare solo i media associati. Nome, costo, effetti e altri parametri restano invariati.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4 p-4 bg-gray-700/50 rounded-lg">
              <div>
                <label className="block text-white text-sm mb-1">Immagine</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => updatePreview(event, "image")}
                  className="w-full text-sm text-white file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                <MediaPreview kind="Image" previewUrl={imagePreviewUrl} onClear={clearImage} />
              </div>

              <div>
                <label className="block text-white text-sm mb-1">Video</label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(event) => updatePreview(event, "video")}
                  className="w-full text-sm text-white file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                <MediaPreview kind="Video" previewUrl={videoPreviewUrl} onClear={clearVideo} />
                <p className="text-gray-400 text-xs mt-1">Consigliato: video breve (&lt;30s) e di dimensioni ridotte.</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-600">
              <button
                type="button"
                onClick={() => onClose(false)}
                className="px-5 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md shadow-md transition-colors duration-150"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`px-5 py-2 bg-gradient-to-r ${config.accentClass} text-white rounded-md shadow-md transition-colors duration-150`}
                disabled={isSaving}
              >
                {config.saveLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}