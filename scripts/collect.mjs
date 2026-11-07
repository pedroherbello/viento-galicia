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

const KEEP_10MIN_H = 50;       // horas de lecturas de 10 min que se conservan (la web muestra 48)
const KEEP_HOURLY_H = 50;      // horas de histórico horario
const HOURLY_EVERY_MIN = 30;   // cada cuánto se vuelve a pedir el histórico horario
const FAIL_AFTER_H = 2;        // la ejecución solo falla (y GitHub avisa) si no hay lecturas nuevas en este tiempo

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
let txt = null;
try { txt = await readFile(file, "utf8"); }
catch (e) { if (e.code !== "ENOENT") throw e; /* primera ejecución */ }
if (txt != null) {
  // Un archivo dañado nunca se trata como primera ejecución: se borraría el historial.
  const j = JSON.parse(txt);
  if (!j || typeof j.spots !== "object") throw new Error("spots.json no tiene el formato esperado");
  data = j;
}
const before = JSON.stringify(data.spots);

const lastHourly = Date.parse(data.hAt || "") || 0;
const needHourly = process.env.FORCE_HOURLY === "1" || now - lastHourly >= (HOURLY_EVERY_MIN - 2) * 60e3;

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
  // Se descartan lecturas sin valores, con fecha imposible o futura.
  const ok1 = u1 && isFinite(parseUTC(u1.t)) && parseUTC(u1.t) <= now + 20 * 60e3 && (u1.vv != null || u1.g != null);
  const u = ok1 && (!prev.u || u1.t >= prev.u.t) ? u1 : prev.u || null;

  const dm = new Map((prev.diez || []).map((o) => [o.t, o]));
  if (ok1) dm.set(u1.t, u1);
  const diez = [...dm.values()].filter((o) => parseUTC(o.t) >= cut10 && parseUTC(o.t) <= now + 20 * 60e3).sort(byT);

  const hm = new Map((prev.h || []).map((o) => [o.t, o]));
  for (const i of h0?.listaInstantes || []) {
    const t = String(i.instanteLecturaUTC || "").slice(0, 16);
    if (!isFinite(parseUTC(t)) || parseUTC(t) > now + 20 * 60e3) continue;
    const old = hm.get(t) || {};
    hm.set(t, { t, d: pick(i.listaMedidas, "DV_AVG_10m") ?? old.d ?? null, g: pick(i.listaMedidas, "VV_RACHA_10m") ?? old.g ?? null });
  }
  const h = [...hm.values()].filter((o) => parseUTC(o.t) >= cutH).sort(byT);

  data.spots[s.id] = { id: s.id, nombre: s.nombre, u, h, diez, hAt: h0 ? new Date(now).toISOString() : prev.hAt || null };
}
if (jh) data.hAt = new Date(now).toISOString();

const changed = JSON.stringify(data.spots) !== before || Boolean(jh);
if (changed) {
  data.actualizado = new Date(now).toISOString();
  await writeFile(file, JSON.stringify(data));
  await writeFile(join(dirname(file), ".changed"), "1");
}
const n = SPOTS.map((s) => `${s.id}:${data.spots[s.id].u?.t || "-"}(${data.spots[s.id].diez.length})`).join(" ");
console.log(`${changed ? "Actualizado" : "Sin cambios"} · ${n}${needHourly ? " · horario pedido" : ""}`);
if (errors.length) console.error("Errores:", errors.join(" | "));
// La ejecución falla (y GitHub avisa por correo) solo si llevamos más de FAIL_AFTER_H horas
// sin lecturas nuevas, para no mandar un correo cada 5 minutos durante un corte breve.
const newest = Math.max(0, ...SPOTS.map((s) => parseUTC(data.spots[s.id].u?.t || "") || 0));
if (!j10 && now - newest > FAIL_AFTER_H * 3600e3) {
  console.error(`Sin lecturas nuevas desde hace más de ${FAIL_AFTER_H} h.`);
  process.exit(1);
}
