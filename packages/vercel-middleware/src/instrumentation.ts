import * as redirectionio from "@redirection.io/redirectionio";
import { getEnv } from "./env";
import { IncomingMessage, ServerResponse } from "http";
import {
    createRedirectionIORequest,
    fetchRedirectionIOAction,
    ForwardedMiddlewareData,
    REDIRECTIONIO_ACTION_HEADER,
    REDIRECTIONIO_MATCH_TIME_TIME_HEADER,
    REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER,
    REDIRECTIONIO_SIGNATURE_HEADER,
    REDIRECTIONIO_START_TIME_HEADER,
    verifyForwardedData,
} from "./common";
const { REDIRECTIONIO_TOKEN, REDIRECTIONIO_INSTANCE_NAME, REDIRECTIONIO_VERSION } = getEnv();

export const registerRedirectionIoInstrumentation = async () => {
    if (process.env.NEXT_RUNTIME !== "edge") {
        if (!REDIRECTIONIO_TOKEN) {
            console.warn("No REDIRECTIONIO_TOKEN environment variable found. Skipping redirection.io instrumentation.");

            return;
        }

        await redirectionio.init();

        const diagnostics = require("diagnostics_channel");
        const channel = diagnostics.channel("http.server.response.finish");

        channel.subscribe(async (message: { request: IncomingMessage; response: ServerResponse }) => {
            const { request, response } = message;
            const nextInternalMeta = Symbol.for("NextInternalRequestMeta");
            // @ts-expect-error
            const requestUrl = request[nextInternalMeta]
                ? // @ts-expect-error
                  request[nextInternalMeta].initURL
                : request.url;

            if (
                requestUrl.startsWith("/_next/") ||
                requestUrl.includes("/__nextjs") ||
                /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json)(\?|$)/i.test(requestUrl)
            ) {
                return; // Skip logging
            }

            const isRioMiddlewareRequest = request.headers["x-redirectionio-middleware"] === "true";

            if (isRioMiddlewareRequest) {
                return;
            }

            const statusCode = response.statusCode;

            const forwardedData = await readForwardedData(request);
            const now = Date.now();
            const proxyResponseTime = forwardedData?.proxyResponseTime ?? now;
            const actionMatchTime = forwardedData?.actionMatchTime ?? now;
            const startTimestamp = forwardedData?.startTimestamp ?? now;
            const actionStr = forwardedData?.action ?? "";

            const ip = (request.headers["x-real-ip"] as string) || request.socket.remoteAddress;

            const redirectionIORequest = createRedirectionIORequest({
                url: new URL(requestUrl, `${request.headers["x-forwarded-proto"]}://${request.headers.host}`),
                headers: request.headers as Record<string, string>,
                method: request.method!,
                ip,
            });

            let action: redirectionio.Action;

            if (!actionStr) {
                action = await fetchRedirectionIOAction(redirectionIORequest);
            } else {
                action = new redirectionio.Action(actionStr);
            }

            await log(
                response,
                statusCode,
                redirectionIORequest,
                startTimestamp,
                actionMatchTime,
                proxyResponseTime,
                action,
                ip,
            );
        });
    }
};

async function readForwardedData(request: IncomingMessage): Promise<ForwardedMiddlewareData | null> {
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
    };

    try {
        return (await verifyForwardedData(data, signature)) ? data : null;
    } catch (err) {
        console.error(err);

        return null;
    }
}

async function log(
    response: ServerResponse,
    backendStatusCode: number,
    redirectionioRequest: redirectionio.Request,
    startTimestamp: number,
    actionMatchTime: number,
    proxyResponseTime: number,
    action: redirectionio.Action,
    clientIP: string | undefined,
) {
    if (response === null) {
        return;
    }

    const responseHeaderMap = new redirectionio.HeaderMap();

    Object.entries(response.getHeaders()).forEach(([key, value]) => {
        if (value) {
            responseHeaderMap.add_header(key, value.toString());
        }
    });

    if (action && !action.should_log_request(backendStatusCode)) {
        return;
    }

    try {
        const logAsJson = redirectionio.create_log_in_json(
            redirectionioRequest,
            response.statusCode,
            responseHeaderMap,
            action,
            "vercel-edge-middleware/" + REDIRECTIONIO_VERSION,
            BigInt(startTimestamp),
            BigInt(actionMatchTime),
            BigInt(proxyResponseTime),
            clientIP ?? "",
        );

        return await fetch("https://agent.redirection.io/" + REDIRECTIONIO_TOKEN + "/log", {
            method: "POST",
            body: logAsJson,
            headers: {
                "User-Agent": "vercel-edge-middleware/" + REDIRECTIONIO_VERSION,
                "x-redirectionio-instance-name": REDIRECTIONIO_INSTANCE_NAME,
            },
            cache: "no-store",
        });
    } catch (err) {
        console.error(err);
    }
}
