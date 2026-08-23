import express from "express";
import authRoutes from "./routes/auth.routes.js";
import urlRoutes from "./routes/url.routes.js";
import { redirectToOriginal } from "./controllers/url.controller.js";
import { rateLimit } from "./middleware/rateLimit.js";

const app = express();

app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/urls", urlRoutes);

// Generous compared to the auth/create limiters on purpose — this is the
// public, high-volume path real traffic is expected to hit constantly.
// The limit here exists to blunt outright abuse/bot floods, not to
// throttle normal usage.
const redirectLimiter = rateLimit({
    windowSeconds: 60,
    max: 100,
    keyPrefix: "redirect",
    keyGenerator: (req) => req.ip,
});

// This sits at the root path (not under /api) because the whole point is
// that shared links look like https://shortify.app/aB92xK, not
// https://shortify.app/api/urls/aB92xK.
app.get("/:shortCode", redirectLimiter, redirectToOriginal);

export default app;
