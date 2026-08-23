// Wraps a Zod schema into an Express middleware. Instead of every
// controller writing its own "if (!field) return 400" checks, each route
// declares which schema its body must match, and this one function does
// the checking for all of them the same way.
export function validate(schema) {
    return (req, res, next) => {
        // safeParse (vs. plain parse) never throws — it always returns
        // either { success: true, data } or { success: false, error },
        // so we don't need a try/catch here.
        const result = schema.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                error: "Validation failed",
                details: result.error.issues.map((issue) => ({
                    field: issue.path.join("."),
                    message: issue.message,
                })),
            });
        }

        // result.data is the *validated* (and, for things like trimmed
        // strings, normalized) body. Overwriting req.body with it means
        // the controller downstream can trust the shape it's getting —
        // it never sees raw, unchecked input.
        req.body = result.data;
        next();
    };
}
