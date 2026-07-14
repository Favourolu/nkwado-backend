import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import prisma from './utils/prisma';

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await prisma.$connect();
    console.log('Database connection established');

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
