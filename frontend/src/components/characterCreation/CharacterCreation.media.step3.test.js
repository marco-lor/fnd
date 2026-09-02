import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import CharacterCreation from "./CharacterCreation";
import { getCodex } from "../../data/codexRepository";
import { getVarie } from "../../data/configRepository";
import { updateCharacterCreation } from "../../data/userData/userDataCommands";
import { uploadLegacyImage, deleteLegacyStoragePath } from "../common/legacyMediaStorage";
import { isTask07MediaV1WriteEnabled } from "../../data/media/mediaFeatureFlags";

let mockSessionState;
let mockProfileState;
const mockOwner = {
  cancel: jest.fn(),
  dispose: jest.fn(),
  hasActiveOperation: jest.fn(() => false),
  isDisposed: jest.fn(() => false),
  start: jest.fn(),
};
const mockCreateTask07MediaOperationOwner = jest.fn();
const mockBeginTask08Transition = jest.fn();
const mockRecordTask08Event = jest.fn();
const mockGetCodex = getCodex;
const mockGetVarie = getVarie;
const mockUpdateCharacterCreation = updateCharacterCreation;
const mockUploadLegacyImage = uploadLegacyImage;
const mockDeleteLegacyStoragePath = deleteLegacyStoragePath;
const mockIsTask07MediaV1WriteEnabled = isTask07MediaV1WriteEnabled;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

jest.mock("react-router-dom", () => {
  const React = require("react");
  const RouterContext = React.createContext(null);
  const MemoryRouter = ({ initialEntries = ["/"], children }) => {
    const initialEntry = initialEntries[0];
    const [location, setLocation] = React.useState(() => (
      typeof initialEntry === "string"
        ? { pathname: initialEntry, state: null }
        : initialEntry
    ));
    const navigate = React.useCallback((to, options = {}) => {
      setLocation({
        pathname: typeof to === "string" ? to : to.pathname,
        state: options.state,
      });
    }, []);
    return (
      <RouterContext.Provider value={{ location, navigate }}>
        {children}
      </RouterContext.Provider>
    );
  };
  return {
    MemoryRouter,
    useLocation: () => React.useContext(RouterContext).location,
    useNavigate: () => React.useContext(RouterContext).navigate,
  };
}, { virtual: true });

jest.mock("../../AuthContext", () => ({
  useAuthSession: () => mockSessionState,
  useProfileState: () => mockProfileState,
}));
jest.mock("../../data/codexRepository", () => ({
  getCodex: jest.fn(() => Promise.resolve({ Razze: { Human: "A balanced race." } })),
  invalidateCodex: jest.fn(),
}));
jest.mock("../../data/configRepository", () => ({
  getVarie: jest.fn(() => Promise.resolve({
    modAnima: { Fire: { Forza: 1 } },
    levelUpAnimaBonus: { Fire: { Salute: 1 } },
    cost_params_combat: {},
  })),
  invalidateConfig: jest.fn(),
}));
jest.mock("../common/legacyMediaStorage", () => ({
  uploadLegacyImage: jest.fn(),
  deleteLegacyStoragePath: jest.fn(),
}));
jest.mock("../../data/userData/userDataCommands", () => ({
  updateCharacterCreation: jest.fn(() => Promise.resolve()),
}));
jest.mock("../backgrounds/GlobalAuroraBackground", () => () => null);
jest.mock("../../data/media/mediaFeatureFlags", () => ({
  isTask07MediaV1WriteEnabled: jest.fn(() => Promise.resolve(false)),
}));
jest.mock("../../data/media/mediaOperationOwner", () => ({
  createTask07MediaOperationOwner: (...args) => mockCreateTask07MediaOperationOwner(...args),
}));
jest.mock("./characterCreationAvatarMedia", () => ({
  runCharacterCreationAvatarV1Write: jest.fn(),
  task07ProfileRevision: jest.fn(() => 0),
}));
jest.mock("../../performance/task08", () => ({
  beginTask08Transition: (...args) => mockBeginTask08Transition(...args),
  recordTask08Event: (...args) => mockRecordTask08Event(...args),
}));
jest.mock("./elements/RaceSelection", () => ({ onRaceSelect, disabled }) => (
  <button type="button" disabled={disabled} onClick={() => onRaceSelect({ id: "human" })}>
    Choose race
  </button>
));
jest.mock("./elements/AnimaShardSelection", () => ({ onAnimaSelect, disabled }) => (
  <button type="button" disabled={disabled} onClick={() => onAnimaSelect({ name: "fire" })}>
    Choose anima
  </button>
));
jest.mock("./elements/PointsDistribution", () => () => <h2>Points Distribution</h2>);
jest.mock("./elements/CharacterDetails", () => ({
  characterName,
  setCharacterName,
  imagePreview,
  handleImageChange,
  disabled,
}) => (
  <div>
    <input aria-label="character-name" value={characterName} disabled={disabled} onChange={setCharacterName} />
    <input aria-label="character-image" type="file" disabled={disabled} onChange={handleImageChange} />
    {imagePreview && <img src={imagePreview} alt="Preview" />}
  </div>
));

