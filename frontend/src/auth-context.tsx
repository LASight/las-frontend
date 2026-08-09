import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type {
  Credentials,
  PasswordChange,
  ProfileUpdate,
  SignupRequest,
  User,
} from "./models/auth-models";
import { authGateway } from "./services/auth-service";
import { getAccessToken, onSessionChange } from "./services/token-store";

/**
 * Who is signed in, for everything below the router.
 *
 * A React Context, matching {@link AppShellProvider} and
 * {@link DigitizationJobProvider} rather than reaching for the `zustand`
 * dependency that is in `package.json` but unused anywhere in `src/`. The
 * session is one small object read by a handful of components; introducing a
 * second state library for it would make the codebase harder to read, not
 * easier.
 *
 * The tokens themselves are **not** here — they live in `services/token-store`,
 * because `http-client` needs them on every request and is not a component.
 * This context holds the profile and the status, which is what renders.
 */

/**
 * `restoring` is a real state, not a detail.
 *
 * On a reload the refresh token is in storage and the access token is not, so
 * there is a moment where the app genuinely does not know yet. Without a
 * distinct state for it the guard would read `user === null`, decide the user
 * is signed out, and bounce every reload through the login page before
 * snapping back.
 */
type AuthStatus = "restoring" | "authenticated" | "anonymous";

type AuthValue = {
  user: User | null;
  status: AuthStatus;
  signup: (request: SignupRequest) => Promise<void>;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (update: ProfileUpdate) => Promise<void>;
  changePassword: (change: PasswordChange) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("restoring");

  useEffect(() => {
    let cancelled = false;

    authGateway
      .restore()
      .then((restored) => {
        if (cancelled) return;
        setUser(restored);
        setStatus(restored ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus("anonymous");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A refresh can fail long after startup — an expired refresh token, or a
  // session revoked from another tab by a password change. `http-client` clears
  // the store when that happens, and without this the UI would keep rendering a
  // signed-in shell whose every request 401s.
  useEffect(
    () =>
      onSessionChange(() => {
        // Only react to the session being *cleared*. This also fires on every
        // successful refresh, which must not sign anyone out.
        if (getAccessToken() !== null) return;
        setUser(null);
        setStatus("anonymous");
      }),
    []
  );

  const signup = useCallback(async (request: SignupRequest) => {
    setUser(await authGateway.signup(request));
    setStatus("authenticated");
  }, []);

  const login = useCallback(async (credentials: Credentials) => {
    setUser(await authGateway.login(credentials));
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await authGateway.logout();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const updateProfile = useCallback(async (update: ProfileUpdate) => {
    setUser(await authGateway.updateProfile(update));
  }, []);

  const changePassword = useCallback(async (change: PasswordChange) => {
    await authGateway.changePassword(change);
    // The backend revokes every session, so the user is signed out by design.
    setUser(null);
    setStatus("anonymous");
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, status, signup, login, logout, updateProfile, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Access the session.
 *
 * Throws outside the provider rather than returning a signed-out default: a
 * component that silently believes nobody is signed in would render a login
 * prompt in the middle of the app, which looks like a session bug and is not.
 */
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be called inside <AuthProvider>");
  }
  return value;
}
