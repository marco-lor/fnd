// Dedicated script for handling the "Avanza" (advance turn) button logic.
// Extracted from EncounterDetails to keep component lean.
import { collection, addDoc, doc, runTransaction, serverTimestamp } from "firebase/firestore";

/**
 * Advance the encounter turn order.
 *
 * Contract:
 *  - Requires: isDM true and an existing turnState in encounter meta.
 *  - Updates: encounters/{encounter.id}.turn (index, round, updatedAt).
 *  - Logs: adds a document to encounters/{encounter.id}/logs describing whose turn begins.
 *  - Safeguards: no-op with alert if preconditions fail.
 *
 * @param {object} params
 * @param {boolean} params.isDM - Whether current user is DM.
 * @param {object|null} params.turnState - Current turn state from encMeta.turn.
 * @param {object} params.encounter - Encounter object containing at least id.
 * @param {import('firebase/firestore').Firestore} params.db - Firestore db instance.
 * @param {Record<string, any>} params.participantsMap - Map of participant docs keyed by participant doc id.
 * @param {Array<{key:string,label:string,initiative:number}>} params.rows - Sorted initiative rows used to resolve labels.
 */
export const advanceTurn = async ({ isDM, turnState, encounter, db, participantsMap, rows }) => {
    if (!isDM || !turnState) return; // precondition
    try {
        const encRef = doc(db, "encounters", encounter.id);
        let nextState = null;
        let rebuiltInfo = null; // {order:[], round:number}
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(encRef);
            const data = snap.data() || {};
            const t = data.turn;
            if (!t?.order || t.order.length === 0) throw new Error("no-turn");
            const cleanOrderExisting = t.order.filter((k) => participantsMap[k]);
            if (cleanOrderExisting.length === 0) throw new Error("empty");

            // -------------------------------------------------------------
            // Decrement active turn effects for finishing participant
            // -------------------------------------------------------------
            try {
                const currentIndex = t.index ?? 0;
                const finishingKey = cleanOrderExisting[currentIndex];
                const finishingParticipant = participantsMap[finishingKey];
                const isFoe = finishingParticipant?.type === "foe";
                const userUid = !isFoe ? (finishingParticipant?.uid || finishingKey) : null;
                if (userUid) {
                    const userRef = doc(db, "users", userUid);
                    const userSnap = await tx.get(userRef);
                    if (userSnap.exists()) {
                        const uData = userSnap.data() || {};
                        const effects = uData.active_turn_effect;
                        if (effects && typeof effects === "object") {
                            let changed = false;
                            const updated = {};
                            for (const [ek, ev] of Object.entries(effects)) {
                                if (ev && typeof ev === "object") {
                                    const curr = typeof ev.remainingTurns === "number" ? ev.remainingTurns : null;
                                    if (curr != null) {
                                        const newVal = Math.max(0, curr - 1);
                                        updated[ek] = { ...ev, remainingTurns: newVal };
                                        if (newVal !== curr) changed = true;
                                    } else {
                                        updated[ek] = ev;
                                    }
                                } else {
                                    updated[ek] = ev;
                                }
                            }
                            if (changed) tx.set(userRef, { active_turn_effect: updated }, { merge: true });
                        }
                    }
                }
            } catch (effectErr) {
                console.warn("Failed to decrement active_turn_effect", effectErr);
            }

            let idx = (t.index ?? 0) + 1;
            let round = t.round ?? 1;
            let orderForNext = cleanOrderExisting;

            const wrapped = idx >= cleanOrderExisting.length;
            if (wrapped) {
                // Start of a NEW ROUND → auto rebuild order including *any* participants
                // that have now an initiative but were not in the previous order (joined mid-round).
                idx = 0;
                round += 1;
                const fullInitiativeOrder = rows
                    .filter((r) => r.initiative != null)
                    .map((r) => r.key); // rows already sorted desc by initiative
                orderForNext = fullInitiativeOrder;
                rebuiltInfo = { order: orderForNext.slice(), round };
            }

            nextState = {
                order: orderForNext,
                index: idx,
                round,
                startedAt: t.startedAt || serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            tx.set(encRef, { turn: nextState }, { merge: true });
        });

        if (nextState) {
            // If we rebuilt, log that first
            if (rebuiltInfo) {
                const labelOrder = rebuiltInfo.order
                    .map((k) => rows.find((r) => r.key === k)?.label || k)
                    .join(" > ");
                await addDoc(collection(db, "encounters", encounter.id, "logs"), {
                    type: "turn",
                    by: "DM",
                    message: `Nuovo round iniziato (Turno ${rebuiltInfo.round}) – Ordine ricostruito: ${labelOrder}`,
                    createdAt: serverTimestamp(),
                });
            }
            const nextKey = nextState.order[nextState.index];
            const label = rows.find((r) => r.key === nextKey)?.label || nextKey;
            await addDoc(collection(db, "encounters", encounter.id, "logs"), {
                type: "turn",
                by: "DM",
                message: `Turn begins: ${label} (Turno ${nextState.round})`,
                createdAt: serverTimestamp(),
            });
        }
    } catch (e) {
        console.error("advanceTurn failed", e);
        alert("Impossibile avanzare il turno.");
    }
};

export default advanceTurn;