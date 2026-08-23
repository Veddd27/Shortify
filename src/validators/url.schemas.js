import { z } from "zod";

// customAlias is optional — if the user doesn't supply one, createUrl falls
// back to the base62(id) behavior from Stage 1. When they do supply one, we
// restrict the character set to what's safe to put directly into a URL path
// without needing escaping, and bound the length so someone can't submit a
// 5000-character "short" code.
const customAliasSchema = z
    .string()
    .min(3, "customAlias must be at least 3 characters")
    .max(30, "customAlias must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "customAlias can only contain letters, numbers, hyphens, and underscores");

export const createUrlSchema = z.object({
    originalUrl: z.url("originalUrl must be a valid URL"),
    customAlias: customAliasSchema.optional(),
    // z.iso.datetime() checks the string is a real ISO 8601 datetime
    // (e.g. "2026-09-01T00:00:00Z"); .refine() adds our own extra rule on
    // top — it must also be in the future, since creating a url that's
    // already expired doesn't make sense.
    expiresAt: z
        .iso.datetime("expiresAt must be a valid ISO datetime string")
        .refine((val) => new Date(val) > new Date(), "expiresAt must be in the future")
        .optional(),
});

// Every field here is optional individually (a PATCH request might only
// want to change one thing), but the .refine() below requires that AT
// LEAST ONE of them is actually present — otherwise an empty {} body would
// "successfully" update nothing, which isn't a meaningful request.
export const updateUrlSchema = z
    .object({
        originalUrl: z.url("originalUrl must be a valid URL").optional(),
        isActive: z.boolean().optional(),
        // Unlike create, expiresAt here also accepts null explicitly —
        // that's how a client says "clear the expiration, make this url
        // permanent again," as opposed to omitting the field entirely
        // (which means "leave expiration as it currently is").
        expiresAt: z.iso.datetime("expiresAt must be a valid ISO datetime string").nullable().optional(),
    })
    .refine(
        (data) => Object.keys(data).length > 0,
        "At least one of originalUrl, isActive, or expiresAt must be provided"
    );