const RouteHarness = () => {
  const location = useLocation();
  return location.pathname === "/character-creation"
    ? <CharacterCreation />
    : <div data-testid="login-route">login</div>;
};

describe("Character Creation avatar preview and owner cleanup", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let createdCount;

  beforeEach(() => {
    mockSessionState = {
      user: { uid: "player-a", email: "player@example.com" },
      authStatus: "authenticated",
      repositoryAccessGeneration: 1,
    };
    mockProfileState = {
      userData: { uid: "player-a", flags: { characterCreationDone: false } },
      profileUid: "player-a",
      profileStatus: "fresh",
    };
    createdCount = 0;
    URL.createObjectURL = jest.fn(() => `blob:character-${++createdCount}`);
    URL.revokeObjectURL = jest.fn();
    mockOwner.cancel.mockReset();
    mockOwner.dispose.mockReset();
    mockOwner.hasActiveOperation.mockReset().mockReturnValue(false);
    mockOwner.isDisposed.mockReset().mockReturnValue(false);
    mockOwner.start.mockReset();
    mockOwner.start.mockImplementation(() => ({
      signal: new AbortController().signal,
      isCurrent: jest.fn(() => true),
      release: jest.fn(),
    }));
    mockOwner.cancel.mockImplementation(() => true);
    mockCreateTask07MediaOperationOwner.mockReset().mockReturnValue(mockOwner);
    mockBeginTask08Transition.mockReset().mockImplementation(() => jest.fn());
    mockRecordTask08Event.mockReset();
    mockGetCodex.mockReset().mockResolvedValue({ Razze: { Human: "A balanced race." } });
    mockGetVarie.mockReset().mockResolvedValue({
      modAnima: { Fire: { Forza: 1 } },
      levelUpAnimaBonus: { Fire: { Salute: 1 } },
      cost_params_combat: {},
    });
    mockUploadLegacyImage.mockReset();
    mockDeleteLegacyStoragePath.mockReset().mockResolvedValue(undefined);
    mockIsTask07MediaV1WriteEnabled.mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    cleanup();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  test("balances first select, replacement, invalid/clear, picker cancel, route cancel, and unmount", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const imageInput = await screen.findByLabelText("character-image");

    fireEvent.change(imageInput, {
      target: { files: [new File(["one"], "one.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.getByAltText("Preview")).toHaveAttribute("src", "blob:character-1"));

    fireEvent.change(imageInput, {
      target: { files: [new File(["two"], "two.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.getByAltText("Preview")).toHaveAttribute("src", "blob:character-2"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:character-1");

    fireEvent.change(imageInput, {
      target: { files: [new File(["bad"], "bad.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText("Please select a valid image file.")).toBeInTheDocument();
    expect(screen.queryByAltText("Preview")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:character-2");

    fireEvent.change(imageInput, { target: { files: [] } });
    expect(screen.queryByAltText("Preview")).not.toBeInTheDocument();

    fireEvent.change(imageInput, {
      target: { files: [new File(["three"], "three.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.getByAltText("Preview")).toHaveAttribute("src", "blob:character-3"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByTestId("login-route")).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:character-3");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(mockOwner.cancel).toHaveBeenCalled();
    expect(mockOwner.dispose).toHaveBeenCalledWith("Character Creation was unmounted.");

    view.unmount();
  });

  test("resets actor-owned wizard state and revokes the current preview on actor change", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const imageInput = await screen.findByLabelText("character-image");
    fireEvent.change(imageInput, {
      target: { files: [new File(["actor-a"], "actor-a.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.getByAltText("Preview")).toHaveAttribute("src", "blob:character-1"));

    mockSessionState = {
      ...mockSessionState,
      user: { uid: "player-b", email: "other@example.com" },
      repositoryAccessGeneration: 2,
    };
    mockProfileState = {
      userData: { uid: "player-b", flags: { characterCreationDone: false } },
      profileUid: "player-b",
      profileStatus: "fresh",
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());
    expect(screen.queryByAltText("Preview")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:character-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(mockOwner.cancel).toHaveBeenCalledWith("The authenticated Character Creation account changed.");
  });

  test("rolls back an uploaded legacy avatar exactly once when the actor changes before completion", async () => {
    const upload = deferred();
    mockUploadLegacyImage.mockReturnValue(upload.promise);
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const imageInput = await screen.findByLabelText("character-image");
    fireEvent.change(imageInput, {
      target: { files: [new File(["legacy"], "legacy.png", { type: "image/png" })] },
    });
    mockUpdateCharacterCreation.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1));

    mockSessionState = {
      ...mockSessionState,
      user: { uid: "player-b", email: "other@example.com" },
      repositoryAccessGeneration: 2,
    };
    mockProfileState = {
      userData: { uid: "player-b", flags: { characterCreationDone: false } },
      profileUid: "player-b",
      profileStatus: "fresh",
    };
    act(() => {
      upload.resolve({ downloadUrl: "https://legacy.test/avatar" });
      view.rerender(
        <MemoryRouter initialEntries={["/character-creation"]}>
          <RouteHarness />
        </MemoryRouter>
      );
    });

    await waitFor(() => expect(mockDeleteLegacyStoragePath).toHaveBeenCalledTimes(1));
    expect(mockDeleteLegacyStoragePath).toHaveBeenCalledWith(expect.stringMatching(/^characters\//));
    expect(mockUpdateCharacterCreation).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "complete" })
    );
    expect(screen.queryByText(/Character creation failed/)).not.toBeInTheDocument();
    view.unmount();
  });

  test("rolls back a legacy avatar exactly once when the route unmounts during upload", async () => {
    const upload = deferred();
    mockUploadLegacyImage.mockReturnValue(upload.promise);
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("character-image"), {
      target: { files: [new File(["legacy"], "legacy.png", { type: "image/png" })] },
    });
    mockUpdateCharacterCreation.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      upload.resolve({ downloadUrl: "https://legacy.test/avatar" });
      await upload.promise;
    });
    await waitFor(() => expect(mockDeleteLegacyStoragePath).toHaveBeenCalledTimes(1));
    expect(mockUpdateCharacterCreation).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "complete" })
    );
  });

  test("disables and synchronously guards replacing or clearing the avatar during legacy submission", async () => {
    const upload = deferred();
    mockUploadLegacyImage.mockReturnValue(upload.promise);
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const imageInput = await screen.findByLabelText("character-image");
    const firstFile = new File(["first"], "first.png", { type: "image/png" });
    fireEvent.change(imageInput, { target: { files: [firstFile] } });
    mockUpdateCharacterCreation.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1));

    expect(imageInput).toBeDisabled();
    fireEvent.change(imageInput, {
      target: { files: [new File(["replacement"], "replacement.png", { type: "image/png" })] },
    });
    fireEvent.change(imageInput, { target: { files: [] } });
    expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1);
    expect(imageInput).toBeDisabled();

    view.unmount();
    await act(async () => {
      upload.resolve({ downloadUrl: "https://legacy.test/avatar" });
      await upload.promise;
    });
    await waitFor(() => expect(mockDeleteLegacyStoragePath).toHaveBeenCalledTimes(1));
  });

  test("keeps name and avatar inputs locked through feature-flag and legacy upload ownership", async () => {
    const featureDecision = deferred();
    const upload = deferred();
    mockIsTask07MediaV1WriteEnabled.mockReturnValue(featureDecision.promise);
    mockUploadLegacyImage.mockReturnValue(upload.promise);
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const nameInput = await screen.findByLabelText("character-name");
    const imageInput = await screen.findByLabelText("character-image");
    fireEvent.change(imageInput, {
      target: { files: [new File(["legacy"], "legacy.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(mockIsTask07MediaV1WriteEnabled).toHaveBeenCalledTimes(1));

    expect(nameInput).toBeDisabled();
    expect(imageInput).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: "should-not-change" } });
    fireEvent.change(imageInput, {
      target: { files: [new File(["replacement"], "replacement.png", { type: "image/png" })] },
    });
    expect(nameInput).toHaveValue("player");
    expect(mockUploadLegacyImage).not.toHaveBeenCalled();

    await act(async () => {
      featureDecision.resolve(false);
      await featureDecision.promise;
    });
    await waitFor(() => expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1));
    expect(nameInput).toBeDisabled();
    expect(imageInput).toBeDisabled();

    view.unmount();
    await act(async () => {
      upload.resolve({ downloadUrl: "https://legacy.test/avatar" });
      await upload.promise;
    });
    await waitFor(() => expect(mockDeleteLegacyStoragePath).toHaveBeenCalledTimes(1));
  });

  test("cleans only the stale actor upload while a newer actor submission remains pending", async () => {
    const uploadA = deferred();
    const uploadB = deferred();
    const completionB = deferred();
    mockUploadLegacyImage
      .mockReturnValueOnce(uploadA.promise)
      .mockReturnValueOnce(uploadB.promise);
    mockUpdateCharacterCreation.mockImplementation(({ action }) => (
      action === "complete" ? completionB.promise : Promise.resolve()
    ));
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("character-image"), {
      target: { files: [new File(["actor-a"], "actor-a.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1));
    const pathA = mockUploadLegacyImage.mock.calls[0][0];

    mockSessionState = {
      ...mockSessionState,
      user: { uid: "player-b", email: "other@example.com" },
      repositoryAccessGeneration: 2,
    };
    mockProfileState = {
      userData: { uid: "player-b", flags: { characterCreationDone: false } },
      profileUid: "player-b",
      profileStatus: "fresh",
    };
    act(() => {
      view.rerender(
        <MemoryRouter initialEntries={["/character-creation"]}>
          <RouteHarness />
        </MemoryRouter>
      );
    });
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("character-image"), {
      target: { files: [new File(["actor-b"], "actor-b.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(mockUploadLegacyImage).toHaveBeenCalledTimes(2));
    const pathB = mockUploadLegacyImage.mock.calls[1][0];

    await act(async () => {
      uploadB.resolve({ downloadUrl: "https://legacy.test/avatar-b" });
      await uploadB.promise;
    });
    await waitFor(() => expect(mockUpdateCharacterCreation).toHaveBeenCalledWith(
      expect.objectContaining({ action: "complete" })
    ));

    await act(async () => {
      uploadA.resolve({ downloadUrl: "https://legacy.test/avatar-a" });
      await uploadA.promise;
    });
    await waitFor(() => expect(mockDeleteLegacyStoragePath).toHaveBeenCalledTimes(1));
    expect(mockDeleteLegacyStoragePath).toHaveBeenCalledWith(pathA);
    expect(mockDeleteLegacyStoragePath).not.toHaveBeenCalledWith(pathB);

    await act(async () => {
      completionB.resolve(undefined);
      await completionB.promise;
    });
    await waitFor(() => expect(screen.getByTestId("login-route")).toBeInTheDocument());
    expect(mockDeleteLegacyStoragePath).not.toHaveBeenCalledWith(pathB);
    view.unmount();
  });

  test("rolls back an uploaded object when legacy download URL retrieval fails", async () => {
    const urlFailure = Object.assign(new Error("download URL unavailable"), {
      code: "storage/download-url-failed",
    });
    mockUploadLegacyImage.mockImplementation((path) => {
      mockUploadLegacyImage.lastPath = path;
      return Promise.reject(urlFailure);
    });
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("character-image"), {
      target: { files: [new File(["broken"], "broken.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));

    await waitFor(() => expect(screen.getByText("Character creation failed: download URL unavailable")).toBeInTheDocument());
    expect(mockDeleteLegacyStoragePath).toHaveBeenCalledTimes(1);
    expect(mockDeleteLegacyStoragePath).toHaveBeenCalledWith(mockUploadLegacyImage.lastPath);
    expect(mockUpdateCharacterCreation).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "complete" })
    );
    expect(screen.queryByTestId("login-route")).not.toBeInTheDocument();
    view.unmount();
  });

  test("does not delete a legacy object after an ambiguous completion acknowledgement", async () => {
    const unavailable = Object.assign(new Error("completion unavailable"), {
      code: "functions/unavailable",
    });
    mockUploadLegacyImage.mockResolvedValue({ downloadUrl: "https://legacy.test/ambiguous" });
    mockUpdateCharacterCreation.mockImplementation(({ action }) => (
      action === "complete" ? Promise.reject(unavailable) : Promise.resolve()
    ));
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("character-image"), {
      target: { files: [new File(["ambiguous"], "ambiguous.png", { type: "image/png" })] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(screen.getByText("Character creation failed: completion unavailable"))
      .toBeInTheDocument());
    expect(mockDeleteLegacyStoragePath).not.toHaveBeenCalled();

    view.unmount();
    expect(mockDeleteLegacyStoragePath).not.toHaveBeenCalled();
  });

  test("retries ambiguous legacy completion without uploading the same selected object again", async () => {
    const unavailable = Object.assign(new Error("completion unavailable"), {
      code: "functions/unavailable",
    });
    let completionAttempts = 0;
    mockUploadLegacyImage.mockResolvedValue({ downloadUrl: "https://legacy.test/retry" });
    mockUpdateCharacterCreation.mockImplementation(({ action }) => {
      if (action !== "complete") return Promise.resolve();
      completionAttempts += 1;
      return completionAttempts === 1 ? Promise.reject(unavailable) : Promise.resolve();
    });
    const view = render(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <RouteHarness />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("character-image"), {
      target: { files: [new File(["retry"], "retry.png", { type: "image/png" })] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(screen.getByText("Character creation failed: completion unavailable"))
      .toBeInTheDocument());
    expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    await waitFor(() => expect(screen.getByTestId("login-route")).toBeInTheDocument());
    expect(mockUploadLegacyImage).toHaveBeenCalledTimes(1);
    expect(completionAttempts).toBe(2);
    view.unmount();
  });
});
