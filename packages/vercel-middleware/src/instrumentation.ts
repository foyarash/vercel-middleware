import * as redirectionio from "@redirection.io/redirectionio";
import { getEnv } from "./env";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import {
    createRedirectionIORequest,
    fetchRedirectionIOAction,
    ForwardedMiddlewareData,
    ForwardedRequest,
    isMiddlewareLoopRequest,
    isPathMatched,
    logRequest,
    REDIRECTIONIO_ACTION_HEADER,
    REDIRECTIONIO_MATCH_TIME_TIME_HEADER,
    REDIRECTIONIO_MIDDLEWARE_HEADER,
    REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER,
    REDIRECTIONIO_REQUEST_URL_HEADER,
    REDIRECTIONIO_SHOULD_LOG_HEADER,
    REDIRECTIONIO_SIGNATURE_HEADER,
    REDIRECTIONIO_START_TIME_HEADER,
    STATIC_ASSET_EXTENSIONS,
    stripNextRscSearchParam,
    verifyForwardedData,
    waitUntil,
} from "./common";
const { IS_VERCEL, REDIRECTIONIO_TOKEN } = getEnv();

type ResponseFinishMessage = { request: IncomingMessage; response: ServerResponse };

type RequestStartMessage = { request: IncomingMessage };

const STATIC_ASSET_REGEX = new RegExp(`\\.(?:${STATIC_ASSET_EXTENSIONS})(?:\\?|$)`, "i");

const LOG_RESPONSE_KEY = Symbol.for("@redirection.io/vercel-middleware/instrumentation");
const SOCKET_ADDRESSES_KEY = Symbol.for("@redirection.io/vercel-middleware/socket-addresses");

type InstrumentationGlobal = typeof globalThis & {
    [LOG_RESPONSE_KEY]?: (message: ResponseFinishMessage) => Promise<void>;
    [SOCKET_ADDRESSES_KEY]?: WeakMap<IncomingMessage, string | undefined>;
};

function getSocketAddresses() {
    const instrumentationGlobal = globalThis as InstrumentationGlobal;

    instrumentationGlobal[SOCKET_ADDRESSES_KEY] ??= new WeakMap();

    return instrumentationGlobal[SOCKET_ADDRESSES_KEY];
}

type RegisterInstrumentationConfig = {
    matcherRegex?: string | null;
};

export const registerRedirectionIoInstrumentation = async ({ matcherRegex }: RegisterInstrumentationConfig = {}) => {
    if (process.env.NEXT_RUNTIME !== "edge") {
        if (!REDIRECTIONIO_TOKEN) {
            console.warn("No REDIRECTIONIO_TOKEN environment variable found. Skipping redirection.io instrumentation.");

            return;
        }

        await redirectionio.init();

        const diagnostics = loadDiagnosticsChannel();

        const logResponse = async ({ request, response }: ResponseFinishMessage) => {
            const nextInternalMeta = Symbol.for("NextInternalRequestMeta");
            // @ts-expect-error
            const requestUrl = request[nextInternalMeta]
                ? // @ts-expect-error
                  request[nextInternalMeta].initURL
                : request.url;

            if (
                requestUrl.startsWith("/_next/") ||
                requestUrl.startsWith("/_vercel/") ||
                requestUrl.includes("/__nextjs") ||
                STATIC_ASSET_REGEX.test(requestUrl) ||
                !isPathMatched(new URL(requestUrl, "http://localhost").pathname, matcherRegex)
            ) {
                return; // Skip logging
            }

            if (
                (await isMiddlewareLoopRequest(request.headers[REDIRECTIONIO_MIDDLEWARE_HEADER])) ||
                isNextPrefetchRequest(request)
            ) {
                return;
            }

            // On Vercel, a Node.js middleware runs in its own invocation, which must not be logged as the request.
            // `next start` only exposes `x-middleware-rewrite` on the response of the rewritten page.
            if (
                response
                    .getHeaderNames()
                    .some((name) => name.startsWith("x-middleware-") && name !== "x-middleware-rewrite")
            ) {
                return;
            }

            // ISR renders requested by the Vercel cache, without client: the middleware logs the client requests
            if (request.headers["x-vercel-sc-host"] && !request.headers["x-vercel-forwarded-for"]) {
                return;
            }

            const statusCode = response.statusCode;

            const url = stripNextRscSearchParam(new URL(requestUrl, getRequestOrigin(request)));

            // Route params added by Vercel to the query of dynamic routes (e.g. ?nxtPslug=value)
            Array.from(url.searchParams.keys())
                .filter((name) => name.startsWith("nxtP") || name.startsWith("nxtI"))
                .forEach((name) => url.searchParams.delete(name));
            const forwarded = await readForwardedData(request, url);
            const forwardedData = forwarded?.data;

            if (forwardedData && !forwardedData.shouldLog) {
                return;
            }

            const now = Date.now();
            const proxyResponseTime = forwardedData?.proxyResponseTime ?? now;
            const actionMatchTime = forwardedData?.actionMatchTime ?? now;
            const startTimestamp = forwardedData?.startTimestamp ?? now;
            const actionStr = forwardedData?.action ?? "";

            const ip = getClientIp(request, getSocketAddresses().get(request));

            const logUrl = forwarded?.publicUrl ?? url;
            const redirectionIORequest = createRedirectionIORequest({
                url: logUrl,
                headers: request.headers,
                method: request.method!,
                ip,
            });

            let action: redirectionio.Action;

            if (!actionStr) {
                action = await fetchRedirectionIOAction(redirectionIORequest);
            } else {
                action = new redirectionio.Action(actionStr);
            }

            const responseHeaders: Array<[string, string]> = [];

            Object.entries(response.getHeaders()).forEach(([key, value]) => {
                if (key === "location" && typeof value === "string" && URL.canParse(value, logUrl)) {
                    responseHeaders.push([key, new URL(value, logUrl).href]);
                } else if (value) {
                    responseHeaders.push([key, value.toString()]);
                }
            });

            await logRequest({
                redirectionioRequest: redirectionIORequest,
                statusCode: response.statusCode,
                backendStatusCode: statusCode,
                responseHeaders,
                action,
                startTimestamp,
                actionMatchTime,
                proxyResponseTime,
                clientIP: ip,
            });
        };

        const instrumentationGlobal = globalThis as InstrumentationGlobal;
        const isSubscribed = instrumentationGlobal[LOG_RESPONSE_KEY] !== undefined;

        // Keep a single subscription across HMR reloads and repeated calls, with the latest config
        instrumentationGlobal[LOG_RESPONSE_KEY] = logResponse;

        if (isSubscribed) {
            return;
        }

        // The socket address is no longer readable once the connection is closed
        diagnostics.channel("http.server.request.start").subscribe((message) => {
            const { request } = message as RequestStartMessage;

            getSocketAddresses().set(request, request.socket.remoteAddress);
        });

        diagnostics.channel("http.server.response.finish").subscribe((message) => {
            try {
                const logLatestResponse = instrumentationGlobal[LOG_RESPONSE_KEY];

                if (!logLatestResponse) {
                    return;
                }

                waitUntil(
                    logLatestResponse(message as ResponseFinishMessage).catch((error) =>
                        console.error("redirection.io: unable to log the request.", error),
                    ),
                );
            } catch (error) {
                console.error("redirection.io: unable to log the request.", error);
            }
        });
    }
};

