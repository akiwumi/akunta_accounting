"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const emailParam = searchParams.get("email") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!token || !emailParam) {
    return (
      <section className="authScreen">
        <div className="authBackdropGlow" aria-hidden />
        <div className="loginStage routeFade">
          <div className="loginCard">
            <h2>Invalid link</h2>
            <p className="note">This password reset link is missing required information. Please request a new one.</p>
            <Link href="/forgot-password" className="button" style={{ display: "inline-block", marginTop: "1rem" }}>
              Request new link
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }

    setStatus("submitting");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, email: emailParam, password })
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErrorMsg(payload.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setStatus("done");
      setTimeout(() => {
        window.location.href = "/login?reset=success";
      }, 2000);
    } catch {
      setErrorMsg("Unable to connect. Please try again.");
      setStatus("error");
    }
  };

  return (
    <section className="authScreen">
      <div className="authBackdropGlow" aria-hidden />

      <div className="loginStage routeFade">
        <div className="loginBrand">
          <Image src="/akunta_logo.png" alt="Akunta logo" width={610} height={614} className="loginBrandLogo" priority />
          <h1 className="splashTitle">Akunta</h1>
          <p className="splashSubtitle">Bookkeeping Accounting</p>
        </div>

        <div className="loginCard">
          <h2>Set new password</h2>
          <p className="note">Enter your new password below.</p>

          {status === "done" ? (
            <p className="note">
              Password updated. Redirecting you to sign in…
            </p>
          ) : (
            <form onSubmit={onSubmit}>
              <label className="stack">
                New password
                <div className="passwordInputWrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="passwordInputWithToggle"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="passwordToggleBtn"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              <label className="stack">
                Confirm new password
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>

              {errorMsg && <p className="error">{errorMsg}</p>}

              <button type="submit" disabled={status === "submitting"}>
                {status === "submitting" ? "Updating…" : "Set new password"}
              </button>

              <p className="authAltLine">
                <Link href="/login" className="textLink">← Back to sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
