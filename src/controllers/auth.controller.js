import bcrypt from "bcrypt";
import pool from "../config/db.js";
import { signToken } from "../utils/jwt.js";

const SALT_ROUNDS = 10;

export async function register(req, res) {
    // No manual "is this present/valid" check needed here — the
    // validate(registerSchema) middleware already rejected anything
    // malformed before this handler ever ran, so req.body is guaranteed
    // to have a well-formed email and an 8+ character password.
    const { email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    try {
        // $1, $2 are parameterized placeholders — pg substitutes them safely
        // server-side instead of us string-concatenating values into the
        // query. This is what prevents SQL injection; never build a query
        // with template literals when user input is involved.
        //
        // RETURNING id, email, created_at hands back the row Postgres just
        // built (including values we didn't provide, like the auto-generated
        // id and the now() default) in the same round trip — no separate
        // SELECT needed after the INSERT.
        const result = await pool.query(
            `INSERT INTO users (email, password_hash)
             VALUES ($1, $2)
             RETURNING id, email, created_at`,
            [email, passwordHash]
        );

        const user = result.rows[0];
        const token = signToken(user);
        return res.status(201).json({ user, token });
    } catch (err) {
        // Postgres error code 23505 = unique_violation. We hit this because
        // users.email has a UNIQUE constraint — rather than doing a SELECT
        // to check "does this email exist" before every insert (an extra
        // round trip, and still technically racy if two requests land at
        // once), we just try the insert and let Postgres enforce uniqueness,
        // then translate its error code into a clean 409 response.
        if (err.code === "23505") {
            return res.status(409).json({ error: "Email already registered" });
        }
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
}

export async function login(req, res) {
    const { email, password } = req.body;
    const result = await pool.query(
        `SELECT id, email, password_hash FROM users WHERE email = $1`,
        [email]
    );
    const user = result.rows[0];

    // Same error for "no such user" and "wrong password" on purpose — this
    // avoids leaking whether a given email is registered.
    if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user);
    return res.json({
        user: { id: user.id, email: user.email },
        token,
    });
}
