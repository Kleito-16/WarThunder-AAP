import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}

for (const file of [...await files("src"), ...await files("public/js")]) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await rm("dist", { recursive: true, force: true }); await mkdir("dist", { recursive: true });
await Promise.all([cp("src", "dist/src", { recursive: true }), cp("public", "dist/public", { recursive: true }), cp("config", "dist/config", { recursive: true })]);
await writeFile("dist/package.json", JSON.stringify({ type: "module", private: true, scripts: { start: "node src/server.ts" }, engines: { node: ">=24" } }, null, 2));
console.log("Build validado e preparado em dist/. Execute: cd dist && npm start");
