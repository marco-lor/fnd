var mockTryPersistTask07PersonalMedia = jest.fn();
var mockMutatePersonalContent = jest.fn();

jest.mock("../../data/userData/userDataCommands", () => ({
  mutatePersonalContent: (...args) => mockMutatePersonalContent(...args),
}));

jest.mock("../../data/media/personalMediaWriter", () => ({
  tryPersistTask07PersonalMedia: (...args) => (
    mockTryPersistTask07PersonalMedia(...args)
  ),
}));

import {
  deleteTecnicaForUser,
  saveTecnicaForUser,
} from "./userOwnedMedia";

describe("canonical user-owned personal content", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTryPersistTask07PersonalMedia.mockResolvedValue(null);
    mockMutatePersonalContent.mockResolvedValue({
      success: true,
      contentId: "technique-doc-1",
      name: "Fire Ball",
    });
  });

  it("creates a no-media entry with Task 05 and retains its returned identity", async () => {
    const result = await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      entryData: {
        Nome: "Fire Ball",
        Costo: 2,
      },
    });

    expect(mockMutatePersonalContent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "target-user",
        kind: "tecnica",
        action: "upsert",
        name: "Fire Ball",
        data: { Nome: "Fire Ball", Costo: 2 },
        retryKey: expect.stringContaining("task05-personal-upsert:tecniche:target-user:new:"),
      })
    );
    expect(mockMutatePersonalContent.mock.calls[0][0]).not.toHaveProperty("contentId");
    expect(result).toEqual(expect.objectContaining({
      contentId: "technique-doc-1",
      data: expect.objectContaining({
        Nome: "Fire Ball",
        _task05ContentId: "technique-doc-1",
      }),
    }));
    expect(mockTryPersistTask07PersonalMedia).not.toHaveBeenCalled();
  });

  it("edits a stable no-media entry through Task 05 and strips transport fields", async () => {
    await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      originalEntity: { _task05ContentId: "technique-doc-1" },
      entryData: {
        _task05ContentId: "technique-doc-1",
        displayName: "Fire Ball",
        revision: 7,
        Nome: "Fire Ball",
        Costo: 3,
      },
    });

    expect(mockMutatePersonalContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: "technique-doc-1",
        data: {
          id: "technique-doc-1",
          Nome: "Fire Ball",
          Costo: 3,
        },
      })
    );
  });

  it("supports one-step new content plus canonical media and retains the writer identity", async () => {
    const imageFile = new File(["image"], "spell.png", { type: "image/png" });
    mockTryPersistTask07PersonalMedia.mockResolvedValue({
      contentId: "content_tecnica_new-1",
      outcomes: [{ handled: true, status: "complete" }],
      task07: true,
    });

    const result = await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      entryData: { Nome: "Fire Ball" },
      imageFile,
      signal: new AbortController().signal,
    });

    expect(mockTryPersistTask07PersonalMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        originalEntity: { Nome: "Fire Ball" },
        entryData: { Nome: "Fire Ball" },
        imageFile,
      })
    );
    expect(mockMutatePersonalContent).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      contentId: "content_tecnica_new-1",
      data: expect.objectContaining({ _task05ContentId: "content_tecnica_new-1" }),
    }));
  });

  it("fails closed rather than falling back when Task 07 declines a media save", async () => {
    const imageFile = new File(["image"], "spell.png", { type: "image/png" });
    await expect(saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      originalEntity: { _task05ContentId: "technique-doc-1" },
      entryData: { Nome: "Fire Ball", _task05ContentId: "technique-doc-1" },
      imageFile,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "task07-canonical-required" });

    expect(mockMutatePersonalContent).not.toHaveBeenCalled();
  });

  it("uses Task 07 for stable media changes and performs no second write", async () => {
    const imageFile = new File(["image"], "spell.png", { type: "image/png" });
    mockTryPersistTask07PersonalMedia.mockResolvedValue({
      contentId: "technique-doc-1",
      outcomes: [{ handled: true, status: "complete" }],
      task07: true,
    });

    const result = await saveTecnicaForUser({
      userId: "target-user",
      originalName: "Fire Ball",
      originalEntity: { _task05ContentId: "technique-doc-1" },
      entryData: { Nome: "Fire Ball", _task05ContentId: "technique-doc-1" },
      imageFile,
      signal: new AbortController().signal,
    });

    expect(mockTryPersistTask07PersonalMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "target-user",
        collectionKey: "tecniche",
        imageFile,
      })
    );
    expect(mockMutatePersonalContent).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      contentId: "technique-doc-1",
      task07: true,
    }));
  });

  it("deletes only a stable V2 entry and leaves cleanup server-owned", async () => {
    await expect(deleteTecnicaForUser({
      userId: "target-user",
      itemName: "Fire Ball",
      itemData: {
        _task05ContentId: "technique-doc-1",
        task07MediaRevision: 4,
        task07VideoMediaRevision: 2,
      },
    })).resolves.toBe(true);

    expect(mockMutatePersonalContent).toHaveBeenCalledWith({
      userId: "target-user",
      kind: "tecnica",
      action: "delete",
      contentId: "technique-doc-1",
      retryKey: "task07-personal-delete:tecniche:target-user:technique-doc-1:4:2",
    });

    await expect(deleteTecnicaForUser({
      userId: "target-user",
      itemName: "Legacy only",
      itemData: { Nome: "Legacy only" },
    })).rejects.toMatchObject({ code: "task05-stable-target-required" });
  });
});
