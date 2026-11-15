"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type InvitePanelProps = {
  locale: Locale;
  token: string;
  invitation: {
    email: string;
    role: "accountant" | "viewer";
    businessName: string;
    inviterName: string | null;
    hasAccount: boolean;
    expiresAt: string;
  };
  /** Email of the signed-in account, or null when nobody is signed in. */
  signedInEmail: string | null;
};

export const InvitePanel = ({ locale, token, invitation, signedInEmail }: InvitePanelProps) => {
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { businessName, email } = invitation;
  const inviter = invitation.inviterName ?? businessName;

  const copy =
    locale === "sv"
      ? {
          heading: `Bokföringen för ${businessName}`,
          lead: `${inviter} bjuder in dig till bokföringen för ${businessName}.`,
          rights:
            invitation.role === "accountant"
              ? "Du får fullständig bokföringsbehörighet: du kan se och bokföra allt. Du kan inte hantera medlemmar, abonnemang eller företagets uppgifter."
              : "Du får läsbehörighet: du kan se allt och ladda ner underlag. Du kan inte ändra något.",
          sentTo: "Inbjudan gäller för",
          accept: `Tacka ja och öppna ${businessName}`,
          working: "Öppnar...",
          wrongAccount: (current: string) =>
            `Du är inloggad som ${current}. Inbjudan gäller för ${email} och kan bara användas av det kontot.`,
          switchAccount: `Logga ut och fortsätt som ${email}`,
          existing: "Det finns redan ett Akunta-konto för den här adressen. Logga in för att tacka ja.",
          password: "Lösenord",
          signInAccept: "Logga in och tacka ja",
          forgot: "Glömt lösenordet?",
          create: "Skapa ditt konto för att tacka ja. Du får inget eget företag i Akunta, bara åtkomst till det här.",
          name: "Ditt namn",
          newPassword: "Välj lösenord",
          passwordHint: "Minst 8 tecken",
          createAccept: "Skapa konto och tacka ja",
          failed: "Det gick inte. Försök igen.",
          offline: "Ingen kontakt med servern. Försök igen."
        }
      : {
          heading: `The books of ${businessName}`,
          lead: `${inviter} invites you to the books of ${businessName}.`,
          rights:
            invitation.role === "accountant"
              ? "You get full bookkeeping access: you can view and book everything. You cannot manage members, the subscription or the business details."
              : "You get read-only access: you can view everything and download exports. You cannot change anything.",
          sentTo: "The invitation is for",
          accept: `Accept and open ${businessName}`,
          working: "Opening...",
          wrongAccount: (current: string) =>
            `You are signed in as ${current}. The invitation is for ${email} and can only be used by that account.`,
          switchAccount: `Sign out and continue as ${email}`,
          existing: "There is already an Akunta account for this address. Sign in to accept.",
          password: "Password",
          signInAccept: "Sign in and accept",
          forgot: "Forgot password?",
          create: "Create your account to accept. You do not get a business of your own in Akunta, only access to this one.",
          name: "Your name",
          newPassword: "Choose a password",
          passwordHint: "At least 8 characters",
          createAccept: "Create account and accept",
          failed: "That did not work. Please try again.",
          offline: "Could not reach the server. Please try again."
        };

  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(json.error ?? copy.failed);
  };

  /** Runs the steps in order; on success the books open with a full page load. */
  const run = async (steps: Array<() => Promise<void>>) => {
    setBusy(true);
    setError(null);
    try {
      for (const step of steps) await step();
      window.location.assign("/dashboard");
    } catch (runError) {
      setError(runError instanceof TypeError ? copy.offline : runError instanceof Error ? runError.message : copy.failed);
      setBusy(false);
    }
  };

  const accept = () => post("/api/invitations/accept", { token });

  const onSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run([() => post("/api/auth/login", { email, password }), accept]);
  };

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run([() => post("/api/invitations/accept", { token, fullName: fullName.trim(), password })]);
  };

  const onSwitchAccount = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  const summary = (
    <>
      <h2>{copy.heading}</h2>
      <p>{copy.lead}</p>
      <p className="note">{copy.rights}</p>
      <p className="note">
        {copy.sentTo} <strong>{email}</strong>
      </p>
    </>
  );

  const errorLine = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  if (signedInEmail && signedInEmail.toLowerCase() === email.toLowerCase()) {
    return (
      <div className="loginCard">
        {summary}
        {errorLine}
        <button type="button" disabled={busy} onClick={() => void run([accept])}>
          {busy ? copy.working : copy.accept}
        </button>
      </div>
    );
  }

  if (signedInEmail) {
    return (
      <div className="loginCard">
        {summary}
        <p>{copy.wrongAccount(signedInEmail)}</p>
        <button type="button" disabled={busy} onClick={() => void onSwitchAccount()}>
          {copy.switchAccount}
        </button>
      </div>
    );
  }

  if (invitation.hasAccount) {
    return (
      <form className="loginCard" onSubmit={onSignIn}>
        {summary}
        <p className="note">{copy.existing}</p>
        <label className="stack">
          {copy.password}
          <input
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {errorLine}
        <button type="submit" disabled={busy}>
          {busy ? copy.working : copy.signInAccept}
        </button>
        <p className="authAltLine">
          <Link href="/forgot-password" className="textLink">
            {copy.forgot}
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form className="loginCard" onSubmit={onCreate}>
      {summary}
      <p className="note">{copy.create}</p>
      <label className="stack">
        {copy.name}
        <input
          required
          autoFocus
          autoComplete="name"
          maxLength={120}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
      </label>
      <label className="stack">
        {copy.newPassword}
        <input
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          placeholder={copy.passwordHint}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {errorLine}
      <button type="submit" disabled={busy}>
        {busy ? copy.working : copy.createAccept}
      </button>
    </form>
  );
};
