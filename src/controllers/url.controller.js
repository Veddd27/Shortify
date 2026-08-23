import pool from "../config/db.js";
import { encode } from "../utils/base62.js";
import { parseUserAgent } from "../utils/userAgent.js";
import { getCachedUrl, setCachedUrl, invalidateCachedUrl } from "../utils/urlCache.js";

export async function createUrl(req, res) {
    // validate(createUrlSchema) already confirmed originalUrl is a valid
    // URL, customAlias (if present) is a safe/well-formed string, and
    // expiresAt (if present) is a real future ISO datetime.
    const { originalUrl, customAlias, expiresAt } = req.body;

    // We always grab a fresh id from the sequence, even when a customAlias
    // is supplied and we won't base62-encode it into anything. Two reasons:
    // every row still needs an id as its primary key regardless, and always
    // taking this same path (rather than branching into two different
    // INSERT statements) keeps the query below the same no matter which
    // case we're in.
    const seqResult = await pool.query("SELECT nextval('urls_id_seq') AS id");
    const id = seqResult.rows[0].id;
    const shortCode = customAlias || encode(id);

    try {
        const result = await pool.query(
            `INSERT INTO urls (id, short_code, original_url, user_id, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, short_code, original_url, is_active, expires_at, created_at`,
            [id, shortCode, originalUrl, req.userId, expiresAt || null]
        );

        const url = result.rows[0];
        return res.status(201).json({
            ...url,
            shortUrl: `${process.env.BASE_URL}/${url.short_code}`,
        });
    } catch (err) {
        // Same unique_violation handling as register() in auth.controller.js
        // — short_code has a UNIQUE constraint, and a customAlias could
        // collide with either another user's custom alias or (rarely) an
        // auto-generated one.
        if (err.code === "23505") {
            return res.status(409).json({ error: "That short code is already taken" });
        }
        throw err;
    }
}

