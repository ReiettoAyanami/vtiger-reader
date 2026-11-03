/** Record ids of the CRM in addresses: digits x digits. */
const recordId = { type: 'string', pattern: '^\\d+x\\d+$', maxLength: 40 } as const;

export const ticketParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: recordId },
} as const;

export const fileParams = {
  type: 'object',
  required: ['id', 'fileId'],
  additionalProperties: false,
  properties: { id: recordId, fileId: recordId },
} as const;

export interface TicketParams {
  id: string;
}

export interface FileParams {
  id: string;
  fileId: string;
}

export const listSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      list: { type: 'integer', minimum: 1, maximum: 4294967295 },
      q: { type: 'string', maxLength: 100 },
      status: { type: 'string', maxLength: 100 },
      contact: recordId,
      organization: recordId,
      sort: { type: 'string', enum: ['created', 'modified'] },
      dir: { type: 'string', enum: ['asc', 'desc'] },
      page: { type: 'integer', minimum: 0, maximum: 10_000 },
      size: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
} as const;

export const fileSchema = {
  params: fileParams,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { download: { type: 'boolean' } },
  },
} as const;

export const markSchema = {
  params: fileParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mark'],
    properties: { mark: { type: ['string', 'null'], enum: ['logo', 'photo', null] } },
  },
} as const;

export interface MarkBody {
  mark: 'logo' | 'photo' | null;
}

export const namesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['ids'],
    properties: { ids: { type: 'string', minLength: 3, maxLength: 4000 } },
  },
} as const;

export const customersSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['q'],
    properties: { q: { type: 'string', minLength: 1, maxLength: 60 } },
  },
} as const;
