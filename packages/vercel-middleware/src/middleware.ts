import * as redirectionio from "@redirection.io/redirectionio";
import { next, RequestContext } from "@vercel/edge";
import { ipAddress, waitUntil } from "@vercel/functions";
import {
    createRedirectionIORequest,
    logRequest,
    ForwardedMiddlewareData,
    ForwardedRequest,
    getMiddlewareLoopMarker,
    isMiddlewareLoopRequest,
    isPathMatched,
    REDIRECTIONIO_ACTION_HEADER,
    REDIRECTIONIO_MATCH_TIME_TIME_HEADER,
    REDIRECTIONIO_MIDDLEWARE_HEADER,
    REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER,
    REDIRECTIONIO_REQUEST_URL_HEADER,
    REDIRECTIONIO_SHOULD_LOG_HEADER,
    REDIRECTIONIO_SIGNATURE_HEADER,
    REDIRECTIONIO_START_TIME_HEADER,
    signForwardedData,
    stripNextRscSearchParam,
} from "./common";
import { getEnv } from "./env";
import { getStaticResponseStatus } from "./routes";
import { Middleware } from "./types";

const {
    REDIRECTIONIO_TOKEN,
    REDIRECTIONIO_INSTANCE_NAME,
    REDIRECTIONIO_VERSION,
    REDIRECTIONIO_ADD_HEADER_RULE_IDS,
    REDIRECTIONIO_DEBUG_HEADERS,
    REDIRECTIONIO_TIMEOUT,
} = getEnv();

type FetchResponse = (request: Request, useFetch: boolean) => Promise<Response>;

type CreateMiddlewareConfig<R extends Request = Request, C extends RequestContext = RequestContext> = {
    previousMiddleware?: Middleware<R, C>;
    nextMiddleware?: Middleware<R, C>;
    matcherRegex?: string | null;
    logged?: boolean;
    includedRequestHeadersInResponse?: string[];
};

export const createRedirectionIoMiddleware = <R extends Request = Request, C extends RequestContext = RequestContext>(
    config: CreateMiddlewareConfig<R, C>,
): Middleware<R, C> => {
    return async (request, context) => {
        if (!isPathMatched(new URL(request.url).pathname, config.matcherRegex)) {
            return next();
        }

        // Avoid infinite loop
        if (
            (await isMiddlewareLoopRequest(request.headers.get(REDIRECTIONIO_MIDDLEWARE_HEADER))) ||
            getNextRequestKind(request) === "server-action"
        ) {
            return next();
        }

        const body = request.body ? await request.arrayBuffer() : null;
        const publicUrl = new URL(request.url);

        let middlewareRequest = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body,
        });

        let previousResponse: Response | null = null;
        let hasCalledBackend = false;

        if (config.previousMiddleware) {
            previousResponse = await config.previousMiddleware(middlewareRequest as R, context);

            if (previousResponse.status !== 200) {
                return previousResponse;
            }

            middlewareRequest = middlewareResponseToRequest(middlewareRequest, previousResponse, body);
        }

        const response = await handler(
            publicUrl,
            middlewareRequest,
            config.includedRequestHeadersInResponse,
            config.logged ?? true,
            (promise) => (context?.waitUntil ? context.waitUntil(promise) : waitUntil(promise)),
            async (request, useFetch): Promise<Response> => {
                let response: Response | null = null;
                hasCalledBackend = true;

                if (config.nextMiddleware) {
                    response = await config.nextMiddleware(request as R, context);

                    if (response.status !== 200) {
                        return mergeMiddlewareResponses(response, [previousResponse], false);
                    }

                    request = middlewareResponseToRequest(request, response, body);
                }

                if (!useFetch || getNextRequestKind(request) !== "document") {
                    return mergeMiddlewareResponses(next(), [previousResponse, response], true);
                }

                const fetchResponse = await fetch(request, {
                    redirect: "manual",
                    cache: "no-store",
                });

                const backendResponse = new Response(fetchResponse.body, fetchResponse);

                // fetch() already decoded the body, keeping these headers makes Vercel send an empty body
                backendResponse.headers.delete("content-encoding");
                backendResponse.headers.delete("content-length");

                return mergeMiddlewareResponses(backendResponse, [previousResponse, response], false);
            },
        );

        return hasCalledBackend ? response : mergeMiddlewareResponses(response, [previousResponse], false);
    };
};

