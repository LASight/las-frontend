/**
 * The authentication and history API contract.
 *
 * Mirrors `app/auth/models.py` and `app/routers/history.py` field for field,
 * the same way `digitization-models.ts` mirrors `digitization/models.py`. When
 * one changes the other has to, and keeping them in one-to-one correspondence
 * is what makes that obvious in review.
 *
 * Field names are snake_case because the API's are. Renaming them here would
 * mean a translation layer in every service, and one mistranslated field is a
 * bug that type-checks.
 */

/** A signed-in account, as `GET /api/auth/me` returns it. */
export type User = {
  user_id: string;
  email: string;
  full_name: string;
  organization: string | null;
  /** Mirrors the Cognito groups: `admin`, `data_manager` or `viewer`. */
  role: string;
  created_at: string;
  last_login_at: string | null;
};

/**
 * What a login, signup or refresh returns.
 *
 * `media_token` exists because raster tiles are loaded with `new Image()`,
 * which cannot send an `Authorization` header — so that one credential has to
 * travel in the query string. It is read-only and shorter-lived than the access
 * token for exactly that reason.
 */
export type TokenPair = {
  access_token: string;
  refresh_token: string;
  media_token: string;
  token_type: string;
  /** Seconds until `access_token` expires. */
  expires_in: number;
};

export type AuthResponse = {
  user: User;
  tokens: TokenPair;
};

export type Credentials = {
  email: string;
  password: string;
};

export type SignupRequest = Credentials & {
  full_name: string;
  organization: string | null;
};

/** Omitted fields are left alone — the endpoint is a PATCH. */
export type ProfileUpdate = {
  email?: string;
  full_name?: string;
  organization?: string;
};

export type PasswordChange = {
  current_password: string;
  new_password: string;
};

export type HistoryKind = "las" | "raster";

/**
 * One row of "my files".
 *
 * `analysis_id` is what makes a row actionable: for a LAS analysis it is the
 * row's own id; for a digitized raster it is set only once the scan has been
 * handed to the analysis workspace. Null means the scan was never analyzed, so
 * the row opens the wizard rather than results.
 */
export type HistoryItem = {
  kind: HistoryKind;
  item_id: string;
  label: string;
  state: string;
  file_count: number;
  analysis_id: string | null;
  quality: number | null;
  created_at: string;
};

export type HistoryPage = {
  items: HistoryItem[];
  total: number;
  limit: number;
  offset: number;
};

/** Password policy, copied from `app/auth/models.py` so the form can pre-check it. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Why a password is unacceptable, or null when it is fine.
 *
 * Duplicated from the backend on purpose, and the backend still validates: this
 * exists so the form can say what is wrong before a round trip, not so the
 * server can stop checking.
 */
export function passwordProblem(password: string): string | null {
  const missing: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    missing.push(`at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!/[a-z]/.test(password)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) missing.push("an uppercase letter");
  if (!/\d/.test(password)) missing.push("a digit");
  return missing.length ? `Password needs ${missing.join(", ")}.` : null;
}
