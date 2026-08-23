import redis from "../config/redis.js";

// A safety-net TTL, not the primary way stale data gets fixed — see
// invalidateCachedUrl below, which is what actually keeps the cache
// correct when a url changes. This just bounds the worst case if an
// invalidation were ever somehow missed.
const TTL_SECONDS = 300;

const keyFor = (shortCode) => `url:${shortCode}`;

export async function getCachedUrl(shortCode) {
    try {
        const cached = await redis.get(keyFor(shortCode));
        return cached ? JSON.parse(cached) : null;
    } catch (err) {
        // Redis being down should never break a redirect — treat any
        // failure here exactly like a cache miss and let the caller fall
        // back to querying Postgres directly.
        console.error("Redis GET failed, falling back to Postgres:", err.message);
        return null;
    }
}

export async function setCachedUrl(shortCode, urlData) {
    try {
        await redis.set(keyFor(shortCode), JSON.stringify(urlData), "EX", TTL_SECONDS);
    } catch (err) {
        // Failing to populate the cache isn't fatal either — the next
        // request for this short code just falls back to Postgres again,
        // same as this one did.
        console.error("Redis SET failed:", err.message);
    }
}

export async function invalidateCachedUrl(shortCode) {
    try {
        await redis.del(keyFor(shortCode));
    } catch (err) {
        console.error("Redis DEL failed:", err.message);
    }
}
