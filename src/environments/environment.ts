export const environment = {
  production: true,
  apiUrl: 'https://api-chat-app.zura156.xyz',
  wsUrl: 'wss://api-chat-app.zura156.xyz',
  recaptchaSiteKey: '6LczclssAAAAALw8rGYCj6RRYCOrcZ8XIDy7X_tm',
  s3Url: 'https://s3.zura156.xyz',

  /*
   * Help & Support details.
   *
   * Empty means "not set up", and the corresponding row is not rendered. The
   * support screen previously hardcoded support@yourapp.com, a "Live chat"
   * card linking to `#`, and version 1.0.0 — all three were placeholders, and
   * the first one is the kind that gets mailed into a void by real users.
   * Fill these in and they appear; leave them blank and nothing claims to
   * exist that doesn't.
   *
   * The terms and privacy policy are pages in the app now (/legal), so they
   * no longer have URLs here. `supportEmail` doubles as the contact address
   * those pages print, unless features/legal/legal.config.ts overrides it.
   */
  supportEmail: 'zuragagnidze69@gmail.com',
  appVersion: '0.0.0',
};
