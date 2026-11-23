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

const LOG_TIMEOUT_MS = 5_000;

export function shouldForwardHeader(name: string) {
    const lowerCaseName = name.toLowerCase();

    return (
        !SENSITIVE_HEADERS.includes(lowerCaseName) || REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS.includes(lowerCaseName)
    );
}

// Same lookup as `waitUntil` from `@vercel/functions`, whose entry point pulls an optional `ws` import that Next.js 14 cannot bundle.
export function waitUntil(promise: Promise<unknown>) {
    const store = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")];
    const context: unknown =
        store && typeof store === "object" && "get" in store && typeof store.get === "function"
            ? store.get()
            : undefined;

    if (context && typeof context === "object" && "waitUntil" in context && typeof context.waitUntil === "function") {
        context.waitUntil(promise);
    }
}

function fetchAgent(endpoint: "action" | "log", body: string, timeout: number) {
    return fetch("https://agent.redirection.io/" + REDIRECTIONIO_TOKEN + "/" + endpoint, {
        method: "POST",
        body,
        headers: {
            "User-Agent": REDIRECTIONIO_VERSION,
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
            REDIRECTIONIO_VERSION,
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
