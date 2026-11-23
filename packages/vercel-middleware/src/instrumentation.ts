import * as redirectionio from "@redirection.io/redirectionio";
import { waitUntil } from "@vercel/functions";
import { getEnv } from "./env";
import { IncomingMessage, ServerResponse } from "http";
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
    REDIRECTIONIO_SHOULD_LOG_HEADER,
    REDIRECTIONIO_SIGNATURE_HEADER,
    REDIRECTIONIO_START_TIME_HEADER,
    stripNextRscSearchParam,
    verifyForwardedData,
} from "./common";
const { REDIRECTIONIO_TOKEN } = getEnv();

type ResponseFinishMessage = { request: IncomingMessage; response: ServerResponse };

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

        const diagnostics = require("diagnostics_channel");
        const channel = diagnostics.channel("http.server.response.finish");

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
                /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json)(\?|$)/i.test(requestUrl) ||
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

            // On Vercel, a Node.js middleware runs in its own invocation, which must not be logged as the request
            if (response.getHeaderNames().some((name) => name.startsWith("x-middleware-"))) {
                return;
            }

            // ISR renders requested by the Vercel cache, without client: the middleware logs the client requests
            if (request.headers["x-vercel-sc-host"] && !request.headers["x-vercel-forwarded-for"]) {
                return;
            }

            const statusCode = response.statusCode;

            const url = stripNextRscSearchParam(
                new URL(requestUrl, `${request.headers["x-forwarded-proto"]}://${request.headers.host}`),
            );

            // Route params added by Vercel to the query of dynamic routes (e.g. ?nxtPslug=value)
            Array.from(url.searchParams.keys())
                .filter((name) => name.startsWith("nxtP") || name.startsWith("nxtI"))
                .forEach((name) => url.searchParams.delete(name));
            const forwardedData = await readForwardedData(request, {
                method: request.method ?? "",
                pathAndQuery: url.pathname + url.search,
            });

            if (forwardedData && !forwardedData.shouldLog) {
                return;
            }

            const now = Date.now();
            const proxyResponseTime = forwardedData?.proxyResponseTime ?? now;
            const actionMatchTime = forwardedData?.actionMatchTime ?? now;
            const startTimestamp = forwardedData?.startTimestamp ?? now;
            const actionStr = forwardedData?.action ?? "";

            const ip = (request.headers["x-real-ip"] as string) || request.socket.remoteAddress;

            const redirectionIORequest = createRedirectionIORequest({
                url,
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
                if (value) {
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

        channel.subscribe((message: ResponseFinishMessage) => {
            waitUntil(logResponse(message).catch((err) => console.error(err)));
        });
    }
};

function isNextPrefetchRequest(request: IncomingMessage) {
    return Boolean(request.headers["next-router-prefetch"] || request.headers["next-router-segment-prefetch"]);
}

async function readForwardedData(
    request: IncomingMessage,
    forwardedRequest: ForwardedRequest,
): Promise<ForwardedMiddlewareData | null> {
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

    try {
        return (await verifyForwardedData(data, forwardedRequest, signature)) ? data : null;
    } catch (err) {
        console.error(err);

        return null;
    }
}
