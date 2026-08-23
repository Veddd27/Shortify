import "dotenv/config";
import { clickWorker } from "./queues/clickWorker.js";

console.log("Click-tracking worker started, listening for jobs...");

// A graceful-shutdown hook: when this process is asked to stop (e.g. pm2
// restarting it, or the OS shutting down), finish whatever job is
// currently running rather than dropping it mid-write.
process.on("SIGTERM", async () => {
    await clickWorker.close();
    process.exit(0);
});
