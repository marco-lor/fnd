import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {TASK07_CALLABLE_OPTIONS} from "./task07CallableOptions";
const {mutateCodex} = require("./codexCore");

type Scope = {epoch: number; generation: string};
type CategoryScope = {categoryId: string; categoryRevision: number};
type ItemScope = {itemId: string; itemRevision: number};
export type CodexMutation = Scope & (
  {action: "category-add"; metadataRevision: number; legacyKey: string} |
  ({action: "category-delete"; metadataRevision: number} & CategoryScope) |
  ({action: "item-add"; legacyKey: string; value: unknown} & CategoryScope) |
  ({action: "item-edit"; value: unknown} & CategoryScope & ItemScope) |
  ({action: "item-delete"} & CategoryScope & ItemScope)
);
// Revision conflicts are safe rejection, including duplicate submissions. The
// caller refreshes the page and asks for a new explicit mutation; never auto-retry
// with fresh revisions, which could overwrite another editor's intent.
export const task12MutateCodex = onCall<CodexMutation>({...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 120}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to edit Codex.");
  try {
    return await mutateCodex(admin.firestore(), request.auth.uid, request.data);
  } catch (error: any) {
    if (["invalid-argument", "permission-denied", "failed-precondition", "aborted", "already-exists", "not-found", "resource-exhausted"].includes(error?.code)) {
      throw new HttpsError(error.code, error.message);
    }
    throw new HttpsError("internal", "Codex mutation failed; refresh before retrying.");
  }
});
