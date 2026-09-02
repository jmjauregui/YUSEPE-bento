/**
 * src/main/pexelsOps.js
 * --------------------------------------------------------------
 * Cliente mínimo de la API de Pexels para el buscador de fondos de
 * pantalla (ver components/wallpaperPicker.js). Vive en el proceso
 * main a propósito: la API key se inyecta en build-time (ver
 * electron.vite.config.mjs, `define` de 'process.env.APIKEY_PEXELS')
 * y nunca se expone al renderer — el renderer solo pide fotos vía
 * IPC (`pexels:search`, ver ipc.js).
 *
 * A diferencia de Unsplash, Pexels no exige un ping de "download" al
 * aplicar una foto — solo atribución (nombre del fotógrafo + link).
 * --------------------------------------------------------------
 */
const API_BASE = 'https://api.pexels.com/v1';

export async function searchPhotos(query, page = 1) {
  const key = process.env.APIKEY_PEXELS;
  if (!key) throw new Error('Falta la API key de Pexels (APIKEY_PEXELS) — revisá el .env con el que se compiló la app.');
  if (!query || !query.trim()) return [];

  const url = `${API_BASE}/search?query=${encodeURIComponent(query)}&page=${page}&per_page=24&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key } });

  if (res.status === 401) throw new Error('API key de Pexels inválida.');
  if (res.status === 429) throw new Error('Límite de la API de Pexels alcanzado. Probá de nuevo más tarde.');
  if (!res.ok) throw new Error(`Error de Pexels (HTTP ${res.status}).`);

  const data = await res.json();
  return (data.photos || []).map((p) => ({
    id: p.id,
    thumb: p.src?.medium,
    full: p.src?.large2x || p.src?.large || p.src?.original,
    // `original` viaja aparte y sin parámetros: es la foto a resolución
    // completa, y el picker le agrega el redimensionado del CDN a la
    // medida de la pantalla real. `large2x` (el fallback `full`) mide
    // 1880px fijos — en una pantalla 2K/4K el `cover` la estira y el
    // fondo se ve borroso.
    original: p.src?.original,
    color: p.avg_color,
    photographerName: p.photographer || 'Desconocido',
    photographerUrl: p.photographer_url || 'https://www.pexels.com',
  }));
}
