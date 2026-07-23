import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AuthProvider,
  getShellCacheKey,
  projectShellProfile,
  readShellCache,
  SHELL_CACHE_MAX_BYTES,
  useAuthSession,
  useProfileState,
  useShellProfile,
  validateShellCache,
  writeShellCache,
} from "./AuthContext";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { subscribeAuthProfileAggregate } from "./data/userData/userDataRepository";

let mockAuthNext;
let mockAuthError;
let mockProfileNext;
let mockProfileError;
let mockAuthUnsubscribe;
let mockProfileSubscriptions;
const mockSetRepositoryActor = jest.fn();

jest.mock("./components/firebaseConfig", () => ({ auth: {} }));

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
}));

jest.mock("./data/userData/userDataRepository", () => ({
  subscribeAuthProfileAggregate: jest.fn(),
}));

jest.mock("./data/repositoryRuntime", () => ({
  setRepositoryActor: (...args) => mockSetRepositoryActor(...args),
}));

const user = { uid: "user-1", email: "hero@example.com" };

const StateProbe = () => {
  const session = useAuthSession();
  const profile = useProfileState();
  const shell = useShellProfile();
  return (
    <div>
      <span data-testid="auth-status">{session.authStatus}</span>
      <span data-testid="profile-status">{profile.profileStatus}</span>
      <span data-testid="profile-role">{profile.userData?.role || "none"}</span>
      <span data-testid="shell-role">{shell.shellProfile?.role || "none"}</span>
      <span data-testid="shell-source">{shell.shellSource}</span>
      <button type="button" onClick={profile.retryProfile}>Retry profile</button>
      <button type="button" onClick={session.logout}>Logout</button>
    </div>
  );
};

describe("AuthProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    mockAuthNext = undefined;
    mockAuthError = undefined;
    mockProfileNext = undefined;
    mockProfileError = undefined;
    mockAuthUnsubscribe = jest.fn();
    mockProfileSubscriptions = [];
    onAuthStateChanged.mockImplementation((_auth, next, error) => {
      mockAuthNext = next;
      mockAuthError = error;
      return mockAuthUnsubscribe;
    });
    subscribeAuthProfileAggregate.mockImplementation((uid, observer) => {
      mockProfileNext = observer.next;
      mockProfileError = observer.error;
      const subscription = { uid, next: observer.next, error: observer.error, unsubscribe: jest.fn() };
      mockProfileSubscriptions.push(subscription);
      return subscription.unsubscribe;
    });
  });

  test("uses one auth observer and one profile subscription, then refreshes a matching cache", async () => {
    const cached = projectShellProfile(user.uid, {
      role: "player",
      characterId: "Cached Hero",
      stats: { level: 3 },
    });
    expect(writeShellCache(cached)).toBe(true);

    render(<AuthProvider><StateProbe /></AuthProvider>);
    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);

    act(() => mockAuthNext(user));
    expect(subscribeAuthProfileAggregate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("profile-status")).toHaveTextContent("cached");
    expect(screen.getByTestId("shell-source")).toHaveTextContent("cached");

    act(() => mockProfileNext({
      role: "players",
      characterId: "Fresh Hero",
      race: "Elf",
      imageUrl: "https://example.com/avatar.png",
      stats: { level: 4, hpCurrent: 10 },
    }));

    await waitFor(() => expect(screen.getByTestId("profile-status")).toHaveTextContent("fresh"));
    expect(screen.getByTestId("profile-role")).toHaveTextContent("player");
    expect(screen.getByTestId("shell-source")).toHaveTextContent("fresh");
    expect(JSON.parse(window.localStorage.getItem(getShellCacheKey(user.uid)))).toEqual(expect.objectContaining({
      role: "player",
      characterId: "Fresh Hero",
      level: 4,
    }));
    expect(window.localStorage.getItem("userData")).toBeNull();
    expect(mockAuthError).toEqual(expect.any(Function));
    expect(mockProfileError).toEqual(expect.any(Function));
  });

  test("does not rerender a shell-only consumer for an unrelated stat update", () => {
    let shellRenderCount = 0;
    const ShellOnly = () => {
      shellRenderCount += 1;
      const { shellProfile } = useShellProfile();
      return <span>{shellProfile?.role || "none"}</span>;
    };

    render(<AuthProvider><ShellOnly /></AuthProvider>);
    act(() => mockAuthNext(user));
    act(() => mockProfileNext({ role: "dm", stats: { level: 8, hpCurrent: 10 } }));
    expect(mockSetRepositoryActor).toHaveBeenCalledTimes(2);
    const beforeStatUpdate = shellRenderCount;

    act(() => mockProfileNext({ role: "dm", stats: { level: 8, hpCurrent: 9 } }));
    expect(shellRenderCount).toBe(beforeStatUpdate);
    expect(mockSetRepositoryActor).toHaveBeenCalledTimes(2);

    act(() => mockProfileNext({ role: "webmaster", stats: { level: 8, hpCurrent: 9 } }));
    expect(shellRenderCount).toBeGreaterThan(beforeStatUpdate);
    expect(mockSetRepositoryActor).toHaveBeenCalledTimes(3);
    expect(mockSetRepositoryActor).toHaveBeenLastCalledWith(user.uid);
  });

  test("clears cached authorization when the live profile is missing", () => {
    writeShellCache(projectShellProfile(user.uid, { role: "dm" }));
    render(<AuthProvider><StateProbe /></AuthProvider>);
    act(() => mockAuthNext(user));
    act(() => mockProfileNext(null));

    expect(screen.getByTestId("profile-status")).toHaveTextContent("missing");
    expect(screen.getByTestId("shell-role")).toHaveTextContent("none");
    expect(readShellCache(user.uid)).toBeNull();
    expect(mockSetRepositoryActor).toHaveBeenLastCalledWith(user.uid);
  });

  test("keeps the cached shell on a profile error and replaces the listener on retry", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    writeShellCache(projectShellProfile(user.uid, { role: "dm", characterId: "Cached" }));
    render(<AuthProvider><StateProbe /></AuthProvider>);
    act(() => mockAuthNext(user));

    act(() => mockProfileError(new Error("temporary failure")));
    expect(screen.getByTestId("profile-status")).toHaveTextContent("error");
    expect(screen.getByTestId("shell-role")).toHaveTextContent("dm");
    expect(screen.getByTestId("shell-source")).toHaveTextContent("cached");

    fireEvent.click(screen.getByRole("button", { name: "Retry profile" }));
    expect(subscribeAuthProfileAggregate).toHaveBeenCalledTimes(2);
    expect(mockProfileSubscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);

    act(() => mockProfileSubscriptions[1].next({
      role: "player", characterId: "Fresh", stats: { level: 2 },
    }));
    expect(screen.getByTestId("profile-status")).toHaveTextContent("fresh");
    expect(screen.getByTestId("shell-role")).toHaveTextContent("player");
    consoleError.mockRestore();
  });

  test("removes the active cache through the shared logout action", async () => {
    writeShellCache(projectShellProfile(user.uid, { role: "player" }));
    render(<AuthProvider><StateProbe /></AuthProvider>);
    act(() => mockAuthNext(user));

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readShellCache(user.uid)).toBeNull());
  });

  test("tears down the old listener and never paints another account's cache", () => {
    const secondUser = { uid: "user-2", email: "other@example.com" };
    writeShellCache(projectShellProfile(user.uid, { role: "dm" }));
    writeShellCache(projectShellProfile(secondUser.uid, { role: "player" }));
    render(<AuthProvider><StateProbe /></AuthProvider>);

    act(() => mockAuthNext(user));
    expect(screen.getByTestId("shell-role")).toHaveTextContent("dm");
    act(() => mockAuthNext(secondUser));

    expect(mockProfileSubscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSetRepositoryActor).toHaveBeenNthCalledWith(1, "user-1");
    expect(mockSetRepositoryActor).toHaveBeenNthCalledWith(2, "user-2");
    expect(subscribeAuthProfileAggregate).toHaveBeenCalledTimes(2);
    expect(subscribeAuthProfileAggregate).toHaveBeenLastCalledWith("user-2", expect.any(Object));
    expect(screen.getByTestId("shell-role")).toHaveTextContent("player");
  });

  test("tears down both active observers on unmount", () => {
    const view = render(<AuthProvider><StateProbe /></AuthProvider>);
    act(() => mockAuthNext(user));
    view.unmount();

    expect(mockAuthUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockProfileSubscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSetRepositoryActor).toHaveBeenLastCalledWith(null);
  });
});

