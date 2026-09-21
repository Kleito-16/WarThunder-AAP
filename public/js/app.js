const $ = (selector) => document.querySelector(selector);
const canvas = $("#map");
const ctx = canvas.getContext("2d");
const image = new Image();
let snapshot;
let imageUrl;
let imageReady = false;
let imageRect = { x: 0, y: 0, width: 0, height: 0 };
let draggingId;
let selectedId;
let lastPatchAt = 0;

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(snapshot?.csrfToken ? { "x-csrf-token": snapshot.csrfToken } : {}), ...options.headers };
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return response.status === 204 ? undefined : response.json();
}

function resize() {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
}

function calculateImageRect(width, height, imageWidth, imageHeight) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  return { x: (width - imageWidth * scale) / 2, y: (height - imageHeight * scale) / 2, width: imageWidth * scale, height: imageHeight * scale };
}

function pointToScreen(point) { return { x: imageRect.x + point.u * imageRect.width, y: imageRect.y + point.v * imageRect.height }; }
function screenToPoint(event) {
  const box = canvas.getBoundingClientRect();
  return { u: (event.clientX - box.left - imageRect.x) / imageRect.width, v: (event.clientY - box.top - imageRect.y) / imageRect.height };
}
function inside(point) { return point.u >= 0 && point.u <= 1 && point.v >= 0 && point.v <= 1; }

function draw() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = "#080c0b"; ctx.fillRect(0, 0, width, height);
  const descriptor = snapshot?.map?.image;
  if (!descriptor || !imageReady) return;
  imageRect = calculateImageRect(width, height, descriptor.widthPx, descriptor.heightPx);
  ctx.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  ctx.strokeStyle = "#96aaa255"; ctx.strokeRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  if (snapshot.player) drawPlayer(snapshot.player);
  for (const target of snapshot.targets) drawTarget(target, snapshot.solutions.find((item) => item.targetId === target.id));
}

