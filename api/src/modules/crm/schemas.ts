export const crmLinkPutSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'username', 'accessKey'],
    properties: {
      // https on a public host: the service checks it, and says so under the field.
      url: { type: 'string', minLength: 1, maxLength: 200 },
      username: { type: 'string', minLength: 1, maxLength: 100 },
      // The CRM's access keys are 16 letters and digits; some room for other vtiger versions.
      accessKey: { type: 'string', minLength: 1, maxLength: 64, pattern: '^\\s*\\S+\\s*$' },
    },
  },
} as const;

export interface CrmLinkPutBody {
  url: string;
  username: string;
  accessKey: string;
}
