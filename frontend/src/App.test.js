import React from "react";
import { render, screen } from "@testing-library/react";

let mockSessionState;
let mockProfileState;
let mockShellState;

jest.mock("react-router-dom", () => ({
  Routes: ({ children }) => <div data-testid="routes">{children}</div>,
  Route: ({ element = null, children = null }) => <>{element}{children}</>,
  Navigate: ({ to }) => <div data-testid="navigate">{to}</div>,
  Outlet: () => <div data-testid="route-outlet" />,
  useLocation: () => ({ pathname: "/" }),
}), { virtual: true });

jest.mock("./AuthContext", () => ({
  AuthProvider: ({ children }) => <>{children}</>,
  BOOTSTRAP_V2_ENABLED: true,
  useAuthSession: () => mockSessionState,
  useProfileState: () => mockProfileState,
  useShellProfile: () => mockShellState,
}));

jest.mock("./components/common/lazyLoading", () => {
  const actual = jest.requireActual("./components/common/lazyLoading");
  return {
    ...actual,
    RetryableLazyBoundary: ({ descriptor, componentProps }) => (
      descriptor.chunkName === 'feature-authenticated-layout'
        ? <div data-testid="layout">{componentProps?.children}</div>
        : <div>{descriptor.chunkName}</div>
    ),
  };
});

jest.mock("./components/Login", () => () => <div>Login Page</div>);
jest.mock("./components/characterCreation/CharacterCreation", () => () => <div>Character Creation Page</div>);
jest.mock("./components/home/Home", () => () => <div>Home Page</div>);
jest.mock("./components/bazaar/Bazaar", () => () => <div>Bazaar Page</div>);
jest.mock("./components/dmDashboard/DMDashboard", () => () => <div>DM Dashboard Page</div>);
jest.mock("./components/foesHub/FoesHub", () => () => <div>Foes Hub Page</div>);
jest.mock("./components/tecnicheSpell/TecnicheSpell", () => () => <div>Tecniche Spell Page</div>);
jest.mock("./components/combatTool/combatPage", () => () => <div>Combat Page</div>);
jest.mock("./components/admin/adminPage", () => () => <div>Admin Page</div>);
jest.mock("./components/codex/Codex", () => () => <div>Codex Page</div>);
jest.mock("./components/echiDiViaggio/EchiDiViaggio", () => () => <div>Echi di Viaggio Page</div>);
jest.mock("./components/grigliata/GrigliataPage", () => () => <div>Grigliata Page</div>);
jest.mock("./components/common/Layout", () => ({ children }) => <div data-testid="layout">{children}</div>);

const authenticatedUser = { uid: "user-1", email: "hero@example.com" };

const setFreshRole = (role) => {
  mockSessionState = {
    user: authenticatedUser,
    authReady: true,
    authStatus: "authenticated",
    logout: jest.fn(),
    retryAuth: jest.fn(),
  };
  mockProfileState = {
    profileStatus: "fresh",
    profileFresh: true,
    retryProfile: jest.fn(),
  };
  mockShellState = {
    shellProfile: { uid: authenticatedUser.uid, role },
    shellProfileFresh: true,
  };
};

describe("App route authorization states", () => {
  let AppRoutes;
  let AuthenticatedRoute;
  let ProtectedDMRoute;
  let ProtectedWebmasterRoute;

  beforeAll(() => {
    ({
      AppRoutes,
      AuthenticatedRoute,
      ProtectedDMRoute,
      ProtectedWebmasterRoute,
    } = require("./App"));
  });

  beforeEach(() => setFreshRole("player"));

  test("shows a deterministic state while auth is cold", () => {
    mockSessionState = { ...mockSessionState, user: null, authReady: false, authStatus: "checking" };
    render(<AuthenticatedRoute />);
    expect(screen.getByText("Checking your session")).toBeInTheDocument();
  });

  test("redirects an anonymous authenticated route to login", () => {
    mockSessionState = { ...mockSessionState, user: null, authStatus: "anonymous" };
    render(<AuthenticatedRoute />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/");
  });

  test("renders only a refresh shell for a cached role", () => {
    mockProfileState = { ...mockProfileState, profileStatus: "cached", profileFresh: false };
    mockShellState = { shellProfile: { uid: authenticatedUser.uid, role: "dm" }, shellProfileFresh: false };
    render(<AuthenticatedRoute />);
    expect(screen.getByText("Refreshing your profile")).toBeInTheDocument();
    expect(screen.getByTestId("layout")).toBeInTheDocument();
    expect(screen.queryByTestId("route-outlet")).not.toBeInTheDocument();
  });

  test("uses exact fresh DM and webmaster authorization", () => {
    setFreshRole("dm");
    const dmView = render(<ProtectedDMRoute><div>DM content</div></ProtectedDMRoute>);
    expect(screen.getByText("DM content")).toBeInTheDocument();
    dmView.unmount();

    setFreshRole("webmaster");
    const webmasterView = render(<ProtectedWebmasterRoute><div>Admin content</div></ProtectedWebmasterRoute>);
    expect(screen.getByText("Admin content")).toBeInTheDocument();
    webmasterView.unmount();

    render(<ProtectedDMRoute><div>DM content</div></ProtectedDMRoute>);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/home");
    expect(screen.queryByText("DM content")).not.toBeInTheDocument();
  });

  test("redirects immediately when a live DM role is lost", () => {
    setFreshRole("dm");
    const view = render(<ProtectedDMRoute><div>DM content</div></ProtectedDMRoute>);
    expect(screen.getByText("DM content")).toBeInTheDocument();

    setFreshRole("player");
    view.rerender(<ProtectedDMRoute><div>DM content</div></ProtectedDMRoute>);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/home");
  });

  test.each([
    ["missing", "Profile unavailable"],
    ["error", "Profile refresh failed"],
  ])("locks content for a %s profile", (profileStatus, title) => {
    mockProfileState = { ...mockProfileState, profileStatus, profileFresh: false };
    mockShellState = {
      shellProfile: profileStatus === "error" ? { uid: authenticatedUser.uid, role: "dm" } : null,
      shellProfileFresh: false,
    };
    render(<AuthenticatedRoute />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByTestId("route-outlet")).not.toBeInTheDocument();
  });

  test("retains public, authenticated, direct-role, and wildcard route elements", () => {
    render(<AppRoutes />);
    expect(screen.getByTestId("routes")).toBeInTheDocument();
    expect(screen.getByText("route-login")).toBeInTheDocument();
    expect(screen.getByText("route-character-creation")).toBeInTheDocument();
    expect(screen.getByText("route-grigliata")).toBeInTheDocument();
    expect(screen.getAllByTestId("navigate").some((node) => node.textContent === "/home")).toBe(true);
  });
});
