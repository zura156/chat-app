import express from 'express';
import { AuthController } from '../controllers/auth.controller';

export const authRouter = express.Router();

authRouter.post('/register', AuthController.register);
authRouter.post('/login', AuthController.login);
authRouter.post('/logout', AuthController.logout);
authRouter.post('/reset-password', AuthController.resetPassword);
authRouter.post('/set-new-password', AuthController.setNewPassword);
