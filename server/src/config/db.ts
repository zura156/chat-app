import mongoose from 'mongoose';
import config from './config';
import { logger } from '../utils/logger';

const DRIVER_DEFAULT_DB = 'test';

export const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(config.mongoUri, {
    // The name is logged because the failure it guards against was invisible:
    // "MongoDB connected" is equally true of the right database and the wrong one.
      // Only override the URI's own path when something actually set the name;
      // passing `dbName: undefined` is fine, passing it blindly is not.
      ...(config.mongoDbName ? { dbName: config.mongoDbName } : {}),
    });

    const dbName = mongoose.connection.name;

    if (dbName === DRIVER_DEFAULT_DB) {
      throw new Error(
        `Refusing to run against the database named "${DRIVER_DEFAULT_DB}" — ` +
          'that is the driver default for a connection string with no database ' +
          'in it, not a deliberate choice. Set MONGO_DB_NAME (chat_app in ' +
          'production, chat_app_dev locally), or add the name to MONGO_URI ' +
          'between the host and the "?".',
      );
    }

    logger.info(`MongoDB connected (database: ${dbName})`);
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};
