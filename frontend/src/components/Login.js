// file: ./frontend/src/components/Login.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebaseConfig";
import { useNavigate } from "react-router-dom";
import { useAuthSession, useProfileState } from "../AuthContext";
import "./LoginAnimations.css";
import LoginCreateButton from "./LoginCreateButton";
import LoginSubmitButton from "./LoginSubmitButton";
import {
  LoginCardBorder,
  LoginDecorativeBackground,
  LoginDecorativeOrbs,
  LoginHeader,
} from "./LoginVisuals";
import { FiMail, FiLock, FiEye, FiEyeOff } from "react-icons/fi";
import {
  beginTask08Transition,
  runTask08AuthRequest,
} from "../performance/task08";
import PerformanceProfiler from "../performance/PerformanceProfiler";

const ACCOUNT_CREATED_MESSAGE = "Account created successfully! Redirecting to character setup...";
const AUTH_SESSION_CHANGED_MESSAGE = "Your authentication session changed. Please try again.";
const AUTH_STATE_UNAVAILABLE_MESSAGE = "Authentication state could not be confirmed. Please try again.";

const updateCharacterCreation = async (input) => {
  const commands = await import('../data/userData/userDataCommands');
  return commands.updateCharacterCreation(input);
};

const authErrorMessage = (error, flow) => {
  if (error?.code === "auth/email-already-in-use") {
    return "This email is already registered. Please login instead.";
  }
  return flow === "login"
    ? "Login failed. Check credentials and try again."
    : "Account creation failed. Please try again.";
};

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [activeAction, setActiveAction] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingAuth, setPendingAuth] = useState(null);
  const navigate = useNavigate();
  const { user, authStatus, authObserverRevision } = useAuthSession();
  const { userData, profileUid, profileStatus } = useProfileState();
  const mountedRef = useRef(true);
  const attemptRef = useRef(null);
  const attemptSequenceRef = useRef(0);
  const credentialsRef = useRef({ email: "", password: "" });
  const authSnapshotRef = useRef({
    uid: user?.uid || null,
    status: authStatus,
    revision: authObserverRevision,
  });

  credentialsRef.current = { email, password };
  authSnapshotRef.current = {
    uid: user?.uid || null,
    status: authStatus,
    revision: authObserverRevision,
  };

  const beginAttempt = useCallback((flow) => {
    if (!mountedRef.current || attemptRef.current) return null;

    const credentials = credentialsRef.current;
    const startingAuthSnapshot = authSnapshotRef.current;
    const attempt = {
      id: ++attemptSequenceRef.current,
      flow,
      email: credentials.email,
      password: credentials.password,
      uid: null,
      profileInitializeStarted: false,
      authSessionObserved: false,
      benignInitialAnonymousRevision: null,
      authStatusAtStart: startingAuthSnapshot.status,
      authUidAtStart: startingAuthSnapshot.uid,
      authObserverRevisionAtStart: startingAuthSnapshot.revision,
      latestAuthStatus: startingAuthSnapshot.status,
      latestAuthUid: startingAuthSnapshot.uid,
      latestAuthObserverRevision: startingAuthSnapshot.revision,
      successMessage: null,
      finishTransition: null,
      finished: false,
    };
    attemptRef.current = attempt;
    setActiveAction(flow);
    return attempt;
  }, []);

  const finishAttempt = useCallback((attempt, outcome) => {
    if (!attempt || attempt.finished) return;
    attempt.finished = true;

    try {
      attempt.finishTransition?.(outcome);
    } finally {
      if (attemptRef.current !== attempt) return;
      attemptRef.current = null;
      if (!mountedRef.current) return;
      setActiveAction(null);
      setPendingAuth((current) => (current?.id === attempt.id ? null : current));
    }
  }, []);

  const reconcileAuthSnapshot = useCallback((attempt, snapshot, expectedUid = attempt?.uid) => {
    if (!attempt || attempt.finished) return "stale";

    attempt.latestAuthStatus = snapshot.status;
    attempt.latestAuthUid = snapshot.uid;
    attempt.latestAuthObserverRevision = snapshot.revision;

    if (snapshot.status === "error") {
      setError(AUTH_STATE_UNAVAILABLE_MESSAGE);
      setSuccessMessage("");
      finishAttempt(attempt, "failure");
      return "finished";
    }

    const comparableRevisions = Number.isFinite(attempt.authObserverRevisionAtStart)
      && Number.isFinite(snapshot.revision);
    const observerRevisionAdvanced = comparableRevisions
      && snapshot.revision > attempt.authObserverRevisionAtStart;
    const isInitialAnonymousAttempt = attempt.authStatusAtStart === "checking"
      && attempt.authUidAtStart === null
      && attempt.authObserverRevisionAtStart === 0;
    const isBenignInitialAnonymousSnapshot = isInitialAnonymousAttempt
      && snapshot.status === "anonymous"
      && snapshot.uid === null
      && snapshot.revision === 1
      && (
        attempt.benignInitialAnonymousRevision === null
        || attempt.benignInitialAnonymousRevision === snapshot.revision
      );

    if (snapshot.status === "anonymous" && snapshot.uid === null) {
      if (isBenignInitialAnonymousSnapshot) {
        attempt.benignInitialAnonymousRevision = snapshot.revision;
        return "waiting";
      }
      if (attempt.authSessionObserved || observerRevisionAdvanced) {
        setError(AUTH_SESSION_CHANGED_MESSAGE);
        setSuccessMessage("");
        finishAttempt(attempt, "cancelled");
        return "finished";
      }
      return "waiting";
    }

    if (!expectedUid) return "waiting";

    if (snapshot.status === "authenticated" && snapshot.uid === expectedUid) {
      attempt.authSessionObserved = true;
      return "matching";
    }

    if (snapshot.status === "authenticated" && snapshot.uid && snapshot.uid !== expectedUid) {
      const isPreObserverAuthenticatedSession = snapshot.uid === attempt.authUidAtStart
        && !observerRevisionAdvanced;
      if (!isPreObserverAuthenticatedSession) {
        setError(AUTH_SESSION_CHANGED_MESSAGE);
        setSuccessMessage("");
        finishAttempt(attempt, "cancelled");
        return "finished";
      }
    }

    return "waiting";
  }, [finishAttempt]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const attempt = attemptRef.current;
      if (!attempt || attempt.finished) return;
      attempt.finished = true;
      attempt.finishTransition?.("cancelled");
      attemptRef.current = null;
    };
  }, []);

  useEffect(() => {
    const attempt = attemptRef.current;
    if (
      !mountedRef.current
      || !attempt
      || attempt.finished
    ) {
      return;
    }

    const expectedUid = attempt.uid
      || (pendingAuth?.id === attempt.id ? pendingAuth.uid : null);
    const authSnapshotResult = reconcileAuthSnapshot(
      attempt,
      {
        status: authStatus,
        uid: user?.uid || null,
        revision: authObserverRevision,
      },
      expectedUid
    );
    if (authSnapshotResult !== "matching") return;

    if (profileStatus === "error") {
      setError(
        attempt.flow === "create"
          ? "Account created, but the character profile could not be loaded. Please try again."
          : "Login succeeded, but the character profile could not be loaded. Please try again."
      );
      setSuccessMessage("");
      finishAttempt(attempt, "failure");
      return;
    }

    if (profileStatus === "missing") {
      if (attempt.profileInitializeStarted) return;
      attempt.profileInitializeStarted = true;
      updateCharacterCreation({
        action: "initialize",
        retryKey: `login-profile-initialize:${expectedUid}`,
      }).catch((profileError) => {
        if (!mountedRef.current || attemptRef.current !== attempt || attempt.finished) return;
        console.error("Login profile creation error:", profileError);
        setError(
          attempt.flow === "create"
            ? "Account created, but the character profile could not be created. Please try again."
            : "Login succeeded, but the character profile could not be created. Please try again."
        );
        setSuccessMessage("");
        finishAttempt(attempt, "failure");
      });
      return;
    }

    if (
      profileStatus !== "fresh"
      || profileUid !== expectedUid
      || !userData
    ) {
      return;
    }

    const destination = attempt.flow === "create"
      ? "/character-creation"
      : userData.flags?.characterCreationDone
        ? "/home"
        : "/character-creation";
    const destinationOptions = attempt.flow === "create"
      ? {
        state: {
          email: attempt.email,
          successMessage: attempt.successMessage || ACCOUNT_CREATED_MESSAGE,
        },
      }
      : undefined;

    finishAttempt(attempt, "success");
    if (!mountedRef.current) return;
    if (destinationOptions) {
      navigate(destination, destinationOptions);
    } else {
      navigate(destination);
    }
  }, [
    activeAction,
    authStatus,
    authObserverRevision,
    finishAttempt,
    navigate,
    pendingAuth,
    profileStatus,
    profileUid,
    reconcileAuthSnapshot,
    user,
    userData,
  ]);

  const handleLogin = useCallback(async (event) => {
    event.preventDefault();
    const attempt = beginAttempt("login");
    if (!attempt) return;

    setError("");
    setSuccessMessage("");
    if (!attempt.email.includes("@") || attempt.password.length < 6) {
      setError("Invalid email or password too short (min 6 characters).");
      finishAttempt(attempt, "failure");
      return;
    }

    try {
      attempt.finishTransition = beginTask08Transition("login-auth-gate", {
        flow: "sign-in",
      });
      const userCredential = await runTask08AuthRequest(
        "sign-in",
        () => signInWithEmailAndPassword(auth, attempt.email, attempt.password)
      );
      const nextUid = userCredential?.user?.uid;
      if (!nextUid) throw new Error("The sign-in response did not include a user UID.");
      if (!mountedRef.current || attemptRef.current !== attempt || attempt.finished) return;

      const authSnapshotResult = reconcileAuthSnapshot(attempt, authSnapshotRef.current, nextUid);
      if (authSnapshotResult === "finished" || attempt.finished) return;

      attempt.uid = nextUid;
      setPendingAuth({
        id: attempt.id,
        uid: nextUid,
        flow: attempt.flow,
      });
    } catch (authError) {
      if (!mountedRef.current || attemptRef.current !== attempt || attempt.finished) return;
      console.error("Login error:", authError);
      setError(authErrorMessage(authError, attempt.flow));
      setSuccessMessage("");
      finishAttempt(attempt, "failure");
    }
  }, [beginAttempt, finishAttempt, reconcileAuthSnapshot]);

  const handleCreate = useCallback(async (event) => {
    event.preventDefault();
    const attempt = beginAttempt("create");
    if (!attempt) return;

    setError("");
    setSuccessMessage("");
    if (!attempt.email.includes("@") || attempt.password.length < 6) {
      setError("Invalid email or password too short (min 6 characters).");
      finishAttempt(attempt, "failure");
      return;
    }

    try {
      attempt.finishTransition = beginTask08Transition("login-auth-gate", {
        flow: "create-account",
      });
      const userCredential = await runTask08AuthRequest(
        "create-account",
        () => createUserWithEmailAndPassword(auth, attempt.email, attempt.password)
      );
      const createdUser = userCredential?.user;
      if (!createdUser?.uid) throw new Error("The account creation response did not include a user UID.");
      if (!mountedRef.current || attemptRef.current !== attempt || attempt.finished) return;

      const authSnapshotResult = reconcileAuthSnapshot(attempt, authSnapshotRef.current, createdUser.uid);
      if (authSnapshotResult === "finished" || attempt.finished) return;

      attempt.uid = createdUser.uid;
      attempt.successMessage = ACCOUNT_CREATED_MESSAGE;
      setSuccessMessage(ACCOUNT_CREATED_MESSAGE);
      setPendingAuth({
        id: attempt.id,
        uid: createdUser.uid,
        flow: attempt.flow,
      });
    } catch (authError) {
      if (!mountedRef.current || attemptRef.current !== attempt || attempt.finished) return;
      console.error("Account creation error:", authError);
      setError(authErrorMessage(authError, attempt.flow));
      setSuccessMessage("");
      finishAttempt(attempt, "failure");
    }
  }, [beginAttempt, finishAttempt, reconcileAuthSnapshot]);

  const isBusy = activeAction !== null;

  return (
    <PerformanceProfiler id="Login">
      <div className="relative w-screen h-screen">
        <LoginDecorativeBackground />
        <LoginDecorativeOrbs />

        <div className="relative z-10 flex justify-center items-center h-full p-4">
          <div className="group relative w-full max-w-md rounded-2xl bg-white/5 backdrop-blur-xl ring-1 ring-white/10 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.6)]">
            <LoginCardBorder />

            <div className="relative px-8 py-8">
              <LoginHeader />

              <form onSubmit={handleLogin} className="space-y-4">
                {/* Email */}
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
                    <FiMail size={18} />
                  </span>
                  <input
                    type="email"
                    placeholder="Email address"
                    className="w-full rounded-lg bg-white/5 py-3 pl-10 pr-3 text-white placeholder-white/50 outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-cyan-400/60"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>

                {/* Password */}
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
                    <FiLock size={18} />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    className="w-full rounded-lg bg-white/5 py-3 pl-10 pr-10 text-white placeholder-white/50 outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-fuchsia-400/60"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white/90 transition"
                  >
                    {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                  </button>
                </div>

                <LoginSubmitButton
                  disabled={isBusy}
                  isLoggingIn={activeAction === "login"}
                />
              </form>

              {/* Divider */}
              <div className="my-2 flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <span className="text-xs uppercase tracking-wider text-white/50">or</span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </div>

              <LoginCreateButton
                handleCreate={handleCreate}
                isCreatingAccount={activeAction === "create"}
                disabled={isBusy}
              />

              {successMessage && <p className="text-emerald-300 mt-2 font-medium text-center">{successMessage}</p>}
              {error && <p className="text-[#FF7A7A] mt-2 font-medium text-center">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    </PerformanceProfiler>
  );
}

export default Login;
