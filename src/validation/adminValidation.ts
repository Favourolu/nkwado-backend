import Joi from 'joi';
import { EVENT_TYPES } from './customerValidation';
import { VENDOR_CATEGORIES } from './vendorValidation';

export const rejectVendorSchema = Joi.object({
  rejectionReason: Joi.string().trim().min(1).required(),
});

export const pendingVendorsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

export const VENDOR_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

export const listVendorsQuerySchema = Joi.object({
  status: Joi.string()
    .valid(...VENDOR_STATUSES)
    .optional(),
  category: Joi.string()
    .valid(...VENDOR_CATEGORIES)
    .optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

export const EVENT_REQUEST_STATUSES = ['PENDING', 'MATCHED', 'QUOTED', 'BOOKED'];
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