function drawPlayer(player) {
  const p = pointToScreen(player.position); ctx.save(); ctx.translate(p.x, p.y);
  const angle = player.headingDeg == null ? 0 : player.headingDeg * Math.PI / 180;
  ctx.rotate(angle); ctx.fillStyle = "#76ff9c"; ctx.shadowColor = "#76ff9c"; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 6); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawTarget(target, solution) {
  const p = pointToScreen(target.position); const selected = selectedId === target.id;
  if (solution?.status === "available" && solution.effect && snapshot.map.bounds.scale.status === "calibrated") {
    ctx.save(); ctx.beginPath(); ctx.ellipse(p.x, p.y, solution.effect.radiusNormalizedX * imageRect.width, solution.effect.radiusNormalizedY * imageRect.height, 0, 0, Math.PI * 2); ctx.fillStyle = "#ffc45c18"; ctx.strokeStyle = "#ffc45c77"; ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.translate(p.x, p.y); ctx.strokeStyle = target.status === "stale" ? "#82918b" : "#ffc45c"; ctx.lineWidth = selected ? 3 : 2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = selected ? 15 : 5;
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.moveTo(-18, 0); ctx.lineTo(-6, 0); ctx.moveTo(6, 0); ctx.lineTo(18, 0); ctx.moveTo(0, -18); ctx.lineTo(0, -6); ctx.moveTo(0, 6); ctx.lineTo(0, 18); ctx.stroke();
  ctx.fillStyle = "#101513dd"; ctx.fillRect(15, -17, 34, 19); ctx.fillStyle = ctx.strokeStyle; ctx.font = "bold 12px monospace"; ctx.fillText(String(target.trackNumber).padStart(2, "0"), 21, -4); ctx.restore();
}

function findTarget(point) {
  return snapshot?.targets.find((target) => { const p = pointToScreen(target.position); const q = pointToScreen(point); return Math.hypot(p.x - q.x, p.y - q.y) <= 22; });
}

canvas.addEventListener("pointerdown", async (event) => {
  if (!snapshot?.map || !imageReady) return; const point = screenToPoint(event); if (!inside(point)) return;
  const target = findTarget(point);
  if (target) { draggingId = target.id; selectedId = target.id; canvas.setPointerCapture(event.pointerId); draw(); return; }
  try { const created = await api("/api/v1/targets", { method: "POST", body: JSON.stringify(point) }); selectedId = created.id; }
  catch (error) { showError(error); }
});
canvas.addEventListener("pointermove", (event) => {
  const point = screenToPoint(event); $("#cursor-coords").textContent = inside(point) ? `U ${point.u.toFixed(4)} · V ${point.v.toFixed(4)}` : "";
  if (!draggingId || !inside(point) || Date.now() - lastPatchAt < 80) return; lastPatchAt = Date.now();
  const local = snapshot.targets.find((target) => target.id === draggingId); if (local) local.position = point; draw();
  void api(`/api/v1/targets/${draggingId}`, { method: "PATCH", body: JSON.stringify(point) }).catch(showError);
});
canvas.addEventListener("pointerup", () => { draggingId = undefined; });
canvas.addEventListener("pointercancel", () => { draggingId = undefined; });

function solutionText(solution) {
  if (!solution || solution.status !== "available") return solution?.reason?.replaceAll("_", " ") ?? "SEM SOLUÇÃO";
  const distance = solution.distance.unit === "m" ? `${Math.round(solution.distance.value)} m` : `${solution.distance.value.toFixed(1)} wu`;
  return `${distance} · AZ ${solution.azimuthMapDeg.toFixed(1).padStart(5, "0")}°`;
}

function renderTargetList() {
  const list = $("#target-list"); list.replaceChildren();
  if (!snapshot.targets.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "Clique no mapa para criar o primeiro ponto."; list.append(p); return; }
  for (const target of snapshot.targets) {
    const solution = snapshot.solutions.find((item) => item.targetId === target.id); const row = document.createElement("div"); row.className = `target ${target.status}`;
    row.innerHTML = `<span class="track">${String(target.trackNumber).padStart(2, "0")}</span><div><strong></strong><div class="metrics"></div></div><button title="Excluir">×</button>`;
    row.querySelector("strong").textContent = target.label; row.querySelector(".metrics").textContent = solutionText(solution);
    row.addEventListener("click", () => { selectedId = target.id; draw(); });
    row.querySelector("button").addEventListener("click", (event) => { event.stopPropagation(); void api(`/api/v1/targets/${target.id}`, { method: "DELETE" }).catch(showError); }); list.append(row);
  }
}

async function populateVehicles() {
  const vehicles = await api("/api/v1/catalog/vehicles"); const select = $("#vehicle"); select.replaceChildren(new Option("Selecione manualmente…", ""));
  for (const vehicle of vehicles) select.add(new Option(vehicle.displayName, vehicle.id));
  select.value = snapshot?.vehicle?.profileId ?? "";
}
async function populateAmmo() {
  const vehicleId = $("#vehicle").value || snapshot?.vehicle?.profileId; const entries = vehicleId ? await api(`/api/v1/catalog/ammo?vehicleId=${encodeURIComponent(vehicleId)}`) : [];
  const select = $("#ammo"); select.replaceChildren(new Option("Selecione manualmente…", ""));
  for (const entry of entries) select.add(new Option(`${entry.ammo.displayName} · ${entry.profile.confidence}`, entry.profile.id)); select.value = snapshot?.ammo?.vehicleAmmoProfileId ?? "";
}
$("#vehicle").addEventListener("change", async () => { try { await api("/api/v1/selection", { method: "PUT", body: JSON.stringify({ vehicleProfileId: $("#vehicle").value }) }); await populateAmmo(); } catch (error) { showError(error); } });
$("#ammo").addEventListener("change", () => void api("/api/v1/selection", { method: "PUT", body: JSON.stringify({ vehicleAmmoProfileId: $("#ammo").value }) }).catch(showError));
$("#clear-targets").addEventListener("click", () => { if (snapshot?.targets.length && confirm("Remover todos os pontos de mira?")) void api("/api/v1/targets", { method: "DELETE" }).catch(showError); });
$("#center-player").addEventListener("click", () => { selectedId = undefined; draw(); });

function render() {
  if (!snapshot) return; const state = snapshot.connection.state; $("#connection").textContent = state.toUpperCase(); $("#mode").textContent = snapshot.mode === "demo" ? "MODO DEMONSTRAÇÃO" : "TELEMETRIA AO VIVO";
  $("#status-dot").style.background = state === "live" ? "#76ff9c" : state === "offline" ? "#ff6464" : "#ffc45c"; $("#sequence").textContent = `SEQ ${snapshot.sequence}`; $("#clock").textContent = new Date(snapshot.capturedAt).toLocaleTimeString("pt-BR");
  $("#map-message").style.display = snapshot.map?.image ? "none" : "grid"; $("#map-message").textContent = snapshot.connection.message || "MAPA INDISPONÍVEL";
  const scale = snapshot.map?.bounds?.scale; $("#calibration").textContent = scale?.status === "calibrated" ? `ESCALA CALIBRADA · ${scale.calibrationId}\nFonte: ${scale.source}` : "ESCALA DESCONHECIDA · distância métrica indisponível";
  if (snapshot.map?.image?.url && imageUrl !== snapshot.map.image.url) { imageReady = false; imageUrl = snapshot.map.image.url; image.onload = () => { imageReady = true; draw(); }; image.src = imageUrl; }
  renderTargetList(); draw();
}
function accept(next) { if (!snapshot || next.serverInstanceId !== snapshot.serverInstanceId || next.sequence >= snapshot.sequence) { snapshot = next; render(); } }
function showError(error) { console.error(error); $("#map-message").textContent = error.message; $("#map-message").style.display = "grid"; setTimeout(render, 1800); }

async function bootstrap() {
  try { accept(await api("/api/v1/snapshot")); await populateVehicles(); await populateAmmo();
    const events = new EventSource("/api/v1/events"); events.addEventListener("snapshot", (event) => accept(JSON.parse(event.data))); events.onerror = () => { $("#connection").textContent = "RECONECTANDO"; };
  } catch (error) { showError(error); setTimeout(bootstrap, 2000); }
}
new ResizeObserver(resize).observe($("#map-wrap")); window.addEventListener("resize", resize); void bootstrap();
