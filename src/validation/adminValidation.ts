import Joi from 'joi';
import { EVENT_TYPES } from './customerValidation';

export const rejectVendorSchema = Joi.object({
  rejectionReason: Joi.string().trim().min(1).required(),
});

export const EVENT_REQUEST_STATUSES = ['pending', 'matched', 'quoted', 'booked'];
export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'PAID', 'COMPLETED', 'CANCELLED'];

export const listRequestsQuerySchema = Joi.object({
  status: Joi.string()
    .valid(...EVENT_REQUEST_STATUSES)
    .optional(),
  eventType: Joi.string()
    .valid(...EVENT_TYPES)
    .optional(),
});

export const listBookingsQuerySchema = Joi.object({
  status: Joi.string()
    .valid(...BOOKING_STATUSES)
    .optional(),
  startDate: Joi.date().iso().optional(),
});
