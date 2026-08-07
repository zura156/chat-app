import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turning a failed request into something a person can act on.
 *
 * Before this existed every call site invented its own reading of the error,
 * and most of them threw the reason away:
 *
 *   - `err.message` on an `HttpErrorResponse` is Angular's own boilerplate —
 *     `Http failure response for http://…/upload/presign: 400 Bad Request`.
 *     That string was being shown to users as the explanation for a rejected
 *     upload, in place of the server's actual "File type not accepted here".
 *   - `err.error.message` is right for most of this API but blank for the
 *     handful of endpoints that answered `{ error }`, and it is the *generic*
 *     half of a validation failure — the per-field reasons live in `errors[]`
 *     and nothing read them, so "Validation failed" was the whole of what a
 *     user got told about a password the server had five specific objections
 *     to.
 *   - `AuthService.handleError` rethrows a plain string rather than the
 *     response, so components that assumed an object got `undefined` and fell
 *     through to their fallback.
 *
 * This accepts all of those shapes and returns the most specific sentence
 * available, so a caller only has to supply the fallback for the case where the
 * server genuinely said nothing.
 */

/** One field's reason, as the API reports it. */
export interface ApiFieldError {
  field?: string;
  msg: string;
}

interface ApiErrorBody {
  message?: unknown;
  error?: unknown;
  errors?: unknown;
  code?: unknown;
  retryAfter?: unknown;
}

/** Angular's placeholder text, which is never worth showing to a user. */
const isTransportBoilerplate = (text: string): boolean =>
  /^Http failure (response|during parsing)/i.test(text);

/**
 * The generic headline the server sends alongside a field-by-field breakdown.
 * Recognised so the breakdown wins when both are present.
 */
const isGenericValidationHeadline = (text: string): boolean =>
  /^validation failed\.?$/i.test(text.trim());

/** The response body, whatever form it arrived in. */
const bodyOf = (error: unknown): ApiErrorBody | null => {
  const raw = (error as HttpErrorResponse)?.error;
  if (!raw) return null;

  // A non-JSON response (an HTML error page, a proxy timeout) arrives as text.
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed
        ? (parsed as ApiErrorBody)
        : null;
    } catch {
      return { message: raw };
    }
  }

  // A network failure surfaces a ProgressEvent here, which has no message.
  if (raw instanceof ProgressEvent) return null;

  return typeof raw === 'object' ? (raw as ApiErrorBody) : null;
};

const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * The per-field reasons, keyed by field name.
 *
 * Lets a form put each reason under the input it belongs to instead of piling
 * them all into one banner. Entries the server reported without a field are
 * dropped here — they are already in the summary from `apiErrorMessage`.
 */
export const apiFieldErrors = (error: unknown): Record<string, string> => {
  const body = bodyOf(error);
  const list = Array.isArray(body?.errors) ? (body!.errors as unknown[]) : [];

  const fields: Record<string, string> = {};
  for (const entry of list) {
    const detail = entry as ApiFieldError;
    const field = asText(detail?.field);
    const msg = asText(detail?.msg);
    // First reason per field: a field with two failed validators should not
    // have the second silently overwrite the first.
    if (field && msg && !fields[field]) fields[field] = msg;
  }

  return fields;
};

/**
 * Every reason the server gave, as one sentence.
 *
 * `fallback` is used only when the failure carries no readable text at all —
 * pick one that names the operation ("Could not save your profile"), because it
 * is the only thing the user will see in that case.
 */
export const apiErrorMessage = (error: unknown, fallback: string): string => {
  // AuthService rethrows a bare string; several components then pass it here.
  const direct = asText(error);
  if (direct) return direct;

  if (error instanceof Error && !(error instanceof HttpErrorResponse)) {
    const message = asText(error.message);
    if (message && !isTransportBoilerplate(message)) return message;
  }

  const status = (error as HttpErrorResponse)?.status;

  // Status 0 is the browser refusing to say more: offline, DNS failure, CORS,
  // or a request the user navigated away from. The body is empty, so without
  // this the user would get the caller's fallback and be told the operation
  // failed rather than that nothing was sent.
  if (status === 0) {
    return 'Could not reach the server. Check your connection and try again.';
  }

  const body = bodyOf(error);

  if (body) {
    const summary = asText(body.message) ?? asText(body.error);
    const details = Object.values(apiFieldErrors(error));

    // The field breakdown is more useful than "Validation failed", but a
    // server that sent a real summary has already folded the fields into it.
    if (summary && !isGenericValidationHeadline(summary)) return summary;
    if (details.length > 0) return details.join(' ');
    if (summary) return summary;

    // `errors` without a `field` (a whole-body rule) still carries a reason.
    const list = Array.isArray(body.errors)
      ? (body.errors as ApiFieldError[])
      : [];
    const bare = list.map((detail) => asText(detail?.msg)).filter(Boolean);
    if (bare.length > 0) return bare.join(' ');
  }

  // Known statuses the server may not have bothered to describe.
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'That no longer exists.';
  if (status === 413) return 'That is too large to send.';
  if (status === 429)
    return 'Too many attempts. Please wait a moment and try again.';
  if (typeof status === 'number' && status >= 500) {
    return 'Something went wrong on our end. Please try again in a moment.';
  }

  return fallback;
};
