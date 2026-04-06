"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const SPLASH_TITLE = "Akunta";
const SUBTITLE = "Bookkeeping Accounting";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"splash" | "login">("splash");
  const [username, setUsername] = useState("owner@akunta.app");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const openLogin = () => {
    setStep("login");
    setError(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Login failed.");
        setIsSubmitting(false);
        return;
      }

      setIsLeaving(true);
      setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, 340);
    } catch {
      setError("Unable to connect. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <section className={`authScreen${isLeaving ? " authScreenLeaving" : ""}`}>
      <div className="authBackdropGlow" aria-hidden />

      {step === "splash" ? (
        <div className="splashStage">
          <button
            type="button"
            className="splashLogoButton"
            onClick={openLogin}
            aria-label="Open login form"
          >
            <Image
              src="/akunta_logo.png"
              alt="Akunta logo"
              width={610}
              height={614}
              className="splashLogo"
              priority
            />
          </button>
          <h1 className="splashTitle">{SPLASH_TITLE}</h1>
          <p className="splashSubtitle">{SUBTITLE}</p>
          <p className="splashHint">Click the logo to sign in</p>
        </div>
      ) : (
        <div className="loginStage routeFade">
          <div className="loginBrand">
            <Image
              src="/akunta_logo.png"
              alt="Akunta logo"
              width={610}
              height={614}
              className="loginBrandLogo"
              priority
            />
            <h1 className="splashTitle">{SPLASH_TITLE}</h1>
            <p className="splashSubtitle">{SUBTITLE}</p>
          </div>

          <form className="loginCard" onSubmit={onSubmit}>
            <h2>Login</h2>
            <p className="note">Sign in to open your accounting workspace.</p>

            <label className="stack">
              Email
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            <label className="stack">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {error ? <p className="error">{error}</p> : null}

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>

            <button
              type="button"
              className="button tertiary"
              disabled={isSubmitting}
              onClick={() => setStep("splash")}
            >
              Back to splash
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
