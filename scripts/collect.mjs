// Recoge la última lectura de 10 minutos de tres estaciones de MeteoGalicia
// y la añade a spots.json. Uso: node scripts/collect.mjs <ruta/spots.json>
// Escribe <dir>/.changed si el archivo ha cambiado (el workflow solo publica entonces).
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SPOTS = [
  { id: "14000", nombre: "Coruña-Dique" },
  { id: "14003", nombre: "Punta Langosteira" },
  { id: "10906", nombre: "Cangas-Porto" },
];
const IDS = SPOTS.map((s) => s.id).join(",");
const BASE = process.env.MG_BASE || "https://servizos.meteogalicia.gal/mgrss/observacion";
const URL10 = `${BASE}/ultimos10minEstacionsMeteo.action?idEst=${IDS}`;
const URLH = `${BASE}/ultimosHorariosEstacions.action?idEst=${IDS}&numHoras=48`;

const KEEP_10MIN_H = 7 * 24;   // horas de lecturas de 10 min que se conservan
const KEEP_HOURLY_H = 50;      // horas de histórico horario
const HOURLY_EVERY_MIN = 30;   // cada cuánto se vuelve a pedir el histórico horario

const file = process.argv[2];
if (!file) { console.error("Falta la ruta de spots.json"); process.exit(2); }
const now = process.env.NOW_MS ? Number(process.env.NOW_MS) : Date.now();

const parseUTC = (s) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s || "");
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
};
const byT = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
const pick = (ms, c) => {
  const m = (ms || []).find((x) => x.codigoParametro === c);
  return m && m.lnCodigoValidacion !== 9 && typeof m.valor === "number" && m.valor > -9000 ? m.valor : null;
};

async function getJSON(url, key) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "viento-galicia-collector" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j[key])) throw new Error(`respuesta sin ${key}`);
      return j;
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${last && last.message}`);
}

let data = { spots: {} };
try {
  const txt = await readFile(file, "utf8");
  const j = JSON.parse(txt);
  if (j && typeof j.spots === "object") data = j;
} catch { /* primera ejecución */ }
const before = JSON.stringify(data.spots);

const oldestHAt = Math.min(...SPOTS.map((s) => Date.parse(data.spots[s.id]?.hAt || "") || 0));
const needHourly = process.env.FORCE_HOURLY === "1" || now - oldestHAt > HOURLY_EVERY_MIN * 60e3;

let j10 = null, jh = null;
const errors = [];
try { j10 = await getJSON(URL10, "listUltimos10min"); } catch (e) { errors.push(e.message); }
if (needHourly) { try { jh = await getJSON(URLH, "listHorarios"); } catch (e) { errors.push(e.message); } }

const cut10 = now - KEEP_10MIN_H * 3600e3, cutH = now - KEEP_HOURLY_H * 3600e3;
for (const s of SPOTS) {
  const prev = data.spots[s.id] || {};
  const u0 = j10?.listUltimos10min.find((e) => String(e.idEstacion) === s.id);
  const h0 = jh?.listHorarios.find((e) => String(e.idEstacion) === s.id);

  const u1 = u0 ? {
    t: String(u0.instanteLecturaUTC || "").slice(0, 16),
    vv: pick(u0.listaMedidas, "VV_AVG_10m"),
    g: pick(u0.listaMedidas, "VV_RACHA_10m"),
    d: pick(u0.listaMedidas, "DV_AVG_10m"),
  } : null;
  const u = u1 && isFinite(parseUTC(u1.t)) && (!prev.u || u1.t >= prev.u.t) ? u1 : prev.u || null;

  const dm = new Map((prev.diez || []).map((o) => [o.t, o]));
  if (u1 && isFinite(parseUTC(u1.t)) && (u1.vv != null || u1.g != null)) dm.set(u1.t, u1);
  const diez = [...dm.values()].filter((o) => parseUTC(o.t) >= cut10).sort(byT);

  const hm = new Map((prev.h || []).map((o) => [o.t, o]));
  for (const i of h0?.listaInstantes || []) {
    const t = String(i.instanteLecturaUTC || "").slice(0, 16);
    if (!isFinite(parseUTC(t))) continue;
    const old = hm.get(t) || {};
    hm.set(t, { t, d: pick(i.listaMedidas, "DV_AVG_10m") ?? old.d ?? null, g: pick(i.listaMedidas, "VV_RACHA_10m") ?? old.g ?? null });
  }
  const h = [...hm.values()].filter((o) => parseUTC(o.t) >= cutH).sort(byT);

  data.spots[s.id] = { id: s.id, nombre: s.nombre, u, h, diez, hAt: h0 ? new Date(now).toISOString() : prev.hAt || null };
}

const changed = JSON.stringify(data.spots) !== before;
if (changed) {
  data.actualizado = new Date(now).toISOString();
  await writeFile(file, JSON.stringify(data));
  await writeFile(join(dirname(file), ".changed"), "1");
}
const n = SPOTS.map((s) => `${s.id}:${data.spots[s.id].u?.t || "-"}(${data.spots[s.id].diez.length})`).join(" ");
console.log(`${changed ? "Actualizado" : "Sin cambios"} · ${n}${needHourly ? " · horario pedido" : ""}`);
if (errors.length) {
  console.error("Errores:", errors.join(" | "));
  // Falla solo si no se pudo leer nada; así GitHub avisa si MeteoGalicia deja de responder.
  if (!j10 && !jh) process.exit(1);
}
