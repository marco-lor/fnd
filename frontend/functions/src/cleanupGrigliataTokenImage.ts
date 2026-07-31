import {onDocumentDeleted, onDocumentUpdated} from "firebase-functions/v2/firestore";
import {getStorage} from "firebase-admin/storage";

const REGION = "europe-west1";

const asNonEmptyString = (value: unknown) => (
  typeof value === "string" && value.trim() ? value.trim() : ""
);

const isCustomUploadedToken = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const token = value as Record<string, unknown>;
  const customTokenRole = asNonEmptyString(token.customTokenRole);
  return asNonEmptyString(token.tokenType) === "custom"
    && customTokenRole !== "instance"
    && asNonEmptyString(token.imageSource) === "uploaded";
};

const deleteStorageObject = async (imagePath: string, logLabel: string) => {
  if (!imagePath) {
    return;
  }

  try {
    await getStorage().bucket().file(imagePath).delete({ignoreNotFound: true});
  } catch (error) {
    console.error(`${logLabel}: Failed to delete storage object`, {
      imagePath,
      error,
    });
  }
};

export const cleanupDeletedGrigliataTokenImage = onDocumentDeleted(
  {
    document: "grigliata_tokens/{tokenId}",
    region: REGION,
  },
  async (event) => {
    const deletedToken = event.data?.data();
    if (!isCustomUploadedToken(deletedToken)) {
      return;
    }

    await deleteStorageObject(
      asNonEmptyString((deletedToken as Record<string, unknown>).imagePath),
      "cleanupDeletedGrigliataTokenImage"
    );
  }
);

export const cleanupReplacedGrigliataTokenImage = onDocumentUpdated(
  {
    document: "grigliata_tokens/{tokenId}",
    region: REGION,
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    if (!isCustomUploadedToken(beforeData)) {
      return;
    }

    const previousImagePath = asNonEmptyString((beforeData as Record<string, unknown>).imagePath);
    const nextImagePath = asNonEmptyString((afterData as Record<string, unknown>).imagePath);
    if (!previousImagePath || previousImagePath === nextImagePath) {
      return;
    }

    await deleteStorageObject(previousImagePath, "cleanupReplacedGrigliataTokenImage");
  }
);
