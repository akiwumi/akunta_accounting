"use client";

import { FormEvent, useState } from "react";

export function ChangePasswordForm({ locale }: { locale: string }) {
  const sv = locale === "sv";
  const copy = sv
    ? {
        title: "Ändra lösenord",
        current: "Nuvarande lösenord",
        newPw: "Nytt lösenord",
        confirm: "Bekräfta nytt lösenord",
        submit: "Uppdatera lösenord",
        submitting: "Uppdaterar…",
        success: "Lösenordet har uppdaterats.",
        mismatch: "Lösenorden matchar inte.",
        tooShort: "Lösenordet måste vara minst 8 tecken.",
        show: "Visa",
        hide: "Dölj"
      }
    : {
        title: "Change password",
        current: "Current password",
        newPw: "New password",
        confirm: "Confirm new password",
        submit: "Update password",
        submitting: "Updating…",
        success: "Password updated successfully.",
        mismatch: "Passwords do not match.",
        tooShort: "Password must be at least 8 characters.",
        show: "Show",
        hide: "Hide"
      };

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword !== confirmPassword) {
      setErrorMsg(copy.mismatch);
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg(copy.tooShort);
      return;
    }

    setStatus("submitting");

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErrorMsg(payload.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setStatus("success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setErrorMsg("Unable to connect. Please try again.");
      setStatus("error");
    }
  };

  return (
    <form onSubmit={onSubmit} className="settingsSection" id="security">
      <h3>{copy.title}</h3>

      <label className="stack">
        {copy.current}
        <div className="passwordInputWrapper">
          <input
            type={showPasswords ? "text" : "password"}
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="passwordInputWithToggle"
          />
          <button
            type="button"
            onClick={() => setShowPasswords((v) => !v)}
            className="passwordToggleBtn"
            tabIndex={-1}
            aria-label={showPasswords ? copy.hide : copy.show}
          >
            {showPasswords ? copy.hide : copy.show}
          </button>
        </div>
      </label>

      <label className="stack">
        {copy.newPw}
        <input
          type={showPasswords ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>

      <label className="stack">
        {copy.confirm}
        <input
          type={showPasswords ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </label>

      {status === "success" && <p className="success">{copy.success}</p>}
      {errorMsg && <p className="error">{errorMsg}</p>}

      <div className="row">
        <button type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? copy.submitting : copy.submit}
        </button>
      </div>
    </form>
  );
}
