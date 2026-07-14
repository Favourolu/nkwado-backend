import Joi from 'joi';

export const rejectVendorSchema = Joi.object({
  rejectionReason: Joi.string().trim().min(1).required(),
});
