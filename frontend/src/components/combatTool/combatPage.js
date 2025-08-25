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
//   { name, status: 'draft'|'published'|'deleted', createdAt, createdBy, ...generalInfo }
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
		<div className="flex items-center justify-between">
			<h2 className="m-0 text-lg font-semibold text-slate-100">{title}</h2>
			<div className="flex gap-2">{actions}</div>
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

const Button = ({ children, onClick, kind = "primary", disabled, title }) => {
	const base = "px-3 py-2 rounded-xl text-sm transition focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed";
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
				list.push({
					uid: d.id,
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
				status: "draft",
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
				actions={<Button onClick={createEncounter} disabled={!canCreate}>Create (draft)</Button>}
			>
				<TextInput label="Encounter name" value={name} onChange={setName} placeholder="e.g., Goblin Ambush" />

						<div className="grid grid-cols-1 gap-3">
					<div>
						<div className="text-xs text-slate-300 mb-1.5">Add player by Character ID</div>
						<div className="flex gap-2">
							<input
								value={singleInput}
								onChange={(e) => setSingleInput(e.target.value)}
								placeholder="Exact characterId"
								list="characterIdOptions"
								className="flex-1 px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
							/>
							<datalist id="characterIdOptions">
								{assignableUsers
									.filter((u) => u.characterId)
									.sort((a, b) => a.characterId.localeCompare(b.characterId))
									.map((u) => (
										<option key={u.uid} value={u.characterId} />
									))}
							</datalist>
							<Button kind="secondary" onClick={onAddSingle} disabled={!singleInput.trim()}>Add</Button>
									<Button
										kind="secondary"
										onClick={onAddAll}
										disabled={assignableUsers.filter((u) => !selected.some((s) => s.uid === u.uid)).length === 0}
										title="Aggiungi tutti i giocatori disponibili"
									>
										Aggiungi tutti
									</Button>
						</div>
					</div>

					{notFound.length > 0 && (
						<div className="text-xs text-rose-200 bg-rose-900/30 border border-rose-800/60 rounded-md px-2 py-1.5">
							Unknown characterIds: {notFound.join(", ")}
						</div>
					)}

					<div>
						<div className="text-xs text-slate-300 mb-1.5">Selected players</div>
						<div>
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
	const { user } = useAuth();

		useEffect(() => {
			if (!user) return;
			const baseColl = collection(db, "encounters");
			const qRef = isDM
				? baseColl
				: query(baseColl, where("participantIds", "array-contains", user.uid), where("status", "in", ["draft", "published"]));

			// Realtime: DM sees all; players see only their encounters
			const unsub = onSnapshot(qRef, (snap) => {
			const rows = [];
			snap.forEach((d) => {
				const data = d.data();
				if (!data) return;
					// Client-side hide deleted just in case
					if (data.status === "deleted") return;
				if (isDM) {
					rows.push({ id: d.id, ...data });
				} else {
						rows.push({ id: d.id, ...data });
				}
			});
			// Sort by createdAt desc
			rows.sort((a, b) => {
				const ta = a.createdAt?.toMillis?.() || 0;
				const tb = b.createdAt?.toMillis?.() || 0;
				return tb - ta;
			});
			setEncounters(rows);
			setLoading(false);
		});
		return () => unsub();
	}, [isDM, user]);

	const setStatus = async (id, status) => {
		try {
			await updateDoc(doc(db, "encounters", id), {
				status,
			});
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
										<div className="text-xs text-slate-400">Status: {e.status}</div>
									</div>
												<div className="flex gap-2 items-center">
													<Button kind="secondary" onClick={() => toggleExpand(e.id)}>
														{expanded[e.id] ? "Nascondi" : "Espandi"}
													</Button>
													{isDM && (
														<>
															{e.status !== "published" && (
																<Button kind="primary" onClick={() => setStatus(e.id, "published")}>Publish</Button>
															)}
															{e.status !== "draft" && (
																<Button kind="secondary" onClick={() => setStatus(e.id, "draft")}>Mark Draft</Button>
															)}
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

					const isParticipant = useMemo(() => {
						if (!user) return false;
						return Array.isArray(encounter.participantIds) && encounter.participantIds.includes(user.uid);
					}, [user, encounter.participantIds]);

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

					// Populate self edit form when my doc changes
					useEffect(() => {
						if (!user) return;
						const me = participantsMap[user.uid];
						if (me) {
							setSelfState({
								hpCurrent: me?.hp?.current ?? "",
								hpTemp: me?.hp?.temp ?? "",
								manaCurrent: me?.mana?.current ?? "",
								conditions: Array.isArray(me?.conditions) ? me.conditions.join(", ") : "",
								notes: me?.notes ?? "",
							});
						}
					}, [participantsMap, user]);

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
							await setDoc(
								doc(db, "encounters", encounter.id, "participants", user.uid),
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
							await setDoc(
								doc(db, "encounters", encounter.id, "participants", user.uid),
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

					// Prefer reading participants from the subcollection; if absent, fall back to the parent list.
					const participants = encounter.participants || [];
					const rows = participants.map((p) => {
						const init = initMap[p.uid] || null;
						return {
							uid: p.uid,
							label: p.characterId || p.email || p.uid,
							initiative: init?.value ?? (init && typeof init === "number" ? init : null),
							meta: init && typeof init === "object" ? init : init ? { value: init } : null,
						};
					});
					rows.sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity));

					return (
						<div className="mt-2 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
							<div className="flex items-center justify-between mb-2">
								<div className="text-sm text-slate-300">Dettagli Incontro</div>
								{isParticipant && (
									<Button kind="primary" onClick={startRoll}>
										Tira Iniziativa (Dado Anima + Destrezza)
									</Button>
								)}
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
											<th className="px-3 py-2 text-center font-medium">HP/Mana</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-white/5">
										{rows.map((r) => (
											<tr key={r.uid} className="odd:bg-transparent even:bg-white/[0.02]">
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
												<td className="px-3 py-2 text-center text-xs text-slate-400">
													{(() => {
														const p = participantsMap[r.uid] || {};
														const hp = p.hp || {};
														const mana = p.mana || {};
														return `HP ${hp.current ?? "?"}${hp.temp ? ` (+${hp.temp})` : ""} / Mana ${mana.current ?? "?"}`;
													})()}
												</td>
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

const CombatPage = () => {
	const { user, userData } = useAuth();
	const isDM = (userData?.role || "") === "dm"; // Webmaster is NOT treated as DM here

		return (
			<div className="relative w-full min-h-screen overflow-x-hidden">
				{/* Background overlay similar to Home */}
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_60%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.04),transparent_65%)] mix-blend-overlay" />

				<div className="relative z-10 flex flex-col">
					<main className="flex flex-col p-6 w-full gap-6 max-w-5xl mx-auto">
						<h1 className="text-2xl font-semibold text-slate-100">Combat Tool</h1>

						{!user && <div className="text-slate-300">Please log in to access encounters.</div>}

						{user && (
							<>
								<EncounterCreator isDM={isDM} currentUid={user.uid} />
								<EncountersList isDM={isDM} currentUid={user.uid} />
							</>
						)}
					</main>
				</div>
			</div>
		);
};

export default CombatPage;

