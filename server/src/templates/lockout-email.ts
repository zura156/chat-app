export const getLockoutEmailHTML = (
  unlockLink: string,
  passwordResetLink: string,
) => `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: -apple-system, sans-serif; background-color: #f0f2f5; color: #1c1e21; margin: 0; padding: 0; }
            .container { max-width: 500px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 15px rgba(0,0,0,0.1); }
            .header { background-color: #0084ff; color: #ffffff; padding: 25px; text-align: center; }
            .content { padding: 30px; line-height: 1.6; }
            .button { background-color: #0084ff; color: #ffffff; padding: 14px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; margin: 20px 0; }
            .link { color: #0084ff; text-decoration: underline; }
            .footer { padding: 20px; text-align: center; font-size: 13px; color: #65676b; background: #f0f2f5; }
            .app-name { font-weight: bold; color: #0084ff; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin:0; font-size: 24px;">ChatApp</h1>
            </div>
            <div class="content">
                <p>Hi there,</p>
                <p>For your security, your <span class="app-name">ChatApp</span> account has been temporarily locked due to multiple unsuccessful login attempts.</p>
                
                <div style="text-align: center;">
                        <a href="${unlockLink}" class="button" style="color: white;">Unlock My Account</a>
                    </div>
    
                <p style="font-size: 14px; color: #65676b;">
                    If this wasn't you, someone might be trying to access your account. You don't need to do anything; the lock will expire automatically, and your messages remain secure.
                </p>
                <p>
                    It's highly recommended that you change the password once you regain access,
                    or change it <a href="${passwordResetLink}" class="link">here</a>.
                </p>

            </div>
            <div class="footer">
                <strong>ChatApp</strong> by zura156 <br>
                Helping you stay connected.
            </div>
        </div>
    </body>
    </html>
`;
