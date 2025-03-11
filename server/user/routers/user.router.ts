import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { getCurrentUser } from "../controllers/user.controller";

const router = Router();

router.get('/profile', authenticate, getCurrentUser);

export default router;
