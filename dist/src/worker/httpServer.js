import Fastify from "fastify";
import { createHmac, timingSafeEqual } from "crypto";
import { registry } from "../app/plugins/registry.js";
import { logAudit } from "../app/store/audit.js";
import { getHealthStatus } from "./health.js";
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8780;
function verifyHmac(secret, body, signature) {
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length)
        return false;
    return timingSafeEqual(sigBuf, expBuf);
}
function registerRoute(server, route) {
    const method = route.method.toLowerCase();
    server.route({
        method: route.method,
        url: route.path,
        preHandler: route.hmacSecretEnv
            ? async (request, reply) => {
                const secret = process.env[route.hmacSecretEnv];
                if (!secret) {
                    reply.code(500).send({ error: "HMAC secret not configured" });
                    return;
                }
                const signature = request.headers["x-hub-signature-256"];
                if (!signature || !request.rawBody) {
                    reply.code(401).send({ error: "Missing signature" });
                    return;
                }
                if (!verifyHmac(secret, request.rawBody, signature)) {
                    reply.code(401).send({ error: "Invalid signature" });
                    return;
                }
            }
            : undefined,
        handler: async (request, reply) => {
            try {
                logAudit({
                    process: "worker",
                    event_type: "webhook_received",
                    target: route.path,
                    detail: { method: route.method },
                });
            }
            catch { /* audit is best-effort */ }
            await route.handler(request, reply);
        },
    });
}
export async function createHttpServer(options) {
    const host = options?.host ?? DEFAULT_HOST;
    const port = options?.port ?? DEFAULT_PORT;
    const server = Fastify({ logger: false });
    // Store raw body for HMAC verification
    server.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
        req.rawBody = body;
        try {
            done(null, JSON.parse(body.toString()));
        }
        catch (err) {
            done(err, undefined);
        }
    });
    // Health endpoint
    server.get("/health", async (_request, _reply) => {
        return getHealthStatus();
    });
    // Register plugin-contributed webhooks
    const webhooks = registry.getAllWebhooks("worker");
    for (const route of webhooks) {
        registerRoute(server, route);
        console.log(`[http] Registered webhook: ${route.method} ${route.path}${route.hmacSecretEnv ? " (HMAC)" : ""}`);
    }
    await server.listen({ host, port });
    console.log(`[http] Server listening on http://${host}:${port}`);
    return server;
}
export async function stopHttpServer(server) {
    await server.close();
    console.log("[http] Server stopped.");
}
