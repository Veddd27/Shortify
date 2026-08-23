// k6 script targeting GET /:shortCode — the redirect endpoint, the one
// path in this app whose traffic scales with clicks rather than users.
// Run with: k6 run -e SHORT_CODE=<code> load-test/redirect-test.js
// (get a SHORT_CODE by running load-test/setup.js first)
//
// Note: k6 scripts run inside k6's own JS runtime (goja), not Node — no
// npm packages, no require(), most Node globals don't exist. `http` and
// `check` below are k6's own built-in modules, imported with the special
// "k6/..." scheme that only means something inside a k6 run.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SHORT_CODE = __ENV.SHORT_CODE;

if (!SHORT_CODE) {
    throw new Error("Pass -e SHORT_CODE=<code> (run load-test/setup.js first to create one)");
}

// `stages` ramps virtual users (VUs) up in steps instead of jumping
// straight to peak load. Each VU is one simulated user that loops through
// the default() function below, continuously, for as long as its stage
// lasts. Ramping (not an instant jump to 200) mirrors how real traffic
// actually arrives, and lets us see AT WHICH concurrency level things
// start degrading — not just whether it survives at max load.
export const options = {
    stages: [
        { duration: "10s", target: 10 },
        { duration: "20s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "20s", target: 200 },
        { duration: "10s", target: 0 },
    ],
};

export default function () {
    // redirects: 0 tells k6 not to follow the 302 to example.com — we're
    // measuring OUR server's redirect response itself, not the (fake)
    // destination site.
    const res = http.get(`${BASE_URL}/${SHORT_CODE}`, { redirects: 0 });
    check(res, {
        "status is 302": (r) => r.status === 302,
    });
    sleep(0.1);
}
