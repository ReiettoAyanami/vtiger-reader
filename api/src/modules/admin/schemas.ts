import { idParams } from '../../shared/schemas.js';

// Generous bounds: the real rules (usernameProblem, emailProblem, passwordProblem) give the reasons.
const username = { type: 'string', minLength: 1, maxLength: 64 } as const;
const email = { type: 'string', minLength: 1, maxLength: 320 } as const;
const password = { type: 'string', minLength: 1, maxLength: 512 } as const;
const role = { type: 'string', enum: ['user', 'admin'] } as const;

export const createUserSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'email', 'password', 'role'],
    properties: { username, email, password, role },
  },
} as const;

export interface CreateUserBody {
  username: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
}

export const updateUserSchema = {
  params: idParams,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: { email, role, password, blocked: { type: 'boolean' } },
  },
} as const;

export interface UpdateUserBody {
  email?: string;
  role?: 'user' | 'admin';
  password?: string;
  blocked?: boolean;
}

export const userIdSchema = { params: idParams } as const;
