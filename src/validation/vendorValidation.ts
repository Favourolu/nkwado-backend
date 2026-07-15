import Joi from 'joi';

export const VENDOR_CATEGORIES = [
  'CATERING',
  'VENUE',
  'DJ',
  'LIVE_BAND',
  'DRESSES',
  'SUITS',
  'DECORATION',
  'PHOTOGRAPHY',
  'VIDEOGRAPHY',
  'TRANSPORTATION',
  'FLORIST',
  'PLANNER',
  'ACCOMMODATION',
];

export const onboardVendorSchema = Joi.object({
  businessName: Joi.string().trim().min(1).required(),
  businessType: Joi.string().trim().optional().allow(''),
  category: Joi.string()
    .valid(...VENDOR_CATEGORIES)
    .required(),
  description: Joi.string().trim().optional().allow(''),
  location: Joi.string().trim().optional().allow(''),
  phoneNumber: Joi.string().trim().optional().allow(''),
  priceRange: Joi.string().trim().optional().allow(''),
  services: Joi.array().items(Joi.string()).optional().default([]),
});

const itemizationRowSchema = Joi.object({
  item: Joi.string().required(),
  qty: Joi.number().positive().required(),
  unitPrice: Joi.number().min(0).required(),
  total: Joi.number().min(0).required(),
});

export const submitQuoteSchema = Joi.object({
  basePrice: Joi.number().positive().required(),
  itemization: Joi.array().items(itemizationRowSchema).optional(),
  notes: Joi.string().trim().optional().allow(''),
});
