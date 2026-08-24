// A follow-up to stress-test.js, pushing well past the ~1,500 VU ceiling
// that found Node's single CPU core as the bottleneck. The expectation
// going in is that this will NOT beat that ~2,300 req/s throughput number
// (the process is already maxed on the one core it uses) — what's
// actually being investigated here is HOW it fails past that point:
// graceful latency degradation, or real errors (timeouts, connection
// resets)? Requires DISABLE_RATE_LIMIT=true, same as stress-test.js.
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SHORT_CODE = __ENV.SHORT_CODE;

if (!SHORT_CODE) {
    throw new Error("Pass -e SHORT_CODE=<code> (run load-test/setup.js first)");
}

export const options = {
    stages: [
        { duration: "20s", target: 1000 },
        { duration: "30s", target: 3000 },
        { duration: "30s", target: 5000 },
        { duration: "30s", target: 5000 },
        { duration: "20s", target: 0 },
    ],
};

export default function () {
    const res = http.get(`${BASE_URL}/${SHORT_CODE}`, { redirects: 0 });
    check(res, {
        "status is 302": (r) => r.status === 302,
    });
}
