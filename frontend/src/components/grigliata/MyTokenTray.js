import React, { useMemo, useState } from 'react';
import { FiCheck, FiEdit2, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import { TRAY_DRAG_MIME } from './constants';

const buildTokenDragPayload = (token) => JSON.stringify({
  type: 'grigliata-token',
  tokenId: token?.tokenId || token?.id || '',
  ownerUid: token?.ownerUid || '',
  uid: token?.ownerUid || '',
});

const getTokenStatusLabel = (token, activeMapName) => {
  if (!activeMapName) {
    return 'Select a map to place this token';
  }

  if (token?.isHiddenByManager) {
    return `Hidden on ${activeMapName} by the DM`;
  }

  if (token?.placed) {
    return `On ${activeMapName} at ${token.col}, ${token.row}`;
  }

  return `Not placed on ${activeMapName} yet`;
};

const getTokenHelpText = (token, activeMapName, canDrag) => {
  if (token?.isHiddenByManager) {
    return 'The DM is currently hiding or controlling this token on the active map. It will be draggable again once it is shown.';
  }

  if (!canDrag) {
    return token?.tokenType === 'character'
      ? 'Upload a profile image from the navbar first. Without it, your main character token stays disabled.'
      : 'Upload an image for this custom token before dragging it onto the map.';
  }

  if (!activeMapName) {
    return 'Select a map first. Token positions are saved independently for each map.';
  }

  return token?.tokenType === 'character'
    ? 'Drag this portrait onto the active map to place or reposition your round character token.'
    : 'Drag this custom token onto the active map to place or reposition it.';
};

export default function MyTokenTray({
  currentUserToken,
  customTokens = [],
  activeMapName,
  onDragStart,
  onDragEnd,
  onCreateCustomToken,
  isCreatingCustomToken = false,
  onUpdateCustomToken,
  updatingCustomTokenId = '',
  onDeleteCustomToken,
  deletingCustomTokenId = '',
}) {
  const [createLabel, setCreateLabel] = useState('');
  const [createImageFile, setCreateImageFile] = useState(null);
  const [createImageInputKey, setCreateImageInputKey] = useState(0);
  const [editingTokenId, setEditingTokenId] = useState('');
  const [editingLabel, setEditingLabel] = useState('');
  const [editingImageFile, setEditingImageFile] = useState(null);
  const [editImageInputKey, setEditImageInputKey] = useState(0);

  const trayTokens = useMemo(
    () => [currentUserToken, ...customTokens].filter(Boolean),
    [currentUserToken, customTokens]
  );

  const resetCreateForm = () => {
    setCreateLabel('');
    setCreateImageFile(null);
    setCreateImageInputKey((currentKey) => currentKey + 1);
  };

  const resetEditForm = () => {
    setEditingTokenId('');
    setEditingLabel('');
    setEditingImageFile(null);
    setEditImageInputKey((currentKey) => currentKey + 1);
  };

  const handleTokenDragStart = (event, token) => {
    const tokenId = token?.tokenId || token?.id || '';
    const ownerUid = token?.ownerUid || '';
    const canDrag = !!(token?.imageUrl && tokenId && ownerUid && !token?.isHiddenByManager && editingTokenId !== tokenId);

    if (!canDrag) {
      event.preventDefault();
      return;
    }

    const payload = buildTokenDragPayload(token);
    event.dataTransfer.setData(TRAY_DRAG_MIME, payload);
    event.dataTransfer.setData('text/plain', payload);
    event.dataTransfer.effectAllowed = 'copyMove';
    onDragStart?.(token);
  };

  const handleCreateSubmit = async () => {
    const didCreateToken = await onCreateCustomToken?.({
      label: createLabel,
      imageFile: createImageFile,
    });

    if (didCreateToken) {
      resetCreateForm();
    }
  };

  const handleBeginEdit = (token) => {
    setEditingTokenId(token?.tokenId || '');
    setEditingLabel(token?.label || '');
    setEditingImageFile(null);
  };

  const handleSaveEdit = async (token) => {
    const didUpdateToken = await onUpdateCustomToken?.({
      tokenId: token?.tokenId || '',
      label: editingLabel,
      imageFile: editingImageFile,
    });

    if (didUpdateToken) {
      resetEditForm();
    }
  };

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">My Tokens</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Your main character token stays pinned first. Custom tokens stay private to your tray until you place them on the map.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {trayTokens.map((token) => {
          const tokenId = token?.tokenId || token?.id || '';
          const ownerUid = token?.ownerUid || '';
          const isEditing = editingTokenId === tokenId;
          const isCustomToken = token?.tokenType === 'custom';
          const isUpdating = updatingCustomTokenId === tokenId;
          const isDeleting = deletingCustomTokenId === tokenId;
          const imageUrl = token?.imageUrl || '';
          const canDrag = !!(imageUrl && tokenId && ownerUid && !token?.isHiddenByManager && !isEditing && !isUpdating && !isDeleting);
          const statusLabel = getTokenStatusLabel(token, activeMapName);
          const helpText = getTokenHelpText(token, activeMapName, canDrag);

          return (
            <div
              key={tokenId || token?.label || 'tray-token'}
              draggable={canDrag}
              onDragStart={(event) => handleTokenDragStart(event, token)}
              onDragEnd={() => onDragEnd?.(token)}
              className={`rounded-2xl border px-4 py-4 transition-colors ${
                token?.isHiddenByManager
                  ? 'border-rose-500/45 bg-rose-950/20 cursor-not-allowed'
                  : canDrag
                    ? 'border-amber-400/50 bg-slate-900/85 cursor-grab active:cursor-grabbing hover:border-amber-300'
                    : 'border-slate-700 bg-slate-900/60 cursor-not-allowed opacity-75'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-slate-300/70 bg-slate-800 shrink-0">
                    {imageUrl ? (
                      <img src={imageUrl} alt={token?.label || 'Token'} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-400 px-2 text-center">
                        No Img
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold text-slate-100 truncate">
                        {token?.label || (isCustomToken ? 'Custom Token' : 'Player')}
                      </p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        isCustomToken
                          ? 'border-sky-400/35 bg-sky-500/10 text-sky-100'
                          : 'border-amber-400/35 bg-amber-500/10 text-amber-100'
                      }`}>
                        {isCustomToken ? 'Custom' : 'Character'}
                      </span>
                    </div>
                    <p className={`text-xs truncate ${token?.isHiddenByManager ? 'text-rose-200' : 'text-slate-400'}`}>
                      {statusLabel}
                    </p>
                  </div>
                </div>

                {isCustomToken && !isEditing && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleBeginEdit(token)}
                      disabled={isUpdating || isDeleting}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 p-2 text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                      aria-label={`Edit ${token.label || 'custom token'}`}
                      title="Edit custom token"
                    >
                      <FiEdit2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteCustomToken?.(token)}
                      disabled={isUpdating || isDeleting}
                      className="inline-flex items-center justify-center rounded-xl border border-rose-400/35 bg-rose-500/10 p-2 text-rose-100 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-55"
                      aria-label={`Delete ${token.label || 'custom token'}`}
                      title="Delete custom token"
                    >
                      <FiTrash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                {helpText}
              </p>

              {isCustomToken && !isEditing && (isUpdating || isDeleting) && (
                <p className="mt-3 text-xs font-medium text-slate-300">
                  {isDeleting ? 'Deleting custom token…' : 'Saving custom token…'}
                </p>
              )}

              {isCustomToken && isEditing && (
                <div className="mt-4 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/75 p-3">
                  <div>
                    <label htmlFor={`edit-token-label-${tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Name
                    </label>
                    <input
                      id={`edit-token-label-${tokenId}`}
                      type="text"
                      value={editingLabel}
                      onChange={(event) => setEditingLabel(event.target.value)}
                      placeholder="Custom token name"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-amber-300"
                    />
                  </div>

                  <div>
                    <label htmlFor={`edit-token-image-${tokenId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Replace Image
                    </label>
                    <input
                      key={`edit-token-image-${tokenId}-${editImageInputKey}`}
                      id={`edit-token-image-${tokenId}`}
                      type="file"
                      accept="image/*"
                      onChange={(event) => setEditingImageFile(event.target.files?.[0] || null)}
                      className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-amber-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-amber-300"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {editingImageFile?.name || 'Keep the current image if you leave this empty.'}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={resetEditForm}
                      disabled={isUpdating}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <FiX className="h-4 w-4" />
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(token)}
                      disabled={isUpdating}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-300/45 bg-amber-400 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <FiCheck className="h-4 w-4" />
                      {isUpdating ? 'Saving' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-amber-300/35 bg-amber-500/10 text-amber-200">
              <FiPlus className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-100">Add Custom Token</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Create extra tokens for summons, companions, disguises, or alternate forms.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="create-custom-token-name" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Name
              </label>
              <input
                id="create-custom-token-name"
                type="text"
                value={createLabel}
                onChange={(event) => setCreateLabel(event.target.value)}
                placeholder="Summoned Wolf"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-amber-300"
              />
            </div>

            <div>
              <label htmlFor="create-custom-token-image" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Image
              </label>
              <input
                key={`create-custom-token-image-${createImageInputKey}`}
                id="create-custom-token-image"
                type="file"
                accept="image/*"
                onChange={(event) => setCreateImageFile(event.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-amber-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-amber-300"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {createImageFile?.name || 'Upload an image to use as the token portrait.'}
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCreateSubmit}
                disabled={isCreatingCustomToken}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-300/45 bg-amber-400 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <FiPlus className="h-4 w-4" />
                {isCreatingCustomToken ? 'Creating' : 'Create Token'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}