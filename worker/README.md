# Worker de consultas (Capa 2) — API de Reportes

Cloudflare Worker que lee el GeoJSON público (Capa 1) y sirve respuestas
**filtradas** en varios formatos, con CORS abierto y caché en el edge.

## Desplegar (igual que tu worker FUNVISIS)

```bash
cd worker
npm install -g wrangler        # si no lo tienes
wrangler login                 # abre el navegador, autoriza tu cuenta Cloudflare
wrangler deploy                # publica el worker
```

Queda en `https://reportes-terremoto.<tu-subdominio>.workers.dev`.
No requiere KV, D1, secretos ni variables: solo lee la Capa 1.

## Uso

`GET /reportes`

| Parámetro | Ejemplo | Efecto |
|---|---|---|
| `format` | `geojson` (def) · `json` · `csv` | formato de salida |
| `city` | `?city=Caracas` | ciudad (insensible a may/tildes, parcial) |
| `damage` | `?damage=total,severo` | nivel(es) de daño |
| `has_photo` | `?has_photo=true` | solo con foto |
| `since` | `?since=2026-06-28` | actualizados desde la fecha |
| `bbox` | `?bbox=-69,10,-66,11` | recorte (minLon,minLat,maxLon,maxLat) |
| `id` | `?id=<uuid>` | un reporte exacto |
| `limit` / `offset` | `?limit=50&offset=0` | paginación |

Otras rutas: `/` (documentación) · `/meta` (conteos del dataset).

### Ejemplos
```
/reportes?damage=total&city=Caracas
/reportes?has_photo=true&format=csv
/reportes?bbox=-67.1,10.5,-66.7,10.7&limit=20
```

La respuesta GeoJSON incluye `matched` (total que cumple el filtro) y `returned`
(devueltos tras limit/offset).
