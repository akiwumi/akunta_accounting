"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const submittedFullName = String(formData.get("fullName") ?? "").trim();
    const submittedEmail = String(formData.get("email") ?? "").trim();
    const submittedPassword = String(formData.get("password") ?? "");
    const submittedBusinessName = String(formData.get("businessName") ?? "").trim();

    setFullName(submittedFullName);
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    setBusinessName(submittedBusinessName);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          fullName: submittedFullName,
          email: submittedEmail,
          password: submittedPassword,
          businessName: submittedBusinessName
        })
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Registration failed. Please try again.");
        setIsSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Unable to connect. Please try again.");
      setIsSubmitting(false);
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

        {done ? (
          <div className="loginCard">
            <h2>Check your email</h2>
            <p className="note">
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
              account and get started.
            </p>
            <p className="note" style={{ marginTop: "8px" }}>
              Didn&apos;t get it? Check your spam folder, or{" "}
              <Link href="/support" className="textLink">contact support</Link>.
            </p>
            <Link href="/login" className="button" style={{ marginTop: "8px" }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form className="loginCard" onSubmit={onSubmit}>
            <h2>Create account</h2>
            <p className="note">Set up your Akunta workspace in seconds.</p>

            <label className="stack">
              Full name
              <input
                name="fullName"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Anna Svensson"
              />
            </label>

            <label className="stack">
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="anna@example.se"
              />
            </label>

            <label className="stack">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ characters"
              />
            </label>

            <label className="stack">
              Business name
              <input
                name="businessName"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Your business name"
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating account…" : "Create account"}
            </button>

            <p className="authAltLine">
              Already have an account?{" "}
              <Link href="/login" className="textLink">Sign in</Link>
            </p>

            <Link href="/" className="authBackLink">← Back to home</Link>
          </form>
        )}
      </div>
    </section>
  );
}
