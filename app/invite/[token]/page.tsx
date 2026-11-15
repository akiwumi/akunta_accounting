export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { InvitePanel } from "@/components/team/InvitePanel";
import { getUserContext } from "@/lib/auth/context";
import { lookupInvitation } from "@/lib/auth/invitations";
import { getRequestLocale } from "@/lib/i18n/locale";

// The address contains the invitation token: keep it out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: "Akunta",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getRequestLocale();
  const [invitation, user] = await Promise.all([lookupInvitation(token), getUserContext()]);

  const copy =
    locale === "sv"
      ? {
          invalidTitle: "Länken fungerar inte",
          invalid: "Den här inbjudningslänken är inte giltig. Kontrollera att du har öppnat hela länken från mejlet.",
          expiredTitle: "Inbjudan har gått ut",
          expired: (name: string) => `Inbjudan till ${name} gällde i 7 dagar. Be ägaren skicka en ny.`,
          revokedTitle: "Inbjudan gäller inte längre",
          revoked: (name: string) =>
            `Inbjudan till ${name} har dragits tillbaka eller ersatts av en nyare. Använd länken i det senaste mejlet, eller be ägaren skicka en ny.`,
          usedTitle: "Inbjudan är redan använd",
          used: (name: string) => `Du har redan tackat ja till ${name}. Logga in för att öppna bokföringen.`,
          signIn: "Logga in",
          home: "Till startsidan"
        }
      : {
          invalidTitle: "This link does not work",
          invalid: "This invitation link is not valid. Check that you opened the whole link from the email.",
          expiredTitle: "The invitation has expired",
          expired: (name: string) => `The invitation to ${name} was valid for 7 days. Ask the owner to send a new one.`,
          revokedTitle: "The invitation is no longer valid",
          revoked: (name: string) =>
            `The invitation to ${name} has been withdrawn or replaced by a newer one. Use the link in the latest email, or ask the owner to send a new one.`,
          usedTitle: "The invitation is already used",
          used: (name: string) => `You have already accepted the invitation to ${name}. Sign in to open the books.`,
          signIn: "Sign in",
          home: "To the start page"
        };

  const closed = !invitation
    ? { title: copy.invalidTitle, body: copy.invalid }
    : invitation.status === "expired"
      ? { title: copy.expiredTitle, body: copy.expired(invitation.businessName) }
      : invitation.status === "revoked"
        ? { title: copy.revokedTitle, body: copy.revoked(invitation.businessName) }
        : invitation.status === "accepted"
          ? { title: copy.usedTitle, body: copy.used(invitation.businessName) }
          : null;

  return (
    <section className="authScreen">
      <div className="authBackdropGlow" aria-hidden />
      <div className="loginStage routeFade">
        <div className="loginBrand">
          <Image src="/akunta_logo.png" alt="Akunta" width={610} height={614} className="loginBrandLogo" priority />
          <h1 className="splashTitle">Akunta</h1>
        </div>

        {closed || !invitation ? (
          <div className="loginCard">
            <h2>{closed?.title}</h2>
            <p className="note">{closed?.body}</p>
            <Link href={user ? "/dashboard" : "/login"} className="button">
              {user ? "Akunta" : copy.signIn}
            </Link>
            <Link href="/" className="authBackLink">
              {copy.home}
            </Link>
          </div>
        ) : (
          <InvitePanel
            locale={locale}
            token={token}
            invitation={{
              email: invitation.email,
              role: invitation.role,
              businessName: invitation.businessName,
              inviterName: invitation.inviterName,
              hasAccount: invitation.hasAccount,
              expiresAt: invitation.expiresAt.toISOString()
            }}
            signedInEmail={user?.email ?? null}
          />
        )}
      </div>
    </section>
  );
}
