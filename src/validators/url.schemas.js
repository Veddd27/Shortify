import { z } from "zod";

// z.url() replaces the manual `new URL(originalUrl)` try/catch that used
// to live in the controller — same check, expressed as a schema instead
// of imperative code.
export const createUrlSchema = z.object({
    originalUrl: z.url("originalUrl must be a valid URL"),
});
