import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Login from "./Login";
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { updateCharacterCreation } from "../data/userData/userDataCommands";
import {
  beginTask08Transition,
  runTask08AuthRequest,
} from "../performance/task08";

const mockNavigate = jest.fn();
let mockSessionState;
let mockProfileState;
let mockAuroraRenderCount = 0;
let mockCreateButtonRenderCount = 0;
let mockProfilerRenderCounts = {};
const mockTransitionFinishers = [];

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock("../AuthContext", () => ({
  useAuthSession: () => mockSessionState,
  useProfileState: () => mockProfileState,
}));

jest.mock("../performance/PerformanceProfiler", () => ({ id, children }) => {
  mockProfilerRenderCounts[id] = (mockProfilerRenderCounts[id] || 0) + 1;
  return <>{children}</>;
});

jest.mock("./firebaseConfig", () => ({ auth: {}, db: {} }));

jest.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  fetchSignInMethodsForEmail: jest.fn(),
}));

jest.mock("../data/userData/userDataCommands", () => ({
  updateCharacterCreation: jest.fn(() => Promise.resolve()),
}));

jest.mock("../performance/firestore", () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join("/") })),
  getDoc: jest.fn(),
  setDoc: jest.fn(() => Promise.resolve()),
}));

jest.mock("./backgrounds/AuroraBackground", () => () => {
  mockAuroraRenderCount += 1;
  return <div data-testid="aurora" />;
});
jest.mock("./LoginCreateButton", () => {
  const MockLoginCreateButton = ({ handleCreate, disabled, isCreatingAccount }) => {
    mockCreateButtonRenderCount += 1;
    return (
      <button
        type="button"
        onClick={handleCreate}
        disabled={disabled || isCreatingAccount}
      >
        Create account
      </button>
    );
  };
  return require("react").memo(MockLoginCreateButton);
});

jest.mock("../performance/task08", () => ({
  beginTask08Transition: jest.fn(() => {
    const finish = jest.fn();
    mockTransitionFinishers.push(finish);
    return finish;
  }),
  recordTask08Event: jest.fn(),
  runTask08AuthRequest: jest.fn((_operation, request) => request()),
}));

const submitLogin = () => {
  fireEvent.change(screen.getByPlaceholderText("Email address"), {
    target: { value: "hero@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "secret1" },
  });
  fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));
};

const fillCredentials = (email = "hero@example.com", password = "secret1") => {
  fireEvent.change(screen.getByPlaceholderText("Email address"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: password },
  });
};

const clickCreate = () => fireEvent.click(screen.getByRole("button", { name: "Create account" }));

const expectControlsEnabled = () => {
  expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
  expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
    .not.toBeDisabled();
};

const matchingSession = (uid = "user-1", email = "hero@example.com") => ({
  user: { uid, email },
  authStatus: "authenticated",
});

const freshProfile = (characterCreationDone = false, uid = "user-1") => ({
  userData: { uid, flags: { characterCreationDone } },
  profileUid: uid,
  profileStatus: "fresh",
});

