import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// Non inizializzare Firebase Admin qui perché è già inizializzato in index.ts.

interface SingleParam {
  Base?: number;
  Anima?: number;
  Equip?: number;
  Mod?: number;
  Tot?: number;
}

interface Parametri {
  Base?: Record<string, SingleParam>;
  Combattimento?: Record<string, SingleParam>;
  Special?: Record<string, SingleParam>;
}

export const updateTotParameters = onDocumentWritten(
  {
    document: "users/{userId}",
    region: "europe-west8", // Imposta esplicitamente la regione qui
  },
  async (event) => {
    const userId = event.params?.userId;
    const afterData = event.data?.after?.data();

    if (!afterData || !afterData.Parametri) {
      console.log("No 'Parametri' field found in user document.");
      return;
    }

    const parametri: Parametri = afterData.Parametri;
    // Clona l'oggetto per evitare di modificare i dati originali.
    const updatedParams: Parametri = {...parametri};

    let changes = false; // Flag per tracciare le modifiche ai valori Tot.

    const computeTotal = (param: SingleParam): number => {
      return (
        (param.Base || 0) +
        (param.Anima || 0) +
        (param.Equip || 0) +
        (param.Mod || 0)
      );
    };

    // Elabora la sezione Base se disponibile.
    if (updatedParams.Base) {
      for (const key of Object.keys(updatedParams.Base)) {
        const p = updatedParams.Base[key];
        if (p) {
          const newTot = computeTotal(p);
          // Aggiorna solo se il totale calcolato è diverso.
          if (p.Tot !== newTot) {
            p.Tot = newTot;
            changes = true;
          }
        }
      }
    }

    // Elabora la sezione Combattimento se disponibile.
    if (updatedParams.Combattimento) {
      for (const key of Object.keys(updatedParams.Combattimento)) {
        const p = updatedParams.Combattimento[key];
        if (p) {
          const newTot = computeTotal(p);
          // Aggiorna solo se il totale calcolato è diverso.
          if (p.Tot !== newTot) {
            p.Tot = newTot;
            changes = true;
          }
        }
      }
    }

    // Elabora la sezione Special se disponibile.
    if (updatedParams.Special) {
      for (const key of Object.keys(updatedParams.Special)) {
        const p = updatedParams.Special[key];
        if (p) {
          const newTot = computeTotal(p);
          if (p.Tot !== newTot) {
            p.Tot = newTot;
            changes = true;
          }
        }
      }
    }

    // Se nessun valore Tot è cambiato, salta l'aggiornamento di Firestore.
    if (!changes) {
      console.log("No changes in Tot values; skipping update.");
      return;
    }

    try {
      if (userId) {
        await admin.firestore().collection("users").doc(userId)
          .update({Parametri: updatedParams});
        console.log(`Updated Tot values for user ${userId}`);
      }
    } catch (error) {
      console.error("Error updating Tot values:", error);
    }
  }
);
