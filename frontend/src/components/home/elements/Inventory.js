import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthSession } from '../../../AuthContext';
import { storage } from '../../firebaseStorage';
import { deleteObject, ref as storageRef } from 'firebase/storage';
import { FiPackage, FiSearch, FiTrash2, FiPlus, FiMinus } from 'react-icons/fi';
import { FaCoins } from 'react-icons/fa';
import { LazyItemDetailsModal as ItemDetailsModal } from './lazyHomeFeatures';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { uploadCacheableImage } from '../../common/imageStorage';
import {
	useEquipment,
	useInventory,
	useResources,
} from '../../../data/userData/userDataHooks';
import {
	adjustGold,
	createUserOperationId,
	isDefinitiveUserDataCommandError,
	mutateInventory,
} from '../../../data/userData/userDataCommands';
import {
	legacyAdjustGold,
	legacyMutateInventory,
} from '../../../data/userData/legacyUserDataCommands';
import {
 isUserDataCommandStageResolved,
 runVersionedUserDataCommand,
} from '../../../data/userData/userDataCommandRouting';
import { resolveEquippedInventoryIds } from './equipmentInventoryProjection';

const inventoryDocumentId = (entry, index) => (
	entry?._task05?.inventoryId
	|| entry?._instance?.instanceId
	|| (typeof entry === 'string' ? entry : entry?.id)
	|| `item-${index}`
);

export const buildInventoryView = (inventory, equipment) => {
	const inv = Array.isArray(inventory) ? inventory : [];
	const equippedValues = Object.values(equipment?.slots || equipment?.equipped || {}).filter(Boolean);
	const equippedInventoryIds = resolveEquippedInventoryIds({
		inventory: inv,
		equipped: Object.fromEntries(equippedValues.map((value, index) => [index, value])),
	});

	const nonVarieInstances = [];
	const varieMap = {};
	inv.forEach((entry, index) => {
		if (!entry) return;
		const baseId = typeof entry === 'string'
			? entry
			: entry.id || entry.name || entry?.General?.Nome || `item-${index}`;
		const baseName = typeof entry === 'string'
			? entry
			: entry?.General?.Nome || entry.name || baseId;
		const type = typeof entry === 'string' ? '' : (entry.type || entry.item_type || '').toLowerCase();
		const rarity = typeof entry === 'object' ? entry.rarity : undefined;
		const quantity = typeof entry === 'object' && typeof entry.qty === 'number'
			? Math.max(1, entry.qty)
			: 1;
		const stableInventoryId = inventoryDocumentId(entry, index);
		const docObj = typeof entry === 'object' ? { ...entry, id: baseId } : null;
		const equipped = equippedInventoryIds.has(stableInventoryId);
		if (type === 'varie') {
			if (!varieMap[baseId]) {
				varieMap[baseId] = {
					id: baseId,
					name: baseName,
					qty: 0,
					rarity,
					type: 'varie',
					doc: docObj,
					instances: [],
					isEquipped: false,
				};
			}
				varieMap[baseId].qty += quantity;
			varieMap[baseId].instances.push({
				inventoryId: stableInventoryId,
				legacyIndex: entry?._task05?.legacyIndex,
				quantity,
				doc: docObj,
			});
			varieMap[baseId].isEquipped = varieMap[baseId].isEquipped || equipped;
			return;
		}
		for (let ordinal = 0; ordinal < quantity; ordinal += 1) {
			nonVarieInstances.push({
				id: baseId,
				name: baseName,
				rarity,
				type: type || 'oggetto',
				doc: docObj,
				invIndex: index,
				inventoryId: stableInventoryId,
				legacyIndex: entry?._task05?.legacyIndex,
				isEquipped: equipped,
			});
		}
	});
	const seenCounts = {};
	const numberedNonVarie = nonVarieInstances.map((item) => {
		const count = (seenCounts[item.id] = (seenCounts[item.id] || 0) + 1);
		return { ...item, displayName: count > 1 ? `${item.name} (${count})` : item.name };
	});
	return {
		items: [...numberedNonVarie, ...Object.values(varieMap)],
	};
};

