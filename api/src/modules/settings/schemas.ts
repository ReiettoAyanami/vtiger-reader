export const settingsPatchSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      language: { type: 'string', minLength: 2, maxLength: 10 },
      timezone: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
} as const;

export interface SettingsPatchBody {
  language?: string;
  timezone?: string;
}
