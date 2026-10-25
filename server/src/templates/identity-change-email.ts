import { escapeHtml } from '../utils/escape-html';

/**
 * Sent when a Google or GitHub account is connected to, or disconnected from,
 * an account here.
 *
 * Connecting is the one that matters. A sign-in through a provider whose
 * verified address matches an existing account is linked automatically, which
 * is also exactly what a takeover through a compromised provider account would
 * look like — and once linked, that provider is a standing way in that no
 * password change revokes. This mail is the owner's only chance to notice, so
 * like the password-changed receipt it names the device and offers a way back.
 */
export const getIdentityChangeEmailHTML = (
  rawUsername: string,
  rawProvider: string,
  change: 'connected' | 'disconnected',
  rawTimestamp: string,
  rawIpAddress: string,
  rawMachineName: string,
  resetPasswordUrl: string,
) => {
  // `machineName` is the caller's User-Agent, unvalidated — see the note in
  // password-changed-email.ts on why everything here is escaped.
  const username = escapeHtml(rawUsername);
  const provider = escapeHtml(rawProvider);
  const timestamp = escapeHtml(rawTimestamp);
  const ipAddress = escapeHtml(rawIpAddress);
  const machineName = escapeHtml(rawMachineName);

  const title =
    change === 'connected'
      ? `${provider} was connected to your account`
      : `${provider} was disconnected from your account`;

  const consequence =
    change === 'connected'
      ? `Anyone signed in to that ${provider} account can now sign in here without your password.`
      : `It can no longer be used to sign in here.`;

  const advice =
    change === 'connected'
      ? `If this wasn't you, reset your password now and disconnect ${provider} under Settings → Security.`
      : `If this wasn't you, someone else has access to your account — reset your password now.`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color: #000000; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Sign-in method ${change}</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #333; font-size: 20px;">Hi ${username},</h2>

              <p style="margin: 0 0 15px; color: #666; line-height: 1.6;">
                ${title}. ${consequence}
              </p>

              <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>Time:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${timestamp}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>IP Address:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${ipAddress}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>Device:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${machineName}</td>
                </tr>
              </table>

              <p style="margin: 20px 0 30px; color: #666; line-height: 1.6;">
                If this was you, nothing more is needed. ${advice} The link below
                expires in 1 hour.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 10px 5px;">
                    <a href="${resetPasswordUrl}" style="display: block; background-color: red; color: #ffffff; text-align: center; padding: 15px; text-decoration: none; border-radius: 5px; font-weight: bold;">This Wasn't Me</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 20px 30px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                This is an automated security notification.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
};
