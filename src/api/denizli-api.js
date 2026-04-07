/**
 * DenizliBus — Denizli Belediyesi Ulaşım API Client
 * 
 * Aktif Endpoint'ler:
 *  - GetAllStations: Tüm duraklar (stationId, stationName, latitude, longitude)
 *  - GetAllRoutes: Tüm hatlar (id, name, start, end)
 *  - GetRouteStations?routeCode=X: Bir hattın durakları
 *  - GetBusDataForStation?waitingStation=X: Canlı otobüs verisi
 *  - SearchStationOrRoute?text=X&type=: Arama
 *  - GetLiveData?lineCode=X: Canlı otobüs konumları
 *  - jsonotobusduraklar.ashx: Hat bilgileri ve sefer saatleri
 */

const API_BASE = import.meta.env.VITE_API_DENIZLI_BASE || 'https://otobusdenizli-api.cagdaspronebeklion.workers.dev/denizli';

// Cache
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;    // 5 dk
const LONG_CACHE = 30 * 60 * 1000;       // 30 dk

function getCached(key, maxAge = CACHE_DURATION) {
  const entry = cache.get(key);
  if (entry && (Date.now() - entry.timestamp) < maxAge) {
    return entry.data;
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

async function fetchJSON(path) {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`API Hatasi: ${response.status} — ${url}`);
  }

  return response.json();
}

/**
 * API yanıtından value kısmını çıkarır
 */
function extractValue(data) {
  if (data?.isSuccess && data?.value !== undefined) {
    return data.value;
  }
  return data;
}

// =====================================
// ANA API FONKSİYONLARI
// =====================================

/**
 * Tüm durakları çeker
 * @returns {Promise<{stations: Array<{stationId, stationName, latitude, longitude}>}>}
 */
export async function getAllStations() {
  const cacheKey = 'all_stations_v2';
  const cached = getCached(cacheKey, LONG_CACHE);
  if (cached) return cached;

  const data = await fetchJSON('/UlasimBackend/api/Calc/GetAllStations');
  const result = extractValue(data);
  
  // API returns {stations: [...]} 
  let stations = [];
  if (result?.stations && Array.isArray(result.stations)) {
    stations = result.stations;
  } else if (Array.isArray(result)) {
    stations = result;
  }

  setCache(cacheKey, stations);
  return stations;
}

/**
 * Tüm hatları çeker
 * @returns {Promise<Array<{id, type, name, start, end}>>}
 */
export async function getAllRoutes() {
  const cacheKey = 'all_routes_v2';
  const cached = getCached(cacheKey, LONG_CACHE);
  if (cached) return cached;

  const data = await fetchJSON('/UlasimBackend/api/Calc/GetAllRoutes');
  const routes = extractValue(data);

  let mappedRoutes = [];
  if (Array.isArray(routes)) {
    mappedRoutes = routes.map(r => ({
      ...r,
      id: r.id || r.lineCode,
      name: r.name || r.lineName,
      start: r.start || r.lineName?.split('-')[1] || '',
      end: r.end || r.lineName?.split('-')[2] || ''
    }));
  }

  setCache(cacheKey, mappedRoutes);
  return mappedRoutes;
}

/**
 * Bir hattın tüm duraklarını sıralı olarak çeker
 * @param {string} routeCode - Hat kodu (örn: "110")
 * @returns {Promise<{stations: Array<{sequence, stationId, stationName, latitude, longitude}>}>}
 */
export async function getRouteStations(routeCode) {
  const cacheKey = `route_stations_${routeCode}`;
  const cached = getCached(cacheKey, LONG_CACHE);
  if (cached) return cached;

  const data = await fetchJSON(`/UlasimBackend/api/Calc/GetRouteStations?routeCode=${routeCode}`);
  const result = extractValue(data);

  let stations = [];
  if (result?.stations && Array.isArray(result.stations)) {
    stations = result.stations;
  } else if (Array.isArray(result)) {
    stations = result;
  }

  setCache(cacheKey, stations);
  return stations;
}

/**
 * Durak/hat arama
 * @param {string} query - Aranacak metin
 * @returns {Promise<Array>}
 */
export async function searchStationOrRoute(query) {
  if (!query || query.length < 2) return [];

  const cacheKey = `search_${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await fetchJSON(
    `/UlasimBackend/api/Calc/SearchStationOrRoute?text=${encodeURIComponent(query)}&type=`
  );
  const results = extractValue(data);

  const arr = Array.isArray(results) ? results : [];
  setCache(cacheKey, arr);
  return arr;
}

/**
 * Bir hattın resmi saat tablosu resmini çeker (JPEG)
 * @param {string|number} routeCode
 * @returns {Promise<string|null>} Resmin URL'i
 */
export async function getTimetableImage(routeCode) {
  const cacheKey = 'timetable_images';
  let data = getCached(cacheKey, LONG_CACHE * 24); // Günde bir kez değişmesi yeterli
  if (!data) {
    try {
      // Proxy yapısı: /api/denizli -> https://ulasim.denizli.bel.tr
      const res = await fetch('/api/denizli/jsonotobusduraklar.ashx');
      data = await res.json();
      setCache(cacheKey, data);
    } catch (e) {
      console.error('Saat tablosu çekilemedi:', e);
      return null;
    }
  }
  
  if (data && data.otobus) {
    // Gelen "930D" veya "340G" kodlarındaki sondaki harfleri temizle (Örn: "930" yap). T1 gibi baştaki harflere dokunma.
    const cleanRouteCode = String(routeCode).replace(/[a-zA-Z]+$/, '');
    
    // HatNo uyuşan objeyi bul
    const routeInfo = data.otobus.find(o => String(o.HatNo) === cleanRouteCode || o.GuzergahIsmi?.includes(cleanRouteCode));
    if (routeInfo && routeInfo.SaatResim) {
      // Gelen SaatResim linki adres yapısını içerir
      return routeInfo.SaatResim;
    }
  }
  return null;
}

/**
 * Bir durağa gelen otobüslerin canlı verisini çeker
 * @param {number} stationId - Durak ID
 * @param {string} routeCode - Hat kodu (opsiyonel)
 * @returns {Promise<Array>}
 */
export async function getBusDataForStation(stationId, routeCode = '') {
  const data = await fetchJSON(
    `/UlasimBackend/api/Calc/GetBusDataForStation?waitingStation=${stationId}&routeCode=${routeCode}`
  );
  const result = extractValue(data);
  return result?.busList ? result.busList : (Array.isArray(result) ? result : []);
}

/**
 * Bir hattın canlı otobüs konumlarını çeker
 * @param {string} lineCode - Hat kodu
 * @returns {Promise<Array>}
 */
export async function getLiveData(lineCode) {
  const data = await fetchJSON(`/UlasimBackend/api/Calc/GetLiveData?lineCode=${lineCode}`);
  const result = extractValue(data);
  return Array.isArray(result) ? result : [];
}

/**
 * Tüm hat bilgileri + sefer saatleri (eski format, hala çalışıyor)
 */
export async function getAllBusLines() {
  const cacheKey = 'all_bus_lines';
  const cached = getCached(cacheKey, LONG_CACHE);
  if (cached) return cached;

  const data = await fetchJSON('/jsonotobusduraklar.ashx');
  setCache(cacheKey, data);
  return data;
}

/**
 * Cache'i temizle
 */
export function clearCache() {
  cache.clear();
}
