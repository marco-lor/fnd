import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../../AuthContext';
import { db, storage } from '../../firebaseConfig';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { FiPackage, FiSearch, FiTrash2, FiPlus, FiMinus } from 'react-icons/fi';
import { FaCoins } from 'react-icons/fa';
import ItemDetailsModal from './ItemDetailsModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

// Simple inventory browser to occupy the right column
// Shows a searchable, grouped list of items in user's inventory
const Inventory = () => {
	const { user } = useContext(AuthContext);
	const [items, setItems] = useState([]);
	const [q, setQ] = useState('');
	const [previewItem, setPreviewItem] = useState(null);
	const [gold, setGold] = useState(0);
	const [busyId, setBusyId] = useState(null);
	const [confirmTarget, setConfirmTarget] = useState(null); // { id, name }
	const [equippedCounts, setEquippedCounts] = useState({}); // id -> count equipped
	// gold adjustment overlay state
	const [showGoldOverlay, setShowGoldOverlay] = useState(false);
	const [goldDir, setGoldDir] = useState(1); // 1 for add, -1 for subtract
	const [goldDelta, setGoldDelta] = useState('');
	const [goldBusy, setGoldBusy] = useState(false);

	// "Varie" custom item overlay state
	const [showVarieOverlay, setShowVarieOverlay] = useState(false);
	const [vName, setVName] = useState('');
	const [vDesc, setVDesc] = useState('');
	const [vQty, setVQty] = useState('1');
	const [vBusy, setVBusy] = useState(false);
	const [vImageFile, setVImageFile] = useState(null);
	const [vImagePreviewUrl, setVImagePreviewUrl] = useState(null);

	useEffect(() => {
		if (!user) return;
		const unsub = onSnapshot(doc(db, 'users', user.uid), snap => {
			const data = snap.data();
			const inv = Array.isArray(data?.inventory) ? data.inventory : [];
			setGold(typeof data?.stats?.gold === 'number' ? data.stats.gold : parseInt(data?.stats?.gold, 10) || 0);
			// Compute equipped counts by id
			const equipped = data?.equipped || {};
			const eqCounts = {};
			Object.values(equipped).forEach((val, idx) => {
				if (!val) return;
				let id;
				if (typeof val === 'string') id = val;
				else id = val.id || val.name || val?.General?.Nome || `eq-${idx}`;
				if (!id) return;
				eqCounts[id] = (eqCounts[id] || 0) + 1;
			});
			setEquippedCounts(eqCounts);
			// Build list where Varie items are stacked but normal items are not
			const nonVarieInstances = [];
			const varieMap = {};
			for (let i = 0; i < inv.length; i++) {
				const e = inv[i];
				if (!e) continue;
				// derive basics
				let baseId, baseName, type, rarity;
				if (typeof e === 'string') {
					baseId = e;
					baseName = e;
					type = undefined;
					rarity = undefined;
				} else {
					baseId = e.id || e.name || e?.General?.Nome || `item-${i}`;
					baseName = e?.General?.Nome || e.name || baseId;
					type = (e.type || e.item_type || '').toLowerCase();
					rarity = e.rarity;
				}
				const qty = (typeof e === 'object' && typeof e.qty === 'number') ? Math.max(1, e.qty) : 1;
				const docObj = typeof e === 'object' ? { ...e, id: baseId } : null;
				const isVarie = (type === 'varie');
				if (isVarie) {
					if (!varieMap[baseId]) {
						varieMap[baseId] = { id: baseId, name: baseName, qty: 0, rarity, type: 'varie', doc: docObj };
					}
					varieMap[baseId].qty += qty;
				} else {
					// expand into individual instances (unstacked)
					for (let u = 0; u < qty; u++) {
						nonVarieInstances.push({
							id: baseId,
							name: baseName,
							rarity,
							type: (type || 'oggetto'),
							doc: docObj,
							invIndex: i
						});
					}
				}
			}
			// number duplicates for non-varie for display
			const seenCounts = {};
			const numberedNonVarie = nonVarieInstances.map((it) => {
				const count = (seenCounts[it.id] = (seenCounts[it.id] || 0) + 1);
				const displayName = count > 1 ? `${it.name} (${count})` : it.name;
				return { ...it, displayName };
			});
			// final items array: keep non-varie instances (qty implicitly 1) and stacked varie
			const combined = [
				...numberedNonVarie,
				...Object.values(varieMap)
			];
			setItems(combined);
		});
		return () => unsub();
	}, [user]);

	// No longer loading the global items catalog; full item specifics are in user's inventory

	// Helper to derive an id from an inventory entry (string or object)
	const deriveId = (e, i) => {
		if (!e) return `item-${i}`;
		if (typeof e === 'string') return e;
		return e.id || e.name || e?.General?.Nome || `item-${i}`;
	};

	// Remove a single unit of an item; if matchIndex is provided, remove at that inventory index
	const removeOne = async (targetId, matchIndex) => {
		if (!user || !targetId) return;
		try {
			setBusyId(targetId);
			const ref = doc(db, 'users', user.uid);
			const snap = await getDoc(ref);
			if (!snap.exists()) return;
			const data = snap.data() || {};
			const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];

			let removed = false;
			let deletedImageUrl = null;
			const next = [];

			for (let i = 0; i < inv.length; i++) {
				const entry = inv[i];
				if (removed) { next.push(entry); continue; }

				// If a specific inventory index is requested, match by index first
				if (typeof matchIndex === 'number') {
					if (i !== matchIndex) { next.push(entry); continue; }
				} else {
					const id = deriveId(entry, i);
					if (id !== targetId) { next.push(entry); continue; }
				}

				// match
				if (typeof entry === 'object' && entry && typeof entry.qty === 'number') {
					const newQty = Math.max(0, (entry.qty || 0) - 1);
					if (newQty > 0) {
						next.push({ ...entry, qty: newQty });
					} else {
						// fully removed; if it was a Varie with its own image, mark for deletion
						if ((entry.type || '').toLowerCase() === 'varie' && entry.image_url) {
							deletedImageUrl = entry.image_url;
						}
						// if this standard item had a user-specific custom image, delete it as well
						if ((entry.type || '').toLowerCase() !== 'varie' && entry.user_image_custom && entry.user_image_url) {
							deletedImageUrl = deletedImageUrl || entry.user_image_url;
						}
						// fully removed; do not push
					}
				} else {
					// string or object without qty: remove this single occurrence by skipping push
					if (typeof entry === 'object') {
						if ((entry.type || '').toLowerCase() === 'varie' && entry.image_url) {
							deletedImageUrl = entry.image_url;
						}
						if ((entry.type || '').toLowerCase() !== 'varie' && entry.user_image_custom && entry.user_image_url) {
							deletedImageUrl = deletedImageUrl || entry.user_image_url;
						}
					}
				}
				removed = true;
			}

			if (!removed) return; // nothing to do
			await updateDoc(ref, { inventory: next });

			// After Firestore update, delete storage file if this was a Varie or a user-custom image and it was fully removed
			if (deletedImageUrl) {
				try {
					const path = decodeURIComponent(deletedImageUrl.split('/o/')[1].split('?')[0]);
					await deleteObject(storageRef(storage, path));
				} catch (e) {
					console.warn('Failed to delete inventory image from storage', e);
				}
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
			const ref = doc(db, 'users', user.uid);
			const snap = await getDoc(ref);
			if (!snap.exists()) return;
			const data = snap.data() || {};
			const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];
			let deletedImageUrl = null;
			const next = [];
			for (let i = 0; i < inv.length; i++) {
				const entry = inv[i];
				const id = deriveId(entry, i);
				if (id === targetId) {
					if (typeof entry === 'object') {
						if ((entry.type || '').toLowerCase() === 'varie' && entry.image_url) {
							deletedImageUrl = entry.image_url;
						}
						if ((entry.type || '').toLowerCase() !== 'varie' && entry.user_image_custom && entry.user_image_url) {
							deletedImageUrl = deletedImageUrl || entry.user_image_url;
						}
					}
					// skip to remove
					continue;
				}
				next.push(entry);
			}
			await updateDoc(ref, { inventory: next });
			if (deletedImageUrl) {
				try {
					const path = decodeURIComponent(deletedImageUrl.split('/o/')[1].split('?')[0]);
					await deleteObject(storageRef(storage, path));
				} catch (e) {
					console.warn('Failed to delete inventory image from storage', e);
				}
			}
		} catch (err) {
			console.error('Error removing all units from inventory', err);
		} finally {
			setBusyId(null);
		}
	};

	// Add a custom "Varie" item to inventory
	const addVarieItem = async () => {
		if (!user) return;
		const name = (vName || '').trim();
		const qtyNum = Math.max(1, Math.abs(parseInt(vQty, 10) || 1));
		if (!name) return; // require a name
		try {
			setVBusy(true);
			const ref = doc(db, 'users', user.uid);
			const snap = await getDoc(ref);
			if (!snap.exists()) return;
			const data = snap.data() || {};
			const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];

			const id = `varie_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
			let image_url = null;
			if (vImageFile) {
				try {
					const safe = name.replace(/[^a-zA-Z0-9]/g, '_');
					const fileName = `varie_${user.uid}_${safe}_${Date.now()}_${vImageFile.name}`;
					const imgRef = storageRef(storage, 'items/' + fileName);
					await uploadBytes(imgRef, vImageFile);
					image_url = await getDownloadURL(imgRef);
				} catch (e) {
					console.error('Failed to upload varie image', e);
				}
			}

			inv.push({ id, name, description: (vDesc||'').trim(), type: 'varie', qty: qtyNum, ...(image_url ? { image_url } : {}) });
			await updateDoc(ref, { inventory: inv });

			// reset and close
			setShowVarieOverlay(false);
			setVName(''); setVDesc(''); setVQty('1'); setVImageFile(null); setVImagePreviewUrl(null);
		} catch (err) {
			console.error('Error adding custom varie item', err);
		} finally {
			setVBusy(false);
		}
	};

	// Open overlay to adjust gold
	const openGoldOverlay = (dir) => {
		setGoldDir(dir);
		setGoldDelta('');
		setShowGoldOverlay(true);
	};

	// Apply gold delta to Firestore, clamped to >= 0
	const applyGoldDelta = async () => {
		if (!user) return;
		const amount = Math.abs(parseInt(goldDelta, 10));
		if (!amount || Number.isNaN(amount)) {
			// no valid amount entered
			return;
		}
		try {
			setGoldBusy(true);
			const ref = doc(db, 'users', user.uid);
			const snap = await getDoc(ref);
			if (!snap.exists()) return;
			const data = snap.data() || {};
			const curr = typeof data?.stats?.gold === 'number' ? data.stats.gold : parseInt(data?.stats?.gold, 10) || 0;
			const next = Math.max(0, curr + (goldDir >= 0 ? amount : -amount));
			await updateDoc(ref, {
				stats: { ...(data.stats || {}), gold: next }
			});
			setShowGoldOverlay(false);
		} catch (err) {
			console.error('Error updating gold', err);
		} finally {
			setGoldBusy(false);
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
					>
						<FiPlus className="h-3 w-3" />
					</button>
					<button
						className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-rose-400/40 text-rose-300 hover:bg-rose-500/10"
						title="Rimuovi oro"
						onClick={() => openGoldOverlay(-1)}
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
							    }} className="min-w-0 text-left flex-1 hover:bg-slate-700/40 rounded-md px-2 py-1">
												<div className="text-sm text-slate-200 truncate">{display}</div>
										<div className="text-[11px] text-slate-400 truncate">{it.type || 'oggetto'}</div>
									</button>
									<div className="ml-3 flex items-center gap-2">
										{it.rarity && (
											<span className="text-[10px] uppercase tracking-wide text-fuchsia-300">{it.rarity}</span>
										)}
												{/* Non-varie are unstacked; no qty badge */}
										{(() => { const isEquipped = (equippedCounts[it.id] || 0) > 0; return (
											<button
														className={`ml-1 inline-flex items-center justify-center rounded-md border p-1.5 transition ${(busyId===it.id || isEquipped) ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-500/10'} border-red-400/40 text-red-300`}
														onClick={() => !isEquipped && setConfirmTarget({ id: it.id, name: display, invIndex: it.invIndex })}
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
									onClick={() => setShowVarieOverlay(true)}
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
												<button onClick={() => setPreviewItem(docObj)} className="min-w-0 text-left flex-1 hover:bg-slate-700/40 rounded-md px-2 py-1">
													<div className="text-sm text-slate-200 truncate">{it.name}</div>
													<div className="text-[11px] text-slate-400 truncate">Varie</div>
												</button>
												<div className="ml-3 flex items-center gap-2">
													<span className="text-xs text-amber-300">x{it.qty}</span>
													<button
														className={`ml-1 inline-flex items-center justify-center rounded-md border p-1.5 transition ${busyId===it.id ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-500/10'} border-red-400/40 text-red-300`}
														onClick={() => setConfirmTarget({ id: it.id, name: it.name })}
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

			{previewItem && (
				<ItemDetailsModal item={previewItem} onClose={() => setPreviewItem(null)} />
			)}

			{confirmTarget && (
				<ConfirmDeleteModal
					itemName={confirmTarget.name}
					onCancel={() => setConfirmTarget(null)}
					onConfirm={async () => {
						await removeOne(confirmTarget.id, confirmTarget.invIndex);
						setConfirmTarget(null);
					}}
					enableDeleteAll={true}
					onConfirmAll={async () => {
						// For non-varie, delete-all will still remove all by id
						await removeAllUnits(confirmTarget.id);
						setConfirmTarget(null);
					}}
				/>
			)}

			{/* Overlay to input gold delta */}
			{showGoldOverlay && (
				<div className="absolute inset-0 z-20 flex items-center justify-center">
					<div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !goldBusy && setShowGoldOverlay(false)} />
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
								onClick={() => !goldBusy && setShowGoldOverlay(false)}
								disabled={goldBusy}
							>
								Annulla
							</button>
							<button
								className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs ${goldDir>=0 ? 'bg-emerald-600/80 hover:bg-emerald-600 text-white' : 'bg-rose-600/80 hover:bg-rose-600 text-white'} disabled:opacity-60`}
								onClick={applyGoldDelta}
								disabled={goldBusy}
							>
								Conferma
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Overlay to add custom Varie item */}
			{showVarieOverlay && (
				<div className="absolute inset-0 z-20 flex items-center justify-center">
					<div
						className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
						onClick={() => {
							if (!vBusy) {
								setShowVarieOverlay(false);
								setVName(''); setVDesc(''); setVQty('1'); setVImageFile(null); setVImagePreviewUrl(null);
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
											setVImagePreviewUrl(f ? URL.createObjectURL(f) : null);
										}}
										className="text-xs text-slate-300"
									/>
									{vImagePreviewUrl && (
										<div className="flex items-center gap-2">
											<div className="h-10 w-10 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50">
												<img src={vImagePreviewUrl} alt="Preview" className="h-full w-full object-cover" />
											</div>
											<button type="button" onClick={() => { setVImageFile(null); setVImagePreviewUrl(null); }} className="text-[11px] text-slate-300 border border-slate-600/60 rounded px-2 py-1 hover:bg-slate-700/40">Rimuovi</button>
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
								onClick={() => { if (!vBusy) { setShowVarieOverlay(false); setVName(''); setVDesc(''); setVQty('1'); setVImageFile(null); setVImagePreviewUrl(null); } }}
								disabled={vBusy}
							>
								Annulla
							</button>
							<button
								className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white disabled:opacity-60`}
								onClick={addVarieItem}
								disabled={vBusy || !vName.trim()}
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
