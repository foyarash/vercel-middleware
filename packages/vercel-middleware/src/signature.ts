import type { IncomingMessage } from "node:http";
import { getEnv } from "./env";

const { REDIRECTIONIO_TOKEN } = getEnv();

export const REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER = "x-redirectionio-proxy-response-time";
export const REDIRECTIONIO_START_TIME_HEADER = "x-redirectionio-start-time";
export const REDIRECTIONIO_MATCH_TIME_TIME_HEADER = "x-redirectionio-action-match-time";
export const REDIRECTIONIO_ACTION_HEADER = "x-redirectionio-action";
export const REDIRECTIONIO_SIGNATURE_HEADER = "x-redirectionio-signature";
export const REDIRECTIONIO_MIDDLEWARE_HEADER = "x-redirectionio-middleware";
export const REDIRECTIONIO_SHOULD_LOG_HEADER = "x-redirectionio-should-log";
export const REDIRECTIONIO_REQUEST_URL_HEADER = "x-redirectionio-request-url";

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

function hexToBytes(hex: string) {
    return new Uint8Array((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));
}

function isFresh(timestamp: number) {
    return Math.abs(Date.now() - timestamp) <= FORWARDED_DATA_MAX_AGE_MS;
}

type LoopRequest = { method: string; url: string };

// The query is left out: Next.js may re-serialize it before the middleware runs again
function serializeLoopMarker(timestamp: number, { method, url }: LoopRequest) {
    return textEncoder.encode(
        [REDIRECTIONIO_MIDDLEWARE_HEADER, timestamp, method.toUpperCase(), new URL(url).pathname].join("\n"),
    );
}

export async function createMiddlewareLoopMarker(request: LoopRequest): Promise<string> {
    const timestamp = Date.now();

    return timestamp + "." + (await hmacHex(serializeLoopMarker(timestamp, request)));
}

export async function isMiddlewareLoopRequest(
    markerValue: string | string[] | null | undefined,
    request: LoopRequest,
): Promise<boolean> {
    if (typeof markerValue !== "string" || !REDIRECTIONIO_TOKEN) {
        return false;
    }

    const [timestampValue, signature, ...rest] = markerValue.split(".");
    const timestamp = Number(timestampValue);

    if (rest.length > 0 || !Number.isSafeInteger(timestamp) || !/^[0-9a-f]{64}$/.test(signature ?? "")) {
        return false;
    }

    if (!isFresh(timestamp)) {
        return false;
    }

    return crypto.subtle.verify(
        "HMAC",
        await getSigningKey(),
        hexToBytes(signature),
        serializeLoopMarker(timestamp, request),
    );
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

    if (!isFresh(data.startTimestamp)) {
        return false;
    }

    return crypto.subtle.verify(
        "HMAC",
        await getSigningKey(),
        hexToBytes(signature),
        serializeForwardedData(data, request),
    );
}

export async function forwardDataToBackend(
    response: Response,
    originalRequestHeaders: Headers,
    data: ForwardedMiddlewareData,
    forwardedRequest: ForwardedRequest,
): Promise<void> {
    const forwardedHeaders = {
        [REDIRECTIONIO_ACTION_HEADER]: data.action,
        [REDIRECTIONIO_START_TIME_HEADER]: data.startTimestamp.toString(),
        [REDIRECTIONIO_MATCH_TIME_TIME_HEADER]: data.actionMatchTime.toString(),
        [REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER]: data.proxyResponseTime.toString(),
        [REDIRECTIONIO_SHOULD_LOG_HEADER]: data.shouldLog ? "1" : "0",
        [REDIRECTIONIO_REQUEST_URL_HEADER]: forwardedRequest.pathAndQuery,
        [REDIRECTIONIO_SIGNATURE_HEADER]: await signForwardedData(data, forwardedRequest),
    };
    const existingOverride = response.headers.get("x-middleware-override-headers");
    const overriddenHeaders = new Set(existingOverride ? existingOverride.split(",").map((name) => name.trim()) : []);

    if (!existingOverride) {
        originalRequestHeaders.forEach((value, key) => {
            overriddenHeaders.add(key);
            response.headers.set("x-middleware-request-" + key, value);
        });
    }

    Object.entries(forwardedHeaders).forEach(([key, value]) => {
        overriddenHeaders.add(key);
        response.headers.set("x-middleware-request-" + key, value);
    });

    overriddenHeaders.delete(REDIRECTIONIO_MIDDLEWARE_HEADER);
    response.headers.delete("x-middleware-request-" + REDIRECTIONIO_MIDDLEWARE_HEADER);
    response.headers.set("x-middleware-override-headers", Array.from(overriddenHeaders).join(","));
}

// Vercel adds the query of a middleware rewrite to the URL seen by the function
function isPublicUrlOf(publicUrl: URL, url: URL) {
    return (
        publicUrl.origin === url.origin &&
        publicUrl.pathname === url.pathname &&
        Array.from(publicUrl.searchParams).every(([name, value]) => url.searchParams.getAll(name).includes(value))
    );
}

export async function readForwardedData(
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
