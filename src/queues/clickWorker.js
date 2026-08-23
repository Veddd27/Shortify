import { Worker } from "bullmq";
import pool from "../config/db.js";
import { parseUserAgent } from "../utils/userAgent.js";

const connection = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    maxRetriesPerRequest: null,
};

// The Worker is what actually does the work a job describes. It watches
// the "click-tracking" queue and, whenever a job appears, runs this
// function with that job's data. Both the user-agent parsing AND the
// Postgres INSERT — the two things Stage 7 identified as real CPU/time
// cost on the redirect's critical path — now happen entirely here,
// removed completely from the request that triggered them.
export const clickWorker = new Worker(
    "click-tracking",
    async (job) => {
        const { urlId, referrer, userAgent, ip } = job.data;
        const { browser, os, deviceType } = parseUserAgent(userAgent);

        await pool.query(
            `INSERT INTO clicks (url_id, referrer, user_agent, browser, os, device_type, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [urlId, referrer, userAgent, browser, os, deviceType, ip]
        );
    },
    { connection }
);

clickWorker.on("failed", (job, err) => {
    // A failed click-tracking job should never have been able to affect
    // the person who clicked the link — by the time this runs, their
    // redirect already happened. We just log it so it's visible, same
    // spirit as the try/catch that used to sit around this same INSERT
    // directly in the redirect handler.
    console.error(`Click tracking job ${job?.id} failed:`, err.message);
});
