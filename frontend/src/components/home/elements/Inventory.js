import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../../AuthContext';
import { db } from '../../firebaseConfig';
import { doc, onSnapshot, collection, getDoc, updateDoc } from 'firebase/firestore';
import { FiPackage, FiSearch, FiTrash2 } from 'react-icons/fi';
import { FaCoins } from 'react-icons/fa';
import ItemDetailsModal from './ItemDetailsModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

// Simple inventory browser to occupy the right column
// Shows a searchable, grouped list of items in user's inventory
const Inventory = () => {
	const { user } = useContext(AuthContext);
	const [items, setItems] = useState([]);
	const [q, setQ] = useState('');
	const [catalog, setCatalog] = useState({}); // id -> General.Nome
	const [docs, setDocs] = useState({}); // id -> full item doc
	const [previewItem, setPreviewItem] = useState(null);
	const [gold, setGold] = useState(0);
	const [busyId, setBusyId] = useState(null);
    const [confirmTarget, setConfirmTarget] = useState(null); // { id, name }
	const [equippedCounts, setEquippedCounts] = useState({}); // id -> count equipped

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
			// Normalize
			const normalized = inv.map((e, i) => {
				if (!e) return null;
				if (typeof e === 'string') {
					const id = e;
					const name = catalog[id] || id;
					return { id, name, qty: 1 };
				}
				const id = e.id || e.name || e?.General?.Nome || `item-${i}`;
				const name = catalog[id] || e?.General?.Nome || e.name || id;
				return { id, name, qty: e.qty || 1, rarity: e.rarity, type: e.type, ...e };
			}).filter(Boolean);
			// Collapse by id
			const map = {};
			for (const it of normalized) {
				if (!map[it.id]) map[it.id] = { ...it };
				else map[it.id].qty += it.qty || 1;
			}
			setItems(Object.values(map));
		});
		return () => unsub();
	}, [user, catalog]);

	// Load item catalog once (id -> General.Nome)
	useEffect(() => {
		const unsub = onSnapshot(collection(db, 'items'), snap => {
			const next = {};
			const full = {};
			snap.forEach(docSnap => {
				const data = docSnap.data();
				const display = data?.General?.Nome || data?.name || docSnap.id;
				next[docSnap.id] = display;
				full[docSnap.id] = { id: docSnap.id, ...data };
			});
			setCatalog(next);
			setDocs(full);
		});
		return () => unsub();
	}, []);

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

	const filtered = items.filter(it =>
		!q || it.name?.toLowerCase().includes(q.toLowerCase()) || it.type?.toLowerCase().includes(q.toLowerCase())
	);

	return (
		<div className="relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg h-full flex flex-col">
			<div className="absolute -left-10 -top-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl" />
			<div className="absolute -right-10 -bottom-10 w-48 h-48 bg-fuchsia-500/10 rounded-full blur-3xl" />

			{/* Gold badge */}
			<div className="absolute top-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 backdrop-blur-sm">
				<FaCoins className="h-3.5 w-3.5 text-amber-300" />
				<span className="text-xs font-medium text-amber-200">{gold}</span>
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
				{filtered.length ? (
					<ul className="space-y-2">
						{filtered.map((it) => {
							const docObj = docs[it.id] ? { ...docs[it.id], ...it } : it;
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
		</div>
	);
};

export default Inventory;
