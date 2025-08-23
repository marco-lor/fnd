import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../../AuthContext';
import { db } from '../../firebaseConfig';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
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
			// Normalize directly from user's inventory entries (which now contain full item data)
			const normalized = inv.map((e, i) => {
				if (!e) return null;
				if (typeof e === 'string') {
					const id = e;
					const name = id;
					return { id, name, qty: 1, doc: null };
				}
				const id = e.id || e.name || e?.General?.Nome || `item-${i}`;
				const name = e?.General?.Nome || e.name || id;
				return { id, name, qty: e.qty || 1, rarity: e.rarity, type: e.type, doc: { ...e, id } };
			}).filter(Boolean);
			// Collapse by id (keep first doc as representative)
			const map = {};
			for (const it of normalized) {
				if (!map[it.id]) map[it.id] = { ...it };
				else map[it.id].qty += it.qty || 1;
			}
			setItems(Object.values(map));
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

	// Remove a single unit of an item by id from the user's inventory
	const removeOne = async (targetId) => {
		if (!user || !targetId) return;
		try {
			setBusyId(targetId);
			const ref = doc(db, 'users', user.uid);
			const snap = await getDoc(ref);
			if (!snap.exists()) return;
			const data = snap.data() || {};
			const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];
			let removed = false;
			const next = [];
			for (let i = 0; i < inv.length; i++) {
				const entry = inv[i];
				if (removed) {
					next.push(entry);
					continue;
				}
				const id = deriveId(entry, i);
				if (id !== targetId) {
					next.push(entry);
					continue;
				}
				// Match found
				if (typeof entry === 'object' && entry && typeof entry.qty === 'number') {
					const newQty = Math.max(0, (entry.qty || 0) - 1);
					if (newQty > 0) {
						next.push({ ...entry, qty: newQty });
					}
				} else {
					// string or object without qty: remove this single occurrence by skipping push
				}
				removed = true;
			}
			if (!removed) return; // nothing to do
			await updateDoc(ref, { inventory: next });
		} catch (err) {
			console.error('Error removing item from inventory', err);
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
			inv.push({ id, name, description: (vDesc||'').trim(), type: 'varie', qty: qtyNum });
			await updateDoc(ref, { inventory: inv });
			setShowVarieOverlay(false);
			setVName(''); setVDesc(''); setVQty('1');
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
		<div className="relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg h-full max-h-[64vh] flex flex-col">
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
								{otherList.map((it) => {
			    const docObj = it.doc || it;
			    const imgUrl = docObj?.General?.image_url || it?.General?.image_url;
									return (
										<li key={it.id} className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
									{imgUrl && (
										<div className="h-8 w-8 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50 mr-2">
											<img src={imgUrl} alt={it.name} className="h-full w-full object-contain" />
										</div>
									)}
				    <button onClick={() => setPreviewItem(docObj)} className="min-w-0 text-left flex-1 hover:bg-slate-700/40 rounded-md px-2 py-1">
										<div className="text-sm text-slate-200 truncate">{it.name}</div>
										<div className="text-[11px] text-slate-400 truncate">{it.type || 'oggetto'}</div>
									</button>
									<div className="ml-3 flex items-center gap-2">
										{it.rarity && (
											<span className="text-[10px] uppercase tracking-wide text-fuchsia-300">{it.rarity}</span>
										)}
										<span className="text-xs text-amber-300">x{it.qty}</span>
										{(() => { const isEquipped = (equippedCounts[it.id] || 0) > 0; return (
											<button
												className={`ml-1 inline-flex items-center justify-center rounded-md border p-1.5 transition ${(busyId===it.id || isEquipped) ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-500/10'} border-red-400/40 text-red-300`}
												onClick={() => !isEquipped && setConfirmTarget({ id: it.id, name: it.name })}
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
									{varieList.map((it) => (
										<li key={it.id} className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
											<button onClick={() => setPreviewItem(it.doc || it)} className="min-w-0 text-left flex-1 hover:bg-slate-700/40 rounded-md px-2 py-1">
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
									))}
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
						await removeOne(confirmTarget.id);
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
					<div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !vBusy && setShowVarieOverlay(false)} />
					<div className="relative z-10 w-[28rem] max-w-[90vw] rounded-xl border border-slate-700/60 bg-slate-800/90 p-4 shadow-xl">
						<h3 className="text-sm font-semibold text-slate-200">Aggiungi oggetto "Varie"</h3>
						<div className="mt-3 grid grid-cols-1 gap-3">
							<div>
								<label className="block text-xs text-slate-300 mb-1">Nome</label>
								<input
									type="text"
									placeholder="Es. Corda di canapa"
									value={vName}
									onChange={(e) => setVName(e.target.value)}
									className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
								/>
							</div>
							<div>
								<label className="block text-xs text-slate-300 mb-1">Descrizione</label>
								<textarea
									rows={3}
									placeholder="Dettagli opzionali"
									value={vDesc}
									onChange={(e) => setVDesc(e.target.value)}
									className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
								/>
							</div>
							<div>
								<label className="block text-xs text-slate-300 mb-1">Quantità</label>
								<input
									type="number"
									min="1"
									value={vQty}
									onChange={(e) => setVQty(e.target.value)}
									className="w-28 rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
								/>
							</div>
						</div>
						<div className="mt-4 flex justify-end gap-2">
							<button
								className="inline-flex items-center justify-center rounded-md border border-slate-600/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40"
								onClick={() => !vBusy && setShowVarieOverlay(false)}
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
