import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../../AuthContext';
import { db } from '../../firebaseConfig';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { FiPackage, FiSearch } from 'react-icons/fi';

// Simple inventory browser to occupy the right column
// Shows a searchable, grouped list of items in user's inventory
const Inventory = () => {
	const { user } = useContext(AuthContext);
	const [items, setItems] = useState([]);
	const [q, setQ] = useState('');
	const [catalog, setCatalog] = useState({}); // id -> General.Nome

	useEffect(() => {
		if (!user) return;
		const unsub = onSnapshot(doc(db, 'users', user.uid), snap => {
			const data = snap.data();
			const inv = Array.isArray(data?.inventory) ? data.inventory : [];
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
			snap.forEach(docSnap => {
				const data = docSnap.data();
				const display = data?.General?.Nome || data?.name || docSnap.id;
				next[docSnap.id] = display;
			});
			setCatalog(next);
		});
		return () => unsub();
	}, []);

	const filtered = items.filter(it =>
		!q || it.name?.toLowerCase().includes(q.toLowerCase()) || it.type?.toLowerCase().includes(q.toLowerCase())
	);

	return (
		<div className="relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg h-full flex flex-col">
			<div className="absolute -left-10 -top-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl" />
			<div className="absolute -right-10 -bottom-10 w-48 h-48 bg-fuchsia-500/10 rounded-full blur-3xl" />

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
						{filtered.map((it) => (
							<li key={it.id} className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
								<div className="min-w-0">
									<div className="text-sm text-slate-200 truncate">{it.name}</div>
									<div className="text-[11px] text-slate-400 truncate">{it.type || 'oggetto'}</div>
								</div>
								<div className="ml-3 flex items-center gap-2">
									{it.rarity && (
										<span className="text-[10px] uppercase tracking-wide text-fuchsia-300">{it.rarity}</span>
									)}
									<span className="text-xs text-amber-300">x{it.qty}</span>
								</div>
							</li>
						))}
					</ul>
				) : (
					<div className="text-slate-400 text-sm">Inventario vuoto.</div>
				)}
			</div>
		</div>
	);
};

export default Inventory;
