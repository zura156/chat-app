import dotenv from 'dotenv';

dotenv.config();

export default {
  port: process.env.PORT || 3000,
  wsPort: process.env.WS_PORT || 3001,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/auth_service',
  jwtSecret: process.env.JWT_SECRET || 'jwt_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:4200',
  nodeEnv: process.env.NODE_ENV || 'development',
};