type NextRequestKind = "server-action" | "rsc" | "document";

function getNextRequestKind(request: Request): NextRequestKind {
    const { headers } = request;

    if (headers.get("next-action")) {
        return "server-action";
    }

    if (
        headers.get("rsc") === "1" ||
        headers.has("next-router-prefetch") ||
        headers.has("next-router-segment-prefetch") ||
        headers.has("next-router-state-tree") ||
        headers.get("accept")?.includes("text/x-component") ||
        new URL(request.url).searchParams.has("_rsc")
    ) {
        return "rsc";
    }

    return "document";
}

const defaultMiddleware = createRedirectionIoMiddleware({});

export default defaultMiddleware;

async function handler(
    publicUrl: URL,
    request: Request,
    includedRequestHeadersInResponse: string[] | undefined,
    isLogged: boolean,
    runInBackground: (promise: Promise<unknown>) => void,
    fetchResponse: FetchResponse,
): Promise<Response> {
    if (!REDIRECTIONIO_TOKEN) {
        console.warn("No REDIRECTIONIO_TOKEN environment variable found. Skipping redirection.io middleware.");

        return fetchResponse(request, false);
    }

    const startTimestamp = Date.now();
    const originalRequestHeaders = new Headers(request.headers);

    await redirectionio.init();

    const ip = ipAddress(request);
    const url = stripNextRscSearchParam(new URL(publicUrl));
    const redirectionIORequest = createRedirectionIORequest({
        url,
        headers: Object.fromEntries(request.headers),
        method: request.method,
        ip,
    });
    const action = await fetchRedirectionIOAction(redirectionIORequest);
    const actionMatchTime = Date.now();
    const middlewareLoopMarker = await getMiddlewareLoopMarker();
    const [response, backendStatusCode] = await proxy(request, action, includedRequestHeadersInResponse, (request) => {
        request.headers.set(REDIRECTIONIO_MIDDLEWARE_HEADER, middlewareLoopMarker);

        // skip fetch if we are in light mode
        return fetchResponse(request, action.need_proxification());
    });

    const proxyResponseTime = Date.now();

    if (REDIRECTIONIO_DEBUG_HEADERS) {
        response.headers.set(REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER, proxyResponseTime.toString());
        response.headers.set(REDIRECTIONIO_START_TIME_HEADER, startTimestamp.toString());
        response.headers.set(REDIRECTIONIO_MATCH_TIME_TIME_HEADER, actionMatchTime.toString());
        response.headers.set(REDIRECTIONIO_ACTION_HEADER, action.serialize());
    }

    const rewriteUrl = response.headers.get("x-middleware-rewrite");
    const isFinalResponse = !response.headers.has("x-middleware-next") && !rewriteUrl;
    const staticResponseStatus = isFinalResponse
        ? undefined
        : getStaticResponseStatus(request.method, rewriteUrl ?? request.url);
    const isLoggedByMiddleware = isFinalResponse || staticResponseStatus !== undefined;

    await forwardDataToBackend(
        response,
        originalRequestHeaders,
        {
            action: action.serialize(),
            startTimestamp,
            actionMatchTime,
            proxyResponseTime,
            shouldLog: isLogged && !isLoggedByMiddleware,
        },
        { method: request.method, pathAndQuery: url.pathname + url.search },
    );

    const location = response.headers.get("Location");

    // Next.js parses the Location of a middleware response without base URL, then sends it relative to the request
    if (location && location.startsWith("/")) {
        response.headers.set("Location", url.origin + location);
    }

    if (isLogged && isLoggedByMiddleware) {
        const responseHeaders: Array<[string, string]> = [];

        response.headers.forEach((value, key) => {
            if (!key.startsWith("x-middleware-")) {
                responseHeaders.push([key, value]);
            }
        });

        runInBackground(
            logRequest({
                redirectionioRequest: redirectionIORequest,
                statusCode: staticResponseStatus ?? response.status,
                backendStatusCode: staticResponseStatus ?? backendStatusCode,
                responseHeaders,
                action,
                startTimestamp,
                actionMatchTime,
                proxyResponseTime,
                clientIP: ip,
            }),
        );
    }

    return response;
}

