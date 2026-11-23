export function mergeMiddlewareResponses(
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

// The body stream moves to the copy: it is only read if the request is proxified, never buffered by the middleware
export function copyRequest(request: Request, url: string): Request {
    const init: RequestInit & { duplex: "half" } = {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: "half",
    };

    return new Request(url, init);
}

function applyOverriddenHeaders(request: Request, response: Response) {
    const headersToOverride = response.headers.get("x-middleware-override-headers");

    if (!headersToOverride) {
        return;
    }

    headersToOverride.split(",").forEach((header) => {
        const value = response.headers.get("x-middleware-request-" + header);

        if (value) {
            request.headers.set(header, value);
        }
    });
}

function applySetCookies(request: Request, response: Response) {
    const cookies = new Map(
        (request.headers.get("cookie") ?? "")
            .split(";")
            .map((cookie) => cookie.trim())
            .filter(Boolean)
            .map((cookie) => [cookie.split("=")[0], cookie]),
    );

    response.headers.getSetCookie().forEach((setCookie) => {
        const cookie = setCookie.split(";")[0].trim();
        cookies.set(cookie.split("=")[0], cookie);
    });

    request.headers.set("cookie", Array.from(cookies.values()).join("; "));
}

export function middlewareResponseToRequest(originalRequest: Request, response: Response): Request {
    const rewriteUrl = response.headers.get("x-middleware-rewrite");
    const request = rewriteUrl ? copyRequest(originalRequest, rewriteUrl) : originalRequest;

    applyOverriddenHeaders(request, response);

    if (response.headers.has("x-middleware-set-cookie")) {
        applySetCookies(request, response);
    }

    return request;
}
