// Turns a url row's numeric `id` into the short code used in the link
// (e.g. id 125 -> "21"). This is the "counter + base62" strategy: ids are
// already unique and sequential because Postgres's BIGSERIAL guarantees
// that, so we don't need to check for collisions — we just need a shorter
// way to *display* the number. Base62 (0-9, a-z, A-Z = 62 symbols) packs
// more value per character than base10, which is the whole point.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BASE = BigInt(ALPHABET.length);

// Postgres BIGINT columns come back from node-postgres as strings, not JS
// numbers — a plain number can only safely hold integers up to 2^53, and
// BIGINT goes up to 2^63. We use JS's native BigInt type here so this still
// works correctly once ids grow past that point instead of silently losing
// precision.
export function encode(id) {
    let value = BigInt(id);

    if (value === 0n) {
        return ALPHABET[0];
    }

    let result = "";
    while (value > 0n) {
        const remainder = value % BASE;
        result = ALPHABET[Number(remainder)] + result;
        value = value / BASE;
    }
    return result;
}
