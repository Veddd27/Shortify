import { Queue } from "bullmq";

// BullMQ manages its own Redis connections internally, using blocking
// commands under the hood — this specifically requires
// maxRetriesPerRequest: null on the connection it's given, which
// conflicts with the shared client in config/redis.js (that one is
// deliberately tuned to fail FAST — maxRetriesPerRequest: 1,
// enableOfflineQueue: false — for the cache's fallback-to-Postgres
// behavior). A job queue wants the opposite: keep retrying, don't give up
// on a job just because Redis blinked. So this gets its own separate
// connection config rather than reusing the shared client.
const connection = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    maxRetriesPerRequest: null,
};

// One Queue object represents one named list of jobs in Redis
// ("click-tracking") — creating it doesn't process anything itself, it's
// just the handle we call .add() on from the redirect handler. The actual
// processing happens in a separate Worker (clickWorker.js), which can run
// in this same process or, as we're doing here, as its own OS process
// entirely (src/worker.js) — meaning the Postgres INSERT and user-agent
// parsing genuinely run on a different process (and potentially a
// different CPU core) than the one answering the redirect.
export const clickQueue = new Queue("click-tracking", { connection });
