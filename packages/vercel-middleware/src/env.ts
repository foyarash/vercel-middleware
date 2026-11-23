export const getEnv = () => {
    const REDIRECTIONIO_TOKEN = process.env.REDIRECTIONIO_TOKEN || "";
    const REDIRECTIONIO_INSTANCE_NAME = process.env.REDIRECTIONIO_INSTANCE_NAME || "redirection-io-vercel-middleware";
    const REDIRECTIONIO_VERSION = "redirection-io-vercel-middleware/0.5.2";
    const REDIRECTIONIO_ADD_HEADER_RULE_IDS = process.env.REDIRECTIONIO_ADD_HEADER_RULE_IDS
        ? process.env.REDIRECTIONIO_ADD_HEADER_RULE_IDS === "true"
        : false;
    const REDIRECTIONIO_DEBUG_HEADERS = process.env.REDIRECTIONIO_DEBUG_HEADERS === "true";
    const REDIRECTIONIO_TIMEOUT = process.env.REDIRECTIONIO_TIMEOUT
        ? parseInt(process.env.REDIRECTIONIO_TIMEOUT, 10)
        : 500;
    const REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS = (process.env.REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS || "")
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);

    return {
        REDIRECTIONIO_TOKEN,
        REDIRECTIONIO_INSTANCE_NAME,
        REDIRECTIONIO_VERSION,
        REDIRECTIONIO_ADD_HEADER_RULE_IDS,
        REDIRECTIONIO_DEBUG_HEADERS,
        REDIRECTIONIO_TIMEOUT,
        REDIRECTIONIO_FORWARDED_SENSITIVE_HEADERS,
    };
};
