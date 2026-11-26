import config from '../config/config';

/**
 * Whether a client-supplied URL points at media this server stored in the
 * public bucket (SECURITY-FIXES.md 2.5, L6). A stored URL is rendered by every
 * viewer, so anything else either makes their browsers fetch from a host the
 * sender chose, or shows a temp-bucket file that was never scanned.
 *
 * It accepts the form the image handler builds, `${s3Url}/${bucket}/${key}`,
 * and only as a string a URL parser reads the way it is stored:
 * - the parsed URL must serialize back to the same string. The parser rewrites
 *   backslashes, strips tabs and newlines, resolves `..` and `%2e%2e`, and
 *   lower-cases the host, so each of those would store one URL and fetch
 *   another;
 * - no query or fragment, checked on the raw string, because a bare `?` or
 *   `#` parses to an empty `search` or `hash`;
 * - no percent-encoding at all. `..%2f` is one segment to the parser, so it
 *   survives the round trip, and whether storage decodes it into a separator
 *   is unknown. The image handler's keys (context, user id, upload id, variant
 *   name) never contain a `%`.
 *
 * The origin check is implied by the prefix once the string is canonical (a
 * mutant without it fails no row); it stays as the plain statement of intent.
 *
 * The relative-path branch is gone: `startsWith('/')` also matched
 * `//evil.example/x.png`, which a browser loads from evil.example.
 */
export const isOwnMediaUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;

  const { s3Url, s3PublicBucket } = config;
  // Unset, nothing can be ours. Building the prefix anyway would make it `/`
  // or `//`, which the relative-path branch showed is too loose.
  if (!s3Url || !s3PublicBucket) return false;

  let url: URL;
  let base: URL;
  try {
    url = new URL(value);
    base = new URL(s3Url);
  } catch {
    return false;
  }

  const prefix = `${s3Url}/${s3PublicBucket}/`;
  return (
    url.href === value &&
    url.origin === base.origin &&
    !/[?#%]/.test(value) &&
    value.startsWith(prefix) &&
    value.length > prefix.length
  );
};
