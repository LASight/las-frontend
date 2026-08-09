import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth-context";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "../../models/auth-models";
import fieldStyles from "../form/field.module.css";
import { TextField } from "../form/text-field";
import { AuthLayout } from "./auth-layout";
import styles from "./auth-layout.module.css";

/**
 * Create an account.
 *
 * The password rules are checked here *and* on the server. This copy exists so
 * the form can say what is wrong while the user is still typing rather than
 * after a round trip; the server's copy is the one that decides.
 */
export function SignupPage() {
  const { signup, status } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Only nag once there is something to nag about — flagging an empty field the
  // user has not reached yet is noise.
  const passwordError = password ? passwordProblem(password) : null;
  const confirmError =
    confirm && confirm !== password ? "The two passwords do not match." : null;

  const submit = useMutation({
    mutationFn: () =>
      signup({
        email,
        password,
        full_name: fullName,
        organization: organization || null,
      }),
    onSuccess: () => navigate("/analysis", { replace: true }),
  });

  if (status === "authenticated") {
    return <Navigate to="/analysis" replace />;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit.mutate();
  }

  const errorMessage = submit.error instanceof Error ? submit.error.message : null;
  const canSubmit =
    Boolean(email && password && confirm) && !passwordError && !confirmError;

  return (
    <AuthLayout
      title="Create an account"
      subtitle="An account keeps your analyses and digitized scans, and keeps them yours."
      footer={
        <>
          Already have one?{" "}
          <Link className={styles.switchLink} to="/login">
            Sign in
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
          label="Full name"
          value={fullName}
          autoComplete="name"
          onChange={(event) => setFullName(event.target.value)}
        />
        <TextField
          label="Organization"
          value={organization}
          autoComplete="organization"
          hint="Optional."
          onChange={(event) => setOrganization(event.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          autoComplete="new-password"
          required
          error={passwordError}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters, with upper and lower case and a digit.`}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextField
          label="Confirm password"
          type="password"
          value={confirm}
          autoComplete="new-password"
          required
          error={confirmError}
          onChange={(event) => setConfirm(event.target.value)}
        />

        {errorMessage && <p className={fieldStyles.error}>{errorMessage}</p>}

        <button
          type="submit"
          className={styles.submit}
          disabled={submit.isPending || !canSubmit}
        >
          {submit.isPending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}
