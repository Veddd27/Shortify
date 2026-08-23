import redis from "../config/redis.js";

// Same "fixed window counter" idea as the coffee-shop tally sheet: each
// caller gets a Redis key that counts their requests, and that key expires
// on its own after windowSeconds — Redis throwing away the old sheet for
// us, no cleanup code needed.
//
// options:
//   windowSeconds — how long one "sheet" lasts before resetting
//   max           — how many requests are allowed per sheet
//   keyPrefix     — a short name so different limiters don't collide
//                   in Redis (e.g. "auth" vs "create-url")
//   keyGenerator  — (req) => string identifying WHO is being limited
//                   (an IP address, or a logged-in user's id)
export function rateLimit({ windowSeconds, max, keyPrefix, keyGenerator }) {
    return async (req, res, next) => {
        const key = `ratelimit:${keyPrefix}:${keyGenerator(req)}`;

        let count;
        try {
            // INCR both creates the key at 1 if it doesn't exist yet, and
            // atomically adds 1 if it does — Redis guarantees no two
            // simultaneous INCRs on the same key ever produce the same
            // result, even under real concurrent traffic.
            count = await redis.incr(key);

            if (count === 1) {
                // This is the very first request in a fresh window (INCR
                // just created the key) — start its one-hour... er, windowSeconds
                // countdown now. Note: INCR and EXPIRE are two separate
                // commands, not one atomic operation — there's a narrow
                // theoretical gap where a crash between them could leave a
                // key with no expiry. Acceptable for this project; a
                // production system would use a single Lua script to make
                // both happen atomically.
                await redis.expire(key, windowSeconds);
            }
        } catch (err) {
            // Fail OPEN: if Redis itself is unreachable, let the request
            // through rather than block all traffic because the
            // protection mechanism failed. An outage caused by our own
            // rate limiter breaking is worse than briefly having none.
            console.error(`Rate limiter Redis error (${keyPrefix}), failing open:`, err.message);
            return next();
        }

        if (count > max) {
            // TTL tells the client roughly how many seconds until their
            // window resets — real HTTP semantics, not a guess.
            const ttl = await redis.ttl(key).catch(() => windowSeconds);
            res.set("Retry-After", String(ttl > 0 ? ttl : windowSeconds));
            return res.status(429).json({ error: "Too many requests, please try again later" });
        }

        next();
    };
}
