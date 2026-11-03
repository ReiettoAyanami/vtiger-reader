/**
 * Problem Details (RFC 9457). Every error the API returns has this shape and is sent as
 * `application/problem+json`: 400 validation, 404 not found, 409 rule violation.
 */

export interface ProblemFieldError {
  /** JSON pointer / field name the error is about (empty for the whole body). */
  field: string;
  message: string;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors: ProblemFieldError[];
  [extension: string]: unknown;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

const TYPE_PREFIX = 'urn:vtiger-reader:problem:';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function statusTitle(status: number): string {
  return TITLES[status] ?? (status >= 500 ? 'Server Error' : 'Client Error');
}

export class ProblemError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly errors: ProblemFieldError[];

  constructor(status: number, code: string, detail: string, errors: ProblemFieldError[] = [], title?: string) {
    super(detail);
    this.name = 'ProblemError';
    this.status = status;
    this.code = code;
    this.title = title ?? statusTitle(status);
    this.errors = errors;
  }

  toBody(): ProblemBody {
    return problemBody(this.status, this.code, this.message, this.errors, this.title);
  }
}

export function problemBody(
  status: number,
  code: string | null,
  detail: string,
  errors: ProblemFieldError[] = [],
  title: string = statusTitle(status),
): ProblemBody {
  return {
    type: code ? `${TYPE_PREFIX}${code}` : 'about:blank',
    title,
    status,
    detail,
    errors,
  };
}

/** 400: input the JSON schema could not catch (ranges, decimals, combinations). */
export function badRequest(detail: string, field?: string): ProblemError {
  return new ProblemError(400, 'validation', detail, field ? [{ field, message: detail }] : []);
}

/** 404: the row does not exist or is soft-deleted. */
export function notFound(what: string, id: number | string): ProblemError {
  return new ProblemError(404, 'not-found', `${what} ${id} not found`);
}

/** 409: a rule refuses the operation; `field`, when one field of the form is the cause. */
export function conflict(code: string, detail: string, field?: string): ProblemError {
  return new ProblemError(409, code, detail, field ? [{ field, message: detail }] : []);
}
