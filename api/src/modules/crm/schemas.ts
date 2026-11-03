export const crmLinkPutSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'accessKey'],
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 100 },
      // The CRM's access keys are 16 letters and digits; some room for other vtiger versions.
      accessKey: { type: 'string', minLength: 1, maxLength: 64, pattern: '^\\s*\\S+\\s*$' },
    },
  },
} as const;

export interface CrmLinkPutBody {
  username: string;
  accessKey: string;
}
