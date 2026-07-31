var mockUser = { getIdToken: jest.fn(() => Promise.resolve("token")) };
var mockStorageRef = { fullPath: "tecnicas/tecnica_target_Fire_Ball_123_image" };
var mockTryPersistTask07PersonalMedia = jest.fn(() => Promise.resolve(null));
var mockMutatePersonalContent = jest.fn();

jest.mock("../../data/userData/userDataCommands", () => ({
  mutatePersonalContent: (...args) => mockMutatePersonalContent(...args),
}));

jest.mock("../../data/media/personalMediaWriter", () => ({
  tryPersistTask07PersonalMedia: (...args) => (
    mockTryPersistTask07PersonalMedia(...args)
  ),
}));

jest.mock("../firebaseConfig", () => {
  const auth = { currentUser: null };
  const db = { __type: "db" };
  return { auth, db };
});
jest.mock("../firebaseStorage", () => ({ storage: { __type: "storage" } }));

var mockOnAuthStateChanged = jest.fn();
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (...args) => mockOnAuthStateChanged(...args),
}));

var mockGetDoc = jest.fn();
var mockUpdateDoc = jest.fn();
jest.mock("firebase/firestore", () => ({
  doc: jest.fn((...parts) => ({ path: parts.join("/") })),
  getDoc: (...args) => mockGetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
}));