// Simple inventory browser to occupy the right column
// Shows a searchable, grouped list of items in user's inventory
const Inventory = () => {
	const { user, repositoryAccessGeneration = 0 } = useAuthSession();
	const actionScopeKey = `${user?.uid || 'anonymous'}:${repositoryAccessGeneration}`;
	const actionScopeRef = useRef(actionScopeKey);
	actionScopeRef.current = actionScopeKey;
	const {
		data: inventory,
		stage: inventoryStage,
		status: inventoryStatus,
	} = useInventory(user?.uid);
	const { data: equipment } = useEquipment(user?.uid);
	const {
		data: resources,
		stage: resourcesStage,
		status: resourcesStatus,
	} = useResources(user?.uid);
	const resourcesCommandsReady = resourcesStatus === 'fresh'
		&& resources !== null
		&& isUserDataCommandStageResolved(resourcesStage);
	const inventoryCommandsReady = inventoryStatus === 'fresh'
		&& inventory !== null
		&& isUserDataCommandStageResolved(inventoryStage);
	const executeInventoryMutation = (payload, legacyOptions = {}, retryKey = null) => runVersionedUserDataCommand({
		stage: inventoryCommandsReady ? inventoryStage : null,
		legacy: () => legacyMutateInventory({ uid: user.uid, ...payload, ...legacyOptions }),
		authoritative: () => mutateInventory({
			userId: user.uid,
			...payload,
			...(retryKey ? { retryKey } : {}),
		}),
	});
	const executeGoldAdjustment = (delta, retryKey = null) => runVersionedUserDataCommand({
		stage: resourcesCommandsReady ? resourcesStage : null,
		legacy: () => legacyAdjustGold({ uid: user.uid, delta }),
		authoritative: () => adjustGold({
			userId: user.uid,
			delta,
			...(retryKey ? { retryKey } : {}),
		}),
	});
	const { items } = useMemo(
		() => buildInventoryView(inventory, equipment),
		[inventory, equipment]
	);
	const [q, setQ] = useState('');
	const [previewItem, setPreviewItem] = useState(null);
	const [previewScopeKey, setPreviewScopeKey] = useState(null);
	const gold = typeof resources?.stats?.gold === 'number'
		? resources.stats.gold
		: parseInt(resources?.stats?.gold, 10) || 0;
	const [busyId, setBusyId] = useState(null);
	const [confirmTarget, setConfirmTarget] = useState(null); // { id, name }
	// gold adjustment overlay state
	const [showGoldOverlay, setShowGoldOverlay] = useState(false);
	const [goldActionScopeKey, setGoldActionScopeKey] = useState(null);
	const [goldRetryKey, setGoldRetryKey] = useState(null);
	const [goldDir, setGoldDir] = useState(1); // 1 for add, -1 for subtract
	const [goldDelta, setGoldDelta] = useState('');
	const [goldBusy, setGoldBusy] = useState(false);

	// "Varie" custom item overlay state
	const [showVarieOverlay, setShowVarieOverlay] = useState(false);
	const [varieActionScopeKey, setVarieActionScopeKey] = useState(null);
	const [varieRetryKey, setVarieRetryKey] = useState(null);
	const [vName, setVName] = useState('');
	const [vDesc, setVDesc] = useState('');
	const [vQty, setVQty] = useState('1');
	const [vBusy, setVBusy] = useState(false);
	const [vImageFile, setVImageFile] = useState(null);
	const [vImagePreviewUrl, setVImagePreviewUrl] = useState(null);
	const [vUploadedImage, setVUploadedImage] = useState(null);

	useEffect(() => {
		setPreviewItem(null);
		setPreviewScopeKey(null);
		setConfirmTarget(null);
		setBusyId(null);
		setShowGoldOverlay(false);
		setGoldActionScopeKey(null);
		setGoldRetryKey(null);
		setGoldDelta('');
		setGoldBusy(false);
		setShowVarieOverlay(false);
		setVarieActionScopeKey(null);
		setVarieRetryKey(null);
		setVName('');
		setVDesc('');
		setVQty('1');
		setVBusy(false);
		setVImageFile(null);
		setVUploadedImage(null);
		setVImagePreviewUrl((currentUrl) => {
			if (currentUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(currentUrl);
			return null;
		});
	}, [actionScopeKey]);

	const closeGoldOverlay = () => {
		if (goldBusy) return;
		setShowGoldOverlay(false);
		setGoldActionScopeKey(null);
		setGoldRetryKey(null);
		setGoldDelta('');
	};

	const resetVarieDraft = () => {
		setShowVarieOverlay(false);
		setVarieActionScopeKey(null);
		setVarieRetryKey(null);
		setVName('');
		setVDesc('');
		setVQty('1');
		setVImageFile(null);
		setVUploadedImage(null);
		setVImagePreviewUrl((currentUrl) => {
			if (currentUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(currentUrl);
			return null;
		});
	};


	// Remove a single unit of an item; if matchIndex is provided, remove at that inventory index
	const removeOne = async (targetId, matchIndex) => {
		if (!user || !targetId) return;
		try {
			setBusyId(targetId);
			const target = typeof matchIndex === 'number'
				? items.find((item) => item.id === targetId && item.invIndex === matchIndex)
				: items.find((item) => item.id === targetId);
			if (!target) return;
			const instance = target.type === 'varie' ? target.instances?.[0] : target;
			if (!instance?.inventoryId) throw new Error('Inventory item is missing its stable instance ID.');
			if (target.type === 'varie' && instance.quantity > 1) {
				await executeInventoryMutation({
					action: 'setQuantity',
					inventoryId: instance.inventoryId,
					quantity: instance.quantity - 1,
				}, { legacyIndex: instance.legacyIndex });
			} else {
				await executeInventoryMutation(
					{ action: 'remove', inventoryId: instance.inventoryId },
					{ legacyIndex: instance.legacyIndex }
				);
			}
		} catch (err) {
			console.error('Error removing item from inventory', err);
		} finally {
			setBusyId(null);
		}
	};

	// Remove all units of an item by id from the user's inventory
	const removeAllUnits = async (targetId) => {
		if (!user || !targetId) return;
		try {
			setBusyId(targetId);
			const ids = new Set();
			const matchingItems = items.filter((item) => item.id === targetId);
			if (matchingItems.some((item) => item.isEquipped)) {
				throw new Error("Prima rimuovi tutti gli oggetti equipaggiati.");
			}
			matchingItems.forEach((item) => {
				if (item.type === 'varie') item.instances?.forEach(({ inventoryId }) => ids.add(inventoryId));
				else if (item.inventoryId) ids.add(item.inventoryId);
			});
			const inventoryIds = [...ids];
			for (let index = 0; index < inventoryIds.length; index += 50) {
				await executeInventoryMutation({
					action: 'removeMany',
					inventoryIds: inventoryIds.slice(index, index + 50),
				});
			}
		} catch (err) {
			console.error('Error removing all units from inventory', err);
		} finally {
			setBusyId(null);
		}
	};

	// Add a custom "Varie" item to inventory
	const addVarieItem = async () => {
		const submissionScopeKey = actionScopeKey;
		const submissionRetryKey = varieRetryKey;
		if (
			!user
			|| !inventoryCommandsReady
			|| varieActionScopeKey !== submissionScopeKey
			|| !submissionRetryKey
		) return;
		const name = (vName || '').trim();
		const qtyNum = Math.max(1, Math.abs(parseInt(vQty, 10) || 1));
		if (!name) return; // require a name
		let uploadedImage = vUploadedImage;
		try {
			setVBusy(true);
			if (vImageFile && !uploadedImage) {
				try {
					const safe = name.replace(/[^a-zA-Z0-9]/g, '_');
					const fileName = `varie_${user.uid}_${safe}_${Date.now()}_${vImageFile.name}`;
					const imgRef = storageRef(storage, 'items/' + fileName);
					const { downloadUrl } = await uploadCacheableImage(imgRef, vImageFile);
					uploadedImage = { downloadUrl, objectRef: imgRef };
					if (actionScopeRef.current !== submissionScopeKey) {
						await deleteObject(imgRef).catch((cleanupError) => {
							console.error('Failed to clean up abandoned varie image', cleanupError);
						});
						return;
					}
					setVUploadedImage(uploadedImage);
				} catch (e) {
					console.error('Failed to upload varie image', e);
				}
			}
			if (actionScopeRef.current !== submissionScopeKey) return;

			await executeInventoryMutation({
				action: 'createVarie',
				quantity: qtyNum,
				snapshot: {
					name,
					description: (vDesc || '').trim(),
					type: 'varie',
					...(uploadedImage?.downloadUrl ? { image_url: uploadedImage.downloadUrl } : {}),
				},
			}, {}, submissionRetryKey);
			if (actionScopeRef.current !== submissionScopeKey) return;

			resetVarieDraft();
		} catch (err) {
			console.error('Error adding custom varie item', err);
			if (isDefinitiveUserDataCommandError(err)) {
				if (uploadedImage?.objectRef) {
					await deleteObject(uploadedImage.objectRef).catch((cleanupError) => {
						console.error('Failed to clean up unused varie image', cleanupError);
					});
				}
				if (actionScopeRef.current === submissionScopeKey) resetVarieDraft();
			}
		} finally {
			if (actionScopeRef.current === submissionScopeKey) setVBusy(false);
		}
	};

	const openVarieOverlay = () => {
		if (!user || !inventoryCommandsReady) return;
		setVarieActionScopeKey(actionScopeKey);
		setVarieRetryKey(`${actionScopeKey}:${createUserOperationId('varie-flow')}`);
		setShowVarieOverlay(true);
	};

	// Open overlay to adjust gold
	const openGoldOverlay = (dir) => {
		if (!user || !resourcesCommandsReady) return;
		setGoldDir(dir);
		setGoldDelta('');
		setGoldActionScopeKey(actionScopeKey);
		setGoldRetryKey(`${actionScopeKey}:${createUserOperationId('gold-flow')}`);
		setShowGoldOverlay(true);
	};

	// Apply gold delta to Firestore, clamped to >= 0
	const applyGoldDelta = async () => {
		const submissionScopeKey = actionScopeKey;
		const submissionRetryKey = goldRetryKey;
		if (
			!user
			|| !resourcesCommandsReady
			|| goldActionScopeKey !== submissionScopeKey
			|| !submissionRetryKey
		) return;
		const amount = Math.abs(parseInt(goldDelta, 10));
		if (!amount || Number.isNaN(amount)) {
			// no valid amount entered
			return;
		}
		try {
			setGoldBusy(true);
			await executeGoldAdjustment(goldDir >= 0 ? amount : -amount, submissionRetryKey);
			if (actionScopeRef.current !== submissionScopeKey) return;
			setShowGoldOverlay(false);
			setGoldActionScopeKey(null);
			setGoldRetryKey(null);
			setGoldDelta('');
		} catch (err) {
			console.error('Error updating gold', err);
			if (
				actionScopeRef.current === submissionScopeKey
				&& isDefinitiveUserDataCommandError(err)
			) closeGoldOverlay();
		} finally {
			if (actionScopeRef.current === submissionScopeKey) setGoldBusy(false);
		}
	};

	const filtered = items.filter(it =>
		!q || it.name?.toLowerCase().includes(q.toLowerCase()) || it.type?.toLowerCase().includes(q.toLowerCase())
	);
	const varieList = filtered.filter(it => (it.type || '').toLowerCase() === 'varie');
	const otherList = filtered.filter(it => (it.type || '').toLowerCase() !== 'varie');

	return (
		<div className="relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl px-5 pt-5 pb-4 shadow-lg h-full flex flex-col">
			<div className="absolute -left-10 -top-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl" />
			<div className="absolute -right-10 -bottom-10 w-48 h-48 bg-fuchsia-500/10 rounded-full blur-3xl" />

			{/* Gold badge + controls */}
			<div className="absolute top-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 backdrop-blur-sm">
				<FaCoins className="h-3.5 w-3.5 text-amber-300" />
				<span className="text-xs font-medium text-amber-200">{gold}</span>
				<div className="ml-2 flex items-center gap-1">
					<button
						className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10"
						title="Aggiungi oro"
						onClick={() => openGoldOverlay(1)}
						disabled={!resourcesCommandsReady}
					>
						<FiPlus className="h-3 w-3" />
					</button>
					<button
						className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-rose-400/40 text-rose-300 hover:bg-rose-500/10"
						title="Rimuovi oro"
						onClick={() => openGoldOverlay(-1)}
						disabled={!resourcesCommandsReady}
					>
						<FiMinus className="h-3 w-3" />
					</button>
				</div>
			</div>

			<div className="relative mb-3 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600/20 to-fuchsia-600/20 text-indigo-300 border border-slate-700/60">
						<FiPackage className="h-4 w-4" />
					</span>
					<h2 className="text-base font-semibold tracking-wide text-slate-200">Inventario</h2>
				</div>
			</div>

			<div className="relative mb-3">
				<FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
				<input
					value={q}
					onChange={e => setQ(e.target.value)}
					placeholder="Cerca nome o tipo…"
					className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-800/60 border border-slate-600/50 text-slate-200 placeholder-slate-400 focus:outline-none focus:border-slate-400"
				/>
			</div>

			<div className="relative flex-1 min-h-0 overflow-auto pr-1 custom-scroll">
				{(otherList.length || varieList.length) ? (
					<div className="space-y-4">
						{/* Non-Varie items */}
						{otherList.length > 0 && (
							<ul className="space-y-2">
								{otherList.map((it, idx) => {
					    const docObj = it.doc || it;
					    const imgUrl = docObj?.user_image_url || docObj?.General?.image_url || it?.General?.image_url;
							    const display = it.displayName || it.name;
							    const key = `${it.id}-${it.invIndex ?? 'x'}-${idx}`;
									return (
											<li key={key} className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
									{imgUrl && (
										<div className="h-8 w-8 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50 mr-2">
											<img src={imgUrl} alt={it.name} className="h-full w-full object-contain" />
										</div>
									)}
							    <button onClick={() => {
							    const modalItem = docObj ? { ...docObj, __invIndex: it.invIndex } : { id: it.id, name: it.name, type: it.type, __invIndex: it.invIndex };
							    setPreviewItem(modalItem);
							    setPreviewScopeKey(actionScopeKey);
							    }} className="min-w-0 text-left flex-1 hover:bg-slate-700/40 rounded-md px-2 py-1">
												<div className="text-sm text-slate-200 truncate">{display}</div>
										<div className="text-[11px] text-slate-400 truncate">{it.type || 'oggetto'}</div>
									</button>
									<div className="ml-3 flex items-center gap-2">
										{it.rarity && (
											<span className="text-[10px] uppercase tracking-wide text-fuchsia-300">{it.rarity}</span>
										)}
												{/* Non-varie are unstacked; no qty badge */}
										{(() => { const isEquipped = it.isEquipped; return (
											<button
														className={`ml-1 inline-flex items-center justify-center rounded-md border p-1.5 transition ${(busyId===it.id || isEquipped) ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-500/10'} border-red-400/40 text-red-300`}
												onClick={() => !isEquipped && setConfirmTarget({ id: it.id, name: display, invIndex: it.invIndex, scopeKey: actionScopeKey })}
														disabled={busyId===it.id || isEquipped}
												title={isEquipped ? "Prima rimuovi l'oggetto" : "Rimuovi 1"}
											>
												<FiTrash2 className="h-3 w-3" />
											</button>
										); })()}
									</div>
								</li>
							);
							})}
						</ul>
						)}

						{/* Varie section */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<h3 className="text-xs font-semibold tracking-wide text-slate-300">Varie</h3>
								<button
									className="inline-flex items-center gap-1 rounded-md border border-slate-600/60 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700/40"
								onClick={openVarieOverlay}
								disabled={!inventoryCommandsReady}
								title="Aggiungi oggetto Varie"
								>
									<FiPlus className="h-3 w-3" /> Aggiungi
								</button>
							</div>
							{varieList.length ? (
								<ul className="space-y-2">
									{varieList.map((it) => {
										const docObj = it.doc || it;
										const imgUrl = docObj?.image_url;
										return (
											<li key={it.id} className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
												{imgUrl && (
													<div className="h-8 w-8 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50 mr-2">
														<img src={imgUrl} alt={it.name} className="h-full w-full object-contain" />
													</div>
												)}
												<button onClick={() => { setPreviewItem(docObj); setPreviewScopeKey(actionScopeKey); }} className="min-w-0 text-left flex-1 hover:bg-slate-700/40 rounded-md px-2 py-1">
													<div className="text-sm text-slate-200 truncate">{it.name}</div>
													<div className="text-[11px] text-slate-400 truncate">Varie</div>
												</button>
												<div className="ml-3 flex items-center gap-2">
													<span className="text-xs text-amber-300">x{it.qty}</span>
													<button
														className={`ml-1 inline-flex items-center justify-center rounded-md border p-1.5 transition ${busyId===it.id ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-500/10'} border-red-400/40 text-red-300`}
													onClick={() => setConfirmTarget({ id: it.id, name: it.name, scopeKey: actionScopeKey })}
														disabled={busyId===it.id}
														title="Rimuovi 1"
													>
														<FiTrash2 className="h-3 w-3" />
													</button>
												</div>
											</li>
										);
									})}
								</ul>
							) : (
								<div className="text-slate-500 text-xs">Nessun oggetto varie</div>
							)}
						</div>
					</div>
				) : (
					<div className="text-slate-400 text-sm">Inventario vuoto.</div>
				)}
			</div>

			{previewItem && previewScopeKey === actionScopeKey && (
				<ItemDetailsModal item={previewItem} onClose={() => { setPreviewItem(null); setPreviewScopeKey(null); }} />
			)}

			{confirmTarget && confirmTarget.scopeKey === actionScopeKey && (
				<ConfirmDeleteModal
					itemName={confirmTarget.name}
					onCancel={() => setConfirmTarget(null)}
					onConfirm={async () => {
						if (actionScopeRef.current !== confirmTarget.scopeKey) return;
						await removeOne(confirmTarget.id, confirmTarget.invIndex);
						if (actionScopeRef.current === confirmTarget.scopeKey) setConfirmTarget(null);
					}}
					enableDeleteAll={true}
					onConfirmAll={async () => {
						// For non-varie, delete-all will still remove all by id
						if (actionScopeRef.current !== confirmTarget.scopeKey) return;
						await removeAllUnits(confirmTarget.id);
						if (actionScopeRef.current === confirmTarget.scopeKey) setConfirmTarget(null);
					}}
				/>
			)}

			{/* Overlay to input gold delta */}
			{showGoldOverlay
				&& goldActionScopeKey === actionScopeKey
				&& resourcesCommandsReady && (
				<div className="absolute inset-0 z-20 flex items-center justify-center">
					<div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeGoldOverlay} />
					<div className="relative z-10 w-72 rounded-xl border border-slate-700/60 bg-slate-800/90 p-4 shadow-xl">
						<h3 className="text-sm font-semibold text-slate-200">
							{goldDir >= 0 ? 'Aggiungi oro' : 'Rimuovi oro'}
						</h3>
						<p className="mt-1 text-xs text-slate-400">Oro attuale: <span className="text-amber-300 font-medium">{gold}</span></p>
						<div className="mt-3">
							<label className="block text-xs text-slate-300 mb-1">Quantità</label>
							<input
								type="number"
								min="0"
								placeholder="Es. 10"
								value={goldDelta}
								onChange={(e) => setGoldDelta(e.target.value)}
								className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
							/>
						</div>
						<div className="mt-4 flex justify-end gap-2">
							<button
								className="inline-flex items-center justify-center rounded-md border border-slate-600/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40"
								onClick={closeGoldOverlay}
								disabled={goldBusy || !resourcesCommandsReady}
							>
								Annulla
							</button>
							<button
								className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs ${goldDir>=0 ? 'bg-emerald-600/80 hover:bg-emerald-600 text-white' : 'bg-rose-600/80 hover:bg-rose-600 text-white'} disabled:opacity-60`}
								onClick={applyGoldDelta}
								disabled={goldBusy || !resourcesCommandsReady}
							>
								Conferma
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Overlay to add custom Varie item */}
			{showVarieOverlay
				&& varieActionScopeKey === actionScopeKey
				&& inventoryCommandsReady && (
				<div className="absolute inset-0 z-20 flex items-center justify-center">
					<div
						className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
						onClick={() => {
							if (!vBusy) {
								resetVarieDraft();
							}
						}}
					/>
					<div className="relative z-10 w-[28rem] max-w-[90vw] rounded-xl border border-slate-700/60 bg-slate-800/90 p-4 shadow-xl">
						<h3 className="text-sm font-semibold text-slate-200">Aggiungi oggetto "Varie"</h3>
						<div className="mt-3 grid grid-cols-1 gap-3">
							<div>
								<label className="block text-xs text-slate-300 mb-1">Nome</label>
								<input type="text" placeholder="Es. Corda di canapa" value={vName} onChange={(e) => setVName(e.target.value)} className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400" />
							</div>
							<div>
								<label className="block text-xs text-slate-300 mb-1">Descrizione</label>
								<textarea rows={3} placeholder="Dettagli opzionali" value={vDesc} onChange={(e) => setVDesc(e.target.value)} className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400" />
							</div>
							<div>
								<label className="block text-xs text-slate-300 mb-1">Immagine (opzionale)</label>
								<div className="flex items-center gap-3">
									<input
										type="file"
										accept="image/*"
										onChange={(e) => {
										const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
										setVImageFile(f);
										setVImagePreviewUrl((currentUrl) => {
											if (currentUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(currentUrl);
											return f ? URL.createObjectURL(f) : null;
										});
									}}
									disabled={vBusy || !!vUploadedImage}
										className="text-xs text-slate-300"
									/>
									{vImagePreviewUrl && (
										<div className="flex items-center gap-2">
											<div className="h-10 w-10 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50">
												<img src={vImagePreviewUrl} alt="Preview" className="h-full w-full object-cover" />
											</div>
											<button type="button" disabled={vBusy || !!vUploadedImage} onClick={() => {
												setVImageFile(null);
												setVImagePreviewUrl((currentUrl) => {
													if (currentUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(currentUrl);
													return null;
												});
											}} className="text-[11px] text-slate-300 border border-slate-600/60 rounded px-2 py-1 hover:bg-slate-700/40 disabled:opacity-50">Rimuovi</button>
										</div>
									)}
								</div>
							</div>
							<div>
								<label className="block text-xs text-slate-300 mb-1">Quantità</label>
								<input type="number" min="1" value={vQty} onChange={(e) => setVQty(e.target.value)} className="w-28 rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400" />
							</div>
						</div>
						<div className="mt-4 flex justify-end gap-2">
							<button
								className="inline-flex items-center justify-center rounded-md border border-slate-600/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40"
								onClick={() => { if (!vBusy) resetVarieDraft(); }}
								disabled={vBusy || !inventoryCommandsReady}
							>
								Annulla
							</button>
							<button
								className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white disabled:opacity-60`}
								onClick={addVarieItem}
								disabled={vBusy || !inventoryCommandsReady || !vName.trim()}
							>
								Aggiungi
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default Inventory;
