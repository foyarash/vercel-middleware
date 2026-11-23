import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { getEnv } from "./env";
import { isPathMatched, STATIC_ASSET_EXTENSIONS } from "./matcher";

const { IS_VERCEL } = getEnv();

const STATIC_ASSET_REGEX = new RegExp(`\\.(?:${STATIC_ASSET_EXTENSIONS})(?:\\?|$)`, "i");

export function getRequestUrl(request: IncomingMessage): string {
    const meta: unknown = Object.getOwnPropertyDescriptor(request, Symbol.for("NextInternalRequestMeta"))?.value;

    if (meta && typeof meta === "object" && "initURL" in meta && typeof meta.initURL === "string") {
        return meta.initURL;
    }

    return request.url ?? "";
}

export function isIgnoredUrl(requestUrl: string, matcherRegex: string | null | undefined) {
    return (
        requestUrl.startsWith("/_next/") ||
        requestUrl.startsWith("/_vercel/") ||
        requestUrl.includes("/__nextjs") ||
        STATIC_ASSET_REGEX.test(requestUrl) ||
        !isPathMatched(new URL(requestUrl, "http://localhost").pathname, matcherRegex)
    );
}

export function isPlatformInternalRequest(request: IncomingMessage, response: ServerResponse) {
    // On Vercel, a Node.js middleware runs in its own invocation, which must not be logged as the request.
    // `next start` only exposes `x-middleware-rewrite` on the response of the rewritten page.
    if (response.getHeaderNames().some((name) => name.startsWith("x-middleware-") && name !== "x-middleware-rewrite")) {
        return true;
    }

    // ISR renders requested by the Vercel cache, without client: the middleware logs the client requests
    return Boolean(request.headers["x-vercel-sc-host"] && !request.headers["x-vercel-forwarded-for"]);
}

// Only the IP set by the Vercel platform can be trusted, any other header may be sent by the client
export function getClientIp(request: IncomingMessage, socketAddress: string | undefined) {
    if (!IS_VERCEL) {
        return socketAddress ?? request.socket.remoteAddress;
    }

    const vercelIp = request.headers["x-real-ip"];

    return typeof vercelIp === "string" ? vercelIp : undefined;
}

export function getRequestOrigin(request: IncomingMessage) {
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

// Route params added by Vercel to the query of dynamic routes (e.g. ?nxtPslug=value)
export function stripVercelRouteParams(url: URL) {
    Array.from(url.searchParams.keys())
        .filter((name) => name.startsWith("nxtP") || name.startsWith("nxtI"))
        .forEach((name) => url.searchParams.delete(name));
}

export function getLoggedResponseHeaders(response: ServerResponse, logUrl: URL) {
    const responseHeaders: Array<[string, string]> = [];

    Object.entries(response.getHeaders()).forEach(([key, value]) => {
        if (key === "location" && typeof value === "string" && URL.canParse(value, logUrl)) {
            responseHeaders.push([key, new URL(value, logUrl).href]);
        } else if (value) {
            responseHeaders.push([key, value.toString()]);
        }
    });

    return responseHeaders;
}
