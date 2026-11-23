import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const PACKAGE_VERSION: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

async function readEnv(variables: Record<string, string>) {
    vi.resetModules();

    for (const [name, value] of Object.entries(variables)) {
        vi.stubEnv(name, value);
    }

    return (await import("./env")).getEnv();
}

describe("getEnv", () => {
    it("uses the defaults", async () => {
        const env = await readEnv({
            VERCEL: "",
            REDIRECTIONIO_TOKEN: "",
            REDIRECTIONIO_INSTANCE_NAME: "",
            REDIRECTIONIO_TIMEOUT: "",
            REDIRECTIONIO_ADD_HEADER_RULE_IDS: "",
            REDIRECTIONIO_DEBUG_HEADERS: "",
            REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS: "",
        });

        expect(env).toEqual({
            IS_VERCEL: false,
            REDIRECTIONIO_TOKEN: "",
            REDIRECTIONIO_INSTANCE_NAME: "redirection-io-vercel-middleware",
            REDIRECTIONIO_VERSION: "redirection-io-vercel-middleware/" + PACKAGE_VERSION,
            REDIRECTIONIO_ADD_HEADER_RULE_IDS: false,
            REDIRECTIONIO_DEBUG_HEADERS: false,
            REDIRECTIONIO_TIMEOUT: 500,
            REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS: [],
        });
    });

    it("parses valid values", async () => {
        const env = await readEnv({
            VERCEL: "1",
            REDIRECTIONIO_TOKEN: "token",
            REDIRECTIONIO_INSTANCE_NAME: "my-instance",
            REDIRECTIONIO_TIMEOUT: " 1500 ",
            REDIRECTIONIO_ADD_HEADER_RULE_IDS: "true",
            REDIRECTIONIO_DEBUG_HEADERS: "false",
            REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS: " Cookie , AUTHORIZATION,,",
        });

        expect(env).toMatchObject({
            IS_VERCEL: true,
            REDIRECTIONIO_TOKEN: "token",
            REDIRECTIONIO_INSTANCE_NAME: "my-instance",
            REDIRECTIONIO_TIMEOUT: 1500,
            REDIRECTIONIO_ADD_HEADER_RULE_IDS: true,
            REDIRECTIONIO_DEBUG_HEADERS: false,
            REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS: ["cookie", "authorization"],
        });
    });

    it.each([
        ["REDIRECTIONIO_TIMEOUT", "abc", 500],
        ["REDIRECTIONIO_TIMEOUT", "0", 500],
        ["REDIRECTIONIO_TIMEOUT", "-1", 500],
        ["REDIRECTIONIO_TIMEOUT", "1.5", 500],
        ["REDIRECTIONIO_TIMEOUT", "2147483648", 500],
        ["REDIRECTIONIO_DEBUG_HEADERS", "1", false],
        ["REDIRECTIONIO_ADD_HEADER_RULE_IDS", "yes", false],
        ["REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS", "cookie,in valid", []],
    ] as const)("falls back to the default value of %s for %j with a warning", async (name, value, defaultValue) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const env = await readEnv({ [name]: value });

        expect(env[name]).toEqual(defaultValue);
        expect(warn).toHaveBeenCalledOnce();
    });

    it("is read once", async () => {
        vi.resetModules();
        vi.stubEnv("REDIRECTIONIO_INSTANCE_NAME", "first");

        const { getEnv } = await import("./env");

        expect(getEnv().REDIRECTIONIO_INSTANCE_NAME).toBe("first");
        vi.stubEnv("REDIRECTIONIO_INSTANCE_NAME", "second");
        expect(getEnv().REDIRECTIONIO_INSTANCE_NAME).toBe("first");
    });
});
