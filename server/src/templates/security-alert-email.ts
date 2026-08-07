import { escapeHtml } from '../utils/escape-html';

export const getSecurityAlertEmailHTML = (
  passwordResetUrl: string,
  secureAccountUrl: string,
  rawTimestamp: string,
  rawIpAddress: string,
  rawLocation: string,
  // Accepted for call-site symmetry with the other security mails; this
  // template deliberately does not name the device.
  _machineName: string,
) => {
  const timestamp = escapeHtml(rawTimestamp);
  const ipAddress = escapeHtml(rawIpAddress);
  const location = escapeHtml(rawLocation);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suspicious Login Attempt</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background-color: #000000; padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Security Alert</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #333; font-size: 20px;">Suspicious Login Attempt Detected</h2>
              
              <p style="margin: 0 0 15px; color: #666; line-height: 1.6;">
                We detected multiple failed login attempts on your account from an unrecognized location.
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
                  <td style="padding: 8px 0; color: #666;"><strong>Location:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${location}</td>
                </tr>
              </table>
              
              <p style="margin: 20px 0 10px; color: #666; line-height: 1.6;">
                Your account has been locked for 30 minutes. If this was you, use the
                unlock link below to sign in again right away.
              </p>
              <p style="margin: 0 0 30px; color: #666; line-height: 1.6;">
                If it wasn't you, reset your password instead — both links expire in 1 hour.
              </p>

              <!-- Buttons -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 10px 5px;">
                    <a href="${secureAccountUrl}" style="display: block; background-color: rgb(0,0, 150); color: #ffffff; text-align: center; padding: 15px; text-decoration: none; border-radius: 5px; font-weight: bold;">Unlock My Account</a>
                  </td>
                  <td style="padding: 10px 5px;">
                    <a href="${passwordResetUrl}" style="display: block; background-color: red; color: #ffffff; text-align: center; padding: 15px; text-decoration: none; border-radius: 5px; font-weight: bold;">This Wasn't Me</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9f9f9; padding: 20px 30px; text-align: center; border-top: 1px solid #eee;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                If you didn't request this, please contact support immediately.
              </p>
              <p style="margin: 10px 0 0; color: #999; font-size: 12px;">
               <strong>ChatApp</strong> by zura156 <br>
                Helping you stay connected.
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
