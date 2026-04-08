export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";

import { WelcomeConfirmationActions } from "@/components/public/WelcomeConfirmationActions";
import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

type WelcomePageProps = {
  searchParams?: {
    confirm?: string | string[];
    confirmed?: string | string[];
    token?: string | string[];
  };
};

export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  let firstName = "there";
  let isAuthenticated = false;
  const awaitingSupabaseConfirmation = searchParams?.confirm === "1";
  const token = typeof searchParams?.token === "string" ? searchParams.token : null;

  try {
    const { userId } = await requireAuthContext();
    isAuthenticated = true;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.fullName) {
      firstName = user.fullName.split(" ")[0] ?? user.fullName;
    }
  } catch {
    if (token) {
      const user = await prisma.user.findUnique({
        where: { emailVerificationToken: token },
        select: { fullName: true }
      });
      if (user?.fullName) {
        firstName = user.fullName.split(" ")[0] ?? user.fullName;
      }
    }
  }

  return (
    <section className="welcomePage routeFade">
      <div className="welcomeCard">
        <Image
          src="/akunta_logo.png"
          alt="Akunta"
          width={610}
          height={614}
          className="welcomeLogo"
          priority
        />
        <p className="welcomeEyebrow">Din arbetsyta är nästan redo / Your workspace is almost ready</p>
        <h1 className="welcomeTitle">
          Välkommen till Akunta, {firstName}!
          <span>Welcome to Akunta, {firstName}!</span>
        </h1>
        <p className="welcomeBody">
          Bekräfta din e-post och fortsätt till din dashboard för att komma igång.{" "}
          Your email confirmation opens the door to your dashboard so you can get started right away.
        </p>

        <div className="welcomeLocaleBlock">
          <h2>Svenska</h2>
          <p>
            Akunta är byggt för att göra vardagen enklare för svenska företagare. Du får stöd för
            bokföring, moms, kvitton, fakturor och viktiga översikter i ett och samma arbetsflöde,
            så att du kan lägga mer tid på verksamheten och mindre på administration.
          </p>
        </div>

        <div className="welcomeLocaleBlock">
          <h2>English</h2>
          <p>
            Akunta is designed to make day-to-day bookkeeping feel lighter for Swedish businesses.
            It brings your accounting, VAT, receipts, invoices, and reporting into one workflow so
            you can spend less time on admin and more time running your business.
          </p>
        </div>

        <div className="welcomeChecklist" aria-label="Akunta highlights">
          <div className="welcomeCheckItem">
            <span className="welcomeCheckIcon" aria-hidden>✓</span>
            Konto, bokföring och moms på samma plats / Account, bookkeeping, and VAT in one place
          </div>
          <div className="welcomeCheckItem">
            <span className="welcomeCheckIcon" aria-hidden>✓</span>
            Svensk kontoplan förberedd / Swedish chart of accounts pre-configured
          </div>
          <div className="welcomeCheckItem">
            <span className="welcomeCheckIcon" aria-hidden>✓</span>
            Redo för kvitton, fakturor och överblick / Ready for receipts, invoicing, and visibility
          </div>
        </div>

        <WelcomeConfirmationActions
          awaitingSupabaseConfirmation={awaitingSupabaseConfirmation}
          isAuthenticated={isAuthenticated}
          token={token}
        />

        <p className="welcomeSupportNote">
          Behöver du hjälp? / Need help?{" "}
          <Link href="/help" className="textLink">Browse the help centre</Link>
          {" "}or{" "}
          <Link href="/support" className="textLink">contact us</Link>.
        </p>
      </div>
    </section>
  );
}
