import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebaseConfig";
import {
	collection,
	setDoc,
	doc,
	onSnapshot,
	query,
	serverTimestamp,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import { useAuth } from "../../AuthContext";
import DiceRoller from "../common/DiceRoller";

// Encounter schema (Firestore: collection "encounters")
// New structure:
// encounters/{encounterId}
//   { name, status: 'published'|'deleted', createdAt, createdBy, ...generalInfo }
//   participants (subcollection)
//     {userId}:
//       {
//         uid, characterId, email,
//         // runtime combat info for that player
//         initiative: { value, faces, modifier, rolledAt },
//         hp: { current, temp },
//         mana: { current },
//         conditions: string[],
//         notes: string,
//         updatedAt
//       }
//
// We keep participantIds and participants array on the parent doc for listing/indexing convenience.

const normalize = (s) => (s || "").trim().toLowerCase();

const Chip = ({ children, onRemove, muted }) => (
	<span
		className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-xl border text-xs mr-1 mb-1 ${
			muted
				? "bg-slate-800/60 border-slate-700/60 text-slate-200"
				: "bg-indigo-900/30 border-indigo-700/60 text-indigo-200"
		}`}
	>
		{children}
		{onRemove && (
			<button
				onClick={onRemove}
				aria-label="Remove"
				title="Remove"
				className="ml-1 text-slate-300 hover:text-white"
			>
				×
			</button>
		)}
	</span>
);

const Section = ({ title, children, actions }) => (
	<section className="group relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg mb-6">
		<div className="flex flex-wrap items-center justify-between gap-2">
			<h2 className="m-0 text-lg font-semibold text-slate-100">{title}</h2>
			<div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">{actions}</div>
		</div>
		<div className="mt-3 text-slate-200">{children}</div>
	</section>
);

const TextInput = ({ label, value, onChange, placeholder }) => (
	<label className="block mb-3">
		<div className="text-xs text-slate-300 mb-1.5">{label}</div>
		<input
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
		/>
	</label>
);

const TextArea = ({ label, value, onChange, placeholder, rows = 3 }) => (
	<label className="block mb-3">
		<div className="text-xs text-slate-300 mb-1.5">{label}</div>
		<textarea
			rows={rows}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
		/>
	</label>
);

const Button = ({ children, onClick, kind = "primary", disabled, title, size = "md" }) => {
	const sizeCls =
		size === "lg"
			? "px-4 py-2.5 rounded-2xl text-sm"
			: size === "sm"
			? "px-2.5 py-1.5 rounded-lg text-xs"
			: "px-3 py-2 rounded-xl text-sm";
	const base = `${sizeCls} transition focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed`;
	const variants = {
		primary:
			"group relative overflow-hidden bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow hover:shadow-indigo-900/30 focus:ring-2 focus:ring-indigo-400/60",
		secondary:
			"bg-slate-800/80 text-slate-100 border border-slate-600/60 hover:bg-slate-800/60",
		danger:
			"bg-red-900/40 text-red-200 border border-red-800/60 hover:bg-red-900/60",
	};
	return (
		<button onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[kind]}`}>
			<span className="relative z-10">{children}</span>
			{kind === "primary" && (
				<span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.2),transparent_70%)]" />
			)}
		</button>
	);
};

