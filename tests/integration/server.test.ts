import test from "node:test";
import assert from "node:assert/strict";
import { createPrototypeServer } from "../../src/server.ts";

test("servidor demo entrega UI, snapshot e CRUD protegido de alvos", async (t) => {
  const { server } = await createPrototypeServer({ mode: "demo" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("endereço inválido");
  const base = `http://127.0.0.1:${address.port}`;
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /CONTROLE DE FOGO/);
  const snapshot = await (await fetch(`${base}/api/v1/snapshot`)).json(); assert.equal(snapshot.mode, "demo"); assert.equal(snapshot.connection.state, "live");
  const denied = await fetch(`${base}/api/v1/targets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ u: .4, v: .4 }) }); assert.equal(denied.status, 403);
  const created = await fetch(`${base}/api/v1/targets`, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": snapshot.csrfToken }, body: JSON.stringify({ u: .7, v: .3, label: "BRAVO" }) });
  assert.equal(created.status, 201); const target = await created.json(); assert.equal(target.label, "BRAVO");
  const updated = await (await fetch(`${base}/api/v1/snapshot`)).json(); assert.equal(updated.targets.length, 1); assert.equal(updated.solutions[0].status, "available"); assert.equal(updated.solutions[0].distance.unit, "m");
});
