import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import vendorRoutes from './routes/vendorRoutes';
import customerRoutes from './routes/customerRoutes';
import adminRoutes from './routes/adminRoutes';

const app: Application = express();

// Railway (and most PaaS hosts) sit behind a reverse proxy — without this, express-rate-limit
// sees every request as coming from the proxy's IP and either rate-limits everyone as one
// client or refuses to start (it validates X-Forwarded-For usage against this setting).
app.set('trust proxy', 1);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/vendors', vendorRoutes);
app.use('/customers', customerRoutes);
app.use('/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
