import * as redirectionio from "@redirection.io/redirectionio";
import { getEnv } from "./env";

const { REDIRECTIONIO_TOKEN, REDIRECTIONIO_INSTANCE_NAME, REDIRECTIONIO_VERSION, REDIRECTIONIO_TIMEOUT } = getEnv();

export const REDIRECTIONIO_PROXY_RESPONSE_TIME_HEADER = "x-redirectionio-proxy-response-time";
export const REDIRECTIONIO_START_TIME_HEADER = "x-redirectionio-start-time";
export const REDIRECTIONIO_MATCH_TIME_TIME_HEADER = "x-redirectionio-action-match-time";
export const REDIRECTIONIO_ACTION_HEADER = "x-redirectionio-action";
export const REDIRECTIONIO_SIGNATURE_HEADER = "x-redirectionio-signature";

export type ForwardedMiddlewareData = {
    action: string;
    startTimestamp: number;
    actionMatchTime: number;
    proxyResponseTime: number;
};

const textEncoder = new TextEncoder();

function importSigningKey() {
    return crypto.subtle.importKey(
        "raw",
        textEncoder.encode(REDIRECTIONIO_TOKEN),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );
}

function serializeForwardedData({
    action,
    startTimestamp,
    actionMatchTime,
    proxyResponseTime,
}: ForwardedMiddlewareData) {
    return textEncoder.encode([startTimestamp, actionMatchTime, proxyResponseTime, action].join("\n"));
}

export async function signForwardedData(data: ForwardedMiddlewareData) {
    const signature = await crypto.subtle.sign("HMAC", await importSigningKey(), serializeForwardedData(data));

    return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyForwardedData(data: ForwardedMiddlewareData, signature: string) {
    if (!/^[0-9a-f]{64}$/.test(signature)) {
        return false;
    }

    const signatureBytes = new Uint8Array((signature.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));

    return crypto.subtle.verify("HMAC", await importSigningKey(), signatureBytes, serializeForwardedData(data));
}

export async function fetchRedirectionIOAction(redirectionIORequest: redirectionio.Request) {
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

type CreateRedirectionIORequestParams = {
    url: URL;
    method: string;
    headers: Record<string, string>;
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
        redirectionioRequest.add_header(key, value as string);
    });

    if (ip) {
        redirectionioRequest.set_remote_ip(ip);
    }

    return redirectionioRequest;
}
