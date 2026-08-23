import { z } from "zod";

// Zod describes the *shape* a request body must have as a schema object,
// once, instead of us writing "if (!email) ..." checks by hand in every
// controller. z.email() checks it's a well-formed email address (not just
// "is this field truthy" like our old manual check did); z.string().min(8)
// requires an actual minimum password length, which we weren't enforcing
// at all before.
export const registerSchema = z.object({
    email: z.email(),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

// Login intentionally doesn't re-enforce the 8-character minimum — a
// user's existing password might predate that rule, or might just be
// short; login should only ever check "does this match what's stored,"
// not re-validate password strength.
export const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1, "Password is required"),
});
