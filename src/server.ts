import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DemoSource } from "./adapters/demoSource.ts";
import { WarThunderClient } from "./adapters/warThunderClient.ts";
import { loadCalibrations, loadCatalog } from "./services/catalog.ts";
import { StateEngine, type TelemetrySource } from "./services/stateEngine.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
};

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); size += buffer.length;
    if (size > 16_384) throw new Error("Corpo excede 16 KiB");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { throw new Error("JSON inválido"); }
}

function isMutation(method?: string): boolean { return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE"; }

export async function createPrototypeServer(options: {
  mode?: "live" | "demo";
  source?: TelemetrySource;
  root?: string;
  startEngine?: boolean;
} = {}) {
  const root = options.root ?? process.cwd();
  const mode = options.mode ?? "live";
  const engine = new StateEngine(options.source ?? (mode === "demo" ? new DemoSource() : new WarThunderClient()), mode, await loadCatalog(root), await loadCalibrations(root));
  if (options.startEngine !== false) await engine.start();
  const requestCounts = new Map<string, { second: number; count: number }>();

  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return json(response, 403, { error: "Host não permitido" });
      const origin = request.headers.origin;
      if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return json(response, 403, { error: "Origin não permitida" });
      const second = Math.floor(Date.now() / 1000); const rateKey = request.socket.remoteAddress ?? "local";
      const rate = requestCounts.get(rateKey);
      const current = rate?.second === second ? rate : { second, count: 0 }; current.count++; requestCounts.set(rateKey, current);
      if (current.count > 80) return json(response, 429, { error: "Muitas requisições" });

      const url = new URL(request.url ?? "/", `http://${host}`);
      const pathname = decodeURIComponent(url.pathname);
      if (isMutation(request.method) && pathname.startsWith("/api/") && request.headers["x-csrf-token"] !== engine.csrfToken) {
        return json(response, 403, { error: "Token CSRF ausente ou inválido" });
      }

      if (request.method === "GET" && pathname === "/api/v1/health") return json(response, 200, { status: "ok", mode, serverInstanceId: engine.serverInstanceId });
      if (request.method === "GET" && pathname === "/api/v1/snapshot") return json(response, 200, engine.getSnapshot());
      if (request.method === "GET" && pathname === "/api/v1/catalog/vehicles") return json(response, 200, engine.catalog.vehicles);
      if (request.method === "GET" && pathname === "/api/v1/catalog/ammo") return json(response, 200, engine.getAmmoForVehicle(url.searchParams.get("vehicleId") ?? undefined));
      if (request.method === "GET" && pathname === "/api/v1/events") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
        const send = (snapshot: unknown) => response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        send(engine.getSnapshot());
        engine.on("snapshot", send);
        const keepalive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
        request.on("close", () => { clearInterval(keepalive); engine.off("snapshot", send); });
        return;
      }
      const imageMatch = pathname.match(/^\/api\/v1\/map\/image\/([a-f0-9]{64})$/);
      if (request.method === "GET" && imageMatch) {
        const image = engine.images.get(imageMatch[1]);
        if (!image) return json(response, 404, { error: "Imagem não encontrada" });
        response.writeHead(200, { "content-type": image.contentType, "cache-control": "public, max-age=31536000, immutable", etag: `"${imageMatch[1]}"` });
        response.end(image.bytes); return;
      }
      if (request.method === "PUT" && pathname === "/api/v1/selection") {
        const body = await readJsonBody(request);
        engine.setSelection({ vehicleProfileId: typeof body.vehicleProfileId === "string" ? body.vehicleProfileId : undefined, vehicleAmmoProfileId: typeof body.vehicleAmmoProfileId === "string" ? body.vehicleAmmoProfileId : undefined });
        return json(response, 200, engine.getSnapshot());
      }
      if (request.method === "POST" && pathname === "/api/v1/context/new-match") { engine.newMatch(); return json(response, 200, engine.getSnapshot()); }
      if (request.method === "GET" && pathname === "/api/v1/targets") return json(response, 200, engine.getSnapshot().targets);
      if (request.method === "POST" && pathname === "/api/v1/targets") {
        const body = await readJsonBody(request);
        const target = engine.createTarget({ u: Number(body.u), v: Number(body.v), label: typeof body.label === "string" ? body.label : undefined });
        return json(response, 201, target);
      }
      if (request.method === "DELETE" && pathname === "/api/v1/targets") { engine.clearTargets(); response.writeHead(204); response.end(); return; }
      const targetMatch = pathname.match(/^\/api\/v1\/targets\/([0-9a-f-]+)$/i);
      if (targetMatch && request.method === "PATCH") {
        const body = await readJsonBody(request);
        const target = engine.updateTarget(targetMatch[1], {
          ...(body.u !== undefined ? { u: Number(body.u) } : {}), ...(body.v !== undefined ? { v: Number(body.v) } : {}),
          ...(typeof body.label === "string" ? { label: body.label } : {}), ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
        });
        return json(response, 200, target);
      }
      if (targetMatch && request.method === "DELETE") {
        if (!engine.deleteTarget(targetMatch[1])) return json(response, 404, { error: "Alvo não encontrado" });
        response.writeHead(204); response.end(); return;
      }
      if (pathname.startsWith("/api/")) return json(response, 404, { error: "Endpoint não encontrado" });

      const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const publicRoot = path.resolve(root, "public"); const file = path.resolve(publicRoot, requested);
      if (!file.startsWith(`${publicRoot}${path.sep}`) && file !== path.join(publicRoot, "index.html")) return json(response, 403, { error: "Caminho inválido" });
      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile()) return json(response, 404, { error: "Arquivo não encontrado" });
      const contents = await readFile(file);
      response.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "content-length": contents.length });
      response.end(contents);
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Erro interno" });
    }
  });
  server.on("close", () => engine.stop());
  return { server, engine };
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--demo") || process.env.WT_MODE === "demo" ? "demo" : "live";
  const host = process.env.HOST ?? "127.0.0.1"; const port = Number(process.env.PORT ?? 3000);
  const { server } = await createPrototypeServer({ mode });
  server.listen(port, host, () => console.log(`War Thunder Artillery Prototype: http://${host}:${port} (${mode})`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
