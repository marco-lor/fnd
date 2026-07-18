import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Login from "./Login";
import { signInWithEmailAndPassword } from "firebase/auth";
import { getDoc, setDoc } from "../performance/firestore";

const mockNavigate = jest.fn();
let mockSessionState;
let mockProfileState;

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock("../AuthContext", () => ({
  useAuthSession: () => mockSessionState,
  useProfileState: () => mockProfileState,
}));

jest.mock("./firebaseConfig", () => ({ auth: {}, db: {} }));

jest.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  fetchSignInMethodsForEmail: jest.fn(),
}));

jest.mock("../performance/firestore", () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join("/") })),
  getDoc: jest.fn(),
  setDoc: jest.fn(() => Promise.resolve()),
}));

jest.mock("./backgrounds/AuroraBackground", () => () => <div data-testid="aurora" />);
jest.mock("./LoginCreateButton", () => () => <button type="button">Create account</button>);

const submitLogin = () => {
  fireEvent.change(screen.getByPlaceholderText("Email address"), {
    target: { value: "hero@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "secret1" },
  });
  fireEvent.submit(screen.getByPlaceholderText("Email address").closest("form"));
};

describe("Login shared profile flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDoc.mockResolvedValue(undefined);
    mockSessionState = { user: null, authStatus: "anonymous" };
    mockProfileState = { userData: null, profileStatus: "idle" };
    signInWithEmailAndPassword.mockResolvedValue({
      user: { uid: "user-1", email: "hero@example.com" },
    });
  });

  test.each([
    [true, "/home"],
    [false, "/character-creation"],
  ])("waits for the shared fresh profile before navigating", async (done, destination) => {
    const view = render(<Login />);
    submitLogin();

    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = {
      userData: { flags: { characterCreationDone: done } },
      profileStatus: "fresh",
    };
    view.rerender(<Login />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(destination));
    expect(getDoc).not.toHaveBeenCalled();
  });

  test("creates a missing profile once and waits for its live snapshot", async () => {
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = { userData: null, profileStatus: "missing" };
    view.rerender(<Login />);
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
    expect(setDoc.mock.calls[0][1]).toEqual(expect.objectContaining({
      email: "hero@example.com",
      role: "player",
      flags: { characterCreationDone: false },
    }));

    view.rerender(<Login />);
    expect(setDoc).toHaveBeenCalledTimes(1);

    mockProfileState = {
      userData: { flags: { characterCreationDone: false } },
      profileStatus: "fresh",
    };
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
      userData: { flags: { characterCreationDone: true } },
      profileStatus: "fresh",
    };
    view.rerender(<Login />);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });

  test("restores login after the authoritative profile subscription fails", async () => {
    const view = render(<Login />);
    submitLogin();
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));

    mockSessionState = {
      user: { uid: "user-1", email: "hero@example.com" },
      authStatus: "authenticated",
    };
    mockProfileState = { userData: null, profileStatus: "error" };
    view.rerender(<Login />);

    await waitFor(() => expect(screen.getByText(/character profile could not be loaded/i)).toBeInTheDocument());
    const submitButton = screen.getByPlaceholderText("Email address").closest("form").querySelector("button[type='submit']");
    expect(submitButton).not.toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });
});
