import { UAParser } from "ua-parser-js";

// Turns a raw User-Agent header string (a messy, human-unreadable blob like
// "Mozilla/5.0 (Windows NT 10.0; ...) Chrome/120.0.0.0 ...") into the three
// clean fields we actually store. UAParser can't always identify every
// field (unusual or spoofed clients), so each piece falls back to null
// individually rather than the whole thing failing.
export function parseUserAgent(userAgentString) {
    if (!userAgentString) {
        return { browser: null, os: null, deviceType: null };
    }

    const result = UAParser(userAgentString);

    return {
        browser: result.browser.name || null,
        os: result.os.name || null,
        // device.type is only set for non-desktop clients ("mobile",
        // "tablet", "console", etc.) — an empty result here genuinely
        // means "regular desktop browser," which is worth recording as
        // its own value rather than null (which would instead mean
        // "couldn't tell at all").
        deviceType: result.device.type || "desktop",
    };
}
