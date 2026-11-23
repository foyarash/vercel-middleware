import { test, expect } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Client navigation", () => {
    test("should apply redirections to prefetched links", async ({ page }) => {
        const redirectedPrefetch = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/test-temp-redirect" &&
                response.request().headers()["next-router-prefetch"] !== undefined,
        );

        await page.goto(`${baseUrl}/links`);

        const prefetchResponse = await redirectedPrefetch;

        expect(prefetchResponse.status()).toBe(307);

        const documentRequests: string[] = [];

        page.on("request", (request) => {
            if (request.resourceType() === "document") {
                documentRequests.push(request.url());
            }
        });

        await page.getByTestId("temp-redirected-link").click();
        await page.waitForURL(`${baseUrl}/`);
        await expect(page.getByText("Hello world")).toBeVisible();

        expect(documentRequests).toEqual([]);
    });

    test("should redirect when clicking a link to a redirected URL", async ({ page }) => {
        await page.goto(`${baseUrl}/links`);
        await page.getByTestId("redirected-link").click();
        await page.waitForURL(`${baseUrl}/result-redirect`);
    });

    test("should navigate to a non redirected URL", async ({ page }) => {
        await page.goto(`${baseUrl}/links`);
        await page.getByTestId("home-link").click();
        await page.waitForURL(`${baseUrl}/`);
        await expect(page.getByText("Hello world")).toBeVisible();
    });
});
