import type {
  AuthResponse,
  Credentials,
  PasswordChange,
  ProfileUpdate,
  SignupRequest,
  User,
} from "../models/auth-models";
import { apiRequest, apiRequestVoid, patchJson, postJson } from "./http-client";
import { clearSession, getRefreshToken, setSession } from "./token-store";

/**
 * Everything the app needs from an authentication backend.
 *
 * An interface rather than a module of functions, for the same reason
 * {@link DigitizationGateway} is one: the UI depends on the capability, not on
 * `fetch`. Two things follow from it here.
 *
 * - `VITE_AUTH_MOCK=true` keeps the existing offline demo working. The
 *   digitization wizard can already run with no backend at all
 *   (`VITE_DIGITIZATION_MOCK`), and a login wall in front of it would have
 *   quietly taken that away.
 * - The backend's own `IdentityProvider` seam has a counterpart on this side,
 *   so a move to Cognito's hosted flow replaces one class rather than every
 *   component that knows how to sign in.
 */
export interface AuthGateway {
  signup(request: SignupRequest): Promise<User>;
  login(credentials: Credentials): Promise<User>;
  logout(): Promise<void>;

  /**
   * Re-establish a session from the stored refresh token, or return null.
   *
   * Called once on startup. Returning null rather than throwing because "not
   * signed in" is the ordinary state of a first visit, not a failure.
   */
  restore(): Promise<User | null>;

  me(): Promise<User>;
  updateProfile(update: ProfileUpdate): Promise<User>;
  changePassword(change: PasswordChange): Promise<void>;
}

const BASE = "/api/auth";

/** Talks to the FastAPI auth router. */
export class HttpAuthGateway implements AuthGateway {
  async signup(request: SignupRequest): Promise<User> {
    return this.#establish(await postJson<AuthResponse>(`${BASE}/signup`, request));
  }

  async login(credentials: Credentials): Promise<User> {
    return this.#establish(await postJson<AuthResponse>(`${BASE}/login`, credentials));
  }

  async logout(): Promise<void> {
    const refreshToken = getRefreshToken();
    // Clear locally first and unconditionally. If the network call fails, the
    // user still expects to be signed out of this browser — leaving them
    // signed in because the server was unreachable is the wrong failure.
    clearSession();
    if (!refreshToken) return;
    try {
      await apiRequestVoid(`${BASE}/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      // The token expires on its own; a failed revoke is not worth an error
      // dialog on the way out.
    }
  }

  async restore(): Promise<User | null> {
    if (!getRefreshToken()) return null;
    try {
      // No explicit refresh call: the access token is gone after a reload, so
      // this 401s and `http-client` refreshes and retries it. One code path
      // for "expired mid-session" and "reloaded the page" is one code path to
      // get right.
      return await this.me();
    } catch {
      clearSession();
      return null;
    }
  }

  me(): Promise<User> {
    return apiRequest<User>(`${BASE}/me`);
  }

  updateProfile(update: ProfileUpdate): Promise<User> {
    return patchJson<User>(`${BASE}/me`, update);
  }

  async changePassword(change: PasswordChange): Promise<void> {
    await apiRequestVoid(`${BASE}/me/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    // The backend revokes every session on a password change, including this
    // one. Clearing here means the UI reflects that immediately instead of
    // discovering it on the next request.
    clearSession();
  }

  #establish(response: AuthResponse): User {
    setSession(response.tokens);
    return response.user;
  }
}

/**
 * A stand-in that accepts anything, for running with no backend.
 *
 * Only reachable via `VITE_AUTH_MOCK=true`, and the UI says so — the same
 * contract {@link MockDigitizationGateway} works under.
 */
export class MockAuthGateway implements AuthGateway {
  #user: User = {
    user_id: "00000000-0000-0000-0000-000000000001",
    email: "demo@wellsight.local",
    full_name: "Demo User",
    organization: "WellSight",
    role: "data_manager",
    created_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  };

  async signup(request: SignupRequest): Promise<User> {
    this.#user = { ...this.#user, email: request.email, full_name: request.full_name };
    return this.#user;
  }

  async login(credentials: Credentials): Promise<User> {
    this.#user = { ...this.#user, email: credentials.email };
    return this.#user;
  }

  async logout(): Promise<void> {
    /* nothing to revoke */
  }

  async restore(): Promise<User | null> {
    return this.#user;
  }

  async me(): Promise<User> {
    return this.#user;
  }

  async updateProfile(update: ProfileUpdate): Promise<User> {
    this.#user = {
      ...this.#user,
      email: update.email ?? this.#user.email,
      full_name: update.full_name ?? this.#user.full_name,
      organization: update.organization ?? this.#user.organization,
    };
    return this.#user;
  }

  async changePassword(): Promise<void> {
    /* accepted */
  }
}

/** True when the app is running against the mock, so the UI can say so. */
export const IS_MOCK_AUTH = import.meta.env.VITE_AUTH_MOCK === "true";

export const authGateway: AuthGateway = IS_MOCK_AUTH
  ? new MockAuthGateway()
  : new HttpAuthGateway();
