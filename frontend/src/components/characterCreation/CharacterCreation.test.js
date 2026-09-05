import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import CharacterCreation from "./CharacterCreation";

let mockAuthState;

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
    Route: ({ element }) => element || null,
    Routes: ({ children }) => <>{children}</>,
    useLocation: () => React.useContext(RouterContext).location,
    useNavigate: () => React.useContext(RouterContext).navigate,
  };
}, { virtual: true });

jest.mock("../../AuthContext", () => ({
  useAuth: () => mockAuthState,
  useAuthSession: () => ({
    user: mockAuthState.user,
    authStatus: "authenticated",
    repositoryAccessGeneration: 1,
  }),
  useProfileState: () => ({
    userData: mockAuthState.userData,
    profileUid: mockAuthState.user?.uid || null,
    profileStatus: mockAuthState.user ? "fresh" : "idle",
  }),
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

jest.mock("../backgrounds/GlobalAuroraBackground", () => () => null);
jest.mock("../common/legacyMediaStorage", () => ({
  deleteLegacyStoragePath: jest.fn(),
  uploadLegacyImage: jest.fn(),
}));
jest.mock("../common/useObjectUrl", () => () => null);
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
jest.mock("../../data/userData/userDataCommands", () => ({
  updateCharacterCreation: () => Promise.resolve(),
}));
jest.mock("../../performance/task08", () => ({
  beginTask08Transition: () => () => {},
  recordTask08Event: () => {},
}));
jest.mock("./elements/RaceSelection", () => ({ onRaceSelect }) => (
  <button type="button" onClick={() => onRaceSelect({ id: "human" })}>
    Choose race
  </button>
));
jest.mock("./elements/AnimaShardSelection", () => ({ onAnimaSelect }) => (
  <button type="button" onClick={() => onAnimaSelect({ name: "fire" })}>
    Choose anima
  </button>
));
jest.mock("./elements/PointsDistribution", () => () => null);
jest.mock("./elements/CharacterDetails", () => ({ characterName }) => (
  <input aria-label="character-name" value={characterName} readOnly />
));

const LocationStateProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="route-state">
      {location.state?.successMessage || "no-success-message"}
      {"|"}
      {location.state?.email || "no-email"}
    </div>
  );
};

describe("CharacterCreation account-created route state", () => {
  beforeEach(() => {
    mockAuthState = {
      user: { uid: "created-user", email: "new@example.com" },
      userData: { flags: { characterCreationDone: false } },
    };
  });

  test("shows the carried success confirmation immediately and consumes only that state", async () => {
    const successMessage = "Account created successfully! Redirecting to character setup...";
    render(
      <MemoryRouter
        initialEntries={[{
          pathname: "/character-creation",
          state: { email: "new@example.com", successMessage },
        }]}
      >
        <Routes>
          <Route path="/character-creation" element={<CharacterCreation />} />
        </Routes>
        <LocationStateProbe />
      </MemoryRouter>
    );

    const status = await screen.findByTestId("account-created-success");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent(successMessage);
    fireEvent.click(screen.getByRole("button", { name: "Choose race" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose anima" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Choose anima" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Points Distribution")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("character-name")).toHaveValue("new");
    await waitFor(() => expect(screen.getByTestId("route-state")).toHaveTextContent(
      "no-success-message|new@example.com"
    ));
    expect(screen.getByTestId("account-created-success")).toHaveTextContent(successMessage);
  });
});
