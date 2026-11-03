/** JSON Schema fragments shared by the modules' schemas.ts files. */

export const instantInput = { type: 'string', format: 'date-time' } as const;

export const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'integer', minimum: 1, maximum: 4294967295 } },
} as const;

export interface IdParams {
  id: number;
}

export function optionalText(maxLength: number) {
  return { type: ['string', 'null'], maxLength } as const;
}

export function requiredText(maxLength: number) {
  return { type: 'string', minLength: 1, maxLength } as const;
}

export const paginationProperties = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  before: instantInput,
} as const;

export interface PaginationQuery {
  limit?: number;
  before?: string;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
