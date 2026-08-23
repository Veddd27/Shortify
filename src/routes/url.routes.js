import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createUrlSchema, updateUrlSchema } from "../validators/url.schemas.js";
import { createUrl, listUrls, updateUrl, deleteUrl } from "../controllers/url.controller.js";

const router = express.Router();

// All routes here require a logged-in user — requireAuth runs first and
// populates req.userId, or short-circuits with a 401 before these handlers
// ever run.
router.use(requireAuth);

router.post("/", validate(createUrlSchema), createUrl);
router.get("/", listUrls);
router.patch("/:id", validate(updateUrlSchema), updateUrl);
router.delete("/:id", deleteUrl);

export default router;
