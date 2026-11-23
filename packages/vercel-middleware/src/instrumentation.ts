import * as redirectionio from "@redirection.io/redirectionio";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRedirectionIORequest, fetchRedirectionIOAction, logRequest, waitUntil } from "./agent";
import { getEnv } from "./env";
import {
    getClientIp,
    getLoggedResponseHeaders,
    getRequestOrigin,
    getRequestUrl,
    isIgnoredUrl,
    isPlatformInternalRequest,
    stripVercelRouteParams,
} from "./incoming-request";
import { isNextPrefetchRequest, stripNextRscSearchParam } from "./next-request";
import { isMiddlewareLoopRequest, readForwardedData, REDIRECTIONIO_MIDDLEWARE_HEADER } from "./signature";

const { REDIRECTIONIO_TOKEN } = getEnv();

type ResponseFinishMessage = { request: IncomingMessage; response: ServerResponse };

type RequestStartMessage = { request: IncomingMessage };

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

async function shouldSkipRequest(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: string,
    matcherRegex: string | null | undefined,
) {
    return (
        isIgnoredUrl(requestUrl, matcherRegex) ||
        (await isMiddlewareLoopRequest(request.headers[REDIRECTIONIO_MIDDLEWARE_HEADER], {
            method: request.method ?? "",
            url: new URL(requestUrl, "http://localhost").href,
        })) ||
        isNextPrefetchRequest(request) ||
        isPlatformInternalRequest(request, response)
    );
}

async function logResponse({ request, response }: ResponseFinishMessage, matcherRegex: string | null | undefined) {
    const requestUrl = getRequestUrl(request);

    if (await shouldSkipRequest(request, response, requestUrl, matcherRegex)) {
        return;
    }

    const url = stripNextRscSearchParam(new URL(requestUrl, getRequestOrigin(request)));

    stripVercelRouteParams(url);

    const forwarded = await readForwardedData(request, url);
    const forwardedData = forwarded?.data;

    if (forwardedData && !forwardedData.shouldLog) {
        return;
    }

    const now = Date.now();
    const ip = getClientIp(request, getSocketAddresses().get(request));
    const logUrl = forwarded?.publicUrl ?? url;
    const redirectionIORequest = createRedirectionIORequest({
        url: logUrl,
        headers: request.headers,
        method: request.method!,
        ip,
    });
    const action = forwardedData?.action
        ? new redirectionio.Action(forwardedData.action)
        : await fetchRedirectionIOAction(redirectionIORequest);

    await logRequest({
        redirectionioRequest: redirectionIORequest,
        statusCode: response.statusCode,
        backendStatusCode: response.statusCode,
        responseHeaders: getLoggedResponseHeaders(response, logUrl),
        action,
        startTimestamp: forwardedData?.startTimestamp ?? now,
        actionMatchTime: forwardedData?.actionMatchTime ?? now,
        proxyResponseTime: forwardedData?.proxyResponseTime ?? now,
        clientIP: ip,
    });
}

function subscribe(diagnostics: typeof import("node:diagnostics_channel")) {
    const instrumentationGlobal = globalThis as InstrumentationGlobal;

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

export const registerRedirectionIoInstrumentation = async ({ matcherRegex }: RegisterInstrumentationConfig = {}) => {
    if (process.env.NEXT_RUNTIME !== "edge") {
        if (!REDIRECTIONIO_TOKEN) {
            console.warn("No REDIRECTIONIO_TOKEN environment variable found. Skipping redirection.io instrumentation.");

            return;
        }

        await redirectionio.init();

        const diagnostics = loadDiagnosticsChannel();
        const instrumentationGlobal = globalThis as InstrumentationGlobal;
        const isSubscribed = instrumentationGlobal[LOG_RESPONSE_KEY] !== undefined;

        // Keep a single subscription across HMR reloads and repeated calls, with the latest config
        instrumentationGlobal[LOG_RESPONSE_KEY] = (message) => logResponse(message, matcherRegex);

        if (isSubscribed) {
            return;
        }

        subscribe(diagnostics);
    }
};

// Bundlers provide require(), while a static or dynamic import makes Next.js warn when it bundles the Edge instrumentation
function loadDiagnosticsChannel(): typeof import("node:diagnostics_channel") {
    return typeof require === "function"
        ? require("node:diagnostics_channel")
        : globalThis.process.getBuiltinModule("node:diagnostics_channel");
}
