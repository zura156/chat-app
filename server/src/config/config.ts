import dotenv from 'dotenv';
dotenv.config();

export default {
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service',
  cookieSecret:
    process.env.COOKIE_SECRET ||
    (() => {
      if (process.env.NODE_ENV === 'production')
        throw new Error('COOKIE_SECRET not set');
      return 'dev_secret';
    })(),
  // Defaulting this to 'localhost' in production is not a degraded mode, it is
  // an outage: the CSRF cookie is set with a domain, the browser silently drops
  // one scoped to a host it is not on, and every mutating request then 403s
  // with nothing in the logs to say why. Fail at boot like the secrets do.
  cookieDomain:
    process.env.COOKIE_DOMAIN ||
    (() => {
      if (process.env.NODE_ENV === 'production')
        throw new Error('COOKIE_DOMAIN not set');
      return 'localhost';
    })(),
  sessionSecret:
    process.env.SESSION_SECRET ||
    (() => {
      if (process.env.NODE_ENV === 'production')
        throw new Error('SESSION_SECRET not set');
      return 'dev_secret';
    })(),
  jwtSecret:
    process.env.JWT_SECRET ||
    (() => {
      if (process.env.NODE_ENV === 'production')
        throw new Error('JWT_SECRET not set');
      return 'dev_secret';
    })(),
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET ||
    (() => {
      if (process.env.NODE_ENV === 'production')
        throw new Error('JWT_REFRESH_SECRET not set');
      return 'dev_secret';
    })(),
  // The label authenticator apps show next to the code. Purely cosmetic, but
  // it is what users read when picking between accounts, so it belongs in
  // config rather than hardcoded at the call site.
  twoFactorIssuer: process.env.TWO_FACTOR_ISSUER ?? 'chat-app',
  /*
   * Whether an unverified address is blocked from the messaging surface.
   *
   * Off by default, deliberately. The verification flow shipped long before
   * anything read its result, so every account that already exists has
   * `is_email_verified: false` — turning the gate on unconditionally locks out
   * the entire existing user base at once, which is what happened when it was
   * first enforced.
   *
   * To enable it safely: run `npm run backfill:verified` to grandfather
   * accounts that predate enforcement, then set REQUIRE_EMAIL_VERIFICATION=true.
   * New registrations are gated from that point on.
   */
  requireEmailVerification:
    process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  /*
   * Whether a new password is checked against Have I Been Pwned.
   *
   * NIST SP 800-63B rev. 4 §3.1.1.2 SHALL-requires that prospective passwords
   * be compared against known *compromised* ones — "passwords obtained from
   * previous breach corpuses" is named explicitly — and no bundled list can do
   * that. OWASP ASVS 5.0 6.2.12 asks for the same thing. So this is on by
   * default: shipping it off would mean the default deployment does not meet
   * the requirement the rest of the policy module is built around.
   *
   * Set CHECK_BREACHED_PASSWORDS=false to disable it — worth doing only where
   * outbound HTTPS is unavailable by policy, and knowing that the local checks
   * cannot cover the compromised half on their own.
   *
   * The password itself never leaves the server: only the first five characters
   * of its SHA-1 digest are sent. The check fails open, and trips a breaker
   * after repeated failures so an unreachable HIBP costs one timeout rather
   * than one per registration. See breached-password.service.
   */
  checkBreachedPasswords: process.env.CHECK_BREACHED_PASSWORDS !== 'false',
  /*
   * bcrypt work factor. 10 is the default everywhere it is not set, and that is
   * the number that matters — it is what protects a stolen password table, so
   * lowering it in any deployed environment is a real weakening.
   *
   * It is configurable only so the test setup can drop it. Every integration
   * fixture creates users, each costing a full hash (~68ms at 10 on a dev
   * machine, ~2ms at 4), which is several seconds of a run spent proving bcrypt
   * still works rather than testing anything. Guarded below so a typo cannot
   * silently weaken production.
   */
  bcryptRounds: (() => {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
    if (Number.isNaN(rounds) || rounds < 4 || rounds > 15) return 10;
    if (rounds < 10 && process.env.NODE_ENV === 'production') return 10;
    return rounds;
  })(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  jwtRefreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:4200',
  nodeEnv: process.env.NODE_ENV || 'development',
  trustedProxies: process.env.TRUSTED_PROXIES?.split(',') || [],
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '4', 10),
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  s3Url: process.env.S3_ENDPOINT || '',
  s3PublicBucket: process.env.S3_BUCKET_PUBLIC || '',
  s3PrivateBucket: process.env.S3_BUCKET_PRIVATE || '',
  s3QuarantineBucket: process.env.S3_BUCKET_QUARANTINE || '',
  s3TempBucket: process.env.S3_BUCKET_TEMP || '',
  s3AccessKey: process.env.S3_APP_ACCESS || '',
  s3SecretKey: process.env.S3_APP_SECRET || '',
  s3QuarantineAccessKey: process.env.S3_QUARANTINE_ACCESS || '',
  s3QuarantineSecretKey: process.env.S3_QUARANTINE_SECRET || '',
  clamavHost: process.env.CLAMAV_HOST || 'localhost',
  clamavPort: parseInt(process.env.CLAMAV_PORT || '3310', 10),
};
