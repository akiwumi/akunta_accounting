import { prisma } from "../lib/db";
import { hashPassword } from "../lib/auth/session";

async function main() {
  const passwordHash = await hashPassword("Test123456");
  let user = await prisma.user.findUnique({ where: { email: "admin" } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "admin",
        passwordHash,
        fullName: "Demo Admin",
        emailVerifiedAt: new Date()
      }
    });
    console.log("Demo user created");
  } else {
    console.log("Demo user already exists");
  }

  let business = await prisma.business.findFirst({ where: { name: "Demo Business" } });
  if (!business) {
    business = await prisma.business.create({
      data: {
        name: "Demo Business",
        orgType: "sole_trader",
        jurisdiction: "SWEDEN",
        bookkeepingMethod: "kontantmetoden",
        vatRegistered: true,
        vatFrequency: "yearly",
        fiscalYearStart: new Date(Date.UTC(new Date().getFullYear(), 0, 1))
      }
    });
    console.log("Demo business created");
  } else {
    console.log("Demo business already exists");
  }

  const membership = await prisma.membership.findFirst({ where: { userId: user.id, businessId: business.id } });
  if (!membership) {
    await prisma.membership.create({ data: { userId: user.id, businessId: business.id, role: "owner" } });
    console.log("Demo membership created");
  } else {
    console.log("Demo membership already exists");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
