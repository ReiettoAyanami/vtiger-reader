/**
 * A failed API call, as the error interceptor hands it to the caller. Built from the Problem
 * Details body (RFC 9457) when there is one; a network failure has no status.
 */
export interface ApiError {
  status: number | null;
  /** The problem's code, the end of its `type` (e.g. `not-found`, `banned-user`); null without one. */
  code: string | null;
  title: string;
  detail: string;
  fieldErrors: FieldError[];
}

/** One validation error, for the form field named by `field` (empty for the whole body). */
export interface FieldError {
  field: string;
  message: string;
}

/** How long a request waits for an answer before it counts as unanswered (design-android.md, "offline"). */
export const ANSWER_TIMEOUT_MS = 15_000;

/**
 * The server gave no answer (design-android.md, "offline"): no network, no answer in 15 s, or the
 * proxy in front of a stopped API (502, 503, 504). Any other status is an answer.
 */
export function isUnreachable(error: ApiError): boolean {
  return error.status === null || error.status === 502 || error.status === 503 || error.status === 504;
}

/** What a form says when its save got no answer: its values and its clientRef stay. */
export const SERVER_NOT_REACHABLE = 'Server not reachable. Press Save again: it will not be saved twice.';
