import express from "express";
import { register, login } from "../controllers/auth.controller.js";
import { validate } from "../middleware/validate.js";
import { registerSchema, loginSchema } from "../validators/auth.schemas.js";

const router = express.Router();

router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);

export default router;
