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
