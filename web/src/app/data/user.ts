/** A user as the admin view shows it (GET /api/admin/users, design-accounts.md "Admin API"). */
export interface User {
  id: number;
  username: string;
  email: string;
  role: 'user' | 'admin';
  /** Cannot sign in; the data stays. */
  blocked: boolean;
  /** false: cannot sign in until an administrator sets a password (test-user). */
  hasPassword: boolean;
  /** ISO 8601 instant. */
  createdAt: string;
}

/** POST /api/admin/users. */
export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role: User['role'];
}

/** PATCH /api/admin/users/:id: any of these, together or alone; a password is a reset. */
export interface UserUpdate {
  email?: string;
  role?: User['role'];
  password?: string;
  blocked?: boolean;
}
