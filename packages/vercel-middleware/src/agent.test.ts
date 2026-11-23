import * as redirectionio from "@redirection.io/redirectionio";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const PACKAGE_VERSION: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const USER_AGENT = "redirection-io-vercel-middleware/" + PACKAGE_VERSION;

async function importAgent(variables: Record<string, string> = {}) {
    vi.resetModules();
    vi.stubEnv("REDIRECTIONIO_TOKEN", "token");
    vi.stubEnv("REDIRECTIONIO_INSTANCE_NAME", "test-instance");

    for (const [name, value] of Object.entries(variables)) {
        vi.stubEnv(name, value);
    }

    const agent = await import("./agent");
    // The library and its WebAssembly module are reloaded with the other modules
    const library = await import("@redirection.io/redirectionio");

    await library.init();

    return { agent, library };
}

function mockFetch(response: () => Response) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
}

function requestOf(call: Parameters<typeof fetch>) {
    const [url, init] = call;

    return { url: String(url), init: init ?? {}, headers: new Headers(init?.headers) };
}

beforeAll(async () => {
    await redirectionio.init();
});

describe("shouldForwardHeader", () => {
    it("filters the sensitive headers by default", async () => {
        const { agent } = await importAgent();

        expect(["Cookie", "authorization", "Proxy-Authorization", "x-api-key"].map(agent.shouldForwardHeader)).toEqual([
            false,
            false,
            false,
            false,
        ]);
        expect(agent.shouldForwardHeader("user-agent")).toBe(true);
    });

    it("forwards the sensitive headers opted in", async () => {
        const { agent } = await importAgent({ REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS: "cookie,Authorization" });

        expect(agent.shouldForwardHeader("Cookie")).toBe(true);
        expect(agent.shouldForwardHeader("authorization")).toBe(true);
        expect(agent.shouldForwardHeader("x-api-key")).toBe(false);
    });
});

describe("createRedirectionIORequest", () => {
    it("sends the URL, method, IP and non sensitive headers", async () => {
        const { agent } = await importAgent();
        const request = agent.createRedirectionIORequest({
            url: new URL("https://example.com/page?a=1"),
            method: "POST",
            headers: { "user-agent": "test", cookie: "a=1", "accept-language": ["fr", "en"], empty: undefined },
            ip: "203.0.113.1",
        });
        const serialized: unknown = JSON.parse(request.serialize());

        expect(serialized).toMatchObject({
            path_and_query_v2: "/page?a=1",
            host: "example.com",
            scheme: "https",
            method: "POST",
            remote_addr: "203.0.113.1",
            headers: [
                { name: "user-agent", value: "test" },
                { name: "accept-language", value: "fr" },
                { name: "accept-language", value: "en" },
            ],
        });
    });
});

describe("fetchRedirectionIOAction", () => {
    it("posts the request to the agent with the library user agent", async () => {
        const { agent, library } = await importAgent();
        const fetchSpy = mockFetch(() => new Response(""));
        const request = new library.Request("/page", "example.com", "https", "GET");
        const action = await agent.fetchRedirectionIOAction(request);
        const { url, init, headers } = requestOf(fetchSpy.mock.calls[0]);

        expect(url).toBe("https://agent.redirection.io/token/action");
        expect(init.method).toBe("POST");
        expect(init.body).toBe(request.serialize());
        expect(headers.get("user-agent")).toBe(USER_AGENT);
        expect(headers.get("x-redirectionio-instance-name")).toBe("test-instance");
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(action.get_status_code(0)).toBe(0);
    });

    it("applies no rule when the agent answers with an error", async () => {
        const { agent, library } = await importAgent();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        mockFetch(() => new Response('{"status_code_update":{"status_code":410}}', { status: 503 }));

        const action = await agent.fetchRedirectionIOAction(new library.Request("/", "example.com", "https", "GET"));

        expect(action.get_status_code(0)).toBe(0);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("503"));
    });

    it("applies no rule when the agent times out", async () => {
        const { agent, library } = await importAgent({ REDIRECTIONIO_TIMEOUT: "20" });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        vi.spyOn(globalThis, "fetch").mockImplementation(
            (_input, init) =>
                new Promise((_resolve, reject) =>
                    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
                ),
        );

        const action = await agent.fetchRedirectionIOAction(new library.Request("/", "example.com", "https", "GET"));

        expect(action.get_status_code(0)).toBe(0);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("within 20ms"));
    });
});

describe("logRequest", () => {
    it("sends the log with the library name and version as proxy", async () => {
        const { agent, library } = await importAgent();
        const fetchSpy = mockFetch(() => new Response(null, { status: 200 }));

        await agent.logRequest({
            redirectionioRequest: new library.Request("/page", "example.com", "https", "GET"),
            statusCode: 404,
            backendStatusCode: 404,
            responseHeaders: [["content-type", "text/html"]],
            action: library.Action.empty(),
            startTimestamp: 1,
            actionMatchTime: 2,
            proxyResponseTime: 3,
            clientIP: "203.0.113.1",
        });

        const { url, headers, init } = requestOf(fetchSpy.mock.calls[0]);
        const log: unknown = JSON.parse(String(init.body));

        expect(url).toBe("https://agent.redirection.io/token/log");
        expect(headers.get("user-agent")).toBe(USER_AGENT);
        expect(log).toMatchObject({ proxy: USER_AGENT, code: 404, ips: ["203.0.113.1"], from: { url: "/page" } });
    });
});

describe("waitUntil", () => {
    it("uses the Vercel request context when there is one", async () => {
        const { agent } = await importAgent();
        const contextKey = Symbol.for("@vercel/request-context");
        const contextWaitUntil = vi.fn();
        const promise = Promise.resolve();

        agent.waitUntil(promise);

        Object.assign(globalThis, { [contextKey]: { get: () => ({ waitUntil: contextWaitUntil }) } });

        try {
            agent.waitUntil(promise);
        } finally {
            Reflect.deleteProperty(globalThis, contextKey);
        }

        expect(contextWaitUntil).toHaveBeenCalledExactlyOnceWith(promise);
    });
});
