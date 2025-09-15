<!--- LAST VERIFIED: 2025-09-06 --->

# FND (Fantasy & Dragons) – D&D‑like Web Application

Modern web application for character creation, progression, foe management, and campaign utilities. Backed by Firestore, FastAPI (utility/admin routes), and Firebase Functions v2.

## 1. Scope & High-level Goals

Provide a browser-based tabletop/RPG‑style character sheet and rules engine featuring:
- Character parameter progression with derived totals and auto HP/Mana computation.
- Points economy (Base points & Combat tokens) with creation-phase incentives for negative stats.
- Admin / DM tooling: bulk level up, user stat normalization, schema seeding, foe duplication with asset cloning.
- Extensible item & consumable schemas to power Bazaar / equipment features.

## 2. Status (Validation – Sept 2025)

| Area | Previous Claim | Current Status | Notes |
|------|----------------|----------------|-------|
| Auth / Roles | player, dm, webmaster roles | VALID | Role checks enforced in callable functions (`deleteUser`, level up). |
| Character param totals | Firestore triggers recompute Tot & derived HP/Mana | VALID | `updateTotParameters`, `updateHpTotal`, `updateManaTotal` active. |
| Points economy | Callable validates spend/refund & creation credits | VALID | `spendCharacterPoint` logic matches description (still region-misaligned). |
| Admin user deletion | Webmaster-only callable | VALID | `deleteUser` enforces role === "webmaster". |
| Bulk utilities | Update-all & full export endpoints | VALID | `/update-all-users`, `/all-data` present. |
| Schema writers | Endpoints seed multiple schemas | PARTIAL | Only `/test-endpoint` currently exposed (writes `schema_consumabili`). Other schema copy helpers exist but endpoints are commented out. |
| Level-up flows | Bulk & single level-up callables | VALID | `levelUpAll`, `levelUpUser` present with DM role check. |
| Anima modifier recalculation | (Not previously documented) | NEW | `updateAnimaModifier` trigger updates `Parametri.*.Anima`. |
| Foe duplication with asset cloning | (Not previously documented) | NEW | `duplicateFoeWithAssets` callable (region europe-west1) duplicates Firestore doc + Storage assets. |
| Region alignment | Most in europe-west8 except spendCharacterPoint | NEEDS IMPROVEMENT | Also `duplicateFoeWithAssets` in europe-west1; Firestore in europe-west8. |

## 3. Tech Stack

- Frontend: React 18 (CRA), React Router DOM v7, Tailwind CSS, Framer Motion, Three.js + React Three Fiber, Konva / React-Konva, FontAwesome.
- Backend API: FastAPI (Python) for utility/admin operations (Render deployment target).
- Data & Auth: Firebase (Firestore, Auth, Storage) – primary region: europe-west8.
- Cloud Functions: Firebase Functions v2 (TypeScript) – mix of europe-west8, us-central1, europe-west1 (to be unified).
- Hosting: Frontend on Firebase Hosting; backend on Render.

## 4. Architecture

```
┌────────────────┐   ┌──────────────────┐   ┌───────────────────────────┐
│ React Frontend │ → │ FastAPI (Render) │ → │ Firebase (Firestore/Auth) │
│ (Firebase Host)│   │  Admin Utilities │   │ + Cloud Functions v2       │
└────────────────┘   └──────────────────┘   └───────────────────────────┘
       ▲  (client SDK / callables / listeners)  │
       └────────────────────────────────────────┘
```

## 5. Frontend Modules (Implemented / Scaffolding)

- AuthContext & protected routes (role-aware UI gating).
- Feature areas scaffolded: Home, Bazaar, Combat Tool, Codex, Spell/Technique management, DM dashboard, Admin panel, Foes Hub.
- Visual layers: 3D (three/R3F) + 2D canvas (Konva) utilities available for future interactive/animated elements.

## 6. Backend API (FastAPI)

Local base: http://127.0.0.1:8000

