import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { TimeoutError, catchError, throwError, timeout } from 'rxjs';

import { ANSWER_TIMEOUT_MS, ApiError } from './api-error';

/**
 * Turns every failed response into an ApiError, and a request with no answer in 15 s into one with
 * no status, like a network failure (design-android.md, "offline"). No retries, no messages shown.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    // `each`: the first event (the request sent) comes at once; the answer must follow within the time.
    timeout({ each: ANSWER_TIMEOUT_MS }),
    catchError((error: unknown) => throwError(() => toError(error))),
  );

function toError(error: unknown): unknown {
  if (error instanceof TimeoutError) {
    return {
      status: null,
      code: null,
      title: 'Server not reachable',
      detail: 'The server did not answer.',
      fieldErrors: [],
    } satisfies ApiError;
  }
  return error instanceof HttpErrorResponse ? toApiError(error) : error;
}

/** The Problem Details body the API sends with every error (design.md, Appendix B). */
interface ProblemDetails {
  type?: string;
  title: string;
  detail: string;
  errors: ApiError['fieldErrors'];
}

function toApiError(response: HttpErrorResponse): ApiError {
  // Status 0: no response at all (API or network down).
  if (response.status === 0) {
    return {
      status: null,
      code: null,
      title: 'Server not reachable',
      detail: 'The server could not be reached.',
      fieldErrors: [],
    };
  }
  const body: unknown = response.error;
  if (isProblemDetails(body)) {
    return {
      status: response.status,
      code: codeOf(body.type),
      title: body.title,
      detail: body.detail,
      fieldErrors: body.errors,
    };
  }
  return {
    status: response.status,
    code: null,
    title: response.statusText,
    detail: '',
    fieldErrors: [],
  };
}

/** `urn:vtiger-reader:problem:not-found` → `not-found`; `about:blank` or none → null. */
function codeOf(type: string | undefined): string | null {
  const prefix = 'urn:vtiger-reader:problem:';
  return type?.startsWith(prefix) ? type.slice(prefix.length) : null;
}

function isProblemDetails(body: unknown): body is ProblemDetails {
  return typeof body === 'object' && body !== null && 'title' in body;
}
