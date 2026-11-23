import * as redirectionio from "@redirection.io/redirectionio";
import { next } from "@vercel/functions/middleware";
import { ipAddress } from "@vercel/functions/headers";
import { createRedirectionIORequest, fetchRedirectionIOAction, logRequest, waitUntil } from "./agent";
import { copyRequest, mergeMiddlewareResponses, middlewareResponseToRequest } from "./chained-middlewares";
import { getEnv } from "./env";
import { isPathMatched } from "./matcher";
import { getNextRequestKind, stripNextRscSearchParam } from "./next-request";
import { FetchResponse, proxy } from "./proxy";
import { getStaticResponseStatus } from "./routes";
import {
    forwardDataToBackend,
    getMiddlewareLoopMarker,
    isMiddlewareLoopRequest,
    REDIRECTIONIO_ACTION_HEADER,
    REDIRECTIONIO_MATCH_TIME_TIME_HEADER,
    REDIRECTIONIO_MIDDLEWARE_HEADER,
    REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER,
    REDIRECTIONIO_START_TIME_HEADER,
} from "./signature";
import { Middleware, RequestContext } from "./types";

const { IS_VERCEL, REDIRECTIONIO_TOKEN, REDIRECTIONIO_DEBUG_HEADERS } = getEnv();

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

        if (
            (await isMiddlewareLoopRequest(request.headers.get(REDIRECTIONIO_MIDDLEWARE_HEADER))) ||
            getNextRequestKind(request) === "server-action"
        ) {
            return next();
        }

        const publicUrl = new URL(request.url);

        let middlewareRequest = copyRequest(request, request.url);

        let previousResponse: Response | null = null;
        let hasCalledBackend = false;

        if (config.previousMiddleware) {
            previousResponse = await config.previousMiddleware(middlewareRequest.clone() as R, context);

            if (previousResponse.status !== 200) {
                return previousResponse;
            }

            middlewareRequest = middlewareResponseToRequest(middlewareRequest, previousResponse);
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
                    response = await config.nextMiddleware(request.clone() as R, context);

                    if (response.status !== 200) {
                        return mergeMiddlewareResponses(response, [previousResponse], false);
                    }

                    request = middlewareResponseToRequest(request, response);
                }

                if (!useFetch || getNextRequestKind(request) !== "document") {
                    return mergeMiddlewareResponses(next(), [previousResponse, response], true);
                }

                return mergeMiddlewareResponses(await fetchBackend(request), [previousResponse, response], false);
            },
        );

        return hasCalledBackend ? response : mergeMiddlewareResponses(response, [previousResponse], false);
    };
};

const defaultMiddleware = createRedirectionIoMiddleware({});

export default defaultMiddleware;

async function fetchBackend(request: Request) {
    const fetchResponse = await fetch(request, {
        redirect: "manual",
        cache: "no-store",
    });

    const backendResponse = new Response(fetchResponse.body, fetchResponse);

    // fetch() already decoded the body, keeping these headers makes Vercel send an empty body
    backendResponse.headers.delete("content-encoding");
    backendResponse.headers.delete("content-length");

    return backendResponse;
}

type Timings = {
    startTimestamp: number;
    actionMatchTime: number;
    proxyResponseTime: number;
};

function setDebugHeaders(response: Response, action: redirectionio.Action, timings: Timings) {
    response.headers.set(REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER, timings.proxyResponseTime.toString());
    response.headers.set(REDIRECTIONIO_START_TIME_HEADER, timings.startTimestamp.toString());
    response.headers.set(REDIRECTIONIO_MATCH_TIME_TIME_HEADER, timings.actionMatchTime.toString());
    response.headers.set(REDIRECTIONIO_ACTION_HEADER, action.serialize());
}

function getMiddlewareLogStatus(request: Request, response: Response) {
    const rewriteUrl = response.headers.get("x-middleware-rewrite");
    const isFinalResponse = !response.headers.has("x-middleware-next") && !rewriteUrl;
    const staticResponseStatus =
        isFinalResponse || !IS_VERCEL ? undefined : getStaticResponseStatus(request.method, rewriteUrl ?? request.url);
    // Outside Vercel, every response goes through the Node.js server, so the instrumentation logs all of them
    const isLoggedByMiddleware = IS_VERCEL && (isFinalResponse || staticResponseStatus !== undefined);

    return { isLoggedByMiddleware, staticResponseStatus };
}

// Next.js parses the Location of a middleware response without base URL, then sends it relative to the request
function makeLocationAbsolute(response: Response, url: URL) {
    const location = response.headers.get("Location");

    if (location && location.startsWith("/")) {
        response.headers.set("Location", url.origin + location);
    }
}

function getLoggedResponseHeaders(response: Response) {
    const responseHeaders: Array<[string, string]> = [];

    response.headers.forEach((value, key) => {
        if (!key.startsWith("x-middleware-")) {
            responseHeaders.push([key, value]);
        }
    });

    return responseHeaders;
}

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

    const ip = IS_VERCEL ? ipAddress(request) : undefined;
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

        return fetchResponse(request, action.need_proxification());
    });
    const timings: Timings = { startTimestamp, actionMatchTime, proxyResponseTime: Date.now() };

    if (REDIRECTIONIO_DEBUG_HEADERS) {
        setDebugHeaders(response, action, timings);
    }

    const { isLoggedByMiddleware, staticResponseStatus } = getMiddlewareLogStatus(request, response);

    await forwardDataToBackend(
        response,
        originalRequestHeaders,
        { action: action.serialize(), ...timings, shouldLog: isLogged && !isLoggedByMiddleware },
        { method: request.method, pathAndQuery: url.pathname + url.search },
    );

    makeLocationAbsolute(response, url);

    if (isLogged && isLoggedByMiddleware) {
        runInBackground(
            logRequest({
                redirectionioRequest: redirectionIORequest,
                statusCode: staticResponseStatus ?? response.status,
                backendStatusCode: staticResponseStatus ?? backendStatusCode,
                responseHeaders: getLoggedResponseHeaders(response),
                action,
                ...timings,
                clientIP: ip,
            }),
        );
    }

    return response;
}
