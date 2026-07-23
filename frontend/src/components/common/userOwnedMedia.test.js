var mockUser = { getIdToken: jest.fn(() => Promise.resolve("token")) };
var mockStorageRef = { fullPath: "tecnicas/tecnica_target_Fire_Ball_123_image" };

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
var mockUploadBytes = jest.fn(() => Promise.resolve());
jest.mock("firebase/storage", () => ({
  deleteObject: (...args) => mockDeleteObject(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
  ref: (...args) => mockRef(...args),
  uploadBytes: (...args) => mockUploadBytes(...args),
}));

import { normalizeV2PersonalContentDocument } from "../../data/userData/normalizers";
import { saveTecnicaForUser } from "./userOwnedMedia";

const { auth: mockAuth } = jest.requireMock("../firebaseConfig");
const { storage: mockStorage } = jest.requireMock("../firebaseStorage");

describe("saveTecnicaForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRef.mockReturnValue(mockStorageRef);
    mockAuth.currentUser = null;

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
    expect(mockUploadBytes).toHaveBeenCalledTimes(1);
    expect(mockUploadBytes).toHaveBeenCalledWith(
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
});
