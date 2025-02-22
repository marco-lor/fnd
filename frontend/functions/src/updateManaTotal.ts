import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// eslint-disable-next-line max-len
// Do NOT initialize Firebase Admin here because it's already initialized in index.ts.

export const updateManaTotal = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "europe-west8", // same region as updateTotParameters
  },
  (event) => {
    // Check if event data is available.
    if (!event.data) {
      console.error("No event data received");
      return;
    }

    // Retrieve before and after snapshots.
    const beforeSnapshot = event.data.before;
    const afterSnapshot = event.data.after;

    const beforeData = beforeSnapshot.data();
    const afterData = afterSnapshot.data();

    // Safely access the "Disciplina[Tot]" parameter in Parametri.Combattimento.
    // eslint-disable-next-line max-len
    const oldDisciplinaTot = beforeData?.Parametri?.Combattimento?.Disciplina?.Tot;
    // eslint-disable-next-line max-len
    const newDisciplinaTot = afterData?.Parametri?.Combattimento?.Disciplina?.Tot;

    // Exit early if "Disciplina[Tot]" hasn't changed.
    if (oldDisciplinaTot === newDisciplinaTot) {
      console.log("No change in Disciplina[Tot], skipping manaTotal update.");
      return;
    }

    // Calculate manaTotal: 5 + Disciplina[Tot] * 7.
    const manaTotal = 5 + newDisciplinaTot * 7;

    // Retrieve the userId from event.params.
    const userId = event.params.userId;
    const docRef = admin.firestore().doc(`users/${userId}`);

    return docRef.update({
      "stats.manaTotal": manaTotal,
    });
  }
);
