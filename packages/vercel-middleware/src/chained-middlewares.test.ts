import { describe, expect, it } from "vitest";
import { mergeMiddlewareResponses, middlewareResponseToRequest } from "./chained-middlewares";

const next = (headers: Record<string, string> = {}) =>
    new Response(null, { headers: { "x-middleware-next": "1", ...headers } });

describe("mergeMiddlewareResponses", () => {
    it("keeps the rewrite of a previous middleware and drops x-middleware-next", () => {
        const previous = new Response(null, { headers: { "x-middleware-rewrite": "https://example.com/rewritten" } });
        const merged = mergeMiddlewareResponses(next(), [previous], true);

        expect(merged.headers.get("x-middleware-rewrite")).toBe("https://example.com/rewritten");
        expect(merged.headers.has("x-middleware-next")).toBe(false);
    });

    it("replaces the request header overrides with the ones of the chained middleware", () => {
        const target = next({
            "x-middleware-override-headers": "x-a",
            "x-middleware-request-x-a": "target",
        });
        const previous = next({
            "x-middleware-override-headers": "x-b",
            "x-middleware-request-x-b": "previous",
        });
        const merged = mergeMiddlewareResponses(target, [previous], true);

        expect(merged.headers.get("x-middleware-override-headers")).toBe("x-b");
        expect(merged.headers.get("x-middleware-request-x-b")).toBe("previous");
        expect(merged.headers.has("x-middleware-request-x-a")).toBe(false);
    });

    it("only copies the response headers of a final response", () => {
        const target = new Response("body", { status: 301, headers: { location: "/new" } });
        const previous = next({
            "x-custom": "1",
            "x-middleware-rewrite": "https://example.com/rewritten",
        });
        const merged = mergeMiddlewareResponses(target, [previous, null], false);

        expect(merged.headers.get("x-custom")).toBe("1");
        expect(merged.headers.has("x-middleware-rewrite")).toBe(false);
        expect(merged.headers.has("x-middleware-next")).toBe(false);
    });

    it("appends set-cookie and joins x-middleware-set-cookie", () => {
        const target = next({ "x-middleware-set-cookie": "a=1" });

        target.headers.append("set-cookie", "a=1");

        const previous = next({ "x-middleware-set-cookie": "b=2" });

        previous.headers.append("set-cookie", "b=2; Path=/");

        const merged = mergeMiddlewareResponses(target, [previous], true);

        expect(merged.headers.getSetCookie()).toEqual(["a=1", "b=2; Path=/"]);
        expect(merged.headers.get("x-middleware-set-cookie")).toBe("a=1,b=2");
    });
});

describe("middlewareResponseToRequest", () => {
    it("follows the rewrite and keeps the method and headers", () => {
        const request = new Request("https://example.com/page", { method: "POST", headers: { "x-a": "1" }, body: "x" });
        const response = next({ "x-middleware-rewrite": "https://example.com/rewritten" });
        const rewritten = middlewareResponseToRequest(request, response);

        expect(rewritten.url).toBe("https://example.com/rewritten");
        expect(rewritten.method).toBe("POST");
        expect(rewritten.headers.get("x-a")).toBe("1");
    });

    it("applies the overridden request headers", () => {
        const request = new Request("https://example.com/page", { headers: { "x-a": "1" } });
        const response = next({
            "x-middleware-override-headers": "x-a,x-b",
            "x-middleware-request-x-a": "2",
            "x-middleware-request-x-b": "3",
        });
        const overridden = middlewareResponseToRequest(request, response);

        expect(overridden.url).toBe("https://example.com/page");
        expect(overridden.headers.get("x-a")).toBe("2");
        expect(overridden.headers.get("x-b")).toBe("3");
    });

    it("merges the cookies set by the middleware into the cookie header", () => {
        const request = new Request("https://example.com/page", { headers: { cookie: "a=1; b=2" } });
        const response = next({ "x-middleware-set-cookie": "b=3,c=4" });

        response.headers.append("set-cookie", "b=3; Path=/");
        response.headers.append("set-cookie", "c=4; HttpOnly");

        expect(middlewareResponseToRequest(request, response).headers.get("cookie")).toBe("a=1; b=3; c=4");
    });
});
