// Utility to log dice rolls for a user, keeping only the latest 20 entries.
// Each entry schema:
// { total: number, meta: { rolls, modifier, faces, count, description }, createdAt: serverTimestamp() }
import { collection, addDoc, query, orderBy, limit, getDocs, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';

/**
 * Logs a dice roll for the given user and trims collection to last 20 rolls.
 * @param {string} uid Firebase Auth user id
 * @param {{ total:number, meta: object }} data Roll data
 */
export async function logDiceRoll(uid, data) {
	if (!uid) return; // silently skip if not logged in
	try {
		const diceRollsCol = collection(db, 'users', uid, 'diceRolls');
		await addDoc(diceRollsCol, { ...data, createdAt: serverTimestamp() });

			// Fetch rolls ordered newest first, skip first 20 and delete rest
			const q = query(diceRollsCol, orderBy('createdAt', 'desc'), limit(50)); // cap fetch to 50 for efficiency
		const snap = await getDocs(q);
		const docs = snap.docs;
			if (docs.length > 20) {
				const deletions = docs.slice(20); // older entries beyond latest 20
			await Promise.allSettled(deletions.map(d => deleteDoc(d.ref)));
		}
	} catch (err) {
		console.error('Failed to log dice roll', err);
	}
}

export default logDiceRoll;