const EncounterCreator = ({ isDM, currentUid }) => {
	const [name, setName] = useState("");
	const [assignableUsers, setAssignableUsers] = useState([]); // {uid, characterId, email}
	const [selected, setSelected] = useState([]); // same shape as above
	const [singleInput, setSingleInput] = useState("");
	const [notFound, setNotFound] = useState([]);
	const [creating, setCreating] = useState(false);

	// Load assignable users (role in [player, webmaster]) in realtime
	useEffect(() => {
		if (!isDM) return; // Fetch list only for DM UI
		const usersCol = collection(db, "users");
		const qUsers = query(usersCol, where("role", "in", ["player", "webmaster"]));
		const unsub = onSnapshot(qUsers, (snap) => {
			const list = [];
			snap.forEach((d) => {
				const data = d.data();
				// Prefer the auth UID stored in the user document, fallback to doc id
				const authUid = data?.uid || d.id;
				list.push({
					uid: authUid,
					characterId: data.characterId || "",
					email: data.email || "",
				});
			});
			setAssignableUsers(list);
		});
		return () => unsub();
	}, [isDM]);

	const byCharId = useMemo(() => {
		const map = new Map();
		for (const u of assignableUsers) {
			if (u.characterId) map.set(normalize(u.characterId), u);
		}
		return map;
	}, [assignableUsers]);

	const addByCharacterId = (cid) => {
		const key = normalize(cid);
		if (!key) return;
		const user = byCharId.get(key);
		if (!user) {
			setNotFound((nf) => Array.from(new Set([...nf, cid])));
			return;
		}
		setSelected((prev) => {
			if (prev.some((p) => p.uid === user.uid)) return prev;
			return [...prev, user];
		});
	};

	const removeSelected = (uid) => setSelected((prev) => prev.filter((p) => p.uid !== uid));

	const onAddSingle = () => {
		addByCharacterId(singleInput);
		setSingleInput("");
	};

		const onAddAll = () => {
			const toAdd = assignableUsers.filter((u) => !selected.some((s) => s.uid === u.uid));
			if (toAdd.length) setSelected((prev) => [...prev, ...toAdd]);
		};

	const canCreate = isDM && name.trim().length > 0 && selected.length > 0 && !creating;

	const createEncounter = async () => {
		if (!canCreate) return;
		try {
			setCreating(true);
			const participants = selected.map((u) => ({ uid: u.uid, characterId: u.characterId || "", email: u.email || "" }));
			// Use a batch to create the encounter and all per-user docs atomically
			const batch = writeBatch(db);
			const encRef = doc(collection(db, "encounters"));
			batch.set(encRef, {
				name: name.trim(),
				status: "published",
				createdAt: serverTimestamp(),
				createdBy: currentUid,
				participants,
				participantIds: participants.map((p) => p.uid),
				participantCharacterIds: participants.map((p) => p.characterId).filter(Boolean),
			});
			for (const p of participants) {
				const pRef = doc(encRef, "participants", p.uid);
				batch.set(pRef, {
					uid: p.uid,
					characterId: p.characterId || null,
					email: p.email || null,
					initiative: null,
					hp: { current: null, temp: 0 },
					mana: { current: null },
					conditions: [],
					notes: "",
					updatedAt: serverTimestamp(),
				});
			}
			await batch.commit();
			// Reset form
			setName("");
			setSelected([]);
			setNotFound([]);
		} catch (err) {
			console.error("Failed to create encounter", err);
			alert("Failed to create encounter. Check console for details.");
		} finally {
			setCreating(false);
		}
	};

	if (!isDM) return null;

		return (
			<Section
					title="Create Encounter"
					actions={<Button size="lg" onClick={createEncounter} disabled={!canCreate}>Crea Encounter</Button>}
			>
				<div className="grid grid-cols-1 gap-4">
					<TextInput label="Encounter name" value={name} onChange={setName} placeholder="e.g., Goblin Ambush" />

					<div>
						<div className="text-xs text-slate-300 mb-1.5">Add player by Character ID</div>
						<div className="flex flex-wrap gap-2 items-center">
							<input
								value={singleInput}
								onChange={(e) => setSingleInput(e.target.value)}
								placeholder="Exact characterId"
								list="characterIdOptions"
								className="min-w-0 flex-1 px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
							/>
							<datalist id="characterIdOptions">
								{assignableUsers
									.filter((u) => u.characterId)
									.sort((a, b) => a.characterId.localeCompare(b.characterId))
									.map((u) => (
										<option key={u.uid} value={u.characterId} />
									))}
							</datalist>
							<div className="shrink-0">
								<Button size="sm" kind="secondary" onClick={onAddSingle} disabled={!singleInput.trim()}>Add</Button>
							</div>
							<div className="shrink-0">
								<Button
									size="sm"
									kind="secondary"
									onClick={onAddAll}
									disabled={assignableUsers.filter((u) => !selected.some((s) => s.uid === u.uid)).length === 0}
									title="Aggiungi tutti i giocatori disponibili"
								>
									Aggiungi tutti
								</Button>
							</div>
						</div>
						<div className="mt-1 text-[11px] text-slate-400">Suggerimento: inizia a digitare per vedere le opzioni.</div>
					</div>

					{notFound.length > 0 && (
						<div className="text-xs text-rose-200 bg-rose-900/30 border border-rose-800/60 rounded-md px-2 py-1.5">
							Unknown characterIds: {notFound.join(", ")}
						</div>
					)}

					<div>
						<div className="text-xs text-slate-300 mb-1.5">Selected players</div>
						<div className="min-h-[2.25rem] rounded-xl border border-slate-700/60 bg-slate-900/40 p-2">
							{selected.length === 0 && <span className="text-slate-400">None selected yet</span>}
							{selected.map((u) => (
								<Chip key={u.uid} onRemove={() => removeSelected(u.uid)}>
									{u.characterId || u.email || u.uid}
								</Chip>
							))}
						</div>
					</div>
				</div>
			</Section>
		);
};

