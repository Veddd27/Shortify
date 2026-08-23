import pool from "../config/db.js";

export async function getUrlAnalytics(req, res) {
    const { id } = req.params;

    // Confirm this url exists AND belongs to the logged-in user before
    // running any analytics queries at all — same ownership pattern as
    // updateUrl/deleteUrl. Without this check, any logged-in user could
    // read click data for ANY url just by guessing an id in the path.
    const urlCheck = await pool.query(
        `SELECT id FROM urls WHERE id = $1 AND user_id = $2`,
        [id, req.userId]
    );
    if (urlCheck.rows.length === 0) {
        return res.status(404).json({ error: "Url not found" });
    }

    // These five queries all read the same url_id and don't depend on each
    // other, so we fire them together with Promise.all instead of one at a
    // time with await. Each one borrows its own connection from the pool
    // (remember: up to 10 can run truly concurrently), so this finishes in
    // roughly the time of the single slowest query, not the sum of all five.
    const [totalResult, byDayResult, referrerResult, browserResult, recentResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total_clicks FROM clicks WHERE url_id = $1`, [id]),

        pool.query(
            `SELECT date_trunc('day', clicked_at) AS day, COUNT(*)::int AS clicks
             FROM clicks
             WHERE url_id = $1
             GROUP BY day
             ORDER BY day`,
            [id]
        ),

        pool.query(
            `SELECT COALESCE(referrer, 'direct') AS referrer, COUNT(*)::int AS clicks
             FROM clicks
             WHERE url_id = $1
             GROUP BY referrer
             ORDER BY clicks DESC
             LIMIT 10`,
            [id]
        ),

        pool.query(
            `SELECT COALESCE(browser, 'unknown') AS browser, COUNT(*)::int AS clicks
             FROM clicks
             WHERE url_id = $1
             GROUP BY browser
             ORDER BY clicks DESC`,
            [id]
        ),

        pool.query(
            `SELECT clicked_at, referrer, browser, os, device_type
             FROM clicks
             WHERE url_id = $1
             ORDER BY clicked_at DESC
             LIMIT 20`,
            [id]
        ),
    ]);

    return res.json({
        totalClicks: totalResult.rows[0].total_clicks,
        clicksByDay: byDayResult.rows,
        topReferrers: referrerResult.rows,
        browserBreakdown: browserResult.rows,
        recentActivity: recentResult.rows,
    });
}
