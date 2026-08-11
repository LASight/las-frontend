import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../auth-context";
import styles from "./auth-layout.module.css";

/**
 * Gate for everything behind the app shell.
 *
 * The same idea as {@link RequireJobPhase}: a guard rather than hidden buttons.
 * A deep link into a workspace nobody is signed in for should land somewhere
 * that can fix that, not render a page whose every request 401s.
 *
 * The `restoring` case is the one worth being careful about. On a reload the
 * refresh token is in storage but the access token is not, so for a moment the
 * app genuinely does not know who is signed in. Treating that as "signed out"
 * would bounce every single reload through `/login` and back, which looks
 * exactly like a broken session.
 *
 * `state.from` is what makes the round trip lossless: sign in from a link to
 * `/digitize/abc/review` and you arrive at `/digitize/abc/review`, not at the
 * default workspace.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "restoring") {
    // An empty frame in the app's own background colour, not a spinner: this
    // resolves in one request, and a spinner that flashes for 80 ms reads as a
    // glitch rather than as progress.
    return <div className={styles.restoring} />;
  }

  if (status === "anonymous") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
