import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthSession } from '../../../AuthContext';
import { FiPackage, FiSearch, FiTrash2, FiPlus, FiMinus } from 'react-icons/fi';
import { FaCoins } from 'react-icons/fa';
import { LazyItemDetailsModal as ItemDetailsModal } from './lazyHomeFeatures';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import useTask07MediaOperationOwner from '../../../data/media/useTask07MediaOperationOwner';
import { tryPersistTask07VarieMedia } from '../../../data/media/privateInventoryMediaWriter';
import {
	describeTask07ConsumerOutcome,
	task07ConsumerNeedsAttention,
} from '../../../data/media/mediaConsumerAdapter';
import MediaImage, { hasMediaAsset } from '../../common/MediaImage';
import useObjectUrl from '../../common/useObjectUrl';
import { recordTask08Event } from '../../../performance/task08';
import useCatalogItemsById from '../../../data/useCatalogItemsById';
import {
	collectInventoryCatalogItemIds,
} from '../../../data/inventoryCatalogProjection';
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
	createHomeInventoryProjection,
	filterHomeInventoryItems,
	HOME_INVENTORY_INITIAL_WINDOW,
	inventoryWindow,
	useHomeInventoryProjection,
} from '../homeInventoryProjection';
import { usePerformanceRenderProbe } from '../../../performance/PerformanceProfiler';

const inventoryDocumentId = (entry, index) => (
	entry?._task05?.inventoryId
	|| entry?._instance?.instanceId
	|| (typeof entry === 'string' ? entry : entry?.id)
	|| `item-${index}`
);

export const buildInventoryView = (inventory, equipment, catalogItemsById = {}) => {
	const projection = createHomeInventoryProjection({ inventory, equipment, catalogItemsById });
	return { items: projection.items };
};

