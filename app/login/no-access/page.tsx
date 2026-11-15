export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NoAccessActions } from "@/components/team/NoAccessActions";
import { getUserContext } from "@/lib/auth/context";
import { normalizeRole } from "@/lib/auth/roles";
import { listUserBusinesses } from "@/lib/auth/session";
import { getRequestLocale } from "@/lib/i18n/locale";

/**
 * Where a signed-in person lands when their session is not in a business they
 * belong to: removed from their only business, or (rarely) from the one they
 * were working in while still a member of others.
 */
export default async function NoAccessPage() {
  const user = await getUserContext();
  if (!user) redirect("/login?expired=1");

  const businesses = await listUserBusinesses(user.userId);
  if (businesses.some((business) => business.id === user.sessionBusinessId)) redirect("/dashboard");

  const locale = await getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: businesses.length ? "Välj företag" : "Du har inte åtkomst till något företag",
          signedIn: "Inloggad som",
          some: "Du har inte längre åtkomst till företaget du arbetade i. De här företagen kan du öppna:",
          none: "Ditt konto finns kvar, men det är inte kopplat till något företag just nu. Antingen har ägaren tagit bort din åtkomst, eller så har du inte tackat ja till en inbjudan än.",
          next: "Be företagets ägare skicka en ny inbjudan till din e-postadress. Länken i mejlet öppnar bokföringen direkt.",
          support: "Kontakta support"
        }
      : {
          title: businesses.length ? "Choose a business" : "You do not have access to any business",
          signedIn: "Signed in as",
          some: "You no longer have access to the business you were working in. You can open these:",
          none: "Your account is still here, but it is not connected to any business right now. Either the owner has removed your access, or you have not accepted an invitation yet.",
          next: "Ask the owner of the business to send a new invitation to your email address. The link in that email opens the books directly.",
          support: "Contact support"
        };

  return (
    <section className="authScreen">
      <div className="authBackdropGlow" aria-hidden />
      <div className="loginStage routeFade">
        <div className="loginBrand">
          <Image src="/akunta_logo.png" alt="Akunta" width={610} height={614} className="loginBrandLogo" priority />
          <h1 className="splashTitle">Akunta</h1>
        </div>
        <div className="loginCard">
          <h2>{copy.title}</h2>
          <p className="note">
            {copy.signedIn} <strong>{user.email}</strong>
          </p>
          {businesses.length ? (
            <p>{copy.some}</p>
          ) : (
            <>
              <p>{copy.none}</p>
              <p className="note">{copy.next}</p>
            </>
          )}
          <NoAccessActions
            locale={locale}
            businesses={businesses.map((b) => ({ id: b.id, name: b.name, role: normalizeRole(b.role) }))}
          />
          <p className="authAltLine">
            <Link href="/support" className="textLink">
              {copy.support}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
