import { escapeHtml } from '../utils/escape-html';

/**
 * Sent to the address a user is trying to move *to*.
 *
 * The account is not changed until this link is clicked, which is what stops a
 * typo from moving an account to an inbox its owner cannot reach.
 */
export const getEmailChangeEmailHTML = (
  rawUsername: string,
  rawNewEmail: string,
  confirmUrl: string,
) => {
  // Both are user-supplied and neither is ever meant to carry markup.
  const username = escapeHtml(rawUsername);
  const newEmail = escapeHtml(rawNewEmail);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your new email address</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color: #000000; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Confirm your email</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #333; font-size: 20px;">Hi ${username},</h2>

              <p style="margin: 0 0 15px; color: #666; line-height: 1.6;">
                You asked to change the email address on your account to
                <strong style="color: #333;">${newEmail}</strong>.
              </p>

              <p style="margin: 0 0 30px; color: #666; line-height: 1.6;">
                Click below to confirm. Until you do, your address stays as it
                is. The link expires in 1 hour, and confirming will sign you out
                on every device.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 10px 5px;">
                    <a href="${confirmUrl}" style="display: block; background-color: rgb(0,0,150); color: #ffffff; text-align: center; padding: 15px; text-decoration: none; border-radius: 5px; font-weight: bold;">Confirm This Address</a>
                  </td>
                </tr>
              </table>

              <p style="margin: 25px 0 0; color: #999; font-size: 13px; line-height: 1.6;">
                If you didn't ask for this, you can ignore this email — nothing
                will change.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 20px 30px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                This is an automated message.
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
