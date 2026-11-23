import { test, expect } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

const internalHeaderNames = (headers: Record<string, string>) =>
    Object.keys(headers).filter((name) => name.startsWith("x-middleware-") || name.startsWith("x-redirectionio-"));

test.describe("Internal headers", () => {
    test("should not leak internal headers on a middleware response", async ({ request }) => {
        const response = await request.get(`${baseUrl}/test-redirect`, { maxRedirects: 0 });

        expect(response.status()).toBe(301);
        expect(internalHeaderNames(response.headers())).toEqual([]);
    });

    test("should not leak internal headers on a backend response", async ({ request }) => {
        const response = await request.get(`${baseUrl}/dynamic`);

        expect(response.status()).toBe(200);
        expect(await response.text()).toContain("Rendered at");
        expect(internalHeaderNames(response.headers())).toEqual([]);
    });
});
