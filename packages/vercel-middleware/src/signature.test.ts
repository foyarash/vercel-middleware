import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForwardedMiddlewareData, ForwardedRequest } from "./signature";

async function importSignature(token = "secret-token") {
    vi.resetModules();
    vi.stubEnv("REDIRECTIONIO_TOKEN", token);

    return import("./signature");
}

const data = (overrides: Partial<ForwardedMiddlewareData> = {}): ForwardedMiddlewareData => ({
    action: '{"rule_ids":["a"]}',
    startTimestamp: Date.now(),
    actionMatchTime: Date.now(),
    proxyResponseTime: Date.now(),
    shouldLog: true,
    ...overrides,
});

const incoming = (request: Partial<IncomingMessage>) => request as IncomingMessage;

const forwardedRequest: ForwardedRequest = { method: "GET", pathAndQuery: "/page?a=1" };

describe("forwarded data signature", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("verifies the data it signed", async () => {
        const { signForwardedData, verifyForwardedData } = await importSignature();
        const signed = data();
        const signature = await signForwardedData(signed, forwardedRequest);

        expect(signature).toMatch(/^[0-9a-f]{64}$/);
        await expect(verifyForwardedData(signed, forwardedRequest, signature)).resolves.toBe(true);
        await expect(verifyForwardedData(signed, { ...forwardedRequest, method: "get" }, signature)).resolves.toBe(
            true,
        );
    });

    it("rejects a signature replayed on another URL or method", async () => {
        const { signForwardedData, verifyForwardedData } = await importSignature();
        const signed = data();
        const signature = await signForwardedData(signed, forwardedRequest);

        await expect(
            verifyForwardedData(signed, { ...forwardedRequest, pathAndQuery: "/other?a=1" }, signature),
        ).resolves.toBe(false);
        await expect(verifyForwardedData(signed, { ...forwardedRequest, method: "POST" }, signature)).resolves.toBe(
            false,
        );
    });

    it("rejects tampered data", async () => {
        const { signForwardedData, verifyForwardedData } = await importSignature();
        const signed = data();
        const signature = await signForwardedData(signed, forwardedRequest);

        await expect(verifyForwardedData({ ...signed, shouldLog: false }, forwardedRequest, signature)).resolves.toBe(
            false,
        );
        await expect(verifyForwardedData({ ...signed, action: "{}" }, forwardedRequest, signature)).resolves.toBe(
            false,
        );
    });

    it("rejects data signed with another token", async () => {
        const other = await importSignature("other-token");
        const signed = data();
        const signature = await other.signForwardedData(signed, forwardedRequest);
        const { verifyForwardedData } = await importSignature();

        await expect(verifyForwardedData(signed, forwardedRequest, signature)).resolves.toBe(false);
    });

    it("rejects data older than 60 seconds", async () => {
        const { signForwardedData, verifyForwardedData } = await importSignature();
        const signed = data();
        const signature = await signForwardedData(signed, forwardedRequest);

        vi.setSystemTime(Date.now() + 60_000);
        await expect(verifyForwardedData(signed, forwardedRequest, signature)).resolves.toBe(true);

        vi.setSystemTime(Date.now() + 1);
        await expect(verifyForwardedData(signed, forwardedRequest, signature)).resolves.toBe(false);
    });

    it.each(["", "abc", "z".repeat(64), "A".repeat(64)])("rejects the malformed signature %j", async (signature) => {
        const { verifyForwardedData } = await importSignature();

        await expect(verifyForwardedData(data(), forwardedRequest, signature)).resolves.toBe(false);
    });
});

