import * as redirectionio from "@redirection.io/redirectionio";
import { getEnv } from "./env";

const {
    REDIRECTIONIO_TOKEN,
    REDIRECTIONIO_INSTANCE_NAME,
    REDIRECTIONIO_VERSION,
    REDIRECTIONIO_TIMEOUT,
    REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS,
} = getEnv();

const SENSITIVE_HEADERS = ["cookie", "authorization", "proxy-authorization", "x-api-key"];

function shouldForwardHeader(name: string) {
    const lowerCaseName = name.toLowerCase();

    return (
        !SENSITIVE_HEADERS.includes(lowerCaseName) || REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS.includes(lowerCaseName)
    );
}

export const REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER = "x-redirectionio-proxy-response-time";
export const REDIRECTIONIO_START_TIME_HEADER = "x-redirectionio-start-time";
export const REDIRECTIONIO_MATCH_TIME_TIME_HEADER = "x-redirectionio-action-match-time";
export const REDIRECTIONIO_ACTION_HEADER = "x-redirectionio-action";
export const REDIRECTIONIO_SIGNATURE_HEADER = "x-redirectionio-signature";
export const REDIRECTIONIO_MIDDLEWARE_HEADER = "x-redirectionio-middleware";
export const REDIRECTIONIO_SHOULD_LOG_HEADER = "x-redirectionio-should-log";

const DEFAULT_MATCHER_REGEX = "^/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)$";

export function isPathMatched(pathname: string, matcherRegex: string | null | undefined) {
    const regex = matcherRegex === undefined ? DEFAULT_MATCHER_REGEX : matcherRegex;

    return regex === null || new RegExp(regex).test(pathname);
}

export type ForwardedMiddlewareData = {
    action: string;
    startTimestamp: number;
    actionMatchTime: number;
    proxyResponseTime: number;
    shouldLog: boolean;
};

export type ForwardedRequest = {
    method: string;
    pathAndQuery: string;
};

const FORWARDED_DATA_MAX_AGE_MS = 60_000;

const textEncoder = new TextEncoder();

let signingKey: Promise<CryptoKey> | undefined;
let middlewareLoopMarker: Promise<string> | undefined;

function getSigningKey() {
    signingKey ??= crypto.subtle.importKey(
        "raw",
        textEncoder.encode(REDIRECTIONIO_TOKEN),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );

    return signingKey;
}

