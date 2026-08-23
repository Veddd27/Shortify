// Stage 7: deliberately push past normal traffic to find the real
// capacity ceiling — different goal from redirect-test.js (Stage 4/5's
// script), which paced itself with sleep(0.1) specifically so latency
// comparisons stayed clean. This script has NO sleep: every VU fires
// requests back-to-back as fast as it can, which is what actually finds
// a throughput/capacity limit instead of measuring latency at a fixed rate.
//
// Requires the server running with DISABLE_RATE_LIMIT=true — otherwise
// Stage 6's rate limiter (correctly) throttles this long before we reach
// any real system limit, since every VU here shares one local IP.
//
// Run with: k6 run -e SHORT_CODE=<code> load-test/stress-test.js
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SHORT_CODE = __ENV.SHORT_CODE;

if (!SHORT_CODE) {
    throw new Error("Pass -e SHORT_CODE=<code> (run load-test/setup.js first to create one)");
}

export const options = {
    stages: [
        { duration: "15s", target: 100 },
        { duration: "30s", target: 500 },
        { duration: "30s", target: 1000 },
        { duration: "30s", target: 1500 },
        { duration: "15s", target: 0 },
    ],
};

export default function () {
    const res = http.get(`${BASE_URL}/${SHORT_CODE}`, { redirects: 0 });
    check(res, {
        "status is 302": (r) => r.status === 302,
    });
}
