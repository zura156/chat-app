import dotenv from 'dotenv';
dotenv.config();

export default {
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service',
  cookieSecret: process.env.COOKIE_SECRET ?? 'cookie_secret_key',
  cookieDomain: process.env.COOKIE_DOMAIN ?? 'localhost',
  sessionSecret: process.env.SESSION_SECRET ?? 'session_secret_key',
  jwtSecret: process.env.JWT_SECRET ?? 'jwt_secret_key',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'jwt_refresh_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  jwtRefreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:4200',
  nodeEnv: process.env.NODE_ENV || 'development',
  trustedProxies: process.env.TRUSTED_PROXIES?.split(',') || [],
  s3Url: process.env.MINIO_URL || '',
  s3AccessKey: process.env.MINIO_ACCESS_KEY || '',
  s3SecretKey: process.env.MINIO_SECRET_KEY || '',
  s3PermanentBucket: process.env.MINIO_PERMANENT_BUCKET || '',
  s3QuarantineBucket: process.env.MINIO_QUARANTINE_BUCKET || '',
  s3StagingBucket: process.env.MINIO_STAGING_BUCKET || '',
};
