import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CharacterCreation from "./CharacterCreation";
import { getCodex } from "../../data/codexRepository";
import { getVarie } from "../../data/configRepository";
import { updateCharacterCreation } from "../../data/userData/userDataCommands";
import { uploadLegacyImage, deleteLegacyStoragePath } from "../../components/common/legacyMediaStorage";
import { isTask07MediaV1WriteEnabled } from "../../data/media/mediaFeatureFlags";

let mockSessionState;
let mockProfileState;
const mockUseAuth = jest.fn();
const mockNavigate = jest.fn();
const mockGetCodex = getCodex;
const mockGetVarie = getVarie;
const mockUpdateCharacterCreation = updateCharacterCreation;
const mockBeginTask08Transition = jest.fn();
const mockRecordTask08Event = jest.fn();

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const renderCharacterCreation = (initialEntry = "/character-creation") => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <CharacterCreation />
  </MemoryRouter>
);

const codexFixture = {
  Razze: { Elfo: "Agile and perceptive." },
};
const varieFixture = {
  modAnima: { Spirito: { Saggezza: 2 } },
  levelUpAnimaBonus: { Spirito: { Saggezza: 1 } },
  cost_params_combat: { Attacco: 2 },
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
      mockNavigate(to, options);
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
  useAuth: (...args) => mockUseAuth(...args),
  useAuthSession: () => mockSessionState,
  useProfileState: () => mockProfileState,
}));
jest.mock("../../data/codexRepository", () => ({
  getCodex: jest.fn(),
  invalidateCodex: jest.fn(),
}));
jest.mock("../../data/configRepository", () => ({
  getVarie: jest.fn(),
  invalidateConfig: jest.fn(),
}));
jest.mock("../../data/userData/userDataCommands", () => ({
  updateCharacterCreation: jest.fn(),
}));
jest.mock("../backgrounds/GlobalAuroraBackground", () => () => null);
jest.mock("../common/useObjectUrl", () => () => null);
jest.mock("../common/legacyMediaStorage", () => ({
  deleteLegacyStoragePath: jest.fn(),
  uploadLegacyImage: jest.fn(),
}));
jest.mock("../../data/media/mediaFeatureFlags", () => ({
  isTask07MediaV1WriteEnabled: jest.fn(() => Promise.resolve(false)),
}));
jest.mock("../../data/media/mediaOperationOwner", () => ({
  createTask07MediaOperationOwner: () => ({
    cancel: jest.fn(),
    dispose: jest.fn(),
    hasActiveOperation: () => false,
    isDisposed: () => false,
    start: jest.fn(),
  }),
}));
jest.mock("./characterCreationAvatarMedia", () => ({
  runCharacterCreationAvatarV1Write: jest.fn(),
  task07ProfileRevision: jest.fn(() => 0),
}));
jest.mock("../../performance/task08", () => ({
  beginTask08Transition: (...args) => mockBeginTask08Transition(...args),
  recordTask08Event: (...args) => mockRecordTask08Event(...args),
}));
jest.mock("./elements/RaceSelection", () => ({ onRaceSelect, selectedRace, disabled }) => (
  <>
    <div data-testid="selected-race-state">{selectedRace?.id || "none"}</div>
    <button type="button" disabled={disabled} onClick={() => onRaceSelect({ id: "human" })}>
      Choose race
    </button>
    <button type="button" disabled={disabled} onClick={() => onRaceSelect({ id: "elf" })}>
      Choose other race
    </button>
  </>
));
jest.mock("./elements/AnimaShardSelection", () => ({ onAnimaSelect, selectedAnima, disabled }) => (
  <>
    <div data-testid="selected-anima-state">{selectedAnima?.name || "none"}</div>
    <button type="button" disabled={disabled} onClick={() => onAnimaSelect({ name: "fire" })}>
      Choose anima
    </button>
    <button type="button" disabled={disabled} onClick={() => onAnimaSelect({ name: "water" })}>
      Choose other anima
    </button>
  </>
));
jest.mock("./elements/PointsDistribution", () => () => <h2>Points Distribution</h2>);
jest.mock("./elements/CharacterDetails", () => ({
  characterName,
  setCharacterName,
  handleImageChange,
  imagePreview,
  disabled,
}) => (
  <>
    <input
      aria-label="character-name"
      value={characterName}
      disabled={disabled}
      onChange={(event) => setCharacterName(event.target.value)}
    />
    <input
      aria-label="character-image"
      type="file"
      disabled={disabled}
      onChange={handleImageChange}
    />
    {imagePreview && <img src={imagePreview} alt="Preview" />}
  </>
));

