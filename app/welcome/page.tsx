export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";

import { requireAuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

export default async function WelcomePage() {
  let firstName = "there";
  try {
    const { userId } = await requireAuthContext();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.fullName) {
      firstName = user.fullName.split(" ")[0] ?? user.fullName;
    }
  } catch {
    // Not critical — welcome page accessible right after verification
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
        <h1 className="welcomeTitle">Welcome to Akunta, {firstName}!</h1>
        <p className="welcomeBody">
          Your account is confirmed and your workspace is ready. Akunta keeps your books, VAT,
          and invoices in order so you can focus on your work.
        </p>

        <div className="welcomeChecklist">
          <div className="welcomeCheckItem">
            <span className="welcomeCheckIcon" aria-hidden>✓</span>
            Account confirmed
          </div>
          <div className="welcomeCheckItem">
            <span className="welcomeCheckIcon" aria-hidden>✓</span>
            Swedish chart of accounts pre-configured
          </div>
          <div className="welcomeCheckItem">
            <span className="welcomeCheckIcon" aria-hidden>✓</span>
            VAT &amp; tax settings ready
          </div>
        </div>

        <Link href="/dashboard" className="button welcomeStartBtn">
          Start using Akunta →
        </Link>

        <p className="welcomeNote">
          Need help?{" "}
          <Link href="/help" className="textLink">Browse the help centre</Link>
          {" "}or{" "}
          <Link href="/support" className="textLink">contact us</Link>.
        </p>
      </div>
    </section>
  );
}
