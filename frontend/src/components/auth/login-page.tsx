import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth-context";
import { IS_MOCK_AUTH } from "../../services/auth-service";
import fieldStyles from "../form/field.module.css";
import { TextField } from "../form/text-field";
import { AuthLayout } from "./auth-layout";
import styles from "./auth-layout.module.css";

/**
 * Sign in.
 *
 * Redirects to wherever the guard came from, so a link into a specific
 * digitization job survives the detour through this page.
 */
export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Where RequireAuth was heading before it sent the user here.
  const from = (location.state as { from?: { pathname: string } } | null)?.from
    ?.pathname;

  const submit = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: () => navigate(from ?? "/analysis", { replace: true }),
  });

  // Someone already signed in has no business on this page — arriving here from
  // a bookmark should land them in the app, not on a form they do not need.
  if (status === "authenticated") {
    return <Navigate to={from ?? "/analysis"} replace />;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit.mutate();
  }

  const errorMessage = submit.error instanceof Error ? submit.error.message : null;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Your analyses and digitized scans are kept against your account."
      footer={
        <>
          No account yet?{" "}
          <Link className={styles.switchLink} to="/signup">
            Create one
          </Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <TextField
          label="Email"
          type="email"
          value={email}
          autoComplete="username"
          required
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          required
          onChange={(event) => setPassword(event.target.value)}
        />

        {IS_MOCK_AUTH && (
          <p className={fieldStyles.notice}>
            Mock auth is on (<code>VITE_AUTH_MOCK</code>). Any credentials are
            accepted and nothing is stored — this is the offline demo, not a
            session.
          </p>
        )}

        {errorMessage && <p className={fieldStyles.error}>{errorMessage}</p>}

        <button
          type="submit"
          className={styles.submit}
          disabled={submit.isPending || !email || !password}
        >
          {submit.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
