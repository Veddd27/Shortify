import Redis from "ioredis";

// One shared connection, same idea as the Postgres Pool from Stage 1 —
// created once when this module first loads, reused by every request
// after that. Unlike Postgres, we don't need a *pool* of several
// connections here: Redis is single-threaded and processes commands one
// at a time internally regardless of how many clients are connected, so
// one connection handling many concurrent commands (each request just
// waits its turn in Redis's own queue, which is extremely fast) works
// fine without the "requests block each other" problem a single Postgres
// connection would have had.
const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    // maxRetriesPerRequest alone wasn't enough — measured live, a command
    // issued while disconnected still WAITS for the client's next
    // reconnect attempt (on its own backoff schedule) before that retry
    // limit even gets evaluated, which cost several seconds per command.
    // enableOfflineQueue: false is the fix that actually matters: when the
    // client isn't currently connected, a command rejects IMMEDIATELY
    // instead of queuing and hoping reconnection happens soon. That's what
    // makes urlCache.js's try/catch fallback trigger fast instead of a
    // redirect silently hanging for seconds.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
});

// ioredis retries a dropped connection in the background on its own; this
// listener just makes a Redis outage visible in the logs instead of
// silent. It does NOT crash the app — every place we actually use Redis
// (src/utils/urlCache.js) wraps each call in its own try/catch and falls
// back to Postgres, so an error here is informational, not fatal.
redis.on("error", (err) => {
    console.error("Redis connection error:", err.message);
});

export default redis;