Active endpoints:
- GET `/` – Healthcheck.
- GET `/characters` – List character document IDs (collection: `characters`).
- POST `/characters` – Create new character document.
- GET `/update-all-users` – Normalizes `stats` structure across all `users/*` documents (resets base & token counts per helper logic).
- GET `/all-data` – Firestore dump (selective) persisted as timestamped JSON backup inside `backend/`.
- GET `/test-endpoint` – Currently seeds `utils/schema_consumabili` only. (Armatura/Weapon/Accessorio helpers exist but not routed.)

Notes:
- CORS origins configured: `https://fatins.web.app`, `https://fatins.firebaseapp.com/` (trailing slash), `http://localhost:3000`. Consider removing trailing slash for consistency.
- Secrets: Service account loaded locally from `firestoreServiceAccountKey.json`, in production from `/etc/secrets/`.

## 7. Cloud Functions (v2)

Central export file: `frontend/functions/src/index.ts`.

Triggers:
- onDocumentWritten `users/{userId}` (europe-west8): `updateTotParameters` – recomputes Tot = Base+Anima+Equip+Mod for Base / Combattimento / Special.
- onDocumentUpdated `users/{userId}` (europe-west8):
  - `updateHpTotal` – HP = hpMultByLevel[level] * Salute.Tot + 8.
  - `updateManaTotal` – Mana = manaMultByLevel[level] * Disciplina.Tot + 5.
  - `updateAnimaModifier` – Recomputes `Anima` contributions based on `AltriParametri` shard selections & level progression tables (modAnima & levelUpAnimaBonus) in `utils/varie`.
- onCall (HTTPS):
  - `spendCharacterPoint` (us-central1) – Validates stat changes; enforces creation credit/negative stat rules and token costs.
  - `deleteUser` (europe-west8) – Webmaster-only deletion of Auth user + Firestore doc.
  - `levelUpAll` (europe-west8) – DM bulk level-up with token grants per level band; writes `level_events` audit subcollection entries.
  - `levelUpUser` (europe-west8) – DM single-user level-up with audit trail.
  - `duplicateFoeWithAssets` (europe-west1) – Clones a foe document and associated image assets (main + spells + tecniche) into new Storage paths with download tokens.

Region alignment opportunities:
- Unify `spendCharacterPoint` (us-central1) and `duplicateFoeWithAssets` (europe-west1) to europe-west8 for reduced latency + cost; Firestore is europe-west8.

## 8. Data Model (Firestore)

Primary collections / docs:
- `users/{userId}`
  - `Parametri` → `Base|Combattimento|Special.<Stat> = { Base, Anima, Equip, Mod, Tot }`.
  - `stats` → `{ level, hpTotal, hpCurrent, manaTotal, manaCurrent, basePointsAvailable, basePointsSpent, combatTokensAvailable, combatTokensSpent, negativeBaseStatCount? }`.
  - `flags` → `{ characterCreationDone: boolean }`.
  - `settings` → `{ lock_param_base: boolean, lock_param_combat: boolean }` (enforcement pending in UI – see gaps).
  - `AltriParametri` → Shard / Anima configuration driving `updateAnimaModifier` (e.g. `Anima_1`, `Anima_4`, `Anima_7`).
  - Subcollection: `level_events/*` audit entries for level-up functions.
  - Other content groups: `inventory`, `spells`, `tecniche`, `conoscenze`, `professioni` (structure evolving).
- `foes/{foeId}` – Foe stat blocks, parameters, asset references.
- `duplications/{idempotencyKey}` – Idempotency records for foe duplication.
- `items/{itemId}` – Marketplace items (future integration with equipment system).
- `utils/varie` – Global config: `hpMultByLevel`, `manaMultByLevel`, `cost_params_combat`, `modAnima`, `levelUpAnimaBonus`, etc.
- `utils/schema_*` – Template documents (armor, weapon, accessorio, consumabili, character schema_pg).

## 9. Core Data Flows

1. Authentication & Session:
  User login → Firebase Auth → AuthContext listener → gated routing & Firestore doc subscription.