var mockDeleteObject = jest.fn(() => Promise.resolve());
var mockGetDownloadURL = jest.fn(() => Promise.resolve("https://example.com/tecnica.png"));
var mockRef = jest.fn(() => mockStorageRef);
var mockUploadTask = {
  snapshot: { ref: mockStorageRef },
  cancel: jest.fn(),
  on: jest.fn((event, onProgress, onError, onComplete) => {
    onComplete();
    return jest.fn();
  }),
};
var mockUploadBytesResumable = jest.fn(() => mockUploadTask);
jest.mock("firebase/storage", () => ({
  deleteObject: (...args) => mockDeleteObject(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
  ref: (...args) => mockRef(...args),
  uploadBytesResumable: (...args) => mockUploadBytesResumable(...args),
}));

import { normalizeV2PersonalContentDocument } from "../../data/userData/normalizers";
import {
  deleteTecnicaForUser,
  saveTecnicaForUser,
} from "./userOwnedMedia";

const { auth: mockAuth } = jest.requireMock("../firebaseConfig");
const { storage: mockStorage } = jest.requireMock("../firebaseStorage");

describe("saveTecnicaForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRef.mockReturnValue(mockStorageRef);
    mockUploadTask.snapshot = { ref: mockStorageRef };
    mockUploadTask.on.mockImplementation(
      (event, onProgress, onError, onComplete) => {
        onComplete();
        return jest.fn();
      }
    );
    mockUploadBytesResumable.mockReturnValue(mockUploadTask);
    mockAuth.currentUser = null;
    mockTryPersistTask07PersonalMedia.mockResolvedValue(null);
    mockMutatePersonalContent.mockResolvedValue({ success: true });

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ tecniche: {} }),
    });

    mockOnAuthStateChanged.mockImplementation((auth, onNext) => {
      onNext(mockUser);
      return jest.fn();
    });
  });

  it("waits for firebase auth before uploading tecnica media", async () => {
    const imageFile = new File(["image"], "spell.png", { type: "image/png" });

    await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      entryData: {
        Nome: "Fire Ball",
        Costo: 2,
        Azione: "Action",
        Effetto: "Deals damage",
      },
      imageFile,
    });

    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
    expect(mockRef).toHaveBeenCalledWith(
      mockStorage,
      expect.stringMatching(/^tecnicas\/tecnica_target-user_Fire_Ball_\d+_image$/)
    );
    expect(mockUploadBytesResumable).toHaveBeenCalledTimes(1);
    expect(mockUploadBytesResumable).toHaveBeenCalledWith(
      mockStorageRef,
      imageFile,
      {
        cacheControl: "private, max-age=31536000, immutable",
        contentType: "image/png",
      }
    );
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        tecniche: expect.objectContaining({
          "Fire Ball": expect.objectContaining({
            Nome: "Fire Ball",
          }),
        }),
      })
    );
  });

  it("strips V2 transport metadata before persisting an edited legacy entry", async () => {
    const v2Entry = normalizeV2PersonalContentDocument({
      id: "technique-doc-1",
      data: () => ({
        id: "transport-id",
        displayName: "Fire Ball",
        normalizedName: "fire ball",
        migration: { source: "legacy" },
        legacyManaged: true,
        schemaVersion: 2,
        revision: 4,
        updatedBy: "migration",
        Nome: "Fire Ball",
        Costo: 2,
        Effetto: "Deals damage",
      }),
    });

    await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      entryData: v2Entry,
    });

    const saved = mockUpdateDoc.mock.calls[0][1].tecniche["Fire Ball"];
    expect(saved).toEqual(expect.objectContaining({
      id: "technique-doc-1",
      Nome: "Fire Ball",
      Costo: 2,
      Effetto: "Deals damage",
    }));
    [
      'name',
      'displayName',
      'normalizedName',
      'migration',
      'legacyManaged',
      '_task05ContentId',
      'schemaVersion',
      'revision',
      'updatedBy',
    ].forEach((field) => expect(saved).not.toHaveProperty(field));
  });

  it("preserves ordinary legacy fields when no V2 normalization marker is present", async () => {
    await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Legacy Technique",
      entryData: {
        Nome: "Legacy Technique",
        name: "legacy-alias",
        createdAt: "custom-created-value",
        updatedAt: "custom-updated-value",
        migration: { custom: true },
      },
    });

    expect(mockUpdateDoc.mock.calls[0][1].tecniche["Legacy Technique"]).toEqual({
      Nome: "Legacy Technique",
      name: "legacy-alias",
      createdAt: "custom-created-value",
      updatedAt: "custom-updated-value",
      migration: { custom: true },
    });
  });

  it("short-circuits legacy Storage and root writes when Task 07 handles media", async () => {
    const controller = new AbortController();
    const imageFile = new File(["image"], "spell.png", { type: "image/png" });
    const originalEntity = {
      _task05ContentId: "technique-doc-1",
      media: { assetId: `m_${"a".repeat(40)}` },
      task07MediaRevision: 2,
      Nome: "Fire Ball",
    };
    mockTryPersistTask07PersonalMedia.mockResolvedValue({
      contentId: "technique-doc-1",
      outcomes: [{ handled: true, status: "complete" }],
      task07: true,
    });

    const result = await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      originalEntity,
      entryData: {
        Nome: "Fire Ball",
        Costo: 3,
      },
      imageFile,
      signal: controller.signal,
    });

    expect(mockTryPersistTask07PersonalMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "target-user",
        collectionKey: "tecniche",
        originalEntity,
        imageFile,
        signal: controller.signal,
      })
    );
    expect(mockUploadBytesResumable).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      contentId: "technique-doc-1",
      task07: true,
    }));
  });

  it("deletes a stable V2 entry through Task 05 and leaves canonical cleanup server-owned", async () => {
    const itemData = {
      _task05ContentId: "technique-doc-1",
      image_url: "https://example.com/legacy-image",
      media: { assetId: `m_${"a".repeat(40)}` },
      task07MediaRevision: 4,
      task07VideoMediaRevision: 2,
    };

    await expect(deleteTecnicaForUser({
      userId: "target-user",
      itemName: "Fire Ball",
      itemData,
    })).resolves.toBe(true);

    expect(mockMutatePersonalContent).toHaveBeenCalledWith({
      userId: "target-user",
      kind: "tecnica",
      action: "delete",
      contentId: "technique-doc-1",
      retryKey: [
        "task07-personal-delete",
        "tecniche",
        "target-user",
        "technique-doc-1",
        "4",
        "2",
      ].join(":"),
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
