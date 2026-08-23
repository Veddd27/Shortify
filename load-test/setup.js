// Creates one fresh user + one active url to point the load test at.
// Plain Node script (not k6) — run with: node load-test/setup.js
// Uses Node's built-in fetch (no extra HTTP library needed for a one-off
// setup script like this).

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function main() {
    const email = `loadtest_${Date.now()}@shortify.local`;
    const password = "loadtest12345";

    const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const { token } = await registerRes.json();

    const urlRes = await fetch(`${BASE_URL}/api/urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ originalUrl: "https://example.com/load-test-target" }),
    });
    const url = await urlRes.json();

    console.log(`Created test url: ${url.shortUrl}`);
    console.log(`\nRun the load test against it with:`);
    console.log(`  k6 run -e SHORT_CODE=${url.short_code} load-test/redirect-test.js`);
}

main();
