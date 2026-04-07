/**
 * DenizliBus — Rota Planlama Algoritması
 * 
 * A noktasından B noktasına en uygun otobüs rotalarını bulur.
 * 
 * Yaklaşım:
 * 1. Tüm durak ve hat verilerini ilk kullanımda yükle & indeksle
 * 2. Başlangıç/bitiş noktalarına yakın durakları bul (client-side)
 * 3. Hangi hatlar bu durakları kapsıyor? → direkt rota
 * 4. Ortak hat yoksa → transfer analizi
 */

import { getAllStations, getAllRoutes, getRouteStations, getBusDataForStation } from './denizli-api.js';

// ==============================
// MESAFE VE ZAMAN HESAPLAMA
// ==============================

export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function calculateWalkMinutes(meters) {
  // Ortalama yürüme hızı: 80 metre / dakika (yaklaşık 4.8 km/s)
  return Math.max(1, Math.ceil(meters / 80));
}

export function formatDuration(minutes) {
  if (!minutes) return 'Belirsiz';
  if (minutes < 60) return `${minutes} dk`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs} sa ${mins} dk` : `${hrs} sa`;
}

export function parseBusWaitTime(sureStr) {
  if (!sureStr) return null;
  const parts = sureStr.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  return null;
}

export async function fetchOSRMRoute(stops) {
  if (!stops || stops.length < 2) return null;
  // OSRM url sınırı için durakları filtrele (Çok duraklıysa atlayarak al)
  let points = stops.map(s => [parseFloat(s.lng), parseFloat(s.lat)]);
  if (points.length > 90) {
    const step = Math.ceil(points.length / 90);
    points = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  }
  
  const coords = points.map(p => `${p[0]},${p[1]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes[0]) {
      // GeoJSON [lng, lat] veriyor, Leaflet [lat, lng] kullanıyor. Tersine çeviriyoruz.
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); 
    }
  } catch (e) {
    console.error('OSRM yola oturtma motoru hatası:', e);
  }
  return null;
}

// ==============================
// ROTA İNDEKSİ (lazy build)
// ==============================

let routeIndex = null;       // stationId → Set<routeId>
let routeStationsMap = null; // routeId → [{ stationId, stationName, lat, lng, sequence }]
let allRoutesData = null;    // routeId → { id, name, start, end }
let indexBuilding = false;
let indexReady = false;
let lastRouteCount = 0;

/**
 * Rota indeksini oluşturur (ilk kullanımda).
 * Tüm hatların duraklarını çeker ve stationId → routes eşlemesi yapar.
 */
export async function buildRouteIndex(routesToBuild, onProgress = () => {}) {
  if (indexReady && lastRouteCount === routesToBuild.length) return;
  if (indexBuilding) {
    // Zaten build ediliyor – bekle
    while (indexBuilding) {
      await new Promise(r => setTimeout(r, 200));
    }
    return;
  }

  indexBuilding = true;
  routeIndex = new Map();         // stationId → Set<routeId>
  routeStationsMap = new Map();   // routeId → stations array
  allRoutesData = new Map();      // routeId → route metadata

  try {
    onProgress('Hat listesi yükleniyor...');
    const routes = routesToBuild && routesToBuild.length > 0 ? routesToBuild : await getAllRoutes();

    routes.forEach(r => {
      allRoutesData.set(r.id, r);
    });

    // Hatların duraklarını batch batch çek (aynı anda 8 istek)
    const BATCH_SIZE = 8;
    const routeIds = routes.map(r => r.id);

    for (let i = 0; i < routeIds.length; i += BATCH_SIZE) {
      const batch = routeIds.slice(i, i + BATCH_SIZE);
      onProgress(`Hat durakları yükleniyor... (${Math.min(i + BATCH_SIZE, routeIds.length)}/${routeIds.length})`);

      const results = await Promise.allSettled(
        batch.map(routeId => getRouteStations(routeId))
      );

      results.forEach((result, idx) => {
        const routeId = batch[idx];
        if (result.status === 'fulfilled' && result.value) {
          const stations = result.value;
          routeStationsMap.set(routeId, stations);

          stations.forEach(s => {
            const sid = String(s.stationId);
            if (!routeIndex.has(sid)) {
              routeIndex.set(sid, new Set());
            }
            routeIndex.get(sid).add(routeId);
          });
        }
      });
    }

    indexReady = true;
    onProgress(`İndeks hazır! ${routeStationsMap.size} hat, ${routeIndex.size} durak`);
    console.log(`Rota indeksi: ${routeStationsMap.size} hat, ${routeIndex.size} durak`);
  } catch (err) {
    console.error('Rota indeksi oluşturma hatası:', err);
    throw err;
  } finally {
    indexBuilding = false;
  }
}

