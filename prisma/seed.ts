import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password';

const prisma = new PrismaClient();

// Admin accounts aren't self-registerable via POST /auth/register (only CUSTOMER/VENDOR are),
// so this seed is the only way to get an ADMIN user for local dev/testing.
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists — skipping.`);
    return;
  }

  const hashedPassword = await hashPassword(password);

  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName: process.env.ADMIN_FIRST_NAME || 'Nkwado',
      lastName: process.env.ADMIN_LAST_NAME || 'Admin',
      role: 'ADMIN',
    },
  });

  console.log(`Created admin user: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