export async function listUrls(req, res) {
    const result = await pool.query(
        `SELECT id, short_code, original_url, is_active, expires_at, created_at
         FROM urls
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.userId]
    );

    const urls = result.rows.map((url) => ({
        ...url,
        shortUrl: `${process.env.BASE_URL}/${url.short_code}`,
    }));
    return res.json({ urls });
}

export async function updateUrl(req, res) {
    const { id } = req.params;
    const { originalUrl, isActive, expiresAt } = req.body;

    // We build the SET clause piece by piece, only including the fields
    // that were actually sent — validate(updateUrlSchema) already
    // guaranteed at least one of them is present. The column *names*
    // here are always our own hardcoded strings, never taken from user
    // input; only the *values* going into $1, $2, ... come from the
    // request, and those stay parameterized exactly like every other
    // query in this file. That distinction is what keeps this safe from
    // injection despite the query text being built dynamically.
    const setClauses = [];
    const values = [];

    if (originalUrl !== undefined) {
        values.push(originalUrl);
        setClauses.push(`original_url = $${values.length}`);
    }
    if (isActive !== undefined) {
        values.push(isActive);
        setClauses.push(`is_active = $${values.length}`);
    }
    if (expiresAt !== undefined) {
        // expiresAt can legitimately be null here (Zod's .nullable() on
        // updateUrlSchema) — that's the client explicitly asking to clear
        // an existing expiration.
        values.push(expiresAt);
        setClauses.push(`expires_at = $${values.length}`);
    }

    values.push(id, req.userId);
    const idPlaceholder = `$${values.length - 1}`;
    const userIdPlaceholder = `$${values.length}`;

    const result = await pool.query(
        `UPDATE urls SET ${setClauses.join(", ")}
         WHERE id = ${idPlaceholder} AND user_id = ${userIdPlaceholder}
         RETURNING id, short_code, original_url, is_active, expires_at, created_at`,
        values
    );

    if (result.rowCount === 0) {
        return res.status(404).json({ error: "Url not found" });
    }

    const url = result.rows[0];

    // Actively invalidate the cache entry the moment the underlying row
    // changes — this is what actually keeps the cache correct, not the
    // TTL. Without this, a disabled/redirected-elsewhere url could keep
    // serving its OLD cached answer for up to TTL_SECONDS after being
    // changed, which is a real correctness bug, not just a performance
    // detail. The next redirect for this short code will simply miss the
    // cache and re-fetch the fresh row from Postgres.
    await invalidateCachedUrl(url.short_code);

    return res.json({
        ...url,
        shortUrl: `${process.env.BASE_URL}/${url.short_code}`,
    });
}

export async function deleteUrl(req, res) {
    const { id } = req.params;

    // Filtering by user_id in the same query (not just id) means a user can
    // never delete someone else's url even by guessing/incrementing an id —
    // the WHERE clause is the authorization check, not a separate step.
    const result = await pool.query(
        `DELETE FROM urls WHERE id = $1 AND user_id = $2 RETURNING id, short_code`,
        [id, req.userId]
    );

    if (result.rowCount === 0) {
        return res.status(404).json({ error: "Url not found" });
    }

    // Same reasoning as updateUrl — a deleted url must stop resolving
    // immediately, not up to 5 minutes later just because a stale cache
    // entry is still sitting there.
    await invalidateCachedUrl(result.rows[0].short_code);

    return res.status(204).send();
}

export async function redirectToOriginal(req, res) {
    const { shortCode } = req.params;

    // Cache-aside: check Redis first. If it's there, we skip Postgres
    // entirely for this request — that's the whole performance win. If
    // not (a genuine miss, OR Redis itself being unreachable — getCachedUrl
    // treats both the same and returns null either way), we fall through
    // to the exact same Postgres query Stage 1-4 always ran.
    let url = await getCachedUrl(shortCode);

    if (url) {
        // JSON has no concept of a Date type — JSON.stringify turned
        // expires_at into a plain ISO string when we cached it, and
        // JSON.parse just gives that string straight back, not a real
        // Date object. We have to reconstruct it here, or the
        // `url.expires_at < new Date()` comparison below would silently
        // compare a string to a Date and never behave correctly.
        url = { ...url, expires_at: url.expires_at ? new Date(url.expires_at) : null };
    } else {
        const result = await pool.query(
            `SELECT id, original_url, is_active, expires_at FROM urls WHERE short_code = $1`,
            [shortCode]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Short URL not found" });
        }

        url = result.rows[0];

        // Cache the row regardless of is_active/expires_at — caching a
        // disabled or expired url's "no" answer is just as valuable as
        // caching an active one's "yes," since it means someone repeatedly
        // hitting a dead link also stops hammering Postgres on every click.
        await setCachedUrl(shortCode, url);
    }

    // 410 Gone (not 404) for both of these on purpose — 404 means "nothing
    // here has ever existed at this address," 410 means "this specifically
    // existed and is now intentionally unavailable." A disabled or expired
    // link is the second case, and telling the two apart is genuinely
    // useful information for whoever's debugging a dead link.
    if (!url.is_active) {
        return res.status(410).json({ error: "This short URL has been disabled" });
    }
    if (url.expires_at && url.expires_at < new Date()) {
        return res.status(410).json({ error: "This short URL has expired" });
    }

    // Recording the click happens INSIDE this request, before we redirect —
    // the response doesn't go out until this INSERT finishes. That's
    // deliberate, not an oversight: this gives us an honest "before"
    // measurement of what analytics-on-the-hot-path actually costs, which
    // is exactly what Stage 4 (Performance) exists to go measure for real.
    // Stage 5 (caching) and Stage 10 (async processing) are the ones that
    // will actually fix this — we want to feel the problem first.
    //
    // DISABLE_CLICK_TRACKING is a deliberate feature flag, not a hack —
    // it exists specifically so we can run the exact same k6 load test
    // twice, once with this INSERT happening and once without, and isolate
    // its cost as a real measured number instead of a guess.
    if (process.env.DISABLE_CLICK_TRACKING !== "true") {
        const { browser, os, deviceType } = parseUserAgent(req.headers["user-agent"]);
        try {
            await pool.query(
                `INSERT INTO clicks (url_id, referrer, user_agent, browser, os, device_type, ip_address)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    url.id,
                    req.headers.referer || null,
                    req.headers["user-agent"] || null,
                    browser,
                    os,
                    deviceType,
                    req.ip,
                ]
            );
        } catch (err) {
            // A failure to record a click should never break the actual
            // redirect for the person clicking the link — log it and move
            // on rather than letting this throw and 500 the request.
            console.error("Failed to record click:", err);
        }
    }

    // 302 (temporary redirect) rather than 301 (permanent) is deliberate:
    // a permanent redirect tells browsers/CDNs to cache the mapping and
    // stop asking our server at all, which breaks the "measure and improve
    // redirect performance" work planned for Stage 4/5.
    return res.redirect(302, url.original_url);
}
