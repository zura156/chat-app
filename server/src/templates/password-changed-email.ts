import { escapeHtml } from '../utils/escape-html';

/**
 * Sent after a successful in-app password change.
 *
 * A change made with the current password is almost always the account owner,
 * so this is a receipt rather than an alarm — but it is also the only signal
 * reaching the real owner if it was not them, which is why it names the device
 * and offers a recovery route.
 */
export const getPasswordChangedEmailHTML = (
  rawUsername: string,
  rawTimestamp: string,
  rawIpAddress: string,
  rawMachineName: string,
  resetPasswordUrl: string,
) => {
  /*
   * `machineName` is the caller's `User-Agent` header, unvalidated the whole
   * way here, and this mail goes to the account owner rather than to whoever
   * set that header — so anything spliced in is markup an attacker chose,
   * shown to the victim inside a security notice. See `escapeHtml`.
   */
  const username = escapeHtml(rawUsername);
  const timestamp = escapeHtml(rawTimestamp);
  const ipAddress = escapeHtml(rawIpAddress);
  const machineName = escapeHtml(rawMachineName);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your password was changed</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color: #000000; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Password changed</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #333; font-size: 20px;">Hi ${username},</h2>

              <p style="margin: 0 0 15px; color: #666; line-height: 1.6;">
                The password on your account was just changed. Every other device
                that was signed in has been signed out.
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
                If this was you, nothing more is needed. If it wasn't, reset your
                password now — the link below expires in 1 hour.
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