// Simple inventory browser to occupy the right column
// Shows a searchable, grouped list of items in user's inventory
const Inventory = () => {
	usePerformanceRenderProbe('Inventory');
	const { user, repositoryAccessGeneration = 0 } = useAuthSession();
	const task07MediaOperationOwner = useTask07MediaOperationOwner();
	const actionScopeKey = `${user?.uid || 'anonymous'}:${repositoryAccessGeneration}`;
	const actionScopeRef = useRef(actionScopeKey);
	actionScopeRef.current = actionScopeKey;
	const {
		data: inventory,
		status: inventoryStatus,
	} = useInventory(user?.uid);
	const catalogItemIds = useMemo(
		() => collectInventoryCatalogItemIds(inventory),
		[inventory]
	);
	const { itemsById: catalogItemsById } = useCatalogItemsById(catalogItemIds);
	const { data: equipment } = useEquipment(user?.uid);
	const {
		data: resourcesGold,
		status: resourcesStatus,
	} = useResources(user?.uid, (data) => data?.stats?.gold ?? 0);
	const resourcesCommandsReady = resourcesStatus === 'fresh'
		&& resourcesGold !== null;
	const inventoryCommandsReady = inventoryStatus === 'fresh'
		&& inventory !== null;
	const executeInventoryMutation = (payload, retryKey = null) => mutateInventory({
		userId: user.uid,
		...payload,
		...(retryKey ? { retryKey } : {}),
	});
	const executeGoldAdjustment = (delta, retryKey = null) => adjustGold({
		userId: user.uid,
		delta,
		...(retryKey ? { retryKey } : {}),
	});
	const inventoryProjection = useHomeInventoryProjection({
		inventory,
		equipment,
		catalogItemsById,
	});
	const { items, searchItems } = inventoryProjection;
	const [q, setQ] = useState('');
	const deferredQ = useDeferredValue(q);
	const [windowState, setWindowState] = useState({
		query: '',
		items: searchItems,
		count: HOME_INVENTORY_INITIAL_WINDOW,
	});
	const [previewItem, setPreviewItem] = useState(null);
	const [previewScopeKey, setPreviewScopeKey] = useState(null);
	const parsedGold = typeof resourcesGold === 'string'
		? parseInt(resourcesGold, 10)
		: Number.NaN;
	const gold = typeof resourcesGold === 'number' && Number.isFinite(resourcesGold)
		? resourcesGold
		: (Number.isFinite(parsedGold) ? parsedGold : 0);
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
	const [vError, setVError] = useState(null);
	const vImagePreviewUrl = useObjectUrl(vImageFile);

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
		setVError(null);
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
		setVError(null);
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
				});
			} else {
				await executeInventoryMutation({
					action: 'remove',
					inventoryId: instance.inventoryId,
				});
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
		const qtyNum = Math.max(1, Math.min(9999, Math.abs(parseInt(vQty, 10) || 1)));
		if (!name) return;
		const snapshot = {
			name,
			description: (vDesc || '').trim(),
			type: 'varie',
			item_type: 'varie',
		};
		try {
			setVBusy(true);
			setVError(null);
			if (vImageFile) {
				const task07Result = await task07MediaOperationOwner.run((signal) => (
					tryPersistTask07VarieMedia({
						userId: user.uid,
						snapshot,
						quantity: qtyNum,
						file: vImageFile,
						signal,
					})
				));
				if (!task07Result) {
					const mediaError = new Error('Canonical media is unavailable. Nothing was saved.');
					mediaError.code = 'task07-canonical-required';
					throw mediaError;
				}
				if (task07ConsumerNeedsAttention(task07Result.outcome)) {
					alert(describeTask07ConsumerOutcome(task07Result.outcome, 'Inventory image'));
				}
			} else {
				await executeInventoryMutation({
					action: 'createVarie',
					quantity: qtyNum,
					snapshot,
				}, submissionRetryKey);
			}
			if (actionScopeRef.current !== submissionScopeKey) return;

			resetVarieDraft();
		} catch (err) {
			console.error('Error adding custom varie item', err);
			if (actionScopeRef.current === submissionScopeKey) {
				setVError(err?.message || 'Impossibile aggiungere l\'oggetto.');
				if (isDefinitiveUserDataCommandError(err)) resetVarieDraft();
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

	const filtered = useMemo(
		() => filterHomeInventoryItems(searchItems, deferredQ),
		[deferredQ, searchItems]
	);
	const visibleCount = windowState.query === deferredQ && windowState.items === searchItems
		? windowState.count
		: HOME_INVENTORY_INITIAL_WINDOW;
	const visibleWindow = useMemo(
		() => inventoryWindow(filtered, visibleCount),
		[filtered, visibleCount]
	);
	const visibleItems = visibleWindow.visibleItems;
	const filterMeasurement = useMemo(() => ({
		inputCount: items.length,
		filteredCount: filtered.length,
		queryLength: deferredQ.trim().length,
		query: deferredQ.trim(),
		mountedCount: visibleItems.length,
		firstItemId: inventoryDocumentId(filtered[0], 0),
		lastItemId: inventoryDocumentId(filtered[filtered.length - 1], filtered.length - 1),
	}), [deferredQ, filtered, items.length, visibleItems.length]);
	const filterMeasurementKey = JSON.stringify(filterMeasurement);
	const committedFilterMeasurementRef = useRef(null);
	useEffect(() => {
		if (committedFilterMeasurementRef.current === filterMeasurementKey) return;
		committedFilterMeasurementRef.current = filterMeasurementKey;
		recordTask08Event({
			metric: 'inventory-filter-result',
			value: filterMeasurement.filteredCount,
			tags: filterMeasurement,
		});
	}, [filterMeasurement, filterMeasurementKey]);
	const varieList = visibleItems.filter(it => (it.type || '').toLowerCase() === 'varie');
	const otherList = visibleItems.filter(it => (it.type || '').toLowerCase() !== 'varie');

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
					onChange={e => {
						const nextQuery = e.target.value;
						setQ(nextQuery);
						setWindowState({
							query: nextQuery,
							items: searchItems,
							count: HOME_INVENTORY_INITIAL_WINDOW,
						});
					}}
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
							<li data-home-inventory-row="true" key={key} className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
									{hasMediaAsset(docObj, { fallbackSrc: imgUrl, variant: 'thumbnail' }) && (
										<div className="h-8 w-8 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50 mr-2">
											<MediaImage
												media={docObj}
												src={imgUrl || ''}
												variant="thumbnail"
												alt={it.name}
												width={32}
												height={32}
												sizes="32px"
												className="h-full w-full object-contain"
											/>
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
											<li data-home-inventory-row="true" key={it.id} className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
												{hasMediaAsset(docObj, { fallbackSrc: imgUrl, variant: 'thumbnail' }) && (
													<div className="h-8 w-8 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50 mr-2">
														<MediaImage
															media={docObj}
															src={imgUrl || ''}
															variant="thumbnail"
															alt={it.name}
															width={32}
															height={32}
															sizes="32px"
															className="h-full w-full object-contain"
														/>
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
				{visibleWindow.hasMore && (
					<button
						type="button"
						className="mt-4 w-full rounded-lg border border-indigo-400/40 px-3 py-2 text-sm font-medium text-indigo-200 hover:bg-indigo-500/10"
						onClick={() => setWindowState({
							query: deferredQ,
							items: searchItems,
							count: visibleCount + HOME_INVENTORY_INITIAL_WINDOW,
						})}
						aria-label={`Load more inventory items, ${visibleWindow.totalCount - visibleItems.length} remaining`}
					>
						Load more
					</button>
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
									}}
									disabled={vBusy}
										className="text-xs text-slate-300"
									/>
									{vImagePreviewUrl && (
										<div className="flex items-center gap-2">
											<div className="h-10 w-10 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50">
												<img src={vImagePreviewUrl} alt="Preview" className="h-full w-full object-cover" />
											</div>
											<button type="button" disabled={vBusy} onClick={() => {
												setVImageFile(null);
											}} className="text-[11px] text-slate-300 border border-slate-600/60 rounded px-2 py-1 hover:bg-slate-700/40 disabled:opacity-50">Rimuovi</button>
										</div>
									)}
								</div>
							</div>
							{vError && <div className="text-xs text-red-400">{vError}</div>}
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
