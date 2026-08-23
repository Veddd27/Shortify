import pool from "../config/db.js";
import { encode } from "../utils/base62.js";

export async function createUrl(req, res) {
    // validate(createUrlSchema) already confirmed originalUrl is present
    // and a well-formed URL before this handler ran.
    const { originalUrl } = req.body;

    // We need the row's id *before* we can compute its short_code (the code
    // is just base62(id)), but the normal INSERT...RETURNING flow only gives
    // us the id *after* insert. Instead of inserting once and UPDATEing the
    // short_code in a second query, we pull the next value straight from the
    // table's underlying sequence (urls_id_seq — the counter object Postgres
    // created for us behind BIGSERIAL) and then insert that id explicitly.
    // BIGSERIAL only sets the *default* for id to nextval(); it doesn't
    // stop us providing our own value, so this is a normal, safe insert.
    const seqResult = await pool.query("SELECT nextval('urls_id_seq') AS id");
    const id = seqResult.rows[0].id;
    const shortCode = encode(id);

    const result = await pool.query(
        `INSERT INTO urls (id, short_code, original_url, user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, short_code, original_url, created_at`,
        [id, shortCode, originalUrl, req.userId]
    );

    const url = result.rows[0];
    return res.status(201).json({
        ...url,
        shortUrl: `${process.env.BASE_URL}/${url.short_code}`,
    });
}

export async function listUrls(req, res) {
    const result = await pool.query(
        `SELECT id, short_code, original_url, created_at
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

export async function deleteUrl(req, res) {
    const { id } = req.params;

    // Filtering by user_id in the same query (not just id) means a user can
    // never delete someone else's url even by guessing/incrementing an id —
    // the WHERE clause is the authorization check, not a separate step.
    const result = await pool.query(
        `DELETE FROM urls WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, req.userId]
    );

    if (result.rowCount === 0) {
        return res.status(404).json({ error: "Url not found" });
    }
    return res.status(204).send();
}

export async function redirectToOriginal(req, res) {
    const { shortCode } = req.params;

    const result = await pool.query(
        `SELECT original_url FROM urls WHERE short_code = $1`,
        [shortCode]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ error: "Short URL not found" });
    }

    // 302 (temporary redirect) rather than 301 (permanent) is deliberate:
    // a permanent redirect tells browsers/CDNs to cache the mapping and
    // stop asking our server at all, which breaks the "measure and improve
    // redirect performance" work planned for Stage 4/5.
    return res.redirect(302, result.rows[0].original_url);
}