async function forwardDataToBackend(
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

function splitSetCookies(cookiesString: string) {
    const cookiesStrings = [];
    let pos = 0;
    let start;
    let ch;
    let lastComma;
    let nextStart;
    let cookiesSeparatorFound;

    function skipWhitespace() {
        while (pos < cookiesString.length && /\s/.test(cookiesString.charAt(pos))) {
            pos += 1;
        }
        return pos < cookiesString.length;
    }

    function notSpecialChar() {
        ch = cookiesString.charAt(pos);

        return ch !== "=" && ch !== ";" && ch !== ",";
    }

    while (pos < cookiesString.length) {
        start = pos;
        cookiesSeparatorFound = false;

        while (skipWhitespace()) {
            ch = cookiesString.charAt(pos);
            if (ch === ",") {
                // ',' is a cookie separator if we have later first '=', not ';' or ','
                lastComma = pos;
                pos += 1;

                skipWhitespace();
                nextStart = pos;

                while (pos < cookiesString.length && notSpecialChar()) {
                    pos += 1;
                }

                // currently special character
                if (pos < cookiesString.length && cookiesString.charAt(pos) === "=") {
                    // we found cookies separator
                    cookiesSeparatorFound = true;
                    // pos is inside the next cookie, so back up and return it.
                    pos = nextStart;
                    cookiesStrings.push(cookiesString.substring(start, lastComma));
                    start = pos;
                } else {
                    // in param ',' or param separator ';',
                    // we continue from that comma
                    pos = lastComma + 1;
                }
            } else {
                pos += 1;
            }
        }

        if (!cookiesSeparatorFound || pos >= cookiesString.length) {
            cookiesStrings.push(cookiesString.substring(start, cookiesString.length));
        }
    }

    return cookiesStrings;
}

function mergeMiddlewareResponses(
    target: Response,
    middlewareResponses: Array<Response | null>,
    isPassThrough: boolean,
): Response {
    for (const source of middlewareResponses) {
        if (!source) {
            continue;
        }

        if (isPassThrough && source.headers.has("x-middleware-override-headers")) {
            Array.from(target.headers.keys())
                .filter((key) => key.startsWith("x-middleware-request-"))
                .forEach((key) => target.headers.delete(key));
        }

        source.headers.forEach((value, key) => {
            if (key === "set-cookie") {
                target.headers.append(key, value);
            } else if (!key.startsWith("x-middleware-")) {
                target.headers.set(key, value);
            } else if (isPassThrough && key === "x-middleware-set-cookie") {
                const existingValue = target.headers.get(key);
                target.headers.set(key, existingValue ? existingValue + "," + value : value);
            } else if (isPassThrough && key !== "x-middleware-next") {
                target.headers.set(key, value);
            }
        });
    }

    if (target.headers.has("x-middleware-rewrite")) {
        target.headers.delete("x-middleware-next");
    }

    return target;
}

function middlewareResponseToRequest(originalRequest: Request, response: Response, body: ArrayBuffer | null): Request {
    let request = originalRequest;

    if (response.headers.has("x-middleware-rewrite")) {
        const newUrl = response.headers.get("x-middleware-rewrite");

        if (newUrl) {
            request = new Request(newUrl, {
                method: request.method,
                headers: request.headers,
                body,
            });
        }
    }

    if (response.headers.has("x-middleware-override-headers")) {
        const headersToOverride = response.headers.get("x-middleware-override-headers");

        if (headersToOverride) {
            headersToOverride.split(",").forEach((header) => {
                const value = response.headers.get("x-middleware-request-" + header);

                if (value) {
                    request.headers.set(header, value);
                }
            });
        }
    }

    const middlewareCookies = response.headers.get("x-middleware-set-cookie");

    if (middlewareCookies) {
        const cookies = new Map(
            (request.headers.get("cookie") ?? "")
                .split(";")
                .map((cookie) => cookie.trim())
                .filter(Boolean)
                .map((cookie) => [cookie.split("=")[0], cookie]),
        );

        splitSetCookies(middlewareCookies).forEach((setCookie) => {
            const cookie = setCookie.split(";")[0].trim();
            cookies.set(cookie.split("=")[0], cookie);
        });

        request.headers.set("cookie", Array.from(cookies.values()).join("; "));
    }

    return request;
}

async function fetchRedirectionIOAction(redirectionIORequest: redirectionio.Request) {
    try {
        const response = (await Promise.race([
            fetch("https://agent.redirection.io/" + REDIRECTIONIO_TOKEN + "/action", {
                method: "POST",
                body: redirectionIORequest.serialize().toString(),
                headers: {
                    "User-Agent": "vercel-edge-middleware/" + REDIRECTIONIO_VERSION,
                    "x-redirectionio-instance-name": REDIRECTIONIO_INSTANCE_NAME,
                },
                cache: "no-store",
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), REDIRECTIONIO_TIMEOUT)),
        ])) as Response;

        const actionStr = await response.text();

        if (actionStr === "") {
            return redirectionio.Action.empty();
        }

        return new redirectionio.Action(actionStr);
    } catch (e) {
        console.error(e);

        return redirectionio.Action.empty();
    }
}