describe("Character Creation Step 3 shared loading and navigation", () => {
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
    mockUseAuth.mockReturnValue({
      user: mockSessionState.user,
      userData: mockProfileState.userData,
    });
    mockNavigate.mockReset();
    mockGetCodex.mockReset();
    mockGetVarie.mockReset();
    mockUpdateCharacterCreation.mockReset();
    mockUpdateCharacterCreation.mockResolvedValue(undefined);
    uploadLegacyImage.mockReset();
    deleteLegacyStoragePath.mockReset().mockResolvedValue(undefined);
    isTask07MediaV1WriteEnabled.mockReset().mockResolvedValue(false);
    mockBeginTask08Transition.mockReset();
    mockBeginTask08Transition.mockImplementation(() => jest.fn());
    mockRecordTask08Event.mockReset();
  });

  const resolveSharedData = () => {
    mockGetCodex.mockResolvedValue(codexFixture);
    mockGetVarie.mockResolvedValue(varieFixture);
  };

  const rerenderAs = (view, uid, email, generation = 2, profile = {}) => {
    mockSessionState = {
      ...mockSessionState,
      user: { uid, email },
      repositoryAccessGeneration: generation,
    };
    mockProfileState = {
      userData: {
        uid,
        flags: { characterCreationDone: false },
        ...profile,
      },
      profileUid: uid,
      profileStatus: "fresh",
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <CharacterCreation />
      </MemoryRouter>
    );
  };

  test("starts both read-only loads before either promise settles", async () => {
    const codex = deferred();
    const varie = deferred();
    mockGetCodex.mockReturnValue(codex.promise);
    mockGetVarie.mockReturnValue(varie.promise);

    renderCharacterCreation();

    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(1));
    expect(mockGetVarie).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading race data...")).toBeInTheDocument();

    await act(async () => {
      codex.resolve(codexFixture);
      varie.resolve(varieFixture);
      await Promise.all([codex.promise, varie.promise]);
    });
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
  });

  test("renders Step 1 after Codex settles while Varie is still pending or fails", async () => {
    const varie = deferred();
    mockGetCodex.mockResolvedValue(codexFixture);
    mockGetVarie.mockReturnValue(varie.promise);
    renderCharacterCreation();

    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    expect(mockGetCodex).toHaveBeenCalledTimes(1);
    expect(mockGetVarie).toHaveBeenCalledTimes(1);

    await act(async () => {
      varie.reject(new Error("varie unavailable"));
      await expect(varie.promise).rejects.toThrow("varie unavailable");
    });

    expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument();
    expect(screen.queryByText("Character Creation data could not be loaded. Please retry.")).not.toBeInTheDocument();
  });

  test("shows explicit retry UI after a rejected load and retries the read", async () => {
    mockGetCodex
      .mockRejectedValueOnce(new Error("codex unavailable"))
      .mockResolvedValueOnce(codexFixture);
    mockGetVarie.mockResolvedValue(varieFixture);

    renderCharacterCreation();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
  });

  test("reuses one shared snapshot while revisiting the steps", async () => {
    resolveSharedData();
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Points Distribution" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose anima" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());

    expect(mockGetCodex).toHaveBeenCalledTimes(1);
    expect(mockGetVarie).toHaveBeenCalledTimes(1);
  });

  test("skips an unchanged race and Anima mutation on a revisit", async () => {
    resolveSharedData();
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Points Distribution" })).toBeInTheDocument();
    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(2);
    expect(mockUpdateCharacterCreation.mock.calls.slice(0, 2).map(([request]) => request.retryScope))
      .toEqual([
        "character-creation:player-a:owned:1:race",
        "character-creation:player-a:owned:1:anima",
      ]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Points Distribution" })).toBeInTheDocument();
    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(2);
  });

  test("provides actor- and repository-generation-fenced scopes for later Character Creation actions", async () => {
    resolveSharedData();
    const view = renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    expect(mockUpdateCharacterCreation.mock.calls[0][0].retryScope)
      .toBe("character-creation:player-a:owned:1:race");

    rerenderAs(view, "player-b", "other@example.com", 2);
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();

    expect(mockUpdateCharacterCreation.mock.calls[1][0].retryScope)
      .toBe("character-creation:player-b:owned:2:race");
  });

  test("treats a changed-back selection as a fresh logical action", async () => {
    resolveSharedData();
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose other race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(3);
  });

  test("uses split auth contexts without adding a compatibility profile source", async () => {
    resolveSharedData();
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    expect(mockUseAuth).not.toHaveBeenCalled();
  });

  test("keeps a partial legacy profile safe while loading Character Creation", async () => {
    mockProfileState = {
      userData: { uid: "player-a" },
      profileUid: "player-a",
      profileStatus: "fresh",
    };
    resolveSharedData();

    renderCharacterCreation();

    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
  });

  test("locks a deferred Next transition synchronously and sends one race command", async () => {
    const command = deferred();
    mockGetCodex.mockResolvedValue(codexFixture);
    mockGetVarie.mockResolvedValue(varieFixture);
    mockUpdateCharacterCreation.mockReturnValue(command.promise);
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    const next = screen.getByRole("button", { name: "Next" });

    act(() => {
      fireEvent.click(next);
      fireEvent.click(next);
    });

    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(1);
    expect(next).toBeDisabled();
    await act(async () => {
      command.resolve(undefined);
      await command.promise;
    });
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    expect(mockBeginTask08Transition).toHaveBeenCalledTimes(1);
  });

  test("releases the Next lock after a command failure so the same step can retry", async () => {
    const failure = deferred();
    mockGetCodex.mockResolvedValue(codexFixture);
    mockGetVarie.mockResolvedValue(varieFixture);
    mockUpdateCharacterCreation
      .mockReturnValueOnce(failure.promise)
      .mockResolvedValue(undefined);
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);
    expect(next).toBeDisabled();

    await act(async () => {
      failure.reject(new Error("write failed"));
      await expect(failure.promise).rejects.toThrow("write failed");
    });
    expect(await screen.findByText(/Failed to save race selection/)).toBeInTheDocument();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    await waitFor(() => expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
  });

  test("serializes a rapid double Back into one revisit", async () => {
    resolveSharedData();
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    const back = screen.getByRole("button", { name: "Back" });

    act(() => {
      fireEvent.click(back);
      fireEvent.click(back);
    });

    expect(mockRecordTask08Event.mock.calls.filter(([event]) => event.metric === "step-revisit")).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose anima" })).toBeInTheDocument());
  });

  test("serializes a browser-faithful double Back burst without skipping a step", async () => {
    resolveSharedData();
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Points Distribution" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("character-name")).toHaveValue("player");
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());

    mockBeginTask08Transition.mockClear();
    mockRecordTask08Event.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Back" }), { detail: 1 });
    expect(await screen.findByRole("heading", { name: "Points Distribution" })).toBeInTheDocument();

    // A real DOM double-click delivers the second click after the first render
    // with detail=2. This must remain part of the first physical burst.
    fireEvent.click(screen.getByRole("button", { name: "Back" }), { detail: 2 });
    expect(screen.getByRole("heading", { name: "Points Distribution" })).toBeInTheDocument();
    expect(mockBeginTask08Transition).toHaveBeenCalledTimes(1);
    expect(mockRecordTask08Event.mock.calls.filter(([event]) => event.metric === "step-revisit"))
      .toHaveLength(1);
    expect(mockRecordTask08Event.mock.calls.filter(([event]) => event.metric === "step-revisit-window-start"))
      .toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Back" }), { detail: 1 });
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    expect(mockBeginTask08Transition).toHaveBeenCalledTimes(2);
    expect(mockRecordTask08Event.mock.calls.filter(([event]) => event.metric === "step-revisit"))
      .toHaveLength(2);
  });

  test("locks final submission before React rerenders so Create sends one command", async () => {
    resolveSharedData();
    renderCharacterCreation();
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
    expect(await screen.findByLabelText("character-name")).toHaveValue("player");

    const command = deferred();
    mockUpdateCharacterCreation.mockClear();
    mockUpdateCharacterCreation.mockReturnValue(command.promise);
    const create = screen.getByRole("button", { name: "Create Character" });
    act(() => {
      fireEvent.click(create);
      fireEvent.click(create);
    });

    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(1);
    expect(create).toBeDisabled();
    await act(async () => {
      command.resolve(undefined);
      await command.promise;
    });
    expect(mockUpdateCharacterCreation).toHaveBeenCalledWith(expect.objectContaining({
      action: "complete",
      characterId: "player",
      retryScope: "character-creation:player-a:owned:1:complete",
    }));
  });

  test("fences a stale account load when the authenticated profile changes", async () => {
    const accountACodex = deferred();
    const accountAVarie = deferred();
    const accountBCodex = deferred();
    const accountBVarie = deferred();
    mockGetCodex
      .mockReturnValueOnce(accountACodex.promise)
      .mockReturnValueOnce(accountBCodex.promise);
    mockGetVarie
      .mockReturnValueOnce(accountAVarie.promise)
      .mockReturnValueOnce(accountBVarie.promise);
    const view = renderCharacterCreation();
    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(1));

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
    mockUseAuth.mockReturnValue({ user: mockSessionState.user, userData: mockProfileState.userData });
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <CharacterCreation />
      </MemoryRouter>
    );
    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(2));

    await act(async () => {
      accountACodex.resolve({ Razze: { Stale: "stale" } });
      accountAVarie.resolve(varieFixture);
      await Promise.all([accountACodex.promise, accountAVarie.promise]);
    });
    expect(screen.queryByText("Choose race")).not.toBeInTheDocument();

    await act(async () => {
      accountBCodex.resolve(codexFixture);
      accountBVarie.resolve(varieFixture);
      await Promise.all([accountBCodex.promise, accountBVarie.promise]);
    });
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
  });

  test("does not render the previous actor snapshot after the profile becomes unavailable", async () => {
    resolveSharedData();
    const view = renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();

    mockProfileState = {
      userData: null,
      profileUid: null,
      profileStatus: "missing",
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <CharacterCreation />
      </MemoryRouter>
    );

    expect(await screen.findByText("Character profile is unavailable. Please return to login and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose race" })).not.toBeInTheDocument();
  });

  test("requires exact fresh profile ownership before rendering the wizard", async () => {
    mockProfileState = {
      userData: { uid: "player-a", flags: { characterCreationDone: false } },
      profileUid: null,
      profileStatus: "fresh",
    };
    resolveSharedData();
    renderCharacterCreation();

    expect(await screen.findByText("Waiting for character profile...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose race" })).not.toBeInTheDocument();
    expect(mockGetCodex).not.toHaveBeenCalled();
    expect(mockGetVarie).not.toHaveBeenCalled();
  });

  test("does not redirect from stale completed profile data across actors", async () => {
    mockSessionState = {
      user: { uid: "player-b", email: "other@example.com" },
      authStatus: "authenticated",
      repositoryAccessGeneration: 1,
    };
    mockProfileState = {
      userData: { uid: "player-a", flags: { characterCreationDone: true } },
      profileUid: "player-a",
      profileStatus: "fresh",
    };
    const view = renderCharacterCreation();

    await waitFor(() => expect(screen.getByText("Waiting for character profile...")).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalledWith("/home");

    mockProfileState = {
      userData: { uid: "player-b", flags: { characterCreationDone: true } },
      profileUid: "player-b",
      profileStatus: "fresh",
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <CharacterCreation />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockNavigate.mock.calls.some(([destination]) => destination === "/home")).toBe(true));
    expect(mockNavigate.mock.calls.filter(([destination]) => destination === "/home")).toHaveLength(1);
  });

  test("leaves initialization when the authoritative profile becomes ready after route initialization", async () => {
    mockSessionState = {
      ...mockSessionState,
      user: { uid: "player-a", email: "created@example.com" },
    };
    mockProfileState = {
      userData: null,
      profileUid: null,
      profileStatus: "loading",
    };
    resolveSharedData();
    const view = renderCharacterCreation({
      pathname: "/character-creation",
      state: { email: "created@example.com" },
    });

    await waitFor(() => expect(screen.getByText("Waiting for character profile...")).toBeInTheDocument());

    mockProfileState = {
      userData: { uid: "player-a", flags: { characterCreationDone: false } },
      profileUid: "player-a",
      profileStatus: "fresh",
    };
    view.rerender(
      <MemoryRouter initialEntries={[{
        pathname: "/character-creation",
        state: { email: "created@example.com" },
      }]}>
        <CharacterCreation />
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
    expect(await screen.findByLabelText("character-name")).toHaveValue("created");
  });

  test("preserves an edited name across same-uid refresh and derives the next actor default", async () => {
    resolveSharedData();
    const view = renderCharacterCreation();
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
    const nameInput = await screen.findByLabelText("character-name");
    fireEvent.change(nameInput, { target: { value: "edited-player" } });

    mockSessionState = {
      ...mockSessionState,
      repositoryAccessGeneration: 2,
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <CharacterCreation />
      </MemoryRouter>
    );
    expect(await screen.findByLabelText("character-name")).toHaveValue("edited-player");

    rerenderAs(view, "player-b", "other@example.com", 3);
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("character-name")).toHaveValue("other");
  });

  test("keeps Step 2 usable during a same-uid Codex refresh that is pending or failed", async () => {
    const refreshedCodex = deferred();
    mockGetCodex
      .mockResolvedValueOnce(codexFixture)
      .mockReturnValueOnce(refreshedCodex.promise);
    mockGetVarie.mockResolvedValue(varieFixture);
    const view = renderCharacterCreation();

    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();

    mockSessionState = {
      ...mockSessionState,
      repositoryAccessGeneration: 2,
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <CharacterCreation />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Choose anima" })).toBeInTheDocument();

    await act(async () => {
      refreshedCodex.reject(new Error("Codex refresh failed"));
      await expect(refreshedCodex.promise).rejects.toThrow("Codex refresh failed");
    });
    expect(screen.getByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    expect(screen.queryByText("Loading race data...")).not.toBeInTheDocument();
    expect(screen.queryByText("Race data could not be loaded. Please retry.")).not.toBeInTheDocument();
  });

  test("resets all wizard selections when ownership changes to another actor", async () => {
    resolveSharedData();
    const view = renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Points Distribution")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const nameInput = await screen.findByLabelText("character-name");
    fireEvent.change(nameInput, { target: { value: "Actor A Name" } });
    expect(nameInput).toHaveValue("Actor A Name");

    rerenderAs(view, "player-b", "other@example.com");

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());
    expect(screen.getByTestId("selected-race-state")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    expect(screen.getByTestId("selected-anima-state")).toHaveTextContent("none");
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("character-name")).toHaveValue("other");
  });

  test("does not apply a stale race rejection after ownership changes", async () => {
    const raceCommand = deferred();
    mockGetCodex.mockResolvedValue(codexFixture);
    mockGetVarie.mockResolvedValue(varieFixture);
    mockUpdateCharacterCreation.mockReturnValueOnce(raceCommand.promise);
    const view = renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    rerenderAs(view, "player-b", "other@example.com");
    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(2));
    await act(async () => {
      raceCommand.reject(new Error("stale race failure"));
      await expect(raceCommand.promise).rejects.toThrow("stale race failure");
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());
    expect(screen.queryByText(/Failed to save race selection/)).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith("/home");
  });

  test("does not apply a stale anima resolution after ownership changes", async () => {
    const animaCommand = deferred();
    resolveSharedData();
    mockUpdateCharacterCreation
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(animaCommand.promise);
    const view = renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    rerenderAs(view, "player-b", "other@example.com");
    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(2));
    await act(async () => {
      animaCommand.resolve(undefined);
      await animaCommand.promise;
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Points Distribution" })).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith("/home");
  });

  test("fences same-uid generation rejection without wiping legitimate wizard selection", async () => {
    const raceCommand = deferred();
    mockGetCodex.mockResolvedValue(codexFixture);
    mockGetVarie.mockResolvedValue(varieFixture);
    mockUpdateCharacterCreation.mockReturnValueOnce(raceCommand.promise);
    const view = renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    mockSessionState = {
      ...mockSessionState,
      repositoryAccessGeneration: 2,
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <CharacterCreation />
      </MemoryRouter>
    );
    await act(async () => {
      raceCommand.reject(new Error("stale generation failure"));
      await expect(raceCommand.promise).rejects.toThrow("stale generation failure");
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());
    expect(screen.getByTestId("selected-race-state")).toHaveTextContent("human");
    expect(screen.queryByText(/Failed to save race selection/)).not.toBeInTheDocument();
  });

  test("guards a same-tick race selection while its command is pending", async () => {
    const raceCommand = deferred();
    mockGetCodex.mockResolvedValue(codexFixture);
    mockGetVarie.mockResolvedValue(varieFixture);
    mockUpdateCharacterCreation.mockReturnValue(raceCommand.promise);
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    const next = screen.getByRole("button", { name: "Next" });

    act(() => {
      fireEvent.click(next);
      fireEvent.click(screen.getByRole("button", { name: "Choose other race" }));
    });

    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("selected-race-state")).toHaveTextContent("human");
    expect(screen.getByRole("button", { name: "Choose other race" })).toBeDisabled();
    await act(async () => {
      raceCommand.resolve(undefined);
      await raceCommand.promise;
    });
  });

  test("guards a same-tick anima selection while its command is pending", async () => {
    const animaCommand = deferred();
    resolveSharedData();
    mockUpdateCharacterCreation
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(animaCommand.promise);
    renderCharacterCreation();
    expect(await screen.findByRole("button", { name: "Choose race" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Choose anima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    const next = screen.getByRole("button", { name: "Next" });

    act(() => {
      fireEvent.click(next);
      fireEvent.click(screen.getByRole("button", { name: "Choose other anima" }));
    });

    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("selected-anima-state")).toHaveTextContent("fire");
    expect(screen.getByRole("button", { name: "Choose other anima" })).toBeDisabled();
    await act(async () => {
      animaCommand.resolve(undefined);
      await animaCommand.promise;
    });
  });

  test("fences a stale final completion after the authenticated account changes", async () => {
    resolveSharedData();
    const view = renderCharacterCreation();
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
    expect(await screen.findByLabelText("character-name")).toHaveValue("player");

    const completion = deferred();
    mockUpdateCharacterCreation.mockClear().mockReturnValue(completion.promise);
    fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
    expect(mockUpdateCharacterCreation).toHaveBeenCalledTimes(1);

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
        <CharacterCreation />
      </MemoryRouter>
    );
    await waitFor(() => expect(mockGetCodex).toHaveBeenCalledTimes(2));
    await act(async () => {
      completion.reject(new Error("stale completion failure"));
      await expect(completion.promise).rejects.toThrow("stale completion failure");
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose race" })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(/Character creation failed/)).not.toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalledWith("/home");
  });

  test('resaves the retained Anima after a different race resets it on the server', async () => {
    resolveSharedData();
    let serverAnima = '---';
    mockUpdateCharacterCreation.mockImplementation(async (request) => {
      if (request.action === 'selectRace') serverAnima = '---';
      if (request.action === 'selectAnima') serverAnima = request.anima;
    });
    renderCharacterCreation();
    await screen.findByRole('button', { name: 'Choose race' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose race' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'Choose anima' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose anima' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Points Distribution' });
    expect(serverAnima).toBe('fire');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('button', { name: 'Choose anima' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('button', { name: 'Choose other race' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose other race' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'Choose anima' });
    expect(screen.getByTestId('selected-anima-state')).toHaveTextContent('fire');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Points Distribution' });
    expect(serverAnima).toBe('fire');
  });
});
