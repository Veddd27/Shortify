import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createUrlSchema, updateUrlSchema } from "../validators/url.schemas.js";
import { createUrl, listUrls, updateUrl, deleteUrl } from "../controllers/url.controller.js";
import { getUrlAnalytics } from "../controllers/analytics.controller.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

// All routes here require a logged-in user — requireAuth runs first and
// populates req.userId, or short-circuits with a 401 before these handlers
// ever run.
router.use(requireAuth);

// Keyed by req.userId (not IP) — this only runs after requireAuth, so
// we know exactly which account is creating urls, and limiting per-user
// is what actually stops one account from scripting mass url creation
// (limiting by IP instead would also punish other people sharing that IP,
// e.g. on the same office network).
const createUrlLimiter = rateLimit({
    windowSeconds: 60,
    max: 20,
    keyPrefix: "create-url",
    keyGenerator: (req) => req.userId,
});

router.post("/", createUrlLimiter, validate(createUrlSchema), createUrl);
router.get("/", listUrls);
router.get("/:id/analytics", getUrlAnalytics);
router.patch("/:id", validate(updateUrlSchema), updateUrl);
router.delete("/:id", deleteUrl);

export default router;
