import * as z from "zod/mini";

const HEADER_NAME_REGEX = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

const booleanSchema = z.stringbool({ truthy: ["true"], falsy: ["false"] });
const timeoutSchema = z.pipe(z.coerce.number(), z.int().check(z.positive(), z.lte(2_147_483_647)));
const headerNamesSchema = z.pipe(
    z.pipe(
        z.string(),
        z.transform((value) =>
            value
                .split(",")
                .map((name) => name.trim().toLowerCase())
                .filter(Boolean),
        ),
    ),
    z.array(z.string().check(z.regex(HEADER_NAME_REGEX))),
);

function readVariable<T>(name: string, value: string | undefined, schema: z.ZodMiniType<T>, defaultValue: T): T {
    const trimmedValue = value?.trim();

    if (!trimmedValue) {
        return defaultValue;
    }

    const result = schema.safeParse(trimmedValue);

    if (result.success) {
        return result.data;
    }

    console.warn(
        `redirection.io: invalid ${name} environment variable "${trimmedValue}", using ${JSON.stringify(defaultValue)} instead.`,
    );

    return defaultValue;
}

function readEnv() {
    return {
        IS_VERCEL: process.env.VERCEL === "1",
        REDIRECTIONIO_TOKEN: process.env.REDIRECTIONIO_TOKEN || "",
        REDIRECTIONIO_INSTANCE_NAME: process.env.REDIRECTIONIO_INSTANCE_NAME || "redirection-io-vercel-middleware",
        REDIRECTIONIO_VERSION: "redirection-io-vercel-middleware/0.5.2",
        REDIRECTIONIO_ADD_HEADER_RULE_IDS: readVariable(
            "REDIRECTIONIO_ADD_HEADER_RULE_IDS",
            process.env.REDIRECTIONIO_ADD_HEADER_RULE_IDS,
            booleanSchema,
            false,
        ),
        REDIRECTIONIO_DEBUG_HEADERS: readVariable(
            "REDIRECTIONIO_DEBUG_HEADERS",
            process.env.REDIRECTIONIO_DEBUG_HEADERS,
            booleanSchema,
            false,
        ),
        REDIRECTIONIO_TIMEOUT: readVariable(
            "REDIRECTIONIO_TIMEOUT",
            process.env.REDIRECTIONIO_TIMEOUT,
            timeoutSchema,
            500,
        ),
        REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS: readVariable(
            "REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS",
            process.env.REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS,
            headerNamesSchema,
            [],
        ),
    };
}

let env: ReturnType<typeof readEnv> | undefined;

export const getEnv = () => {
    env ??= readEnv();

    return env;
};
