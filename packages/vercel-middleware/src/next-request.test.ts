import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { getNextRequestKind, isNextPrefetchRequest, stripNextRscSearchParam } from "./next-request";

const request = (headers: Record<string, string>, url = "https://example.com/page") => new Request(url, { headers });

describe("getNextRequestKind", () => {
    it("detects server actions", () => {
        expect(getNextRequestKind(request({ "next-action": "abc", rsc: "1" }))).toBe("server-action");
    });

    it.each<Record<string, string>>([
        { rsc: "1" },
        { "next-router-prefetch": "1" },
        { "next-router-segment-prefetch": "/_tree" },
        { "next-router-state-tree": "%5B%5D" },
        { accept: "text/x-component" },
    ])("detects RSC requests from %o", (headers) => {
        expect(getNextRequestKind(request(headers))).toBe("rsc");
    });

    it("detects RSC requests from the _rsc parameter", () => {
        expect(getNextRequestKind(request({}, "https://example.com/page?_rsc=abc"))).toBe("rsc");
    });

    it("defaults to documents", () => {
        expect(getNextRequestKind(request({ accept: "text/html", rsc: "0" }))).toBe("document");
    });
});

describe("isNextPrefetchRequest", () => {
    const incoming = (headers: IncomingMessage["headers"]): IncomingMessage =>
        ({ headers }) as Partial<IncomingMessage> as IncomingMessage;

    it("detects prefetches", () => {
        expect(isNextPrefetchRequest(incoming({ "next-router-prefetch": "1" }))).toBe(true);
        expect(isNextPrefetchRequest(incoming({ "next-router-segment-prefetch": "/_tree" }))).toBe(true);
    });

    it("ignores other requests", () => {
        expect(isNextPrefetchRequest(incoming({ rsc: "1" }))).toBe(false);
    });
});

describe("stripNextRscSearchParam", () => {
    it("removes _rsc without changing the original URL", () => {
        const url = new URL("https://example.com/page?a=1&_rsc=abc&b=2");
        const stripped = stripNextRscSearchParam(url);

        expect(stripped.href).toBe("https://example.com/page?a=1&b=2");
        expect(url.searchParams.has("_rsc")).toBe(true);
    });

    it("keeps URLs without _rsc", () => {
        expect(stripNextRscSearchParam(new URL("https://example.com/?q=a+b")).search).toBe("?q=a+b");
    });
});
