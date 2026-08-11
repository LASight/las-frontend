import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import appStyles from "../app.module.css";
import { useAuth } from "../auth-context";
import { useShellStatus } from "../app-shell-context";
import fieldStyles from "../components/form/field.module.css";
import { TextField } from "../components/form/text-field";
import { SectionPanel } from "../components/section-panel";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "../models/auth-models";

/**
 * Account settings: the profile, and the password.
 *
 * Two separate forms and two separate requests, because they are two different
 * operations with different consequences. Changing a name is reversible and
 * silent; changing a password revokes every session on the account, including
 * this one. Putting both behind one Save button would make the second happen by
 * accident.
 */
export function AccountWorkspace() {
  const { user, updateProfile, changePassword } = useAuth();

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [organization, setOrganization] = useState(user?.organization ?? "");
  const [email, setEmail] = useState(user?.email ?? "");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const profile = useMutation({
    mutationFn: () =>
      updateProfile({
        email,
        full_name: fullName,
        organization,
      }),
  });

  const password = useMutation({
    mutationFn: () =>
      changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    // No redirect on success: the auth context clears the session, and the
    // route guard takes the user to /login on the next render. Navigating here
    // as well would race it.
  });

  useShellStatus(
    profile.isPending || password.isPending ? "Saving…" : "Account settings.",
    profile.isPending || password.isPending
  );

  const newPasswordError = newPassword ? passwordProblem(newPassword) : null;
  const confirmError =
    confirm && confirm !== newPassword ? "The two passwords do not match." : null;

  const profileError = profile.error instanceof Error ? profile.error.message : null;
  const passwordError = password.error instanceof Error ? password.error.message : null;

  function submitProfile(event: FormEvent) {
    event.preventDefault();
    profile.mutate();
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    password.mutate();
  }

  return (
    <main className={appStyles.mainBody}>
      <SectionPanel title="Profile">
        <form onSubmit={submitProfile}>
          <div className={fieldStyles.fieldGrid}>
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
              onChange={(event) => setOrganization(event.target.value)}
            />
            <TextField label="Role" value={user?.role ?? ""} readOnly disabled />
          </div>

          {profileError && <p className={fieldStyles.error}>{profileError}</p>}
          {profile.isSuccess && !profile.isPending && (
            <p className={fieldStyles.success}>Profile saved.</p>
          )}

          <div className={fieldStyles.actions}>
            <div className={fieldStyles.spacer} />
            <button
              type="submit"
              className={fieldStyles.primaryBtn}
              disabled={profile.isPending || !email}
            >
              {profile.isPending ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </SectionPanel>

      <SectionPanel title="Password">
        <form onSubmit={submitPassword}>
          <div className={fieldStyles.fieldGrid}>
            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              required
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              autoComplete="new-password"
              required
              error={newPasswordError}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters, with upper and lower case and a digit.`}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirm}
              autoComplete="new-password"
              required
              error={confirmError}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>

          <p className={fieldStyles.notice}>
            Changing your password signs you out everywhere, including here. That
            is deliberate — it is how you end a session you no longer trust.
          </p>

          {passwordError && <p className={fieldStyles.error}>{passwordError}</p>}

          <div className={fieldStyles.actions}>
            <div className={fieldStyles.spacer} />
            <button
              type="submit"
              className={fieldStyles.primaryBtn}
              disabled={
                password.isPending ||
                !currentPassword ||
                !newPassword ||
                Boolean(newPasswordError) ||
                Boolean(confirmError) ||
                !confirm
              }
            >
              {password.isPending ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </SectionPanel>
    </main>
  );
}
