import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";

async function importIncomingRequest(isVercel: boolean) {
    vi.resetModules();
    vi.stubEnv("VERCEL", isVercel ? "1" : "");

    return import("./incoming-request");
}

function incoming({
    headers = {},
    remoteAddress,
    encrypted = false,
    url = "/page",
}: {
    headers?: IncomingMessage["headers"];
    remoteAddress?: string;
    encrypted?: boolean;
    url?: string;
}): IncomingMessage {
    const socket: Partial<Socket> & { encrypted: boolean } = { remoteAddress, encrypted };
    const request: Partial<IncomingMessage> = { headers, url, socket: socket as Socket };

    return request as IncomingMessage;
}

function serverResponse(headers: Record<string, string>): ServerResponse {
    const response: Partial<ServerResponse> = {
        getHeaderNames: () => Object.keys(headers),
        getHeaders: () => headers,
    };

    return response as ServerResponse;
}

describe("getClientIp", () => {
    it("only trusts x-real-ip on Vercel", async () => {
        const { getClientIp } = await importIncomingRequest(true);
        const request = incoming({
            headers: { "x-real-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.1" },
            remoteAddress: "10.0.0.1",
        });

        expect(getClientIp(request, "10.0.0.2")).toBe("203.0.113.1");
        expect(getClientIp(incoming({ remoteAddress: "10.0.0.1" }), "10.0.0.2")).toBeUndefined();
    });

    it("uses the socket address outside Vercel, never the client headers", async () => {
        const { getClientIp } = await importIncomingRequest(false);
        const request = incoming({
            headers: { "x-real-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.1" },
            remoteAddress: "10.0.0.1",
        });

        expect(getClientIp(request, "10.0.0.2")).toBe("10.0.0.2");
        expect(getClientIp(request, undefined)).toBe("10.0.0.1");
    });
});

describe("getRequestOrigin", () => {
    it("uses the forwarded protocol and the host", async () => {
        const { getRequestOrigin } = await importIncomingRequest(false);

        expect(
            getRequestOrigin(incoming({ headers: { host: "example.com, other.com", "x-forwarded-proto": "https" } })),
        ).toBe("https://example.com");
    });

    it("falls back to the connection protocol and localhost", async () => {
        const { getRequestOrigin } = await importIncomingRequest(false);

        expect(getRequestOrigin(incoming({ headers: { "x-forwarded-proto": "gopher" }, encrypted: true }))).toBe(
            "https://localhost",
        );
        expect(getRequestOrigin(incoming({}))).toBe("http://localhost");
    });
});

describe("getRequestUrl", () => {
    it("prefers the initial URL kept by Next.js", async () => {
        const { getRequestUrl } = await importIncomingRequest(false);
        const request = incoming({ url: "/rewritten" });

        expect(getRequestUrl(request)).toBe("/rewritten");

        Object.assign(request, { [Symbol.for("NextInternalRequestMeta")]: { initURL: "/page?a=1" } });

        expect(getRequestUrl(request)).toBe("/page?a=1");
    });
});

describe("isIgnoredUrl", () => {
    it.each(["/_next/static/a.js", "/_vercel/insights", "/__nextjs_original-stack-frame", "/a.css?v=1", "/api/a"])(
        "ignores %s",
        async (url) => {
            const { isIgnoredUrl } = await importIncomingRequest(false);

            expect(isIgnoredUrl(url, undefined)).toBe(true);
        },
    );

    it("applies the matcher", async () => {
        const { isIgnoredUrl } = await importIncomingRequest(false);

        expect(isIgnoredUrl("/page?a=1", undefined)).toBe(false);
        expect(isIgnoredUrl("/api/a", null)).toBe(false);
        expect(isIgnoredUrl("/page", "^/blog/")).toBe(true);
    });
});

describe("isPlatformInternalRequest", () => {
    it("detects Node.js middleware invocations but not rewritten pages", async () => {
        const { isPlatformInternalRequest } = await importIncomingRequest(true);

        expect(isPlatformInternalRequest(incoming({}), serverResponse({ "x-middleware-next": "1" }))).toBe(true);
        expect(isPlatformInternalRequest(incoming({}), serverResponse({ "x-middleware-rewrite": "/a" }))).toBe(false);
    });

    it("detects ISR renders requested by the Vercel cache", async () => {
        const { isPlatformInternalRequest } = await importIncomingRequest(true);
        const response = serverResponse({});

        expect(isPlatformInternalRequest(incoming({ headers: { "x-vercel-sc-host": "a" } }), response)).toBe(true);
        expect(
            isPlatformInternalRequest(
                incoming({ headers: { "x-vercel-sc-host": "a", "x-vercel-forwarded-for": "203.0.113.1" } }),
                response,
            ),
        ).toBe(false);
    });
});

describe("stripVercelRouteParams", () => {
    it("removes the route params added by Vercel", async () => {
        const { stripVercelRouteParams } = await importIncomingRequest(true);
        const url = new URL("https://example.com/products/a?nxtPslug=a&nxtIlocale=fr&q=1");

        stripVercelRouteParams(url);

        expect(url.search).toBe("?q=1");
    });
});

describe("getLoggedResponseHeaders", () => {
    it("resolves a relative location against the logged URL", async () => {
        const { getLoggedResponseHeaders } = await importIncomingRequest(false);

        expect(
            getLoggedResponseHeaders(
                serverResponse({ location: "/new", "content-type": "text/html", empty: "" }),
                new URL("https://example.com/old"),
            ),
        ).toEqual([
            ["location", "https://example.com/new"],
            ["content-type", "text/html"],
        ]);
    });
});
