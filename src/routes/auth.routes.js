import express from "express";
import { register, login } from "../controllers/auth.controller.js";
import { validate } from "../middleware/validate.js";
import { registerSchema, loginSchema } from "../validators/auth.schemas.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

// One shared budget for both register and login, per IP — an attacker
// trying either endpoint repeatedly (credential stuffing, brute-forcing
// passwords) should be throttled the same way regardless of which one
// they're hammering. Not behind requireAuth (you're not logged in yet
// when hitting these), so IP is the only identity we have to key on.
const authLimiter = rateLimit({
    windowSeconds: 60,
    max: 5,
    keyPrefix: "auth",
    keyGenerator: (req) => req.ip,
});

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);

export default router;
