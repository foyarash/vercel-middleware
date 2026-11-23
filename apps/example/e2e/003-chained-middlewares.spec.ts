import { test, expect } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Chained middlewares", () => {
    test("should keep rewrite, request headers and cookies of chained middlewares", async ({ page, context }) => {
        const response = await page.goto(`${baseUrl}/chained-rewrite`);

        expect(response).not.toBe(null);
        expect(response?.status()).toBe(200);
        expect(page.url()).toBe(`${baseUrl}/chained-rewrite`);
        expect(response?.headers()["x-chained-previous-response"]).toBe("previous");
        expect(response?.headers()["x-chained-next-response"]).toBe("next");

        await expect(page.getByTestId("from")).toHaveText("/chained-rewrite");
        await expect(page.getByTestId("previous-header")).toHaveText("previous");
        await expect(page.getByTestId("next-header")).toHaveText("next");
        await expect(page.getByTestId("previous-cookie")).toHaveText("previous");

        const cookies = await context.cookies(baseUrl);
        expect(cookies.find((cookie) => cookie.name === "chained-previous")?.value).toBe("previous");
        expect(cookies.find((cookie) => cookie.name === "chained-next")?.value).toBe("next");
    });

    test("should still apply redirection.io rules", async ({ page }) => {
        await page.goto(`${baseUrl}/test-redirect`);

        await page.waitForURL(`${baseUrl}/result-redirect`);
    });
});
