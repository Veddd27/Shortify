import express from "express";
import authRoutes from "./routes/auth.routes.js";
import urlRoutes from "./routes/url.routes.js";
import { redirectToOriginal } from "./controllers/url.controller.js";

const app = express();

app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/urls", urlRoutes);

// This sits at the root path (not under /api) because the whole point is
// that shared links look like https://shortify.app/aB92xK, not
// https://shortify.app/api/urls/aB92xK.
app.get("/:shortCode", redirectToOriginal);

export default app;
