import * as redirectionio from "@redirection.io/redirectionio";
import { getEnv } from "./env";
import { getNextRequestKind } from "./next-request";

const { REDIRECTIONIO_ADD_HEADER_RULE_IDS } = getEnv();

export type FetchResponse = (request: Request, useFetch: boolean) => Promise<Response>;

function toHeaderMap(response: Response, request: Request, includedRequestHeadersInResponse: string[] | undefined) {
    const headerMap = new redirectionio.HeaderMap();

    response.headers.forEach((value, key) => {
        if (key !== "set-cookie") {
            headerMap.add_header(key, value);
        }
    });

    response.headers.getSetCookie().forEach((cookie) => headerMap.add_header("set-cookie", cookie));

    request.headers.forEach((value, key) => {
        if (includedRequestHeadersInResponse?.includes(key)) {
            headerMap.add_header(key, value);
        }
    });

    return headerMap;
}

function toHeaders(headerMap: redirectionio.HeaderMap) {
    const headers = new Headers();

    for (let i = 0; i < headerMap.len(); i++) {
        const headerName = headerMap.get_header_name(i);

        if (headerName && headerName.length > 0) {
            headers.append(headerName, headerMap.get_header_value(i));
        }
    }

    return headers;
}

export async function proxy(
    request: Request,
    action: redirectionio.Action,
    includedRequestHeadersInResponse: string[] | undefined,
    fetchResponse: FetchResponse,
): Promise<[Response, number]> {
    try {
        const statusCodeBeforeResponse = action.get_status_code(0);

        let response =
            statusCodeBeforeResponse === 0
                ? await fetchResponse(request, true)
                : new Response("", { status: Number(statusCodeBeforeResponse) });

        const backendStatusCode = response.status;
        const statusCodeAfterResponse = action.get_status_code(backendStatusCode);
        const status = statusCodeAfterResponse !== 0 ? Number(statusCodeAfterResponse) : response.status;

        const newHeaderMap = action.filter_headers(
            toHeaderMap(response, request, includedRequestHeadersInResponse),
            backendStatusCode,
            REDIRECTIONIO_ADD_HEADER_RULE_IDS,
        );

        response = new Response(response.body, {
            status: status,
            statusText: response.statusText,
            headers: toHeaders(newHeaderMap),
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

        filterBody(response.body, writable, bodyFilter);

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

async function writeIfAny(writer: WritableStreamDefaultWriter, data: Uint8Array | undefined) {
    if (data) {
        await writer.write(data);
    }
}

async function filterBody(
    readable: ReadableStream<Uint8Array> | null,
    writable: WritableStream,
    bodyFilter: redirectionio.BodyFilter,
) {
    const writer = writable.getWriter();
    const reader = readable?.getReader();

    try {
        if (!reader) {
            await writeIfAny(writer, bodyFilter.filter(new Uint8Array()));
        } else {
            let data = await reader.read();

            while (!data.done) {
                await writeIfAny(writer, bodyFilter.filter(data.value));

                data = await reader.read();
            }
        }

        await writeIfAny(writer, bodyFilter.end());
        await writer.close();
    } catch (error) {
        console.error(error);

        await Promise.allSettled([writer.abort(error), reader?.cancel(error)]);
    } finally {
        reader?.releaseLock();
    }
}
