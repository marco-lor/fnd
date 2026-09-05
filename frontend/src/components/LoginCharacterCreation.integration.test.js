import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Login from "./Login";
import CharacterCreation from "./characterCreation/CharacterCreation";
import { createUserWithEmailAndPassword } from "firebase/auth";

let mockSessionState;
let mockProfileState;
let createRequest;
const mockNavigate = jest.fn();

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

  const Route = ({ path, element }) => {
    const { location } = React.useContext(RouterContext);
    return path === location.pathname ? element : null;
  };

  return {
    MemoryRouter,
    Route,
    Routes: ({ children }) => <>{children}</>,
    useLocation: () => React.useContext(RouterContext).location,
    useNavigate: () => React.useContext(RouterContext).navigate,
  };
}, { virtual: true });

jest.mock("./../AuthContext", () => ({
  useAuth: () => ({
    user: mockSessionState.user,
    userData: mockProfileState.userData,
  }),
  useAuthSession: () => mockSessionState,
  useProfileState: () => mockProfileState,
}));

jest.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
}));
jest.mock("./firebaseConfig", () => ({ auth: {} }));
jest.mock("../data/codexRepository", () => ({
  getCodex: jest.fn(() => Promise.resolve({ Razze: { Human: "A balanced race." } })),
  invalidateCodex: jest.fn(),
}));
jest.mock("../data/configRepository", () => ({
  getVarie: jest.fn(() => Promise.resolve({
    modAnima: { Fire: { Forza: 1 } },
    levelUpAnimaBonus: { Fire: { Salute: 1 } },
    cost_params_combat: {},
  })),
  invalidateConfig: jest.fn(),
}));
jest.mock("./LoginVisuals", () => ({
  LoginCardBorder: () => null,
  LoginDecorativeBackground: () => null,
  LoginDecorativeOrbs: () => null,
  LoginHeader: () => <h1>Login</h1>,
}));
jest.mock("../performance/PerformanceProfiler", () => ({ children }) => <>{children}</>);
jest.mock("../performance/task08", () => ({
  beginTask08Transition: () => () => {},
  recordTask08Event: () => {},
  runTask08AuthRequest: (_operation, request) => request(),
}));
jest.mock("../data/userData/userDataCommands", () => ({
  updateCharacterCreation: () => Promise.resolve(),
}));

jest.mock("./characterCreation/characterCreationAvatarMedia", () => ({
  runCharacterCreationAvatarV1Write: jest.fn(),
  task07ProfileRevision: jest.fn(() => 0),
}));
jest.mock("./common/legacyMediaStorage", () => ({
  deleteLegacyStoragePath: jest.fn(),
  uploadLegacyImage: jest.fn(),
}));
jest.mock("./common/useObjectUrl", () => () => null);
jest.mock("./backgrounds/GlobalAuroraBackground", () => () => null);
jest.mock("../data/media/mediaFeatureFlags", () => ({
  isTask07MediaV1WriteEnabled: jest.fn(() => Promise.resolve(false)),
}));
jest.mock("../data/media/mediaOperationOwner", () => ({
  createTask07MediaOperationOwner: () => ({
    cancel: () => {},
    dispose: () => {},
    hasActiveOperation: () => false,
    isDisposed: () => false,
    start: () => null,
  }),
}));
jest.mock("./characterCreation/elements/RaceSelection", () => () => null);
jest.mock("./characterCreation/elements/AnimaShardSelection", () => () => null);
jest.mock("./characterCreation/elements/PointsDistribution", () => () => null);
jest.mock("./characterCreation/elements/CharacterDetails", () => () => null);

const renderJourney = () => render(
  <MemoryRouter initialEntries={["/"]}>
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/character-creation" element={<CharacterCreation />} />
    </Routes>
  </MemoryRouter>
);

describe("Login to Character Creation journey", () => {
  beforeEach(() => {
    mockSessionState = { user: null, authStatus: "anonymous" };
    mockProfileState = { userData: null, profileUid: null, profileStatus: "idle" };
    createRequest = deferred();
    mockNavigate.mockReset();
    createUserWithEmailAndPassword.mockReset();
    createUserWithEmailAndPassword.mockReturnValue(createRequest.promise);
  });

  test("navigates as soon as a pre-fresh shared profile is available and shows the confirmation", async () => {
    const view = renderJourney();
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "secret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));
    await waitFor(() => expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: "created-user", email: "new@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = {
      userData: { uid: "created-user", flags: { characterCreationDone: false } },
      profileUid: "created-user",
      profileStatus: "fresh",
    };
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/character-creation" element={<CharacterCreation />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();

    await act(async () => {
      createRequest.resolve({ user: { uid: "created-user", email: "new@example.com" } });
      await createRequest.promise;
    });

    await waitFor(() => expect(screen.getByRole("heading", { name: "Character Creation" })).toBeInTheDocument());
    expect(screen.getByTestId("account-created-success")).toHaveTextContent(
      "Account created successfully! Redirecting to character setup..."
    );
    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
  });

  test("preserves a create confirmation until the exact actor profile becomes ready", async () => {
    mockSessionState = {
      user: { uid: "created-user", email: "new@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = {
      userData: null,
      profileUid: null,
      profileStatus: "loading",
    };
    const view = render(
      <MemoryRouter initialEntries={[{
        pathname: "/character-creation",
        state: {
          email: "new@example.com",
          successMessage: "Account created successfully! Redirecting to character setup...",
        },
      }]}>
        <Routes>
          <Route path="/character-creation" element={<CharacterCreation />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Waiting for character profile...")).toBeInTheDocument());
    expect(screen.queryByTestId("account-created-success")).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    mockProfileState = {
      userData: { uid: "created-user", flags: { characterCreationDone: false } },
      profileUid: "created-user",
      profileStatus: "fresh",
    };
    view.rerender(
      <MemoryRouter initialEntries={[{
        pathname: "/character-creation",
        state: {
          email: "new@example.com",
          successMessage: "Account created successfully! Redirecting to character setup...",
        },
      }]}>
        <Routes>
          <Route path="/character-creation" element={<CharacterCreation />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId("account-created-success")).toHaveTextContent(
      "Account created successfully! Redirecting to character setup..."
    );
    expect(mockNavigate).toHaveBeenCalledWith("/character-creation", expect.objectContaining({
      replace: true,
      state: { email: "new@example.com" },
    }));

    mockSessionState = {
      ...mockSessionState,
      user: { uid: "other-user", email: "other@example.com" },
    };
    mockProfileState = {
      userData: { uid: "other-user", flags: { characterCreationDone: false } },
      profileUid: "other-user",
      profileStatus: "fresh",
    };
    view.rerender(
      <MemoryRouter initialEntries={["/character-creation"]}>
        <Routes>
          <Route path="/character-creation" element={<CharacterCreation />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByTestId("account-created-success")).not.toBeInTheDocument());
  });
});
