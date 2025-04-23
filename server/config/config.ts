import dotenv from 'dotenv';
dotenv.config();

export default {
  port: parseInt(process.env.PORT || '3000', 10),
  wsPort: parseInt(process.env.WS_PORT || '3001', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service',
  jwtSecret: process.env.JWT_SECRET ?? 'jwt_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  jwtRefreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:4200',
  nodeEnv: process.env.NODE_ENV || 'development',
};
