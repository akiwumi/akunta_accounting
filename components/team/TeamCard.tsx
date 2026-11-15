"use client";

import { FormEvent, useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type Role = "owner" | "accountant" | "viewer";

export type TeamMember = {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: Role;
  since: string;
};

export type TeamInvitation = {
  id: string;
  email: string;
  role: "accountant" | "viewer";
  expiresAt: string;
  expired: boolean;
};

type TeamCardProps = {
  locale: Locale;
  role: Role;
  currentUserId: string;
  businessName: string;
  initialMembers: TeamMember[];
  initialInvitations: TeamInvitation[];
  /** False when the server cannot send email, so an invitation would never arrive. */
  emailAvailable: boolean;
};

const formatDate = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleDateString(locale === "sv" ? "sv-SE" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Europe/Stockholm"
  });

export const TeamCard = ({
  locale,
  role,
  currentUserId,
  businessName,
  initialMembers,
  initialInvitations,
  emailAvailable
}: TeamCardProps) => {
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"accountant" | "viewer">("accountant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isOwner = role === "owner";

  const copy =
    locale === "sv"
      ? {
          title: "Team och redovisningskonsult",
          introOwner: `Ge din redovisningskonsult eller en kollega åtkomst till bokföringen för ${businessName}. Ange e-postadressen, så skickar vi en länk som gäller i 7 dagar.`,
          introOther: `De här personerna har åtkomst till bokföringen för ${businessName}. Bara ägaren kan ändra vem som har åtkomst.`,
          email: "E-postadress",
          emailPlaceholder: "namn@byra.se",
          role: "Behörighet",
          invite: "Bjud in",
          inviting: "Skickar...",
          invited: (to: string) => `Inbjudan skickad till ${to}.`,
          invitedNoEmail: (to: string) =>
            `Inbjudan till ${to} är skapad, men mejlet kunde inte skickas. Försök skicka igen om en stund.`,
          noEmail: "Servern kan inte skicka e-post just nu, så en inbjudan skulle inte komma fram.",
          roles: { owner: "Ägare", accountant: "Redovisningskonsult", viewer: "Läsbehörighet" } as Record<Role, string>,
          roleHelp: {
            accountant: "Kan se och bokföra allt. Kan inte hantera medlemmar, abonnemang eller företagets uppgifter.",
            viewer: "Kan se allt och ladda ner underlag. Kan inte ändra något."
          },
          members: "Har åtkomst",
          person: "Person",
          since: "Sedan",
          you: "du",
          remove: "Ta bort",
          removeConfirm: (who: string) => `Ta bort ${who}? Personen loggas ut ur ${businessName} direkt.`,
          leave: "Lämna",
          leaveConfirm: `Lämna ${businessName}? Du förlorar åtkomsten direkt och behöver en ny inbjudan för att komma tillbaka.`,
          pending: "Väntar på svar",
          expires: "Gäller till",
          expired: "Har gått ut",
          resend: "Skicka igen",
          resent: (to: string) => `En ny länk är skickad till ${to}. Den gamla länken gäller inte längre.`,
          revoke: "Dra tillbaka",
          failed: "Det gick inte. Försök igen."
        }
      : {
          title: "Team and accountant",
          introOwner: `Give your accountant or a colleague access to the books of ${businessName}. Enter their email address and we send a link that is valid for 7 days.`,
          introOther: `These people have access to the books of ${businessName}. Only the owner can change who has access.`,
          email: "Email address",
          emailPlaceholder: "name@firm.se",
          role: "Access",
          invite: "Invite",
          inviting: "Sending...",
          invited: (to: string) => `Invitation sent to ${to}.`,
          invitedNoEmail: (to: string) =>
            `The invitation to ${to} is created, but the email could not be sent. Try sending it again in a while.`,
          noEmail: "The server cannot send email right now, so an invitation would not arrive.",
          roles: { owner: "Owner", accountant: "Accountant", viewer: "Read-only" } as Record<Role, string>,
          roleHelp: {
            accountant: "Can view and book everything. Cannot manage members, the subscription or the business details.",
            viewer: "Can view everything and download exports. Cannot change anything."
          },
          members: "Has access",
          person: "Person",
          since: "Since",
          you: "you",
          remove: "Remove",
          removeConfirm: (who: string) => `Remove ${who}? They are signed out of ${businessName} at once.`,
          leave: "Leave",
          leaveConfirm: `Leave ${businessName}? You lose access at once and need a new invitation to come back.`,
          pending: "Waiting for an answer",
          expires: "Valid until",
          expired: "Expired",
          resend: "Send again",
          resent: (to: string) => `A new link is sent to ${to}. The old link no longer works.`,
          revoke: "Withdraw",
          failed: "That did not work. Please try again."
        };

  const reload = async () => {
    const response = await fetch("/api/members", { cache: "no-store" });
    if (!response.ok) return;
    const json = (await response.json()) as { members: TeamMember[]; invitations: TeamInvitation[] };
    setMembers(json.members);
    setInvitations(json.invitations);
  };

  /** Runs one request, shows its error, and refreshes the lists. Returns the JSON on success. */
  const call = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        ...init,
        headers: init.body ? { "content-type": "application/json" } : undefined
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : copy.failed);
      await reload();
      return json;
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : copy.failed);
      await reload().catch(() => {});
      return null;
    } finally {
      setBusy(false);
    }
  };

  const onInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const to = email.trim();
    if (!to) return;
    const json = await call("/api/invitations", { method: "POST", body: JSON.stringify({ email: to, role: inviteRole }) });
    if (!json) return;
    setEmail("");
    setNotice(json.emailSent ? copy.invited(to) : copy.invitedNoEmail(to));
  };

  const onResend = async (invitation: TeamInvitation) => {
    const json = await call(`/api/invitations/${invitation.id}/resend`, { method: "POST" });
    if (json) setNotice(json.emailSent ? copy.resent(invitation.email) : copy.invitedNoEmail(invitation.email));
  };

  const onLeave = async () => {
    if (!window.confirm(copy.leaveConfirm)) return;
    const json = await call("/api/members/leave", { method: "POST" });
    // Leaving ends the session in this business, so the next stop is the sign-in page.
    if (json) window.location.assign("/login");
  };

  return (
    <div className="stack">
      <h2>{copy.title}</h2>
      <p className="note">{isOwner ? copy.introOwner : copy.introOther}</p>

      {isOwner && (
        <form className="stack" onSubmit={onInvite}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="stack">
              {copy.email}
              <input
                type="email"
                required
                autoComplete="off"
                value={email}
                placeholder={copy.emailPlaceholder}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="stack">
              {copy.role}
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "accountant" | "viewer")}>
                <option value="accountant">{copy.roles.accountant}</option>
                <option value="viewer">{copy.roles.viewer}</option>
              </select>
            </label>
            <button type="submit" disabled={busy || !emailAvailable}>
              {busy ? copy.inviting : copy.invite}
            </button>
          </div>
          <p className="note">{copy.roleHelp[inviteRole]}</p>
          {!emailAvailable && <p className="note">{copy.noEmail}</p>}
        </form>
      )}

      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h3>{copy.members}</h3>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>{copy.person}</th>
              <th>{copy.role}</th>
              <th>{copy.since}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const self = member.userId === currentUserId;
              const name = member.fullName?.trim() || member.email;
              return (
                <tr key={member.id}>
                  <td data-label={copy.person}>
                    {name}
                    {self ? ` (${copy.you})` : ""}
                    {member.fullName?.trim() ? <div className="note">{member.email}</div> : null}
                  </td>
                  <td data-label={copy.role}>
                    {isOwner ? (
                      <select
                        aria-label={`${copy.role}: ${name}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          void call(`/api/members/${member.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ role: event.target.value })
                          }).then((json) => {
                            // An owner who steps down sees the page as their new role.
                            if (json && self) window.location.reload();
                          })
                        }
                      >
                        <option value="owner">{copy.roles.owner}</option>
                        <option value="accountant">{copy.roles.accountant}</option>
                        <option value="viewer">{copy.roles.viewer}</option>
                      </select>
                    ) : (
                      <span className="badge">{copy.roles[member.role]}</span>
                    )}
                  </td>
                  <td data-label={copy.since}>{formatDate(member.since, locale)}</td>
                  <td>
                    {isOwner && !self && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(copy.removeConfirm(name))) {
                            void call(`/api/members/${member.id}`, { method: "DELETE" });
                          }
                        }}
                      >
                        {copy.remove}
                      </button>
                    )}
                    {!isOwner && self && (
                      <button type="button" className="secondary" disabled={busy} onClick={() => void onLeave()}>
                        {copy.leave}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isOwner && invitations.length > 0 && (
        <>
          <h3>{copy.pending}</h3>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.email}</th>
                  <th>{copy.role}</th>
                  <th>{copy.expires}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td data-label={copy.email}>{invitation.email}</td>
                    <td data-label={copy.role}>{copy.roles[invitation.role]}</td>
                    <td data-label={copy.expires}>
                      {invitation.expired ? (
                        <span className="badge warn">{copy.expired}</span>
                      ) : (
                        formatDate(invitation.expiresAt, locale)
                      )}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy || !emailAvailable}
                          onClick={() => void onResend(invitation)}
                        >
                          {copy.resend}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void call(`/api/invitations/${invitation.id}`, { method: "DELETE" })}
                        >
                          {copy.revoke}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