// Only the IP set by the Vercel platform can be trusted, any other header may be sent by the client
function getClientIp(request: IncomingMessage, socketAddress: string | undefined) {
    if (!IS_VERCEL) {
        return socketAddress ?? request.socket.remoteAddress;
    }

    const vercelIp = request.headers["x-real-ip"];

    return typeof vercelIp === "string" ? vercelIp : undefined;
}

// Bundlers provide require(), while a static or dynamic import makes Next.js warn when it bundles the Edge instrumentation
function loadDiagnosticsChannel(): typeof import("node:diagnostics_channel") {
    return typeof require === "function"
        ? require("node:diagnostics_channel")
        : globalThis.process.getBuiltinModule("node:diagnostics_channel");
}

function getRequestOrigin(request: IncomingMessage) {
    const firstValue = (value: string | string[] | undefined) =>
        (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim();
    const forwardedProto = firstValue(request.headers["x-forwarded-proto"]);
    const protocol =
        forwardedProto === "http" || forwardedProto === "https"
            ? forwardedProto
            : (request.socket as TLSSocket).encrypted
              ? "https"
              : "http";

    return `${protocol}://${firstValue(request.headers.host) || "localhost"}`;
}

function isNextPrefetchRequest(request: IncomingMessage) {
    return Boolean(request.headers["next-router-prefetch"] || request.headers["next-router-segment-prefetch"]);
}

// Vercel adds the query of a middleware rewrite to the URL seen by the function
function isPublicUrlOf(publicUrl: URL, url: URL) {
    return (
        publicUrl.origin === url.origin &&
        publicUrl.pathname === url.pathname &&
        Array.from(publicUrl.searchParams).every(([name, value]) => url.searchParams.getAll(name).includes(value))
    );
}

async function readForwardedData(
    request: IncomingMessage,
    url: URL,
): Promise<{ data: ForwardedMiddlewareData; publicUrl: URL } | null> {
    const headerValue = (name: string) => {
        const value = request.headers[name];

        return typeof value === "string" ? value : "";
    };
    const signature = headerValue(REDIRECTIONIO_SIGNATURE_HEADER);

    if (!signature) {
        return null;
    }

    const data: ForwardedMiddlewareData = {
        action: headerValue(REDIRECTIONIO_ACTION_HEADER),
        startTimestamp: Number(headerValue(REDIRECTIONIO_START_TIME_HEADER)),
        actionMatchTime: Number(headerValue(REDIRECTIONIO_MATCH_TIME_TIME_HEADER)),
        proxyResponseTime: Number(headerValue(REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER)),
        shouldLog: headerValue(REDIRECTIONIO_SHOULD_LOG_HEADER) === "1",
    };

    const pathAndQuery = headerValue(REDIRECTIONIO_REQUEST_URL_HEADER) || url.pathname + url.search;
    const publicUrl = URL.canParse(pathAndQuery, url) ? new URL(pathAndQuery, url) : null;

    if (!publicUrl || !isPublicUrlOf(publicUrl, url)) {
        return null;
    }

    const forwardedRequest: ForwardedRequest = { method: request.method ?? "", pathAndQuery };

    try {
        return (await verifyForwardedData(data, forwardedRequest, signature)) ? { data, publicUrl } : null;
    } catch (err) {
        console.error(err);

        return null;
    }
}
