import { verifyToken } from "../utils/jwt.js";

// Protects routes that require a logged-in user. Expects:
//   Authorization: Bearer <token>
export function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or malformed Authorization header" });
    }

    const token = header.slice("Bearer ".length);
    try {
        const payload = verifyToken(token);
        req.userId = payload.userId;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}
