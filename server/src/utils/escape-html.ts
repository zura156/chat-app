/*
 * Escaping for values interpolated into the HTML mails.
 *
 * The templates are built with template literals, so every `${}` is a raw
 * splice. Most of what goes into them is server-generated — URLs, timestamps,
 * a six-digit code — but three values are not: the username, the address a
 * user is moving to, and the `User-Agent` header echoed back as the device
 * name in the security receipts.
 *
 * The User-Agent one is the sharp edge. It is attacker-controlled with no
 * validation anywhere in its path, and the mail it lands in is a security
 * notice sent to the *victim* — the one mail whose contents the recipient has
 * every reason to trust and act on. An attacker who can trigger a
 * password-change receipt can splice their own markup into it: a link, a
 * phone number to call, a "if this wasn't you, click here" that goes
 * somewhere else. Mail clients strip <script>, so this is not XSS in the
 * browser sense; it is content injection into a trusted channel, which for a
 * phishing payload is the more useful of the two.
 *
 * Escaping the five characters that can leave a text or attribute context is
 * enough — none of these values is ever meant to carry markup.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a value for interpolation into HTML text or a quoted attribute.
 *
 * `&` is replaced first by virtue of being in the same pass — a sequential
 * chain of replaces would double-encode the entities it just introduced.
 */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