/* Redirection.io logic */
async function proxy(
    request: Request,
    action: redirectionio.Action,
    includedRequestHeadersInResponse: string[] | undefined,
    fetchResponse: FetchResponse,
): Promise<[Response, number]> {
    try {
        const statusCodeBeforeResponse = action.get_status_code(0);

        let response;

        if (statusCodeBeforeResponse === 0) {
            response = await fetchResponse(request, true);
        } else {
            response = new Response("", {
                status: Number(statusCodeBeforeResponse),
            });
        }

        const backendStatusCode = response.status;
        const statusCodeAfterResponse = action.get_status_code(backendStatusCode);
        let status = response.status;

        if (statusCodeAfterResponse !== 0) {
            status = Number(statusCodeAfterResponse);
        }

        const headerMap = new redirectionio.HeaderMap();

        response.headers.forEach((value, key) => {
            if (key === "set-cookie") {
                const cookies = splitSetCookies(value);

                for (const cookie of cookies) {
                    headerMap.add_header("set-cookie", cookie);
                }
            } else {
                headerMap.add_header(key, value);
            }
        });

        request.headers.forEach((value, key) => {
            if (includedRequestHeadersInResponse?.includes(key)) {
                headerMap.add_header(key, value);
            }
        });

        const newHeaderMap = action.filter_headers(headerMap, backendStatusCode, REDIRECTIONIO_ADD_HEADER_RULE_IDS);
        const newHeaders = new Headers();

        for (let i = 0; i < newHeaderMap.len(); i++) {
            const headerName = newHeaderMap.get_header_name(i);

            if (headerName && headerName.length > 0) {
                newHeaders.append(headerName, newHeaderMap.get_header_value(i));
            }
        }

        response = new Response(response.body, {
            status: status,
            statusText: response.statusText,
            headers: newHeaders,
        });

        newHeaderMap.remove_header("content-encoding");
        const bodyFilter = action.create_body_filter(backendStatusCode, newHeaderMap);

        if (bodyFilter.is_null() || getNextRequestKind(request) !== "document") {
            return [response, response.status];
        }

        const filteredHeaders = new Headers(response.headers);

        filteredHeaders.delete("content-encoding");
        filteredHeaders.delete("content-length");

        const { readable, writable } = new TransformStream();

        createBodyFilter(response.body, writable, bodyFilter);

        return [
            new Response(readable, {
                status: response.status,
                statusText: response.statusText,
                headers: filteredHeaders,
            }),
            backendStatusCode,
        ];
    } catch (err) {
        console.error(err);
        const response = await fetchResponse(request, true);

        return [response, response.status];
    }
}

async function createBodyFilter(
    readable: ReadableStream<Uint8Array> | null,
    writable: WritableStream,
    bodyFilter: redirectionio.BodyFilter,
) {
    const writer = writable.getWriter();
    const reader = readable?.getReader();

    try {
        if (!reader) {
            const filteredData = bodyFilter.filter(new Uint8Array());

            if (filteredData) {
                await writer.write(filteredData);
            }

            const lastData = bodyFilter.end();

            if (lastData) {
                await writer.write(lastData);
            }

            await writer.close();

            return;
        }

        let data = await reader.read();

        while (!data.done) {
            const filteredData = bodyFilter.filter(data.value);

            if (filteredData) {
                await writer.write(filteredData);
            }

            data = await reader.read();
        }

        const lastData = bodyFilter.end();

        if (lastData) {
            await writer.write(lastData);
        }

        await writer.close();
    } catch (error) {
        console.error(error);

        await Promise.allSettled([writer.abort(error), reader?.cancel(error)]);
    } finally {
        reader?.releaseLock();
    }
}