const EncountersList = ({ isDM, currentUid }) => {
	const [encounters, setEncounters] = useState([]);
	const [loading, setLoading] = useState(true);
	const [expanded, setExpanded] = useState({}); // { [encounterId]: true }
	const mountedRef = useRef(false);
	const { user, userData } = useAuth();

		useEffect(() => {
			if (!user) return;
			const baseColl = collection(db, "encounters");
			// DM sees all; non-DM see by UID or by characterId
			if (isDM) {
				const unsubAll = onSnapshot(baseColl, (snap) => {
					const rows = [];
					snap.forEach((d) => {
						const data = d.data();
						if (!data || data.status === "deleted") return;
						rows.push({ id: d.id, ...data });
					});
					rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
					setEncounters(rows);
					setLoading(false);
				});
				return () => unsubAll();
			}

			const unsubs = [];
			const byId = new Map();
			const applySnap = (snap) => {
				snap.forEach((d) => {
					const data = d.data();
					if (!data || data.status === "deleted") return;
					byId.set(d.id, { id: d.id, ...data });
				});
				const rows = Array.from(byId.values());
				rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
				setEncounters(rows);
				setLoading(false);
			};

			// Query by participant UID
			unsubs.push(
				onSnapshot(query(baseColl, where("participantIds", "array-contains", user.uid)), applySnap)
			);
			// Query by characterId if available
			const cid = userData?.characterId;
			if (cid) {
				unsubs.push(
					onSnapshot(query(baseColl, where("participantCharacterIds", "array-contains", cid)), applySnap)
				);
			}
			return () => unsubs.forEach((u) => u());
		}, [isDM, user, userData?.characterId]);

	const setStatus = async (id, status) => {
		try {
			await updateDoc(doc(db, "encounters", id), { status });
		} catch (e) {
			console.error("Failed to update status", e);
			alert("Failed to update encounter status.");
		}
	};

		const handleDelete = async (id, name) => {
			const ok = window.confirm(
				`Sei sicuro di voler eliminare l'incontro${name ? ` "${name}"` : ""}?\nQuesta azione lo sposterà nello stato 'deleted'.`
			);
			if (!ok) return;
			await setStatus(id, "deleted");
		};

			const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

		if (loading) return <div className="text-slate-300">Loading encounters…</div>;

	return (
			<Section title="Encounters">
			{encounters.length === 0 ? (
					<div className="text-slate-400">No encounters yet.</div>
			) : (
					<div className="grid gap-2">
					{encounters.map((e) => (
										<div key={e.id} className="border border-slate-700/50 rounded-2xl p-3 bg-slate-900/60 grid gap-2">
											<div className="flex items-center justify-between gap-2">
									<div>
												<div className="font-semibold text-slate-100">{e.name || "Untitled"}</div>
									</div>
												<div className="flex flex-wrap gap-2 items-center justify-end">
													<Button kind="secondary" onClick={() => toggleExpand(e.id)}>
														{expanded[e.id] ? "Nascondi" : "Espandi"}
													</Button>
													{isDM && (
														<>
															<Button kind="danger" onClick={() => handleDelete(e.id, e.name)}>Delete</Button>
														</>
													)}
												</div>
								</div>
								<div>
									<div className="text-xs text-slate-300 mb-1.5">Players</div>
									<div>
										{(e.participants || []).map((p) => (
											<Chip key={p.uid} muted>
												{p.characterId || p.email || p.uid}
											</Chip>
										))}
										{(!e.participants || e.participants.length === 0) && (
											<span className="text-slate-400">No players</span>
										)}
									</div>
								</div>
											{expanded[e.id] && (
												<EncounterDetails encounter={e} isDM={isDM} />
											)}
							</div>
					))}
				</div>
			)}
		</Section>
	);
};

				const EncounterDetails = ({ encounter, isDM }) => {
					const { user, userData } = useAuth();
					const [initMap, setInitMap] = useState({}); // { uid: { value, faces, modifier, rolledAt } | number | null }
					const [participantsMap, setParticipantsMap] = useState({}); // { uid: full participant doc }
					const [roller, setRoller] = useState({ visible: false, faces: 0, modifier: 0 });
					const [dadiAnimaByLevel, setDadiAnimaByLevel] = useState([]);
					// Self-edit state for the current participant
					const [selfState, setSelfState] = useState({ hpCurrent: "", hpTemp: "", manaCurrent: "", conditions: "", notes: "" });
					// Store the key of my participant doc (could be uid or characterId for legacy data)
					const [myDocKey, setMyDocKey] = useState(null);

					// Determine if the current user is a participant using the live subcollection snapshot
					const isParticipant = useMemo(() => {
						if (!user) return false;
						const cid = userData?.characterId;
						const keys = Object.keys(participantsMap || {});
						return keys.includes(user.uid) || (cid ? keys.includes(cid) : false);
					}, [user, userData?.characterId, participantsMap]);

					useEffect(() => {
						// Load dadiAnimaByLevel once
						(async () => {
							try {
								const snap = await import("firebase/firestore").then(({ doc, getDoc }) =>
									getDoc(doc(db, "utils", "varie"))
								);
								if (snap.exists()) setDadiAnimaByLevel(snap.data().dadiAnimaByLevel || []);
							} catch {}
						})();
					}, []);

					useEffect(() => {
						// Subscribe to participants subcollection (per-user docs)
						const coll = collection(db, "encounters", encounter.id, "participants");
						const unsub = onSnapshot(coll, (snap) => {
							const init = {};
							const pmap = {};
							snap.forEach((d) => {
								const data = d.data() || {};
								pmap[d.id] = data;
								init[d.id] = data?.initiative || null;
							});
							setParticipantsMap(pmap);
							setInitMap(init);
						});
						return () => unsub();
					}, [encounter.id]);

					// Determine my participant document key and populate self edit form
					useEffect(() => {
						if (!user) return;
						const cid = userData?.characterId;
						const candidate = participantsMap[user.uid] || (cid ? participantsMap[cid] : null);
						if (candidate) {
							setMyDocKey(participantsMap[user.uid] ? user.uid : cid || null);
							setSelfState({
								hpCurrent: candidate?.hp?.current ?? "",
								hpTemp: candidate?.hp?.temp ?? "",
								manaCurrent: candidate?.mana?.current ?? "",
								conditions: Array.isArray(candidate?.conditions) ? candidate.conditions.join(", ") : "",
								notes: candidate?.notes ?? "",
							});
						}
					}, [participantsMap, user, userData?.characterId]);

					const getDexTot = () => {
						const base = userData?.Parametri?.Base || {};
						const key = Object.keys(base).find((k) => k.toLowerCase() === "destrezza");
						return Number(base?.[key]?.Tot) || 0;
					};

					const computeFaces = () => {
						const lvl = Number(userData?.stats?.level) || 0;
						const diceStr = dadiAnimaByLevel[(lvl - 1) | 0] || dadiAnimaByLevel[lvl] || "";
						const faces = parseInt(String(diceStr).replace(/^d/i, ""), 10);
						return Number.isFinite(faces) && faces > 0 ? faces : 0;
					};

					const startRoll = () => {
						const faces = computeFaces();
						const modifier = getDexTot();
						if (!faces) return alert("Impossibile determinare il Dado Anima.");
						setRoller({ visible: true, faces, modifier });
					};

					const saveInitiative = async (total, faces, modifier) => {
						if (!user) return;
						try {
							const key = myDocKey || user.uid;
							await setDoc(
								doc(db, "encounters", encounter.id, "participants", key),
								{
									uid: user.uid,
									characterId: userData?.characterId || null,
									email: user?.email || null,
									initiative: {
										value: total,
										faces,
										modifier,
										rolledAt: serverTimestamp(),
									},
									updatedAt: serverTimestamp(),
								},
								{ merge: true }
							);
						} catch (e) {
							console.error("Failed to save initiative", e);
							alert("Non hai i permessi per salvare l'iniziativa. Contatta il DM.");
						}
					};

					const saveSelfState = async () => {
						if (!user) return;
						const conditions = selfState.conditions
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						try {
							const key = myDocKey || user.uid;
							await setDoc(
								doc(db, "encounters", encounter.id, "participants", key),
								{
									uid: user.uid,
									hp: { current: selfState.hpCurrent === "" ? null : Number(selfState.hpCurrent), temp: selfState.hpTemp === "" ? 0 : Number(selfState.hpTemp) },
									mana: { current: selfState.manaCurrent === "" ? null : Number(selfState.manaCurrent) },
									conditions,
									notes: selfState.notes,
									updatedAt: serverTimestamp(),
								},
								{ merge: true }
							);
						} catch (e) {
							console.error("Failed to save player state", e);
							alert("Non hai i permessi per aggiornare il tuo stato. Contatta il DM.");
						}
					};

					// Build rows directly from the live participants subcollection for real-time updates
					const rows = Object.entries(participantsMap).map(([docKey, data]) => {
						const initiativeVal = data?.initiative?.value ?? (typeof data?.initiative === "number" ? data.initiative : null);
						return {
							key: docKey,
							uid: data?.uid || docKey,
							label: data?.characterId || data?.email || data?.uid || docKey,
							initiative: initiativeVal,
							meta: data && typeof data.initiative === "object" ? data.initiative : initiativeVal != null ? { value: initiativeVal } : null,
						};
					});
					rows.sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity));

					return (
						<div className="mt-2 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
							<div className="flex items-center justify-between mb-2 gap-2">
								<div className="text-sm text-slate-300">Dettagli Incontro</div>
								<div className="flex flex-wrap gap-2 justify-end">
									{isParticipant && (
										<Button kind="primary" onClick={startRoll}>
											Tira Iniziativa (Dado Anima + Destrezza)
										</Button>
									)}
									{isDM && (
										<Button
											kind="danger"
											onClick={async () => {
												const ok = window.confirm(`Sei sicuro di voler eliminare l'incontro${encounter.name ? ` "${encounter.name}"` : ""}?\nQuesta azione lo sposterà nello stato 'deleted'.`);
												if (!ok) return;
												try {
													await updateDoc(doc(db, "encounters", encounter.id), { status: "deleted" });
												} catch (e) {
													console.error(e);
													alert("Failed to delete");
												}
											}}
										>
											Delete
										</Button>
									)}
								</div>
							</div>

							{isParticipant && (
								<div className="mb-3 grid gap-2 md:grid-cols-2">
									<div className="text-xs text-slate-400 md:col-span-2">Aggiorna il tuo stato</div>
									<div className="flex gap-2">
										<input
											type="number"
											value={selfState.hpCurrent}
											onChange={(e) => setSelfState((s) => ({ ...s, hpCurrent: e.target.value }))}
											placeholder="HP attuali"
											className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
										/>
										<input
											type="number"
											value={selfState.hpTemp}
											onChange={(e) => setSelfState((s) => ({ ...s, hpTemp: e.target.value }))}
											placeholder="HP temporanei"
											className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
										/>
									</div>
									<div className="flex gap-2">
										<input
											type="number"
											value={selfState.manaCurrent}
											onChange={(e) => setSelfState((s) => ({ ...s, manaCurrent: e.target.value }))}
											placeholder="Mana attuale"
											className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
										/>
										<input
											value={selfState.conditions}
											onChange={(e) => setSelfState((s) => ({ ...s, conditions: e.target.value }))}
											placeholder="Condizioni (separate da virgola)"
											className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
										/>
									</div>
									<textarea
										rows={2}
										value={selfState.notes}
										onChange={(e) => setSelfState((s) => ({ ...s, notes: e.target.value }))}
										placeholder="Note personali per il combattimento"
										className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
									/>
									<div>
										<Button kind="secondary" onClick={saveSelfState}>Salva Stato</Button>
									</div>
								</div>
							)}
							<div className="overflow-x-auto">
								<table className="w-full text-sm text-left text-slate-300">
									<thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
										<tr>
											<th className="px-3 py-2 font-medium">Giocatore</th>
											<th className="px-3 py-2 text-center font-medium">Iniziativa</th>
											<th className="px-3 py-2 text-center font-medium">Dettagli</th>
											{isDM && (
												<th className="px-3 py-2 text-center font-medium">HP/Mana</th>
											)}
										</tr>
									</thead>
									<tbody className="divide-y divide-white/5">
										{rows.map((r) => (
											<tr key={r.key} className="odd:bg-transparent even:bg-white/[0.02]">
												<td className="px-3 py-2 text-white">{r.label}</td>
												<td className="px-3 py-2 text-center">
													{r.initiative !== null ? (
														<span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums">
															{r.initiative}
														</span>
													) : (
														<span className="text-slate-500">—</span>
													)}
												</td>
												<td className="px-3 py-2 text-center text-xs text-slate-400">
													{r.meta ? `d${r.meta.faces} ${r.meta.modifier ? "+ " + r.meta.modifier : ""}` : ""}
												</td>
												{isDM && (
													<td className="px-3 py-2 text-center text-xs text-slate-400">
														{(() => {
															const p = participantsMap[r.key] || {};
															const hp = p.hp || {};
															const mana = p.mana || {};
															return `HP ${hp.current ?? "?"}${hp.temp ? ` (+${hp.temp})` : ""} / Mana ${mana.current ?? "?"}`;
														})()}
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{roller.visible && (
								<DiceRoller
									faces={roller.faces}
									count={1}
									modifier={roller.modifier}
									description={`Iniziativa (d${roller.faces} + ${roller.modifier})`}
									onComplete={(total) => {
										saveInitiative(total, roller.faces, roller.modifier);
										setRoller({ visible: false, faces: 0, modifier: 0 });
									}}
								/>
							)}
						</div>
					);
				};

// Sidebar list of encounters (click to view details on the right)
const EncounterSidebarList = ({ isDM, onSelect, selectedId }) => {
	const { user, userData } = useAuth();
    const [encounters, setEncounters] = useState([]);
    const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!user) return;
		const baseColl = collection(db, "encounters");
		if (isDM) {
			const unsubAll = onSnapshot(baseColl, (snap) => {
				const rows = [];
				snap.forEach((d) => {
					const data = d.data();
					if (!data || data.status === "deleted") return;
					rows.push({ id: d.id, ...data });
				});
				rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
				setEncounters(rows);
				setLoading(false);
			});
			return () => unsubAll();
		}

		const unsubs = [];
		const byId = new Map();
		const applySnap = (snap) => {
			snap.forEach((d) => {
				const data = d.data();
				if (!data || data.status === "deleted") return;
				byId.set(d.id, { id: d.id, ...data });
			});
			const rows = Array.from(byId.values());
			rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
			setEncounters(rows);
			setLoading(false);
		};

		// by UID
		unsubs.push(onSnapshot(query(baseColl, where("participantIds", "array-contains", user.uid)), applySnap));
		// by characterId
		const cid = userData?.characterId;
		if (cid) {
			unsubs.push(onSnapshot(query(baseColl, where("participantCharacterIds", "array-contains", cid)), applySnap));
		}
		return () => unsubs.forEach((u) => u());
	}, [isDM, user, userData?.characterId]);

    useEffect(() => {
        if (!onSelect) return;
        if (loading) return;
        if (selectedId) return;
        if (encounters.length > 0) onSelect(encounters[0]);
    }, [onSelect, loading, selectedId, encounters]);

    if (loading) return <div className="text-slate-300">Loading encounters…</div>;

    return (
        <Section title="Encounters">
            {encounters.length === 0 ? (
                <div className="text-slate-400">No encounters yet.</div>
            ) : (
                <div className="grid gap-2">
                    {encounters.map((e) => {
                        const isSelected = selectedId === e.id;
                        return (
                            <button
                                key={e.id}
                                onClick={() => onSelect && onSelect(e)}
                                className={`text-left border rounded-2xl p-3 transition bg-slate-900/60 border-slate-700/50 hover:border-indigo-600/60 hover:bg-slate-900/80 ${
                                    isSelected ? "ring-2 ring-indigo-500/60" : ""
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
									<div>
										<div className="font-semibold text-slate-100 truncate">{e.name || "Untitled"}</div>
									</div>
                                    <div className="text-xs text-slate-400">
                                        {(e.participants || []).length} players
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </Section>
    );
};

const CombatPage = () => {
	const { user, userData } = useAuth();
	const isDM = (userData?.role || "") === "dm"; // Webmaster is NOT treated as DM here

	const [selectedEncounter, setSelectedEncounter] = useState(null);

	return (
		<div className="relative w-full min-h-screen overflow-hidden">
			{/* Background overlay similar to Home */}
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_60%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.04),transparent_65%)] mix-blend-overlay" />

			<div className="relative z-10 flex flex-col h-full">
				<header className="px-6 pt-6">
					<h1 className="text-2xl font-semibold text-slate-100">Combat Tool</h1>
				</header>

				<main className="flex-1 px-6 pb-6 pt-4 w-full">
					{!user && <div className="text-slate-300">Please log in to access encounters.</div>}

					{user && (
						<div className="grid grid-cols-1 md:grid-cols-[20rem_1fr] gap-6 items-start">
							<div className="md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-5rem)] overflow-y-auto pr-1">
								{isDM && <EncounterCreator isDM={isDM} currentUid={user.uid} />}
								<EncounterSidebarList
									isDM={isDM}
									onSelect={setSelectedEncounter}
									selectedId={selectedEncounter?.id}
								/>
							</div>
							<div className="min-h-[50vh]">
								{selectedEncounter ? (
									<Section title={selectedEncounter.name || "Encounter"}>
										<EncounterDetails encounter={selectedEncounter} isDM={isDM} />
									</Section>
								) : (
									<Section title="Encounter Details">
										<div className="text-slate-400">Seleziona un incontro dalla lista a sinistra.</div>
									</Section>
								)}
							</div>
						</div>
					)}
				</main>
			</div>
		</div>
	);
};

export default CombatPage;

