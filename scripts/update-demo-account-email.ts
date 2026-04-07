import { prisma } from "../lib/db";

async function main() {
  const oldEmail = "admin";
  const newEmail = "admin@akunta.com";
  const user = await prisma.user.findUnique({ where: { email: oldEmail } });
  if (!user) {
    console.error("Demo user with email 'admin' not found.");
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { email: newEmail } });
  console.log(`Demo user email updated to ${newEmail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
