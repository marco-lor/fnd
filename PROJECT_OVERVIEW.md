# FND (Fantasy & Dragons) – D&D‑like Web Application

Modern web app for character creation and campaign play, backed by Firestore, FastAPI, and Firebase Functions.

## Status at a glance

- Auth: Firebase Auth integrated with role-based access (player, dm, webmaster).
- Character params: Real-time totals via Firestore triggers; HP/Mana auto-recalc by level and stats.
- Points economy: Callable function validates Base/Combat point spending and credits during creation.
- Admin utils: Webmaster-only user deletion; bulk user update and Firestore export endpoints.
- Schema writers: Backend endpoints to seed item/armor/weapon/accessory schemas under `utils/`.

## Tech stack

- Frontend: React 18 (Create React App), React Router DOM v7, Tailwind CSS, Framer Motion, Three.js + R3F, Konva/React-Konva, FontAwesome.
- Backend API: FastAPI (Python) with CORS to `fatins.web.app`, `firebaseapp.com`, and `localhost:3000`.
- Realtime + Auth + Storage: Firebase (Firestore, Auth, Storage).
- Cloud Functions: Firebase Functions v2 (TypeScript).
- Deploy: Frontend on Firebase Hosting; Backend on Render; Firestore in europe-west8.

## Architecture

```
┌────────────────┐   ┌──────────────────┐   ┌─────────────────────────┐
│ React Frontend │ → │ FastAPI (Render) │ → │ Firebase Services       │
│ (Hosting)      │   │ (utility routes) │   │ - Firestore (europe‑w8) │
│                │   │                  │   │ - Auth / Storage        │
└────────────────┘   └──────────────────┘   │ - Cloud Functions v2    │
                                            └─────────────────────────┘
```

## Frontend modules

- AuthContext + protected routes.
- Home, Bazaar, Combat Tool, Codex, Spell/Technique, DM dashboard, Admin panel (structure present; features incremental).
- 3D (three/r3f) and 2D canvas (konva) utilities available.

## Backend API (FastAPI)

Base URL (local): http://127.0.0.1:8000

- GET `/` – healthcheck.
- GET `/characters` – list character document IDs from `characters` collection.
- POST `/characters` – create a new `characters/{id}`.
- GET `/update-all-users` – utility; normalizes `stats` for all `users/*`.
- GET `/all-data` – dumps Firestore (server-side) and writes a timestamped JSON backup in `backend/`.
- GET `/test-endpoint` – seeds `utils/schema_consumabili` with default schema (other schema writers available in code).

Notes
- CORS allowed origins: `https://fatins.web.app`, `https://fatins.firebaseapp.com/`, `http://localhost:3000`.

## Cloud Functions (v2)

Initialized in `frontend/functions/src/index.ts`; all TypeScript v2 triggers.

- onDocumentWritten users/{userId} (region: europe-west8)
  - `updateTotParameters`: recalculates Tot for Base/Combattimento from Base+Anima+Equip+Mod.
- onDocumentUpdated users/{userId} (region: europe-west8)
  - `updateHpTotal`: recomputes `stats.hpTotal` from `Parametri.Combattimento.Salute.Tot` and `utils/varie.hpMultByLevel`.
  - `updateManaTotal`: recomputes `stats.manaTotal` from `Parametri.Combattimento.Disciplina.Tot` and `utils/varie.manaMultByLevel`.
- onCall HTTPS
  - `spendCharacterPoint` (region: us-central1): validates and applies Base/Combat point spend/refund with creation-phase credits and token costs (`utils/varie.cost_params_combat`).
  - `deleteUser` (region: europe-west8): webmaster-only deletion of a user’s Auth record and `users/{uid}` doc.
  - `levelUpAll`, `levelUpUser`: exported and available (see source) for bulk/targeted level-up flows.

Region note
- Firestore is in europe-west8; most functions are europe-west8, while `spendCharacterPoint` is us-central1. Consider aligning `spendCharacterPoint` to europe-west8 to reduce cross-region latency.

## Data model (Firestore)

Collections
- `users/{userId}`
  - `Parametri.Base|Combattimento.<Stat> = { Base, Anima, Equip, Mod, Tot }`
  - `stats`: `{ level, hpTotal, hpCurrent, manaTotal, manaCurrent, basePointsAvailable, basePointsSpent, combatTokensAvailable, combatTokensSpent, negativeBaseStatCount? }`
  - `flags`: `{ characterCreationDone: boolean }`
  - `settings`: `{ lock_param_base: boolean, lock_param_combat: boolean }`
  - `inventory`, `spells`, `tecniche`, `conoscenze`, `professioni`.
- `items/{itemId}`: marketplace items (stats/effects).
- `utils/`
  - `varie`: global config (`hpMultByLevel`, `manaMultByLevel`, `cost_params_combat`, ...).
  - `schema_pg`: character template.
  - `schema_armatura`, `schema_weapon`, `schema_accessorio`, `schema_consumabili`: seeded via backend utilities.

## Data flows

1) Auth and user session
User Login → Firebase Auth → AuthContext → route protection + user doc listener

2) Stat change and totals
UI action → `spendCharacterPoint` (onCall) → Firestore update → `updateTotParameters` → `updateHpTotal`/`updateManaTotal` → UI listeners reflect new values

3) Admin utilities
Webmaster → `deleteUser` (onCall) or FastAPI bulk endpoints → Firestore/Auth updates → UI refresh

## Development

- Frontend: CRA scripts (`npm start`, `npm run build`).
- Backend: `uvicorn main:app --reload` from `backend/` (defaults to 127.0.0.1:8000).
- Emulation: Firebase emulators recommended for Functions/Firestore during local dev.

Preconditions
- Ensure `utils/varie` exists with `hpMultByLevel`, `manaMultByLevel`, and `cost_params_combat` set to avoid function early exits.

## Security & permissions

- Role-based UI (player, dm, webmaster).
- Callable functions require Auth; `deleteUser` enforces `role === "webmaster"`.
- Firestore security rules expected to protect write paths (see functions assumptions above).

## Known gaps / next steps

- Align `spendCharacterPoint` region to europe-west8.
- Wire additional schema writer endpoints or expose them with explicit routes.
- Add API docs for FastAPI endpoints and consider auth on utility routes.
- Expand tests for point-spend edge cases and negative credits.
- Document and enforce lock settings (`settings.lock_param_*`) in UI.

---

This overview reflects the current codebase (functions, endpoints, and data flows) and is intended to stay close to implementation.
