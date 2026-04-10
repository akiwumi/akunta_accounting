"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);

    const submittedEmail = email.trim().toLowerCase();

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: submittedEmail })
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErrorMsg(payload.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setStatus("sent");
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
          <h2>Reset password</h2>
          <p className="note">Enter your email address and we&apos;ll send you a reset link.</p>

          {status === "sent" ? (
            <div>
              <p className="note">
                If an account exists for <strong>{email}</strong>, you&apos;ll receive a password reset link shortly.
                Check your inbox (and spam folder).
              </p>
              <Link href="/login" className="button" style={{ display: "inline-block", marginTop: "1rem" }}>
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <label className="stack">
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>

              {errorMsg && <p className="error">{errorMsg}</p>}

              <button type="submit" disabled={status === "submitting"}>
                {status === "submitting" ? "Sending…" : "Send reset link"}
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
