import { describe, expect, it } from "vitest";
import { isPathMatched } from "./matcher";

describe("isPathMatched", () => {
    it.each(["/", "/page", "/blog/post", "/old-page.html", "/blog/post.php", "/robots.txt", "/sitemap.xml", "/a.pdf"])(
        "matches %s with the default regex",
        (pathname) => {
            expect(isPathMatched(pathname, undefined)).toBe(true);
        },
    );

    it.each([
        "/api/hello",
        "/_next/static/chunk.js",
        "/_static/logo.png",
        "/_vercel/insights/script.js",
        "/style.css",
        "/assets/app.mjs",
        "/img/photo.JPEG".toLowerCase(),
        "/fonts/font.woff2",
        "/manifest.webmanifest",
        "/data.json",
        "/app.js.map",
    ])("ignores %s with the default regex", (pathname) => {
        expect(isPathMatched(pathname, undefined)).toBe(false);
    });

    it("matches every path when the regex is null", () => {
        expect(isPathMatched("/api/hello", null)).toBe(true);
        expect(isPathMatched("/_next/static/chunk.js", null)).toBe(true);
    });

    it("uses a custom regex", () => {
        expect(isPathMatched("/blog/post", "^/blog/")).toBe(true);
        expect(isPathMatched("/shop", "^/blog/")).toBe(false);
    });
});
