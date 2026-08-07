import { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

/**
 * Human labels for the body fields the validators run against.
 *
 * express-validator reports the raw path (`first_name`), which is the wrong
 * register for a sentence shown to a person. Anything not listed falls back to
 * the path with underscores turned into spaces.
 */
const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  new_email: 'New email',
  username: 'Username',
  first_name: 'First name',
  last_name: 'Last name',
  password: 'Password',
  current_password: 'Current password',
  new_password: 'New password',
  token: 'Token',
  userId: 'User id',
  code: 'Code',
};

const labelFor = (field: string): string =>
  FIELD_LABELS[field] ?? field.replace(/_/g, ' ');

/**
 * One sentence naming the field and the reason.
 *
 * The validators already phrase most messages as complete sentences that carry
 * their own subject ("Username must be between 3 and 32 characters"), so
 * prefixing those would read "Username: Username must be…". The label is only
 * added when the message does not already open with it.
 */
const describe = (field: string | undefined, msg: string): string => {
  const text = String(msg ?? '').trim();
  if (!field) return text;

  const label = labelFor(field);
  const alreadyNamed = text.toLowerCase().startsWith(label.toLowerCase());
  if (alreadyNamed) return text;

  // Password policy messages are imperatives ("Use at least 8 characters.") and
  // read better introduced than colon-joined.
  return `${label}: ${text}`;
};

/**
 * express-validator chains only *record* errors — without this middleware the
 * validators on the routes are inert and bad input falls through to Mongoose,
 * surfacing as a 500 instead of a 400.
 *
 * The response carries the reasons twice, deliberately:
 *
 *   - `message` is a complete, readable sentence naming every field that
 *     failed and why. It exists because every client in this app reads
 *     `error.message` first, and this endpoint used to answer the constant
 *     string "Validation failed" — so a user whose password was refused for
 *     being a well-known one, or whose username contained a space, was told
 *     only that validation had failed and was left to guess which of the six
 *     fields was at fault. The reasons were in `errors[]` all along and nothing
 *     rendered them.
 *   - `errors[]` keeps the per-field breakdown so a form can put each reason
 *     under the input it belongs to rather than in one banner.
 */
export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // One entry per field: a field with two failed validators would otherwise
    // repeat its label in the summary sentence.
    const seen = new Set<string>();
    const details = errors
      .array()
      .map((e) => ({
        field: e.type === 'field' ? String(e.path) : undefined,
        msg: String(e.msg),
      }))
      .filter((detail) => {
        const key = detail.field ?? detail.msg;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    res.status(400).json({
      message: details
        .map((detail) => describe(detail.field, detail.msg))
        .join(' '),
      code: 'VALIDATION_FAILED',
      errors: details,
    });
    return;
  }

  next();
};
