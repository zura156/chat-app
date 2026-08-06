/**
 * The mail carrying a one-time code for the email second factor.
 *
 * Two things it deliberately does not contain: a link, and anything that
 * identifies the account beyond the address it was sent to. A code that arrives
 * with a "click here to sign in" button trains users to click exactly what a
 * phishing mail wants them to click, and this mail is sent to people in the
 * middle of a sign-in — the moment they are least likely to look twice.
 *
 * The code is shown as text rather than an image so it survives forwarding,
 * screen readers and the plaintext part clients generate from this.
 */
export const getTwoFactorCodeEmailHTML = (
  code: string,
  minutesValid: number,
  context: 'login' | 'enroll',
) => {
  const heading =
    context === 'login' ? 'Your sign-in code' : 'Confirm this email for sign-in';

  const explanation =
    context === 'login'
      ? 'Enter this code to finish signing in.'
      : 'Enter this code to start using email as your second factor.';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">

          <tr>
            <td style="background-color: #000000; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">${heading}</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 25px; color: #666; line-height: 1.6;">
                ${explanation}
              </p>

              <div style="margin: 0 0 25px; padding: 20px; background-color: #f4f4f4; border-radius: 8px; text-align: center;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #111;">${code}</span>
              </div>

              <p style="margin: 0 0 15px; color: #666; line-height: 1.6;">
                It expires in ${minutesValid} minutes and can only be used once.
              </p>

              <p style="margin: 0; color: #666; line-height: 1.6;">
                If you did not ask for this, someone may know your password.
                Change it, and do not share this code with anyone — nobody from
                Chat App will ever ask you for it.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color: #fafafa; padding: 20px 30px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                This is an automated message, please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