describe("shell cache validation", () => {
  test("prefers the compact-shell summary level while retaining legacy fallback", () => {
    expect(projectShellProfile("uid-1", {
      summary: { level: 7 },
      stats: { level: 3 },
    }).level).toBe(7);
    expect(projectShellProfile("uid-1", { stats: { level: 3 } }).level).toBe(3);
  });

  test("contains only the approved projection and remains below five KiB", () => {
    const projected = projectShellProfile("uid-1", {
      role: "players",
      characterId: "Aster",
      race: "Human",
      imageUrl: "https://example.com/avatar.png",
      imagePath: "must-not-be-cached",
      inventory: [{ secret: true }],
      flags: { characterCreationDone: true },
      stats: { level: 9, hpCurrent: 100 },
    });

    expect(Object.keys(projected).sort()).toEqual([
      "avatarUrl",
      "characterId",
      "level",
      "race",
      "role",
      "uid",
      "updatedAt",
      "version",
    ].sort());
    expect(new Blob([JSON.stringify(projected)]).size).toBeLessThan(SHELL_CACHE_MAX_BYTES);
    expect(validateShellCache({ ...projected, inventory: [] }, "uid-1")).toBeNull();
    expect(validateShellCache(projected, "different-uid")).toBeNull();
  });

  test("rejects malformed and oversized serialized entries", () => {
    const cacheKey = getShellCacheKey("uid-1");
    window.localStorage.setItem(cacheKey, "{not-json");
    expect(readShellCache("uid-1")).toBeNull();
    expect(window.localStorage.getItem(cacheKey)).toBeNull();

    const oversized = projectShellProfile("uid-1", {
      role: "player",
      imageUrl: `https://example.com/${"x".repeat(SHELL_CACHE_MAX_BYTES)}`,
    });
    window.localStorage.setItem(cacheKey, JSON.stringify(oversized));
    expect(readShellCache("uid-1")).toBeNull();
    expect(writeShellCache(oversized)).toBe(false);
  });
});
