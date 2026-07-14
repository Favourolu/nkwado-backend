import { PrismaClient } from '@prisma/client';

// Prisma's auto-detected default pool size (num_physical_cpus * 2 + 1) under-provisions on
// a small container — see architecture audit, deliverable 7. Set explicitly via env so it
// can be tuned per-environment without a code change; Railway's own Postgres plugin has its
// own max_connections ceiling shared across every service in the project, so this needs to
// leave headroom rather than being maximized in isolation.
const CONNECTION_LIMIT = process.env.DB_CONNECTION_LIMIT || '20';

function withConnectionLimit(url: string | undefined): string | undefined {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return url.includes('connection_limit=') ? url : `${url}${separator}connection_limit=${CONNECTION_LIMIT}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: withConnectionLimit(process.env.DATABASE_URL) },
  },
});

export default prisma;
