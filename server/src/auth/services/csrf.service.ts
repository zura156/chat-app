import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export const csrfTokens = new Map();

export const generateCSRFToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};
