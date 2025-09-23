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
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(encRef);
            const data = snap.data() || {};
            const t = data.turn;
            if (!t?.order || t.order.length === 0) throw new Error("no-turn");
            const cleanOrder = t.order.filter((k) => participantsMap[k]);
            if (cleanOrder.length === 0) throw new Error("empty");

            // -------------------------------------------------------------
            // Decrement active turn effects (remainingTurns - 1) for the
            // participant whose turn is FINISHING (current index before
            // we advance). Only applied to user participants (skip foes).
            // Firestore structure (user doc): active_turn_effect: {
            //   barriera: { remainingTurns: Number, totalTurns: Number, ... }
            // }
            // -------------------------------------------------------------
            try {
                const currentIndex = t.index ?? 0;
                const finishingKey = cleanOrder[currentIndex];
                const finishingParticipant = participantsMap[finishingKey];
                const isFoe = finishingParticipant?.type === "foe"; // foes shouldn't have user doc effects
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
                                        updated[ek] = ev; // leave untouched if malformed
                                    }
                                } else {
                                    updated[ek] = ev;
                                }
                            }
                            if (changed) {
                                tx.set(userRef, { active_turn_effect: updated }, { merge: true });
                            }
                        }
                    }
                }
            } catch (effectErr) {
                // Non-fatal: log but don't abort advancing turns
                console.warn("Failed to decrement active_turn_effect", effectErr);
            }

            let idx = (t.index ?? 0) + 1;
            let round = t.round ?? 1;
            if (idx >= cleanOrder.length) {
                idx = 0;
                round += 1;
            }
            nextState = {
                order: cleanOrder,
                index: idx,
                round,
                startedAt: t.startedAt || serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            tx.set(encRef, { turn: nextState }, { merge: true });
        });
        if (nextState) {
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
        // Keep same UX behavior as original implementation
        console.error("advanceTurn failed", e);
        alert("Impossibile avanzare il turno.");
    }
};

export default advanceTurn;