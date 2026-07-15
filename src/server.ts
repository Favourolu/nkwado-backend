import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import prisma from './utils/prisma';
import { startDeadlineReminderJob } from './jobs/deadlineReminderJob';

const PORT = process.env.PORT || 3001;

// A JWT is only as trustworthy as its signing secret. jwt.ts throws lazily if JWT_SECRET is
// unset, meaning the server would boot fine and only fail at the first login/verify — and a
// short or placeholder secret (e.g. the ".env.example" default) is brute-forceable offline,
// letting an attacker forge admin tokens. Validate up front and refuse to start on the
// clearly-unsafe cases rather than discovering it in production.
const PLACEHOLDER_SECRETS = new Set(['your-secret-key-here', 'changeme', 'secret']);
function validateJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || PLACEHOLDER_SECRETS.has(secret)) {
    console.error('FATAL: JWT_SECRET is missing or set to a placeholder value. Set a strong, random secret (32+ chars).');
    process.exit(1);
  }
  if (secret.length < 32) {
    console.warn(
      `WARNING: JWT_SECRET is only ${secret.length} characters. Use at least 32 random characters to resist offline brute-force of issued tokens.`
    );
  }
}

async function start() {
  try {
    validateJwtSecret();

    await prisma.$connect();
    console.log('Database connection established');

    startDeadlineReminderJob();

    app.listen(PORT, () => {
      console.log(`Nkwado backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