describe("Login shared profile flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuroraRenderCount = 0;
    mockCreateButtonRenderCount = 0;
    mockProfilerRenderCounts = {};
    mockTransitionFinishers.length = 0;
    updateCharacterCreation.mockResolvedValue(undefined);
    mockSessionState = { user: null, authStatus: "anonymous" };
    mockProfileState = { userData: null, profileUid: null, profileStatus: "idle" };
    beginTask08Transition.mockImplementation(() => {
      const finish = jest.fn();
      mockTransitionFinishers.push(finish);
      return finish;
    });
    runTask08AuthRequest.mockImplementation((_operation, request) => request());
    signInWithEmailAndPassword.mockResolvedValue({
      user: { uid: "user-1", email: "hero@example.com" },
    });
    createUserWithEmailAndPassword.mockResolvedValue({
      user: { uid: "created-user", email: "new@example.com" },
    });
    fetchSignInMethodsForEmail.mockResolvedValue([]);
  });

  test.each([
    [true, "/home"],
    [false, "/character-creation"],
  ])("waits for the shared fresh profile before navigating", async (done, destination) => {
    const view = render(<Login />);
    submitLogin();

    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = freshProfile(done);
    view.rerender(<Login />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(destination));
  });

  test("waits through a pre-observer authenticated session before accepting the matching UID", async () => {
    mockSessionState = {
      user: { uid: "previous-user", email: "previous@example.com" },
      authStatus: "authenticated",
      authObserverRevision: 1,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
      authObserverRevision: 2,
    };
    mockProfileState = freshProfile(false);
    view.rerender(<Login />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/character-creation"));
  });

  test("cancels when a different authenticated UID is published before the auth promise resolves", async () => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 1,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: "other-user", email: "other@example.com" },
      authStatus: "authenticated",
      authObserverRevision: 2,
    };
    view.rerender(<Login />);

    await act(async () => {
      authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
      await authRequest.promise;
    });

    await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .not.toBeDisabled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");
  });

  test.each(["resolve", "reject"])(
    "finishes on auth observer error while the Auth promise is pending and ignores a late %s",
    async (lateSettlement) => {
      const authRequest = deferred();
      signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
      mockSessionState = {
        user: null,
        authStatus: "anonymous",
        authObserverRevision: 1,
      };
      const view = render(<Login />);
      submitLogin();
      await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

      mockSessionState = {
        user: null,
        authStatus: "error",
        authObserverRevision: 2,
      };
      view.rerender(<Login />);

      await waitFor(() => expect(screen.getByText(/authentication state could not be confirmed/i)).toBeInTheDocument());
      expectControlsEnabled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockTransitionFinishers).toHaveLength(1);
      expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
      expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("failure");

      await act(async () => {
        if (lateSettlement === "resolve") {
          authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
        } else {
          authRequest.reject(Object.assign(new Error("late failure"), { code: "auth/network-request-failed" }));
        }
        await authRequest.promise.catch(() => undefined);
      });

      expect(screen.getByText(/authentication state could not be confirmed/i)).toBeInTheDocument();
      expectControlsEnabled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockTransitionFinishers).toHaveLength(1);
      expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    }
  );

  test("cancels a ready anonymous session revision while the Auth promise is pending", async () => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 1,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 2,
    };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
    expectControlsEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");

    await act(async () => {
      authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
      await authRequest.promise;
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
  });

  test("cancels a ready anonymous revision after the Auth response UID exists", async () => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 1,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    await act(async () => {
      authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
      await authRequest.promise;
    });
    expect(mockNavigate).not.toHaveBeenCalled();

    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 2,
    };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
    expectControlsEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");
  });

  test("treats the initial checking-to-anonymous snapshot as benign across promise reconciliation", async () => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    mockSessionState = {
      user: null,
      authStatus: "checking",
      authObserverRevision: 0,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 1,
    };
    view.rerender(<Login />);
    expect(mockTransitionFinishers[0]).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .toBeDisabled();

    await act(async () => {
      authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
      await authRequest.promise;
    });
    expect(screen.queryByText(/authentication session changed/i)).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers[0]).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();

    view.rerender(<Login />);
    expect(screen.queryByText(/authentication session changed/i)).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers[0]).not.toHaveBeenCalled();

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
      authObserverRevision: 2,
    };
    mockProfileState = freshProfile(false);
    view.rerender(<Login />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/character-creation"));
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("success");
  });

  test("cancels after benign checking-to-anonymous readiness advances to revision two", async () => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    mockSessionState = {
      user: null,
      authStatus: "checking",
      authObserverRevision: 0,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 1,
    };
    view.rerender(<Login />);
    expect(mockTransitionFinishers[0]).not.toHaveBeenCalled();

    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 2,
    };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
    expectControlsEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");

    await act(async () => {
      authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
      await authRequest.promise;
    });
    expectControlsEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
  });

  test("cancels when matching and anonymous observer callbacks collapse to the final anonymous revision", async () => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 1,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    // The matching callback and the subsequent sign-out are both published
    // before the next Login render, so only the final anonymous snapshot is visible.
    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
      authObserverRevision: 2,
    };
    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 3,
    };
    view.rerender(<Login />);

    await act(async () => {
      authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
      await authRequest.promise;
    });

    await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
    expectControlsEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");
  });

  test.each([
    ["same", "user-1", "user-1"],
    ["different", "other-user", "user-1"],
  ])("reconciles the authenticated observer UID published before the Auth promise (%s)", async (_label, observerUid, responseUid) => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    mockSessionState = {
      user: null,
      authStatus: "anonymous",
      authObserverRevision: 1,
    };
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: observerUid, email: "hero@example.com" },
      authStatus: "authenticated",
      authObserverRevision: 2,
    };
    mockProfileState = responseUid === "user-1" ? freshProfile(false, responseUid) : freshProfile(true, observerUid);
    view.rerender(<Login />);

    await act(async () => {
      authRequest.resolve({ user: { uid: responseUid, email: "hero@example.com" } });
      await authRequest.promise;
    });

    if (observerUid === responseUid) {
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/character-creation"));
      expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("success");
    } else {
      await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
      expectControlsEnabled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockTransitionFinishers).toHaveLength(1);
      expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
      expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");
    }
  });

  test("creates a missing profile once and waits for its live snapshot", async () => {
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = { userData: null, profileUid: null, profileStatus: "missing" };
    view.rerender(<Login />);
    await waitFor(() => expect(updateCharacterCreation).toHaveBeenCalledTimes(1));
    expect(updateCharacterCreation).toHaveBeenCalledWith({
      action: "initialize",
      retryKey: "login-profile-initialize:user-1",
    });

    view.rerender(<Login />);
    expect(updateCharacterCreation).toHaveBeenCalledTimes(1);

    mockProfileState = freshProfile(false);
    view.rerender(<Login />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/character-creation"));
  });

  test("ignores a fresh profile for a different authenticated UID", async () => {
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: "other-user", email: "other@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = {
      userData: { uid: "other-user", flags: { characterCreationDone: true } },
      profileUid: "other-user",
      profileStatus: "fresh",
    };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .not.toBeDisabled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");
  });

  test("releases controls when the auth observer fails after the auth promise resolves", async () => {
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = { user: null, authStatus: "error" };
    mockProfileState = { userData: null, profileUid: null, profileStatus: "idle" };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/authentication state could not be confirmed/i)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .not.toBeDisabled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("failure");
  });

  test.each([
    ["anonymous", { user: null, authStatus: "anonymous" }],
    ["different authenticated UID", { user: { uid: "other-user", email: "other@example.com" }, authStatus: "authenticated" }],
  ])("cancels a pending attempt when the observed session becomes %s", async (_label, nextSession) => {
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = matchingSession();
    mockProfileState = { userData: null, profileUid: null, profileStatus: "loading" };
    view.rerender(<Login />);
    expect(mockTransitionFinishers[0]).not.toHaveBeenCalled();

    mockSessionState = nextSession;
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/authentication session changed/i)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .not.toBeDisabled();
    expect(mockTransitionFinishers).toHaveLength(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledTimes(1);
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");
  });

  test("restores login after the authoritative profile subscription fails", async () => {
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = { userData: null, profileUid: null, profileStatus: "error" };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/character profile could not be loaded/i)).toBeInTheDocument());
    const submitButton = screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']");
    expect(submitButton).not.toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("creates directly without an account-existence preflight", async () => {
    render(<Login />);
    fillCredentials("new@example.com");
    clickCreate();

    await waitFor(() => expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1));
    expect(fetchSignInMethodsForEmail).not.toHaveBeenCalled();
    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      "new@example.com",
      "secret1"
    );
  });

  test("accepts only one same-tick create action and blocks a competing login request", async () => {
    const createRequest = deferred();
    createUserWithEmailAndPassword.mockReturnValue(createRequest.promise);
    render(<Login />);
    fillCredentials("new@example.com");

    clickCreate();
    clickCreate();
    fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));

    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .toBeDisabled();

    createRequest.resolve({ user: { uid: "created-user", email: "new@example.com" } });
    await act(async () => {
      await createRequest.promise;
    });
  });

  test("maps email-already-in-use to the friendly recovery message and re-enables both actions", async () => {
    createUserWithEmailAndPassword.mockRejectedValue(
      Object.assign(new Error("duplicate"), { code: "auth/email-already-in-use" })
    );
    render(<Login />);
    fillCredentials("existing@example.com");
    clickCreate();

    await waitFor(() => expect(screen.getByText(/already registered.*login instead/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .not.toBeDisabled();
  });

  test("recovers controls after a generic authentication failure", async () => {
    signInWithEmailAndPassword.mockRejectedValue(
      Object.assign(new Error("offline"), { code: "auth/network-request-failed" })
    );
    render(<Login />);
    fillCredentials();
    fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));

    await waitFor(() => expect(screen.getByText(/Login failed/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .not.toBeDisabled();
  });

  test("initializes a missing create profile only through the shared profile gate", async () => {
    const initializeRequest = deferred();
    updateCharacterCreation.mockReturnValue(initializeRequest.promise);
    const view = render(<Login />);
    fillCredentials("new@example.com");
    clickCreate();

    await waitFor(() => expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1));
    expect(updateCharacterCreation).not.toHaveBeenCalled();

    mockSessionState = matchingSession("created-user", "new@example.com");
    mockProfileState = { userData: null, profileUid: null, profileStatus: "missing" };
    view.rerender(<Login />);
    await waitFor(() => expect(updateCharacterCreation).toHaveBeenCalledTimes(1));

    initializeRequest.resolve(undefined);
    await act(async () => {
      await initializeRequest.promise;
    });
    view.rerender(<Login />);
    expect(updateCharacterCreation).toHaveBeenCalledTimes(1);
  });

  test("does not navigate before a matching fresh profile and carries create success state", async () => {
    const view = render(<Login />);
    fillCredentials("new@example.com");
    clickCreate();
    await waitFor(() => expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = matchingSession("created-user", "new@example.com");
    mockProfileState = { userData: null, profileUid: null, profileStatus: "missing" };
    view.rerender(<Login />);
    await waitFor(() => expect(updateCharacterCreation).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();

    mockProfileState = freshProfile(false, "created-user");
    view.rerender(<Login />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
      "/character-creation",
      {
        state: {
          email: "new@example.com",
          successMessage: expect.stringContaining("Account created successfully"),
        },
      }
    ));
  });

  test("converges when the matching auth and fresh profile arrive before create resolves", async () => {
    const createRequest = deferred();
    createUserWithEmailAndPassword.mockReturnValue(createRequest.promise);
    const view = render(<Login />);
    fillCredentials("new@example.com");
    clickCreate();
    await waitFor(() => expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = matchingSession("created-user", "new@example.com");
    mockProfileState = freshProfile(false, "created-user");
    view.rerender(<Login />);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(updateCharacterCreation).not.toHaveBeenCalled();

    await act(async () => {
      createRequest.resolve({ user: { uid: "created-user", email: "new@example.com" } });
      await createRequest.promise;
    });

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
      "/character-creation",
      {
        state: {
          email: "new@example.com",
          successMessage: expect.stringContaining("Account created successfully"),
        },
      }
    ));
    expect(updateCharacterCreation).not.toHaveBeenCalled();
  });

  test("recovers controls after shared missing-profile initialization fails", async () => {
    updateCharacterCreation.mockRejectedValue(new Error("profile unavailable"));
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = matchingSession();
    mockProfileState = { userData: null, profileUid: null, profileStatus: "missing" };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/profile could not be created/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeDisabled();
    expect(screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']"))
      .not.toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("allows only one request when Login wins a same-tick Create race", async () => {
    const loginRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(loginRequest.promise);
    const view = render(<Login />);
    fillCredentials();

    fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));
    clickCreate();

    expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();

    view.unmount();
    loginRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
    await act(async () => {
      await loginRequest.promise;
    });
  });

  test("does not route a fresh profile that belongs to the previous UID", async () => {
    signInWithEmailAndPassword
      .mockResolvedValueOnce({ user: { uid: "user-1", email: "hero@example.com" } })
      .mockResolvedValueOnce({ user: { uid: "user-2", email: "other@example.com" } });
    const view = render(<Login />);
    fillCredentials();
    fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = matchingSession("user-1");
    mockProfileState = { userData: null, profileUid: null, profileStatus: "error" };
    view.rerender(<Login />);
    await waitFor(() => expect(screen.getByText(/profile could not be loaded/i)).toBeInTheDocument());

    fillCredentials("other@example.com");
    fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(2));

    mockSessionState = matchingSession("user-2", "other@example.com");
    mockProfileState = freshProfile(true, "user-1");
    view.rerender(<Login />);
    expect(mockNavigate).not.toHaveBeenCalled();

    mockProfileState = freshProfile(true, "user-2");
    view.rerender(<Login />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/home"));
  });

  test("typing credentials does not rerender memoized decorative or animated button subtrees", () => {
    render(<Login />);
    expect(mockAuroraRenderCount).toBe(1);
    expect(mockCreateButtonRenderCount).toBe(1);
    expect(mockProfilerRenderCounts.LoginDecorativeBackground).toBe(1);
    expect(mockProfilerRenderCounts.LoginDecorativeOrbs).toBe(1);
    expect(mockProfilerRenderCounts.LoginCardBorder).toBe(1);
    expect(mockProfilerRenderCounts.LoginHeader).toBe(1);
    expect(mockProfilerRenderCounts.LoginSubmitButton).toBe(1);

    fillCredentials("typed@example.com", "secret2");

    expect(mockAuroraRenderCount).toBe(1);
    expect(mockCreateButtonRenderCount).toBe(1);
    expect(mockProfilerRenderCounts.LoginDecorativeBackground).toBe(1);
    expect(mockProfilerRenderCounts.LoginDecorativeOrbs).toBe(1);
    expect(mockProfilerRenderCounts.LoginCardBorder).toBe(1);
    expect(mockProfilerRenderCounts.LoginHeader).toBe(1);
    expect(mockProfilerRenderCounts.LoginSubmitButton).toBe(1);
  });

  test("preserves password visibility behavior while the form rerenders", () => {
    render(<Login />);
    const password = screen.getByPlaceholderText("Password");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  test("finishes a pending transition as cancelled and ignores auth completion after unmount", async () => {
    const authRequest = deferred();
    signInWithEmailAndPassword.mockReturnValue(authRequest.promise);
    const view = render(<Login />);
    fillCredentials();
    fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));
    await waitFor(() => expect(mockTransitionFinishers).toHaveLength(1));

    view.unmount();
    expect(mockTransitionFinishers[0]).toHaveBeenCalledWith("cancelled");

    await act(async () => {
      authRequest.resolve({ user: { uid: "user-1", email: "hero@example.com" } });
      await authRequest.promise;
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
