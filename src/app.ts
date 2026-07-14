import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

const app: Application = express();

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

// Routes will be mounted here in later sessions
// app.use('/auth', authRoutes);
// app.use('/vendors', vendorRoutes);
// app.use('/customers', customerRoutes);
// app.use('/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