/**
 * Bir durağın içinden geçen hatların detaylarını döner
 */
export function getLinesForStation(stationId) {
  if (!indexReady || !routeIndex || !allRoutesData) return [];
  const routeIds = routeIndex.get(String(stationId));
  if (!routeIds) return [];
  return Array.from(routeIds).map(id => allRoutesData.get(id)).filter(Boolean);
}

/**
 * İndeks hazır mı?
 */
export function isIndexReady() {
  return indexReady;
}

// ==============================
// YAKIN DURAK BULMA (client-side)
// ==============================

/**
 * Verilen koordinata en yakın N durağı bulur
 */
export function findNearestStations(lat, lng, allStations, count = 8) {
  return allStations
    .map(s => {
      const sLat = parseFloat(s.latitude || s.lat || 0);
      const sLng = parseFloat(s.longitude || s.lng || 0);
      if (!sLat || !sLng) return null;

      return {
        stationId: s.stationId || s.id,
        stationName: s.stationName || s.name || `Durak ${s.stationId}`,
        lat: sLat,
        lng: sLng,
        distance: calculateDistance(lat, lng, sLat, sLng),
      };
    })
    .filter(s => s !== null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

// ==============================
// ANA ROTA PLANLAMA
// ==============================

/**
 * A noktasından B noktasına rotaları bulur
 * 
 * @param {Object} startPoint - { lat, lng, stationId?, stationName? }
 * @param {Object} endPoint   - { lat, lng, stationId?, stationName? }
 * @param {Array}  allStations - Tüm durak listesi
 * @param {Function} onProgress - İlerleme callback
 * @returns {Promise<{routes: Array, error?: string}>}
 */
export async function findRoutes(startPoint, endPoint, allStations, onProgress = () => {}, timeConfig = { isNow: true, timeStr: null }) {
  const results = [];

  try {
    const allRoutes = await getAllRoutes();
    if (!allRoutes || allRoutes.length === 0) return { routes: [], error: 'Hat verisi alınamadı.' };

    // Gece Otobüsleri (Night Bus) Kalkanı: Saat seçimine göre veya o anki saate göre
    let h = new Date().getHours();
    let m = new Date().getMinutes();
    if (!timeConfig.isNow && timeConfig.timeStr) {
       const parts = timeConfig.timeStr.split(':');
       if (parts.length === 2) {
         h = parseInt(parts[0], 10);
         m = parseInt(parts[1], 10);
       }
    }
    const isNight = (h === 23 && m >= 30) || (h >= 0 && h <= 5);

    const cleanAllRoutes = allRoutes.filter(r => {
      const routeCodeStr = String(r.id || r.routeCode || '');
      const isNightBus = /^(910|920|930)/.test(routeCodeStr);
      if (isNightBus && !isNight) return false; // Gündüzse gece otobüslerini engelle
      return true;
    });

    if (typeof lastIsNight === 'undefined') window.lastIsNight = isNight;

    if (!indexReady || lastRouteCount !== cleanAllRoutes.length || window.lastIsNight !== isNight) {
      await buildRouteIndex(cleanAllRoutes, onProgress);
      lastRouteCount = cleanAllRoutes.length;
      window.lastIsNight = isNight;
    }

    // 1. Yakın durakları bul
    onProgress('Yakındaki duraklar belirleniyor...');

    const NEARBY_COUNT = 30; // 400-500 metrelik yürüyüş bandını kapsamak için çap genişletildi
    const startStations = startPoint.stationId
      ? [{ stationId: String(startPoint.stationId), stationName: startPoint.stationName, lat: startPoint.lat, lng: startPoint.lng, distance: 0 }]
      : findNearestStations(startPoint.lat, startPoint.lng, allStations, NEARBY_COUNT);

    const endStations = endPoint.stationId
      ? [{ stationId: String(endPoint.stationId), stationName: endPoint.stationName, lat: endPoint.lat, lng: endPoint.lng, distance: 0 }]
      : findNearestStations(endPoint.lat, endPoint.lng, allStations, NEARBY_COUNT);

    if (!startStations.length) return { routes: [], error: 'Başlangıç noktası yakınında durak bulunamadı.' };
    if (!endStations.length) return { routes: [], error: 'Varış noktası yakınında durak bulunamadı.' };

    // 2. Başlangıç ve bitiş duraklarından geçen hatları bul
    onProgress('Ortak hatlar analiz ediliyor...');

    const startStationIds = new Set(startStations.map(s => String(s.stationId)));
    const endStationIds = new Set(endStations.map(s => String(s.stationId)));

    // Başlangıç bölgesindeki hatlar
    const startRouteSets = new Map(); // routeId → startStation info
    startStations.forEach(s => {
      const routes = routeIndex.get(String(s.stationId));
      if (routes) {
        routes.forEach(routeId => {
          if (!startRouteSets.has(routeId) || s.distance < startRouteSets.get(routeId).distance) {
            startRouteSets.set(routeId, s);
          }
        });
      }
    });

    // Bitiş bölgesindeki hatlar
    const endRouteSets = new Map(); // routeId → endStation info
    endStations.forEach(s => {
      const routes = routeIndex.get(String(s.stationId));
      if (routes) {
        routes.forEach(routeId => {
          if (!endRouteSets.has(routeId) || s.distance < endRouteSets.get(routeId).distance) {
            endRouteSets.set(routeId, s);
          }
        });
      }
    });

    // 3. DİREKT ROTALAR — aynı hat her iki bölgede de var mı?
    onProgress('Direkt rotalar aranıyor...');

    for (const [routeId, startStation] of startRouteSets) {
      if (endRouteSets.has(routeId)) {
        const endStation = endRouteSets.get(routeId);
        const routeMeta = allRoutesData.get(routeId);
        const routeStations = routeStationsMap.get(routeId) || [];

        // Yön kontrolü: başlangıç durağı bitiş durağından ÖNCE mi geliyor?
        const startIdx = routeStations.findIndex(s => String(s.stationId) === String(startStation.stationId));
        const endIdx = routeStations.findIndex(s => String(s.stationId) === String(endStation.stationId));

        if (startIdx >= 0 && endIdx >= 0 && startIdx < endIdx) {
          const stopCount = endIdx - startIdx;

          results.push({
            type: 'direct',
            routeCode: routeId,
            routeName: routeMeta?.name || routeId,
            startStation: {
              id: startStation.stationId,
              name: startStation.stationName,
              lat: startStation.lat,
              lng: startStation.lng,
              walkDistance: startStation.distance,
            },
            endStation: {
              id: endStation.stationId,
              name: endStation.stationName,
              lat: endStation.lat,
              lng: endStation.lng,
              walkDistance: endStation.distance,
            },
            stopCount,
            startWalkDistance: startStation.distance,
            endWalkDistance: endStation.distance,
            totalWalkDistance: startStation.distance + endStation.distance,
            // Ara duraklar (haritada çizmek için)
            intermediateStops: routeStations.slice(startIdx, endIdx + 1).map(s => ({
              id: s.stationId,
              name: s.stationName,
              lat: parseFloat(s.latitude),
              lng: parseFloat(s.longitude),
            })),
          });
        }
      }
    }

    // 4. SÜRE TAHMİNLERİ EKLENİYOR
    const WALKING_PENALTY = 1.8; // Yürüme zahmetlidir, skoru artırır

    results.forEach(r => {
      r.walkMinutes = calculateWalkMinutes(r.totalWalkDistance);
      r.transitMinutes = Math.max(5, r.stopCount * 2); // Durak başı ~2 dakika
      r.totalWaitMinutes = 6; // Ortalama 6 dk bekleme varsayımı
      r.totalMinutes = r.walkMinutes + r.transitMinutes + r.totalWaitMinutes;
      r.score = (r.walkMinutes * WALKING_PENALTY) + r.transitMinutes + r.totalWaitMinutes;
    });

    results.sort((a, b) => a.score - b.score);
    const directRoutes = results.slice(0, 10);

    // 5. TRANSFER ROTALARI — direkt az ise
    if (directRoutes.length < 3) {
      onProgress('Aktarmalı rotalar aranıyor...');

      const transferRoutes = findTransferRoutes(
        startRouteSets, endRouteSets, startStations, endStations
      );
      
      transferRoutes.forEach(r => {
        r.walkMinutes = calculateWalkMinutes(r.totalWalkDistance);
        r.transitMinutes = r.leg1Transit + r.leg2Transit; 
        r.totalWaitMinutes = 15; // İki otobüs için statik bir varsayım (sonradan Canlı API ile ezilecek)
        r.totalMinutes = r.walkMinutes + r.transitMinutes + r.totalWaitMinutes;
        r.score = (r.walkMinutes * WALKING_PENALTY) + r.transitMinutes + r.totalWaitMinutes + 15; // Aktarma cezası
      });
      
      transferRoutes.sort((a, b) => a.score - b.score);
      directRoutes.push(...transferRoutes.slice(0, 3));
    }

    // Toplam tahmini süreye göre nihai sıralama
    directRoutes.sort((a, b) => a.totalMinutes - b.totalMinutes);

    // 6. CANLI OTOBÜS SAATLERİ (Zaman Makinesi) - SADECE "ŞİMDİ" İÇİN
    if (timeConfig.isNow) {
      onProgress('Senkronize aktarma süreleri hesaplanıyor...');
      await Promise.all(directRoutes.map(async r => {
      try {
        if (r.type === 'direct') {
          const liveData = await getBusDataForStation(r.startStation.id, r.routeCode);
          const nextBus = liveData.find(b => b.hatno === r.routeCode || b.hatadi?.includes(r.routeCode));
          
          if (nextBus) {
            const expectedWait = parseBusWaitTime(nextBus.sure);
            r.liveWaitMinutes = expectedWait;
            
            if (expectedWait !== null) {
              r.totalMinutes = r.totalMinutes - r.totalWaitMinutes + expectedWait;
              
              // KAÇIRMA KONTROLÜ (1. Aşama)
              const startWalkMins = calculateWalkMinutes(r.startWalkDistance);
              if (expectedWait < startWalkMins) {
                r.liveStatusAlert = true; // UI'da kırmızı yanması için
              }
            }
            
            if (nextBus.kalanduraksayisi === '0') {
              r.liveStatus = 'Hemen geliyor / Durakta!';
            } else {
              const timeTxt = expectedWait !== null ? formatDuration(expectedWait) : (nextBus.sure ? formatDuration(parseBusWaitTime(nextBus.sure)) : '?');
              if (expectedWait !== null && expectedWait > 20 && parseInt(nextBus.kalanduraksayisi) <= 3) {
                r.liveStatus = `Peron/Depo beklemesinde (~${timeTxt} sonra)`;
              } else {
                r.liveStatus = `${nextBus.kalanduraksayisi} durak geride (~${timeTxt} sonra)`;
              }
            }

            // Durum metnine ekleme yap (Direct için)
            if (r.liveStatusAlert) {
                const lang = timeConfig.lang || 'tr';
                r.liveStatus += ` <span style="font-weight:700; color:#ef4444;">(${lang === 'tr' ? 'Yetişilemez' : 'Unreachable'})</span>`;
            }
          }
        } else {
          // AKTARMALI ROTA GELECEK ZAMAN HESAPLAMASI
          const l1Code = r.legs[0].routeCode;
          const live1 = await getBusDataForStation(r.startStation.id, l1Code);
          const nextBus1 = live1.find(b => b.hatno === l1Code || b.hatadi?.includes(l1Code));
          
          let waitLeg1 = 7; // Varsayılan bekleme
          if (nextBus1) {
            const expectedWait1 = parseBusWaitTime(nextBus1.sure);
            if (expectedWait1 !== null) {
              waitLeg1 = expectedWait1;
              const timeTxt = formatDuration(expectedWait1);
              
              // Kaçırma kontrolü (Aktarmalı 1. Ayak)
              const startWalkMins = calculateWalkMinutes(r.startWalkDistance);
              const isMissed = expectedWait1 < startWalkMins;
              const lang = timeConfig.lang || 'tr';
              
              r.liveStatus = nextBus1.kalanduraksayisi === '0' ? 'Hemen geliyor / Durakta!' : 
                  (expectedWait1 > 20 && parseInt(nextBus1.kalanduraksayisi) <= 3 ? `Peron/Depo beklemesinde (~${timeTxt} sonra)` : `${nextBus1.kalanduraksayisi} durak geride (~${timeTxt} sonra)`);

              if (isMissed) {
                  r.liveStatusAlert = true;
                  r.liveStatus += ` <span style="font-weight:700; color:#ef4444;">(${lang === 'tr' ? 'Yetişilemez' : 'Unreachable'})</span>`;
              }
            }
          }

          // 1. ZAMAN MAKİNESİ: Aktarma durağına varış anımız!
          // (İlk yürüme) + (1. Otobüs bekleme) + (1. Otobüs yolculuğu)
          const arrivalToTransferMins = calculateWalkMinutes(r.startWalkDistance) + waitLeg1 + r.leg1Transit;
          
          // 2. OTOBÜS HESABI
          const l2Code = r.legs[1].routeCode;
          const live2 = await getBusDataForStation(r.transferStation.id, l2Code);
          
          // O durağa biz VARDİKTAN SONRA gelecek olan araçların tespiti
          const futureBuses = live2.filter(b => b.hatno === l2Code || b.hatadi?.includes(l2Code))
                                   .map(b => ({ ...b, mins: parseBusWaitTime(b.sure) }))
                                   .filter(b => b.mins !== null && b.mins >= arrivalToTransferMins)
                                   .sort((a,b) => a.mins - b.mins);
          
          if (futureBuses.length > 0) {
            const bestBus2 = futureBuses[0];
            const waitAtTransfer = bestBus2.mins - arrivalToTransferMins;
            r.liveStatusLeg2 = `Harika! Aktarma durağına vardığında sadece ~${formatDuration(waitAtTransfer)} bekleyeceksin.`;
            
            // Toplam süreyi sihirli şekilde gerçekte neyse ona sabitle:
            r.totalMinutes = arrivalToTransferMins + waitAtTransfer + r.leg2Transit + calculateWalkMinutes(r.endWalkDistance);
          } else {
            // Eğer veri varsa ama saatleri bizim varışımızdan önceyse (yani otobüsü kaçırıyorsak)
            const allBuses = live2.filter(b => b.hatno === l2Code || b.hatadi?.includes(l2Code))
                                 .map(b => ({ ...b, mins: parseBusWaitTime(b.sure) }))
                                 .filter(b => b.mins !== null);
            
            if (allBuses.length > 0) {
              const missedBus = allBuses[0];
              const lang = timeConfig.lang || 'tr';
              if (lang === 'tr') {
                r.liveStatusLeg2 = `⚠️ <b>KAÇIRABİLİRSİN!</b> (Otobüs ~${formatDuration(missedBus.mins)}, Senin Varışın ~${formatDuration(arrivalToTransferMins)})`;
              } else {
                r.liveStatusLeg2 = `⚠️ <b>MAY MISS!</b> (Bus ~${formatDuration(missedBus.mins)}, Your Arrival ~${formatDuration(arrivalToTransferMins)})`;
              }
            } else {
              r.liveStatusLeg2 = `Sen vardığında uygun saatli kalkış verisi sisteme henüz düşmemiş.`;
            }
            r.totalMinutes = r.totalMinutes - r.totalWaitMinutes + waitLeg1 + 10; // Klasik hesap
          }
        }
      } catch (err) {
        console.warn(`Canlı veri alınamadı:`, err);
      }
    }));
    }

    // Canlı veriden sonra toplam süreye göre bir daha sıralayalım
    directRoutes.sort((a, b) => a.totalMinutes - b.totalMinutes);

    return {
      routes: directRoutes,
      startStations: startStations.slice(0, 5),
      endStations: endStations.slice(0, 5),
      error: directRoutes.length === 0 ? 'Bu güzergâh için uygun otobüs rotası bulunamadı.' : null,
    };

  } catch (err) {
    console.error('Rota planlama hatası:', err);
    return { routes: [], error: `<strong>Planner Debug:</strong> ${err.message || String(err)}<br><small style="font-size:10px; opacity:0.6;">${err.stack ? err.stack.replace(/\n/g, '<br>') : ''}</small>` };
  }
}

// ==============================
// TRANSFER ROTALARI
// ==============================

function findTransferRoutes(startRouteSets, endRouteSets, startStations, endStations) {
  const transfers = [];
  const seen = new Set();

  for (const [startRouteId, startStation] of startRouteSets) {
    const startRouteStations = routeStationsMap.get(startRouteId) || [];

    for (const [endRouteId, endStation] of endRouteSets) {
      if (startRouteId === endRouteId) continue;

      const key = `${startRouteId}→${endRouteId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const endRouteStations = routeStationsMap.get(endRouteId) || [];
      const startIdx1 = startRouteStations.findIndex(s => String(s.stationId) === String(startStation.stationId));
      const endIdx2 = endRouteStations.findIndex(s => String(s.stationId) === String(endStation.stationId));

      if (startIdx1 < 0 || endIdx2 < 0) continue;

      // Ortak veya YAKIN durak bul
      let transferInfo = null;

      // START rotasındaki durakları tara (başlangıç puanından sonrakiler)
      for (let i = startIdx1 + 1; i < startRouteStations.length; i++) {
        const s1 = startRouteStations[i];
        const s1Lat = parseFloat(s1.latitude);
        const s1Lng = parseFloat(s1.longitude);

        // END rotasındaki durakları tara (bitiş puanından öncekiler)
        for (let j = 0; j < endIdx2; j++) {
           const s2 = endRouteStations[j];
           const s2Lat = parseFloat(s2.latitude);
           const s2Lng = parseFloat(s2.longitude);

           // İki durak arası mesafe 250 metreden az mı? (Aynı durak ise 0 çıkar)
           const d = calculateDistance(s1Lat, s1Lng, s2Lat, s2Lng);
           if (d < 250) {
             transferInfo = {
               s1, s2, 
               dist: d,
               leg1Stops: i - startIdx1,
               leg2Stops: endIdx2 - j
             };
             break;
           }
        }
        if (transferInfo) break;
      }

      if (transferInfo) {
        const startMeta = allRoutesData.get(startRouteId);
        const endMeta = allRoutesData.get(endRouteId);

        const leg1Transit = Math.max(4, transferInfo.leg1Stops * 2);
        const leg2Transit = Math.max(4, transferInfo.leg2Stops * 2);

        transfers.push({
          type: 'transfer',
          legs: [
            { routeCode: startRouteId, routeName: startMeta?.name || startRouteId },
            { routeCode: endRouteId, routeName: endMeta?.name || endRouteId },
          ],
          transferStation: {
            id: transferInfo.s1.stationId,
            name: transferInfo.s1.stationName,
            lat: parseFloat(transferInfo.s1.latitude),
            lng: parseFloat(transferInfo.s1.longitude),
            isNearby: transferInfo.dist > 10,
            nearbyTarget: {
               id: transferInfo.s2.stationId,
               name: transferInfo.s2.stationName,
               lat: parseFloat(transferInfo.s2.latitude),
               lng: parseFloat(transferInfo.s2.longitude),
               dist: transferInfo.dist
            }
          },
          startStation: {
            id: startStation.stationId,
            name: startStation.stationName,
            lat: startStation.lat,
            lng: startStation.lng,
            walkDistance: startStation.distance,
          },
          endStation: {
            id: endStation.stationId,
            name: endStation.stationName,
            lat: endStation.lat,
            lng: endStation.lng,
            walkDistance: endStation.distance,
          },
          startWalkDistance: startStation.distance,
          endWalkDistance: endStation.distance,
          totalWalkDistance: startStation.distance + endStation.distance,
          leg1Stops: transferInfo.leg1Stops,
          leg1Transit,
          leg2Stops: transferInfo.leg2Stops,
          leg2Transit
        });
      }
    }
  }

  transfers.sort((a, b) => a.totalWalkDistance - b.totalWalkDistance);
  return transfers;
}
