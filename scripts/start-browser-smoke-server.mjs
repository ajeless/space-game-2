process.env.SG2_PORT ??= process.env.PLAYWRIGHT_SERVER_PORT ?? "4174";
process.env.SG2_ADMIN_TOKEN ??= "browser-smoke-token";

await import("../dist/server/server/index.js");
