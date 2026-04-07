"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function SupportPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message })
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? "Submission failed. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMsg("Unable to connect. Please try again.");
      setStatus("error");
    }
  };

  return (
    <div className="publicPage">
      <header className="publicNav">
        <div className="publicNavInner">
          <Link href="/" className="publicNavBrand">
            <span className="publicNavWordmark">Akunta</span>
          </Link>
          <nav className="publicNavLinks">
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/support" aria-current="page">Support</Link>
          </nav>
          <Link href="/login" className="button publicNavCta">Sign in</Link>
        </div>
      </header>

      <div className="publicContent">
        <h1>Support</h1>
        <p className="publicLead">
          Have a question or issue? Fill in the form below and we&apos;ll get back to you.
          You can also check the <Link href="/help">Help centre</Link> for step-by-step guides.
        </p>

        {status === "success" ? (
          <div className="supportSuccess">
            <h2>Message received</h2>
            <p>Thanks for reaching out. We&apos;ll reply to <strong>{email}</strong> as soon as possible.</p>
            <Link href="/" className="button tertiary">Back to home</Link>
          </div>
        ) : (
          <form className="supportForm" onSubmit={onSubmit}>
            <label className="stack">
              Your name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>

            <label className="stack">
              Email address
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>

            <label className="stack">
              Subject
              <input
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>

            <label className="stack">
              Message
              <textarea
                required
                minLength={10}
                maxLength={5000}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>

            {status === "error" && errorMsg ? (
              <p className="error">{errorMsg}</p>
            ) : null}

            <button type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Sending..." : "Send message"}
            </button>
          </form>
        )}
      </div>

      <footer className="publicFooter">
        <div className="publicFooterInner">
          <nav className="publicFooterLinks">
            <Link href="/">Home</Link>
            <Link href="/help">Help</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/resources">Resources</Link>
          </nav>
          <p className="publicFooterLegal">&copy; {new Date().getFullYear()} Akunta</p>
        </div>
      </footer>
    </div>
  );
}
