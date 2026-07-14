import Joi from 'joi';

export const EVENT_TYPES = [
  'BIRTHDAY',
  'WEDDING',
  'ANNIVERSARY',
  'CORPORATE',
  'GRADUATION',
  'ENGAGEMENT',
  'BABY_SHOWER',
  'CONCERT',
  'CONFERENCE',
  'OTHER',
];

// Prisma-side enum names (see CLAUDE.md note on BudgetRange rename from the spec's
// _500K_TO_1M-style identifiers, which aren't valid Prisma enum names).
export const BUDGET_RANGES = [
  'ZERO_TO_500K',
  'FROM_500K_TO_1M',
  'FROM_1M_TO_3M',
  'FROM_3M_TO_5M',
  'ABOVE_5M',
];

export const questionnaireSchema = Joi.object({
  eventType: Joi.string()
    .valid(...EVENT_TYPES)
    .required(),
  eventDate: Joi.date().iso().optional(),
  guestCount: Joi.number().integer().positive().optional(),
  location: Joi.string().trim().optional().allow(''),
  budgetRange: Joi.string()
    .valid(...BUDGET_RANGES)
    .required(),
  specialRequirements: Joi.string().trim().optional().allow(''),
  questionnaire: Joi.object().unknown(true).optional(),
});
