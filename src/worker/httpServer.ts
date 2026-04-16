import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHmac, timingSafeEqual } from "crypto";
import { registry } from "../app/plugins/registry.js";
import { logAudit } from "../app/store/audit.js";
import { getHealthStatus } from "./health.js";
import type { WebhookRoute } from "../app/plugins/types.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8780;

function verifyHmac(secret: string, body: Buffer, signature: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

function registerRoute(server: FastifyInstance, route: WebhookRoute): void {
  const method = route.method.toLowerCase() as "get" | "post" | "put";

  server.route({
    method: route.method,
    url: route.path,
    preHandler: route.hmacSecretEnv
      ? async (request: FastifyRequest, reply: FastifyReply) => {
          const secret = process.env[route.hmacSecretEnv!];
          if (!secret) {
            reply.code(500).send({ error: "HMAC secret not configured" });
            return;
          }

          const signature = request.headers["x-hub-signature-256"] as string | undefined;
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
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        logAudit({
          process: "worker",
          event_type: "webhook_received",
          target: route.path,
          detail: { method: route.method },
        });
      } catch { /* audit is best-effort */ }

      await route.handler(request, reply);
    },
  });
}

export async function createHttpServer(
  options?: { host?: string; port?: number },
): Promise<FastifyInstance> {
  const host = options?.host ?? DEFAULT_HOST;
  const port = options?.port ?? DEFAULT_PORT;

  const server = Fastify({ logger: false });

  // Store raw body for HMAC verification
  server.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req: FastifyRequest, body: Buffer, done: (err: Error | null, result?: unknown) => void) => {
      req.rawBody = body;
      try {
        done(null, JSON.parse(body.toString()));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

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

export async function stopHttpServer(server: FastifyInstance): Promise<void> {
  await server.close();
  console.log("[http] Server stopped.");
}
