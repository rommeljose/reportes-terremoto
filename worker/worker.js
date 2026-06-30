/**
 * API de Reportes ciudadanos — Doblete de Yumare 2026 (Capa 2 · Cloudflare Worker)
 *
 * Lee el GeoJSON público (Capa 1, GitHub Pages), lo cachea en el edge y sirve
 * respuestas FILTRADAS en varios formatos. CORS abierto.
 *
 * Endpoint:  GET /reportes
 *   format     geojson (default) | json | csv
 *   city       texto, insensible a may/tildes (coincidencia parcial)
 *   damage     parcial | severo | total   (lista separada por comas)
 *   has_photo  true  → solo con foto
 *   since      YYYY-MM-DD → actualizados desde esa fecha (last_updated_at)
 *   bbox       minLon,minLat,maxLon,maxLat → recorte rectangular
 *   id         uuid exacto
 *   limit      máx. resultados (0 = todos)
 *   offset     desplazamiento para paginar
 *
 * Otras rutas:  /  (documentación)   ·   /meta  (conteos del dataset)
 */

const SRC = "https://rommeljose.github.io/reportes-terremoto/reportes.geojson";
const META = "https://rommeljose.github.io/reportes-terremoto/meta.json";
const EDGE_TTL = 300; // seg. que el edge cachea el origen (Pages se refresca por push)

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "*",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    try {
      if (url.pathname === "/" || url.pathname === "") return docs();
      if (url.pathname === "/meta") return passthrough(META, "application/json");
      if (url.pathname === "/reportes" || url.pathname === "/reportes.geojson")
        return await reportes(url);
      return json({ error: "ruta no encontrada", rutas: ["/reportes", "/meta", "/"] }, 404);
    } catch (e) {
      return json({ error: "fallo interno", detalle: String(e) }, 500);
    }
  },
};

// --- carga del dataset (cacheado en el edge de Cloudflare) ---
async function loadFC() {
  const r = await fetch(SRC, { cf: { cacheTtl: EDGE_TTL, cacheEverything: true } });
  if (!r.ok) throw new Error("no se pudo leer el origen (" + r.status + ")");
  return r.json();
}

// --- normaliza para comparar ciudades (minúsculas, sin tildes) ---
const norm = (s) =>
  (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

async function reportes(url) {
  const q = url.searchParams;
  const fc = await loadFC();
  let feats = fc.features;

  const id = q.get("id");
  if (id) feats = feats.filter((f) => f.properties.id === id);

  const city = norm(q.get("city"));
  if (city) feats = feats.filter((f) => norm(f.properties.city).includes(city));

  const damage = q.get("damage");
  if (damage) {
    const set = new Set(damage.split(",").map((s) => norm(s)));
    feats = feats.filter((f) => set.has(norm(f.properties.damage_level)));
  }

  if (q.get("has_photo") === "true")
    feats = feats.filter((f) => (f.properties.n_fotos || 0) > 0 || f.properties.main_photo_url);

  const since = q.get("since");
  if (since) feats = feats.filter((f) => (f.properties.last_updated_at || "") >= since);

  const bbox = q.get("bbox");
  if (bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
    if ([minLon, minLat, maxLon, maxLat].every((n) => !Number.isNaN(n))) {
      feats = feats.filter((f) => {
        const c = f.geometry && f.geometry.coordinates;
        return c && c[0] >= minLon && c[0] <= maxLon && c[1] >= minLat && c[1] <= maxLat;
      });
    }
  }

  const total = feats.length;
  const offset = Math.max(0, parseInt(q.get("offset") || "0", 10) || 0);
  const limit = Math.max(0, parseInt(q.get("limit") || "0", 10) || 0);
  if (offset) feats = feats.slice(offset);
  if (limit) feats = feats.slice(0, limit);

  const format = (q.get("format") || "geojson").toLowerCase();
  if (format === "json") return json(feats.map(asRow));
  if (format === "csv") return csv(feats.map(asRow));
  return json(
    { type: "FeatureCollection", name: "reportes_terremotovenezuela", matched: total, returned: feats.length, features: feats },
    200,
    "application/geo+json"
  );
}

// aplana un Feature a objeto (para json/csv)
function asRow(f) {
  const p = f.properties;
  const [lon, lat] = (f.geometry && f.geometry.coordinates) || [null, null];
  return {
    id: p.id, name: p.name, address: p.address, city: p.city, zone: p.zone,
    damage_level: p.damage_level, status: p.status,
    is_technically_evaluated: p.is_technically_evaluated,
    general_source: p.general_source, notes: p.notes,
    trapped_names: p.trapped_names, casualties_notes: p.casualties_notes,
    has_missing_persons: p.has_missing_persons,
    created_at: p.created_at, last_updated_at: p.last_updated_at,
    lat, lon, n_fotos: p.n_fotos,
    main_photo_url: p.main_photo_url,
    media_urls: Array.isArray(p.media_urls) ? p.media_urls.join(" | ") : "",
  };
}

// --- helpers de respuesta ---
function json(obj, status = 200, ctype = "application/json") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": ctype + "; charset=utf-8", "cache-control": "max-age=120", ...CORS },
  });
}

function csv(rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = [cols.join(",")].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(","))).join("\n");
  return new Response("﻿" + body, {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "max-age=120", ...CORS },
  });
}

async function passthrough(srcUrl, ctype) {
  const r = await fetch(srcUrl, { cf: { cacheTtl: EDGE_TTL, cacheEverything: true } });
  return new Response(r.body, { status: r.status, headers: { "content-type": ctype, ...CORS } });
}

function docs() {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>API Reportes · consultas</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:24px;line-height:1.55;color:#1c2430}
h1{font-size:20px}code{background:#f3f5f8;padding:1px 5px;border-radius:4px}pre{background:#f3f5f8;padding:12px;border-radius:6px;overflow:auto}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #e1e6ec;padding:5px 8px;text-align:left}a{color:#3a6ea5}</style></head><body>
<h1>API de Reportes — consultas (Capa 2)</h1>
<p>Copia de preservación humanitaria de <b>terremotovenezuela.com</b>. CORS abierto. Datos: Capa 1 en
<a href="https://rommeljose.github.io/reportes-terremoto/">GitHub Pages</a>.</p>
<h2>GET /reportes</h2>
<table>
<tr><th>Parámetro</th><th>Ejemplo</th></tr>
<tr><td>format</td><td>geojson · json · csv</td></tr>
<tr><td>city</td><td><code>?city=Caracas</code></td></tr>
<tr><td>damage</td><td><code>?damage=total,severo</code></td></tr>
<tr><td>has_photo</td><td><code>?has_photo=true</code></td></tr>
<tr><td>since</td><td><code>?since=2026-06-28</code></td></tr>
<tr><td>bbox</td><td><code>?bbox=-69,10,-66,11</code></td></tr>
<tr><td>limit / offset</td><td><code>?limit=50&offset=0</code></td></tr>
</table>
<h3>Ejemplos</h3>
<pre>/reportes?damage=total&city=Caracas
/reportes?has_photo=true&format=csv
/reportes?bbox=-67.1,10.5,-66.7,10.7&limit=20</pre>
</body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
}
