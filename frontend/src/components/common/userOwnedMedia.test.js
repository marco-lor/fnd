var mockUser = { getIdToken: jest.fn(() => Promise.resolve("token")) };
var mockStorageRef = { fullPath: "tecnicas/tecnica_target_Fire_Ball_123_image" };

jest.mock("../firebaseConfig", () => {
  const auth = { currentUser: null };
  const db = { __type: "db" };
  const storage = { __type: "storage" };

  return { auth, db, storage };
});

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

import { saveTecnicaForUser } from "./userOwnedMedia";

const { auth: mockAuth, storage: mockStorage } = jest.requireMock("../firebaseConfig");

describe("saveTecnicaForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