describe("middleware loop marker", () => {
    it("recognizes its own marker only", async () => {
        const { getMiddlewareLoopMarker, isMiddlewareLoopRequest } = await importSignature();
        const marker = await getMiddlewareLoopMarker();

        expect(marker).toMatch(/^[0-9a-f]{64}$/);
        await expect(isMiddlewareLoopRequest(marker)).resolves.toBe(true);
        await expect(isMiddlewareLoopRequest("1")).resolves.toBe(false);
        await expect(isMiddlewareLoopRequest([marker])).resolves.toBe(false);
        await expect(isMiddlewareLoopRequest(null)).resolves.toBe(false);
        await expect(isMiddlewareLoopRequest(undefined)).resolves.toBe(false);
    });

    it("depends on the token", async () => {
        const marker = await (await importSignature("other-token")).getMiddlewareLoopMarker();
        const { isMiddlewareLoopRequest } = await importSignature();

        await expect(isMiddlewareLoopRequest(marker)).resolves.toBe(false);
    });

    it("is never recognized without token", async () => {
        const { isMiddlewareLoopRequest } = await importSignature("");

        await expect(isMiddlewareLoopRequest("0".repeat(64))).resolves.toBe(false);
    });
});

describe("forwardDataToBackend and readForwardedData", () => {
    async function forward(originalHeaders: Record<string, string>, responseHeaders: Record<string, string> = {}) {
        const signature = await importSignature();
        const response = new Response(null, { headers: { "x-middleware-next": "1", ...responseHeaders } });
        const forwardedData = data();

        await signature.forwardDataToBackend(response, new Headers(originalHeaders), forwardedData, forwardedRequest);

        return { signature, response, forwardedData };
    }

    function requestHeadersSeenByBackend(response: Response): Record<string, string> {
        const names = (response.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean);

        return Object.fromEntries(
            names.map((name) => [name, response.headers.get("x-middleware-request-" + name) ?? ""]),
        );
    }

    it("overrides the request headers with the original ones and the signed data", async () => {
        const { signature, response } = await forward({ "user-agent": "test", "x-redirectionio-middleware": "x" });
        const headers = requestHeadersSeenByBackend(response);

        expect(headers["user-agent"]).toBe("test");
        expect(headers[signature.REDIRECTIONIO_SHOULD_LOG_HEADER]).toBe("1");
        expect(headers[signature.REDIRECTIONIO_REQUEST_URL_HEADER]).toBe("/page?a=1");
        expect(headers[signature.REDIRECTIONIO_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
        expect(headers).not.toHaveProperty(signature.REDIRECTIONIO_MIDDLEWARE_HEADER);
        expect(response.headers.has("x-middleware-request-" + signature.REDIRECTIONIO_MIDDLEWARE_HEADER)).toBe(false);
    });

    it("keeps the overrides of a chained middleware", async () => {
        const { response } = await forward(
            { "user-agent": "test" },
            { "x-middleware-override-headers": "x-a", "x-middleware-request-x-a": "1" },
        );
        const headers = requestHeadersSeenByBackend(response);

        expect(headers["x-a"]).toBe("1");
        expect(headers).not.toHaveProperty("user-agent");
    });

    it("lets the instrumentation read the data, with the query Vercel adds after a rewrite", async () => {
        const { signature, response, forwardedData } = await forward({});
        const request = incoming({ method: "GET", headers: requestHeadersSeenByBackend(response) });

        await expect(
            signature.readForwardedData(request, new URL("https://example.com/page?a=1&rewritten=1")),
        ).resolves.toEqual({ data: forwardedData, publicUrl: new URL("https://example.com/page?a=1") });
        await expect(signature.readForwardedData(request, new URL("https://example.com/other?a=1"))).resolves.toBe(
            null,
        );
        await expect(
            signature.readForwardedData(
                incoming({ ...request, method: "POST" }),
                new URL("https://example.com/page?a=1"),
            ),
        ).resolves.toBe(null);
    });

    it("ignores unsigned data", async () => {
        const { readForwardedData, REDIRECTIONIO_ACTION_HEADER } = await importSignature();
        const request = incoming({ method: "GET", headers: { [REDIRECTIONIO_ACTION_HEADER]: "{}" } });

        await expect(readForwardedData(request, new URL("https://example.com/page"))).resolves.toBe(null);
    });
});
