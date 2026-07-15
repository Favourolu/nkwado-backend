import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import vendorRoutes from './routes/vendorRoutes';
import customerRoutes from './routes/customerRoutes';
import adminRoutes from './routes/adminRoutes';
import webhookRoutes from './routes/webhookRoutes';

const app: Application = express();

// Railway (and most PaaS hosts) sit behind a reverse proxy — without this, express-rate-limit
// sees every request as coming from the proxy's IP and either rate-limits everyone as one
// client or refuses to start (it validates X-Forwarded-For usage against this setting).
app.set('trust proxy', 1);

// Don't advertise the framework/version to every client — it's free reconnaissance for an
// attacker fingerprinting known-Express CVEs. (Was showing up as `x-powered-by: Express`.)
app.disable('x-powered-by');

// Baseline security response headers. This is a JSON API (no first-party HTML/JS served),
// so a full CSP isn't needed, but these close off the common cheap attacks: MIME-sniffing,
// clickjacking via framing, referrer leakage to third parties, and downgrade-to-HTTP.
app.use((req: Request, res: Response, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // HSTS: the API is served over HTTPS on Railway; tell browsers never to try plain HTTP.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
// Explicit body-size caps — the default is 100kb, but pinning it makes the DoS ceiling
// intentional rather than incidental, and keeps oversized-payload rejections uniform.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/vendors', vendorRoutes);
app.use('/customers', customerRoutes);
app.use('/admin', adminRoutes);
app.use('/webhooks', webhookRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