async function hmacHex(message: Uint8Array<ArrayBuffer>) {
    const signature = await crypto.subtle.sign("HMAC", await getSigningKey(), message);

    return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getMiddlewareLoopMarker(): Promise<string> {
    middlewareLoopMarker ??= hmacHex(textEncoder.encode(REDIRECTIONIO_MIDDLEWARE_HEADER));

    return middlewareLoopMarker;
}

export async function isMiddlewareLoopRequest(markerValue: string | string[] | null | undefined) {
    if (typeof markerValue !== "string" || !REDIRECTIONIO_TOKEN) {
        return false;
    }

    return markerValue === (await getMiddlewareLoopMarker());
}

function serializeForwardedData(
    { action, startTimestamp, actionMatchTime, proxyResponseTime, shouldLog }: ForwardedMiddlewareData,
    { method, pathAndQuery }: ForwardedRequest,
) {
    return textEncoder.encode(
        [
            method.toUpperCase(),
            pathAndQuery,
            startTimestamp,
            actionMatchTime,
            proxyResponseTime,
            shouldLog ? "1" : "0",
            action,
        ].join("\n"),
    );
}

export function signForwardedData(data: ForwardedMiddlewareData, request: ForwardedRequest) {
    return hmacHex(serializeForwardedData(data, request));
}

export async function verifyForwardedData(data: ForwardedMiddlewareData, request: ForwardedRequest, signature: string) {
    if (!/^[0-9a-f]{64}$/.test(signature)) {
        return false;
    }

    if (!(Math.abs(Date.now() - data.startTimestamp) <= FORWARDED_DATA_MAX_AGE_MS)) {
        return false;
    }

    const signatureBytes = new Uint8Array((signature.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));

    return crypto.subtle.verify("HMAC", await getSigningKey(), signatureBytes, serializeForwardedData(data, request));
}

const LOG_TIMEOUT_MS = 5_000;

function fetchAgent(endpoint: "action" | "log", body: string, timeout: number) {
    return fetch("https://agent.redirection.io/" + REDIRECTIONIO_TOKEN + "/" + endpoint, {
        method: "POST",
        body,
        headers: {
            "User-Agent": "vercel-edge-middleware/" + REDIRECTIONIO_VERSION,
            "x-redirectionio-instance-name": REDIRECTIONIO_INSTANCE_NAME,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
    });
}

function isTimeoutError(error: unknown) {
    return typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError";
}

export async function fetchRedirectionIOAction(redirectionIORequest: redirectionio.Request) {
    try {
        const response = await fetchAgent("action", redirectionIORequest.serialize().toString(), REDIRECTIONIO_TIMEOUT);

        if (!response.ok) {
            await response.body?.cancel();
            console.error(
                `redirection.io: the agent answered the action request with a ${response.status} status, no rule is applied.`,
            );

            return redirectionio.Action.empty();
        }

        const actionStr = await response.text();

        if (actionStr === "") {
            return redirectionio.Action.empty();
        }

        return new redirectionio.Action(actionStr);
    } catch (error) {
        if (isTimeoutError(error)) {
            console.error(
                `redirection.io: the agent did not answer the action request within ${REDIRECTIONIO_TIMEOUT}ms, no rule is applied.`,
            );
        } else {
            console.error("redirection.io: unable to fetch the action, no rule is applied.", error);
        }

        return redirectionio.Action.empty();
    }
}

type LogRequestParams = {
    redirectionioRequest: redirectionio.Request;
    statusCode: number;
    backendStatusCode: number;
    responseHeaders: Array<[string, string]>;
    action: redirectionio.Action;
    startTimestamp: number;
    actionMatchTime: number;
    proxyResponseTime: number;
    clientIP: string | undefined;
};

export async function logRequest({
    redirectionioRequest,
    statusCode,
    backendStatusCode,
    responseHeaders,
    action,
    startTimestamp,
    actionMatchTime,
    proxyResponseTime,
    clientIP,
}: LogRequestParams) {
    if (!action.should_log_request(backendStatusCode)) {
        return;
    }

    const responseHeaderMap = new redirectionio.HeaderMap();

    responseHeaders.forEach(([key, value]) => {
        responseHeaderMap.add_header(key, value);
    });

    try {
        const logAsJson = redirectionio.create_log_in_json(
            redirectionioRequest,
            statusCode,
            responseHeaderMap,
            action,
            "vercel-edge-middleware/" + REDIRECTIONIO_VERSION,
            BigInt(startTimestamp),
            BigInt(actionMatchTime),
            BigInt(proxyResponseTime),
            clientIP ?? "",
        );

        const response = await fetchAgent("log", logAsJson, LOG_TIMEOUT_MS);

        await response.body?.cancel();

        if (!response.ok) {
            console.error(
                `redirection.io: the agent answered the log request with a ${response.status} status, the request is not logged.`,
            );
        }
    } catch (error) {
        if (isTimeoutError(error)) {
            console.error(
                `redirection.io: the agent did not answer the log request within ${LOG_TIMEOUT_MS}ms, the request may not be logged.`,
            );
        } else {
            console.error("redirection.io: unable to log the request.", error);
        }
    }
}

type CreateRedirectionIORequestParams = {
    url: URL;
    method: string;
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
};

export function createRedirectionIORequest({ url, method, headers, ip }: CreateRedirectionIORequestParams) {
    const redirectionioRequest = new redirectionio.Request(
        url.pathname + url.search,
        url.host,
        url.protocol.replace(":", ""),
        method,
    );

    Object.entries(headers).forEach(([key, value]) => {
        if (!shouldForwardHeader(key)) {
            return;
        }

        (Array.isArray(value) ? value : [value]).forEach((headerValue) => {
            if (headerValue !== undefined) {
                redirectionioRequest.add_header(key, headerValue);
            }
        });
    });

    if (ip) {
        redirectionioRequest.set_remote_ip(ip);
    }

    return redirectionioRequest;
}

// Next strips `_rsc` (re-serializing the query) before the proxy runs, so both sides must normalize the same way.
export function stripNextRscSearchParam(url: URL): URL {
    const strippedUrl = new URL(url);

    strippedUrl.searchParams.delete("_rsc");

    return strippedUrl;
}
