# Stage 4 — Performance Baseline

**Date:** 2026-08-23
**Environment:** Local dev machine — Node app and Postgres running on the same laptop (not separate servers). Numbers below are only meant to be compared *against each other* (same machine, same conditions, one variable changed), not treated as production-representative absolute numbers.

**Tool:** [k6](https://k6.io/), scripted in [`load-test/redirect-test.js`](load-test/redirect-test.js). Ramping virtual users: 10 → 50 → 100 → 200 over ~80 seconds, hitting `GET /:shortCode` (the redirect endpoint) repeatedly with `sleep(0.1)` between iterations per virtual user.

**Setup:** [`load-test/setup.js`](load-test/setup.js) creates one fresh user + one active url via the real API, then the same short code was reused for both runs below.

## The experiment

Stage 3 added a synchronous `INSERT INTO clicks` on the redirect path — the app writes an analytics row and waits for it to finish *before* sending the redirect response. Instead of guessing whether that matters, we ran the identical k6 script twice against the identical endpoint, changing exactly one thing: the `DISABLE_CLICK_TRACKING` env flag (added specifically for this test — see `redirectToOriginal` in [url.controller.js](src/controllers/url.controller.js)).

## Results

| | Click tracking ON (current state) | Click tracking OFF | Difference |
|---|---|---|---|
| **p95 latency** | 5.76 ms | 2.04 ms | **−64.6%** |
| **avg latency** | 2.57 ms | 0.85 ms | **−66.9%** |
| **max latency** | 135.67 ms | 154.66 ms | (single outliers, not a trend) |
| **Throughput** | 744.5 req/s | 757.0 req/s | +1.7% (see caveat below) |
| **Error rate** | 0% (0 / 59,606) | 0% (0 / 60,617) | — |

**Throughput caveat, stated honestly**: this test script has `sleep(0.1)` in every iteration, meaning each virtual user's request rate is dominated by that fixed sleep, not by server response time — neither run came close to saturating the server's real capacity. The throughput numbers above are near-identical because of this test design, not because click tracking has no throughput cost. **The latency numbers are the real, meaningful signal here**; a proper throughput/capacity ceiling test belongs in Stage 7, without an artificial sleep, run against a deployed instance.

## What `EXPLAIN ANALYZE` showed

```sql
EXPLAIN ANALYZE SELECT id, original_url, is_active, expires_at FROM urls WHERE short_code = '1';
```
→ `Index Scan using urls_short_code_key`, **Execution Time: 0.073 ms**. Confirms the redirect lookup is doing exactly what we designed it to do back in Stage 1 — using the automatic unique index, not a full table scan.

```sql
EXPLAIN ANALYZE INSERT INTO clicks (...) VALUES (...);
```
→ **Execution Time: 13.769 ms** for a single isolated insert via `psql` (this number isn't directly comparable to the k6 numbers above — it's one uncontended insert outside the connection pool, run for the specific purpose of seeing the query plan, not a load-bearing benchmark). Notably: `Trigger for constraint clicks_url_id_fkey: time=2.022 calls=1` — part of that cost is Postgres actively re-verifying the foreign key against `urls` on every single insert.

## Interpretation

The `SELECT` that finds the url is effectively free (0.073ms) — Stage 1's indexing decisions are paying off exactly as intended. The cost Stage 3 introduced is real and now measured: writing a click record roughly **triples average redirect latency and more than doubles p95 latency** under concurrent load. At Shortify's realistic traffic this is not yet breaking anything (0% errors, sub-6ms p95 even with tracking on), but it's the honest, specific number behind why Stage 5 (caching) and Stage 10 (moving this write off the request path entirely) exist — not a hypothetical problem, a measured one.

## Reproducing this

```bash
node load-test/setup.js
k6 run -e SHORT_CODE=<code from setup output> load-test/redirect-test.js
```

To compare with tracking disabled, set `DISABLE_CLICK_TRACKING=true` in `.env`, restart the server, and re-run the same k6 command against the same short code.

---

# Stage 5 — Caching

**Date:** 2026-08-23
**What was built:** Redis cache-aside caching for the redirect lookup (`GET /:shortCode`), using `ioredis`. `updateUrl`/`deleteUrl` actively invalidate the relevant cache entry the moment the row changes (not relying on TTL alone — a disabled/updated url must stop resolving immediately, not up to 5 minutes later). A 5-minute TTL exists only as a safety net. Redis runs locally via Docker (`redis:7-alpine`).

## A real bug found and fixed along the way

The first version of the "graceful fallback if Redis is down" logic wasn't actually graceful — measured live, a redirect took **16.6 seconds** to respond while Redis was stopped, because `ioredis` by default queues commands and waits for a reconnect attempt before giving up, rather than failing fast. Adding `enableOfflineQueue: false` (see [config/redis.js](src/config/redis.js)) fixed this to a consistent **~100ms** fallback to Postgres — verified by stopping the Redis container mid-test and timing real requests before and after the fix.

## The performance result — genuinely surprising, reported honestly

| | Stage 4 baseline (no cache) | Stage 5 (cached) |
|---|---|---|
| p95, click tracking OFF | 2.04 ms | 11.51 ms (repeated: 11.14 ms) |
| p95, click tracking ON | 5.76 ms | 52.5 ms |
| Error rate | 0% | 0% |

**Caching made the redirect measurably slower, not faster**, at 200 concurrent VUs. This was not expected, and rather than write around it, here's the actual investigation:

- **Isolated, low-concurrency check** (100 sequential calls, no load): Redis `GET` (avg 0.76ms) and the Postgres `SELECT` it replaces (avg 1.5ms) are comparable — Redis if anything slightly faster. So the slowdown isn't "Redis is inherently slow."
- **Redis container CPU usage during the k6 run**: measured at just **10%** via `docker stats` — Redis itself is nowhere near its own capacity limit.
- **Conclusion**: the added latency is very likely coming from the network path, not Redis or the caching logic — Docker Desktop on Windows has no host-networking mode, so every request to the containerized Redis is routed through a virtualized NAT layer (WSL2). That overhead doesn't show up in a low-frequency sequential probe, but becomes a real bottleneck under genuine concurrent load.

**This is treated as a local-environment artifact, not a verdict on caching itself.** An attempt was made to remove Docker's networking layer from the equation entirely by installing Redis natively on Windows (Memurai) — the installer required admin elevation that wasn't completed in this session, so this remains an open, flagged question rather than a proven root cause. The cache-aside logic, invalidation, and graceful-degradation behavior are all correct and verified independently of this result (see below). The real, representative measurement will come once this runs against AWS ElastiCache in the same VPC as the app (Stage 8/9) — same-network, purpose-built, no consumer-OS virtualization layer involved — and this section will be revisited then.

## What was verified correct (independent of the performance surprise)

- Cache populated on first (miss) request, hit on subsequent requests — confirmed via `redis-cli GET` showing the cached row and a live TTL.
- `PATCH` (disable, change destination, set/clear expiration) and `DELETE` both invalidate the cache entry immediately — confirmed a disabled url returns `410` on the very next request, not a stale cached `302`, and confirmed the "disabled" answer itself then gets correctly cached.
- Redis outage: app falls back to Postgres and keeps serving correct redirects with 0 errors; recovers and resumes caching automatically once Redis comes back, with no app restart needed.

## Open item

Revisit this comparison once deployed to AWS with ElastiCache, and/or complete the native Redis (Memurai) install locally to isolate whether Docker Desktop's networking is really the cause.

---

# Stage 7 — Load Testing

**Date:** 2026-08-23
**Environment caveat, stated up front**: this is still a single laptop running the k6 load generator, the Node app, Postgres, and the Redis container all at once, on the same machine, competing for the same CPU cores. Stage 8 (cloud deployment) and Stage 9 (horizontal scaling) haven't happened yet. Every number below is a **single-instance, single-machine ceiling**, not a production capacity claim — and as the findings below show, the load generator sharing the machine with the server under test is itself part of the story.

## Part 1 — does rate limiting actually hold under real load?

Ran the existing Stage 4/5 script ([`redirect-test.js`](load-test/redirect-test.js), ramping to 200 VUs) with Stage 6's rate limiter left **on** (default, 100 req/min per IP on the redirect endpoint).

**Result: 200 successful redirects out of 59,417 total requests (99.66% correctly rejected with 429).** Since k6 sends all virtual users' traffic from one local IP, this is exactly the expected outcome: ~100 requests per 60-second window got through, everything else was correctly throttled. This is a genuine validation of Stage 6 under real concurrent load, not just the small controlled curl tests from that stage — the limiter holds up.

## Part 2 — finding the actual capacity ceiling

Rate limiting was temporarily disabled (`DISABLE_RATE_LIMIT=true` — added specifically for this test, same pattern as `DISABLE_CLICK_TRACKING`) so the test could reach real system limits instead of our own intentional throttling. A new script, [`stress-test.js`](load-test/stress-test.js), removes the `sleep(0.1)` pacing Stage 4/5 used (that pacing was deliberate for clean latency comparisons; here we want raw throughput) and ramps virtual users to 1,500.

| | Run 1 | Run 2 (repeat, with diagnostics running alongside) |
|---|---|---|
| Peak throughput | 2,359 req/s | 2,220 req/s |
| Error rate | **0%** (0 / 283,128) | **0%** (0 / 266,462) |
| p95 latency at peak | 598.8 ms | 688.8 ms |
| avg latency at peak | 286.7 ms | 305.0 ms |

The system never broke — every single request across both runs got a correct `302`. What it did do is get significantly slower under sustained heavy concurrency (sub-6ms p95 at moderate load in Stage 4/5, ~600-700ms p95 here) — a real, honest degradation curve rather than a hard failure.

## Where's the actual bottleneck? (checked, not assumed)

Sampled mid-run:
- **Postgres connections**: 2 active, 9 idle out of 11 total — the connection pool (`max: 10`) was **not** saturated or queuing.
- **Redis container CPU**: 15.82% — nowhere near its limit.
- **Node process CPU**: measured at **~109%** — essentially one full CPU core maxed out.

That's the real finding: **the bottleneck is Node's single-threaded JavaScript execution, not the database or the cache.** Every request still does real synchronous work — parsing the `User-Agent` string (regex-based, in `parseUserAgent`), JSON-encoding/decoding the cached url, building the click insert — and all of that competes for the same one thread, regardless of how many free database connections or how much Redis headroom exists. This is a specific, concrete, and encouraging piece of evidence for why Stage 9 (horizontal scaling — running multiple Node processes/instances) is the right next lever to pull, rather than, say, further tuning the database.

**One more honest caveat**: the k6 load generator itself ran on this same laptop, competing for the same CPU the server needed. A properly isolated test (separate load-generator machine, standard practice, and something we'll have naturally once deployed) would very likely show a *higher* real ceiling than measured here — this number is a lower bound, not a precise one.

## Reproducing this

```bash
# Part 1 (rate limiting on, default):
node load-test/setup.js
k6 run -e SHORT_CODE=<code> load-test/redirect-test.js

# Part 2 (finding the ceiling): set DISABLE_RATE_LIMIT=true in .env, restart the server, then:
k6 run -e SHORT_CODE=<code> load-test/stress-test.js
```

---

# Stage 10 — Async Processing

**Date:** 2026-08-24
**What was built:** Click tracking moved off the redirect's critical path entirely. Instead of `redirectToOriginal` writing directly to Postgres (Stage 3/4's approach), it now enqueues a small job onto a Redis-backed queue (BullMQ) and immediately redirects. A completely separate OS process (`src/worker.js`, run alongside the main server) picks jobs off that queue, parses the user agent, and does the actual `INSERT` — both pieces of work Stage 7 specifically identified as real cost on the request path.

## The measurement (rate limiting disabled for this run, same reasoning as Stage 7 — one k6 process shares one IP)

| | Stage 4: synchronous INSERT (baseline) | Stage 10: async via queue | Stage 4: tracking off entirely (theoretical floor) |
|---|---|---|---|
| p95 latency | 5.76 ms | **3.72 ms** | 2.04 ms |
| avg latency | 2.57 ms | **2.04 ms** | 0.85 ms |
| Error rate | 0% | 0% | 0% |

Async processing recovered **35.4% of the p95 latency cost** and **20.6% of the average latency cost** that synchronous click tracking introduced — real, measured, using the identical k6 script and VU ramp as Stage 4. It doesn't fully close the gap down to the "tracking off" floor, and that's expected: the redirect handler still does one Redis round trip to enqueue the job (`clickQueue.add(...)`), which is real but far cheaper than a Postgres `INSERT` with a foreign-key check. The ~1.68ms remaining gap between async and "fully off" is roughly the cost of that one Redis write.

## A real discrepancy investigated, not glossed over

Immediately after the load test, the analytics endpoint reported `totalClicks: 58529` — short of the `59,900` requests k6 actually sent. Rather than round it off as "close enough," this was checked directly:
- `LLEN bull:click-tracking:wait` → `0` — no jobs stuck pending.
- No entries in either the "failed to enqueue" log or the worker's "failed" event log.
- A raw `SELECT COUNT(*) FROM clicks` moments later → **59,901** — exactly right (59,900 + 1 warm-up request).

Conclusion: no data was lost. The first check simply caught the worker mid-drain — it processes one job at a time by default, so a sudden burst of ~750 clicks/sec takes a few seconds *after* the burst ends to fully catch up. That's the queue doing exactly its job: absorbing a spike and processing it at a sustainable rate, rather than either dropping data or blocking the redirects that generated it. Worth knowing as a real property of this design: analytics numbers are *eventually* consistent, not instantaneous, by design.

## Reproducing this

```bash
# Two processes now, not one:
npm run start    # the API server
npm run worker   # the click-tracking worker, in a separate terminal

# Then, same as Stage 4/7:
node load-test/setup.js
k6 run -e SHORT_CODE=<code> load-test/redirect-test.js
```