2. Stat Change → Derived Totals:
  UI action → `spendCharacterPoint` → user doc update → `updateAnimaModifier` (if shards/level changed) → `updateTotParameters` → `updateHpTotal` / `updateManaTotal` → reactive UI.
3. Level Up:
  DM triggers callable(s) → stats.level increment & tokens grant → audit `level_events` → HP/Mana recalculation triggers.
4. Foe Duplication:
  Callable clones Firestore doc + Storage assets → returns new foe ID + asset URLs → UI refreshes foe list.
5. Admin Maintenance:
  Web endpoints (`/update-all-users`, `/all-data`) or callable (`deleteUser`) adjust or export state.

## 10. Development Workflow

- Frontend: `npm start` (CRA dev server), `npm run build` for production bundle.
- Backend: From `backend/` run `uvicorn main:app --reload` (defaults to 127.0.0.1:8000).
- Functions: Deploy via Firebase CLI; recommend local emulators for iterative testing (Firestore + Functions) especially for spend/level-up logic.
- Backups: Run `/all-data` to produce timestamped `firestore_backup_YYYYMMDD_HHMMSS.json` files.

Preconditions for Functions:
- Ensure `utils/varie` includes: `hpMultByLevel`, `manaMultByLevel`, `cost_params_combat`, `modAnima`, `levelUpAnimaBonus` (absence may cause silent early exits / zero multipliers).

## 11. Security & Permissions

- Role checks inside callables: `deleteUser` (webmaster), `levelUp*` (dm), others currently only require authentication (`duplicateFoeWithAssets` could optionally restrict to dm).
- Negative stat credits limited & frozen post creation (`flags.characterCreationDone`).
- Firestore security rules (not included here) must enforce server-side invariants (e.g., disallow manual Tot overwrite, restrict role elevation, prevent unauthorized deletions).

## 12. Known Gaps / Recommended Next Steps

Technical / Infrastructure:
- Consolidate all functions to europe-west8 (or chosen primary region) for latency coherence.
- Expose dedicated endpoints for `schema_armatura`, `schema_weapon`, `schema_accessorio` (separate routes or a parameterized one) instead of overloading `/test-endpoint`.
- Add OpenAPI docs (FastAPI auto docs) and consider auth / API key for destructive admin routes.

Gameplay / Logic:
- Implement enforcement in UI for `settings.lock_param_base` & `settings.lock_param_combat` (currently just documented).
- Expand validation around shard (`AltriParametri`) selections (prevent incompatible combinations, enforce level windows on client side too).
- Add server-side guard to prevent arbitrary writes to `Parametri.*.Tot` and `Anima` fields (rely solely on functions).

Testing / Reliability:
- Unit/integration tests for `spendCharacterPoint` covering: max negative stats, credit refund edge cases, insufficient tokens, post-creation restrictions.
- Add tests for `duplicateFoeWithAssets` idempotency behavior & broken asset references.
- Monitoring / logging improvements (structured logs, correlation IDs in batch operations).

Security / Permissions:
- Restrict `duplicateFoeWithAssets` to dm or higher if intended (currently any authenticated user can call it).
- Add audit logging for `deleteUser` (dedicated security collection) beyond function logs.

UX / Ops:
- Provide admin UI to trigger schema seeding with explicit selection.
- Surface level-up audit history (`level_events`) in DM dashboard.

## 13. Change Log (since prior overview)

- Added `updateAnimaModifier` trigger (Anima shard system) – NEW.
- Added `duplicateFoeWithAssets` callable (foe + asset cloning with idempotency) – NEW.
- Added foe-related collections (`foes`, `duplications`) and level audit subcollection (`level_events`).
- Expanded schema helper definitions (armor/weapon/accessorio/consumabili) – only consumabili endpoint exposed.
- Confirmed spend logic robust; still region misalignment and credit system intact.

---

This overview is current as of 2025-09-06 and should remain implementation-close. Update the validation table upon material changes (new functions, schema evolution, region migrations).
