"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const resetParam = searchParams.get("reset");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [successMsg] = useState<string | null>(
    resetParam === "success" ? "Password updated. Sign in with your new credentials." : null
  );
  const [error, setError] = useState<string | null>(
    errorParam === "invalid_token" ? "That verification link is invalid or has expired." :
    errorParam === "no_business"   ? "Account setup incomplete. Please contact support." : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const submittedEmail = String(formData.get("email") ?? "").trim();
    const submittedPassword = String(formData.get("password") ?? "");

    setEmail(submittedEmail);
    setPassword(submittedPassword);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: submittedEmail, password: submittedPassword })
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Login failed.");
        setIsSubmitting(false);
        return;
      }
      setIsLeaving(true);
      // Hard redirect so the root layout gets a fresh server render with the
      // session cookie present — client-side router.replace() does not re-run
      // shared Server Component layouts, which would leave the sidebar missing.
      setTimeout(() => { window.location.href = "/dashboard"; }, 340);
    } catch {
      setError("Unable to connect. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <section className={`authScreen${isLeaving ? " authScreenLeaving" : ""}`}>
      <div className="authBackdropGlow" aria-hidden />

      <div className="loginStage routeFade">
        <div className="loginBrand">
          <Image src="/akunta_logo.png" alt="Akunta logo" width={610} height={614} className="loginBrandLogo" priority />
          <h1 className="splashTitle">Akunta</h1>
          <p className="splashSubtitle">Bookkeeping Accounting</p>
        </div>

        <form className="loginCard" onSubmit={onSubmit}>
          <h2>Sign in</h2>
          <p className="note">Open your accounting workspace.</p>

          <label className="stack">
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="stack">
            Password
            <div className="passwordInputWrapper">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
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

          {successMsg && <p className="success">{successMsg}</p>}
          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>

          <p className="authAltLine">
            <Link href="/forgot-password" className="textLink">Forgot password?</Link>
          </p>

          <p className="authAltLine">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="textLink">Create one</Link>
          </p>

          <Link href="/" className="authBackLink">← Back to home</Link>
        </form>
      </div>
    </section>
  );
}
