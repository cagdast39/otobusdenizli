/**
 * DenizliBus — Ana Uygulama
 * Denizli Otobüs Rota Bulucu
 */

import './css/index.css';
import { inject } from '@vercel/analytics';

// Analytics başlat
inject();
import { getAllStations, searchStationOrRoute, getTimetableImage, getBusDataForStation } from './api/denizli-api.js';
import {
  findRoutes, calculateDistance, formatDistance, formatDuration,
  findNearestStations, buildRouteIndex, isIndexReady, fetchOSRMRoute, getLinesForStation
} from './api/route-planner.js';
import { translations } from './api/i18n.js';

// ===========================
// SABITLER
// ===========================
const DENIZLI_CENTER = { lat: 37.7749, lng: 29.0875 };
const DEFAULT_ZOOM = 13;
const SEARCH_DEBOUNCE = 300;

// ===========================
// DURUM
// ===========================
const state = {
  map: null,
  markers: { start: null, end: null, stops: [], route: [] },
  layers: { routeLayer: null },
  allStations: [],
  userLat: null,
  userLng: null,
  startPoint: null,
  endPoint: null,
  theme: localStorage.getItem('denizlibus-theme') || 'dark',
  isSearching: false,
  nearbyVisible: false,
  searchMode: 'all', // 'all' = Harita+Durak, 'stops' = Sadece Durak
  routeIndexValid: false,
  lang: localStorage.getItem('denizlibus-lang') || 'tr',
  currentSortType: 'all',
};

// ===========================
// DOM
// ===========================
const $ = (s) => document.querySelector(s);
let els = {};

function cacheDom() {
  els = {
    loadingOverlay: $('#loading-overlay'),
    inputStart: $('#input-start'),
    inputEnd: $('#input-end'),
    suggestionsStart: $('#suggestions-start'),
    suggestionsEnd: $('#suggestions-end'),
    btnSearch: $('#btn-search'),
    btnSwap: $('#btn-swap'),
    btnMyLocationStart: $('#btn-my-location-start'),
    btnMyLocationEnd: $('#btn-my-location-end'),
    btnNearby: $('#btn-nearby'),
    btnThemeToggle: $('#theme-toggle'),
    btnCenterMap: $('#btn-center-map'),
    btnRequestLocation: $('#btn-request-location'),
    routeResults: $('#route-results'),
    nearbyPanel: $('#nearby-panel'),
    nearbyList: $('#nearby-list'),
    statusBar: $('#status-bar'),
    statusText: $('#status-text'),
    departureTime: $('#departure-time'),
    departureTimeCustom: $('#departure-time-custom'),
    modalTimetable: $('#modal-timetable'),
    modalTimetableClose: $('#modal-timetable-close'),
    modalTimetableImg: $('#modal-timetable-img'),
    modalTimetableLoader: $('#modal-timetable-loader'),
    modalTimetableError: $('#modal-timetable-error'),
    langToggle: $('#lang-toggle'),
    langText: $('#lang-toggle .lang-text'),
  };
}

// ===========================
// BAŞLATMA
// ===========================
async function init() {
  // PWA Çevrimdışı (Offline) Ağ Koruması
  window.addEventListener('offline', () => {
    const alertLabel = document.createElement('div');
    alertLabel.id = "offline-alert";
    alertLabel.style.cssText = "background:#ef4444; color:white; text-align:center; padding:8px; font-size:0.9rem; font-weight:600; position:fixed; top:0; left:0; width:100%; z-index:99999; box-shadow:0 4px 10px rgba(0,0,0,0.3);";
    alertLabel.innerHTML = "<span>⏳</span> İnternet bağlantınız koptu. Canlı verilere ulaşılamıyor.";
    document.body.prepend(alertLabel);
  });

  window.addEventListener('online', () => {
    const alert = document.getElementById('offline-alert');
    if (alert) alert.remove();
    showStatus('🌐 İnternet bağlantısı yeniden sağlandı.', 4000);
  });

  cacheDom();
  document.body.dataset.theme = state.theme;
  initMap();
  bindEvents();
  
  // Favorileri Yükle
  loadFavorites();

  // Dili uygula
  updateTranslations();

  // Durakları yükle
  // ... rest of logic stays same or fits in ...
  showStatus(translations[state.lang].loadStations);
  try {
    state.allStations = await getAllStations();
    console.log(`${state.allStations.length} durak yüklendi`);
    showStatus(`${state.allStations.length} ${translations[state.lang].stationsLoaded}`, 2000);
  } catch (err) {
    console.error('Durak yükleme hatası:', err);
    showStatus(state.lang === 'tr' ? 'Durak verileri yüklenenemedi — lütfen sayfayı yenileyin.' : 'Could not load stations - please refresh.', 8000);
  }

  // Rota indeksini arka planda oluştur
  buildRouteIndex(null, (msg) => console.log('[index]', msg)).then(() => {
    if (state.nearbyVisible && state.userLat && state.userLng) {
      loadNearby(state.userLat, state.userLng);
    }
  }).catch(err => {
    console.warn('Rota indeksi arka planda oluşturulamadı:', err);
  });

  setTimeout(() => els.loadingOverlay.classList.add('hidden'), 600);
}

// ===========================
// ÇEVİRİLER
// ===========================
function updateTranslations() {
  const t = translations[state.lang];
  els.langText.textContent = state.lang.toUpperCase();
  
  $('.logo-subtitle').textContent = t.subtitle;
  $('.search-title').childNodes[2].textContent = ` ${t.whereTo}`;
  els.inputStart.placeholder = t.from;
  els.inputEnd.placeholder = t.to;
  els.btnSearch.querySelector('span').textContent = t.findRoute;
  
  const timeLabel = $('.time-picker-wrapper label');
  if (timeLabel) timeLabel.textContent = `⏰ ${t.depTime}`;
  
  const departureOptions = els.departureTime.querySelectorAll('option');
  if (departureOptions[0]) departureOptions[0].textContent = t.now;
  if (departureOptions[1]) departureOptions[1].textContent = t.customTime;
  
  const favoriTitle = $('#favorites-container div');
  if (favoriTitle) favoriTitle.textContent = `⭐ ${t.favorites}`;
  
  const nearbyTitle = $('#nearby-panel .section-title span:last-child');
  if (nearbyTitle) nearbyTitle.textContent = ` ${t.nearbyStops}`;
  
  const nearbyEmpty = $('#nearby-list .empty-state p');
  if (nearbyEmpty) {
    nearbyEmpty.textContent = state.lang === 'tr' 
      ? 'Konumunuza yakın durakları bulmak için konum iznine ihtiyacımız var.'
      : 'We need location permission to find nearby stops.';
  }
  
  const aboutTitle = $('#about-modal h2 span:last-child');
  if (aboutTitle) aboutTitle.textContent = ` ${t.about}`;
  
  // Rota sonuçları (varsa) yeniden render et
  if (currentResults && !els.routeResults.classList.contains('hidden')) {
    displayResults(currentResults, state.currentSortType);
  }
}

function toggleLanguage() {
  state.lang = state.lang === 'tr' ? 'en' : 'tr';
  localStorage.setItem('denizlibus-lang', state.lang);
  updateTranslations();
  showStatus(state.lang === 'tr' ? 'Dil: Türkçe' : 'Language: English', 2000);
}

// ===========================
// HARİTA
function initMap() {
  state.map = L.map('map', {
    center: [DENIZLI_CENTER.lat, DENIZLI_CENTER.lng],
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
  });
  updateMapTiles();
  
  // Rota katmanını bir kere oluşturuyoruz. Haritayı temizlerken bunu .clearLayers() yapacağız.
  state.layers.routeLayer = L.featureGroup().addTo(state.map);
}

function updateMapTiles() {
  state.map.eachLayer(l => { if (l instanceof L.TileLayer) state.map.removeLayer(l); });
  const url = state.theme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  L.tileLayer(url, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(state.map);
}

function createIcon(type = 'default') {
  const c = { start: ['#10b981','#059669'], end: ['#ef4444','#dc2626'], user: ['#8b5cf6','#7c3aed'], default: ['#3b82f6','#2563eb'], transfer: ['#f59e0b','#d97706'] }[type] || ['#3b82f6','#2563eb'];
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:22px;height:22px;background:${c[0]};border:3px solid ${c[1]};border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><div style="width:5px;height:5px;background:#fff;border-radius:50%"></div></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
  });
}

function placeMarker(type, lat, lng, title) {
  if (state.markers[type]) state.map.removeLayer(state.markers[type]);
  const marker = L.marker([lat, lng], { 
    icon: createIcon(type),
    draggable: true // İğneleri sürüklenebilir yapıyoruz
  }).addTo(state.map).bindPopup(`<div class="popup-title">${title} <br><small style="opacity:0.7">(Sürükleyebilirsiniz)</small></div>`);
  
  // Sürükleme bittiğinde tetiklenecek olay
  marker.on('dragend', function (e) {
    const newPos = e.target.getLatLng();
    if (type === 'start') {
      state.startPoint = { lat: newPos.lat, lng: newPos.lng };
      els.inputStart.value = `📍 Harita (${newPos.lat.toFixed(4)}, ${newPos.lng.toFixed(4)})`;
    } else {
      state.endPoint = { lat: newPos.lat, lng: newPos.lng };
      els.inputEnd.value = `📍 Harita (${newPos.lat.toFixed(4)}, ${newPos.lng.toFixed(4)})`;
    }
    
    // Eğer her iki nokta da belliyse otomatik arama yap
    if (state.startPoint && state.endPoint) {
      handleSearch();
    }
    updateBtn();
  });

  state.markers[type] = marker;
}

// ===========================
// EVENT'LER
// ===========================
function bindEvents() {
  let stT, enT;
  els.inputStart.addEventListener('input', e => { 
    if (e.target.value.trim() === '') showFavoriteSuggestions(els.suggestionsStart, 'start');
    else { clearTimeout(stT); stT = setTimeout(() => handleInput(e.target.value, 'start'), SEARCH_DEBOUNCE); }
    updateBtn(); 
  });
  els.inputEnd.addEventListener('input', e => { 
    if (e.target.value.trim() === '') showFavoriteSuggestions(els.suggestionsEnd, 'end');
    else { clearTimeout(enT); enT = setTimeout(() => handleInput(e.target.value, 'end'), SEARCH_DEBOUNCE); }
    updateBtn(); 
  });

  els.inputStart.addEventListener('focus', () => { 
    if (els.inputStart.value.trim() === '') showFavoriteSuggestions(els.suggestionsStart, 'start');
    else if (els.suggestionsStart.children.length) els.suggestionsStart.classList.remove('hidden'); 
  });
  els.inputEnd.addEventListener('focus', () => { 
    if (els.inputEnd.value.trim() === '') showFavoriteSuggestions(els.suggestionsEnd, 'end');
    else if (els.suggestionsEnd.children.length) els.suggestionsEnd.classList.remove('hidden'); 
  });

  document.addEventListener('click', e => {
    if (!els.inputStart.contains(e.target) && !els.suggestionsStart.contains(e.target)) els.suggestionsStart.classList.add('hidden');
    if (!els.inputEnd.contains(e.target) && !els.suggestionsEnd.contains(e.target)) els.suggestionsEnd.classList.add('hidden');
  });

  els.btnSearch.addEventListener('click', handleSearch);

  // Kalkış Zamanı Seçici
  els.departureTime?.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      els.departureTimeCustom.classList.remove('hidden');
    } else {
      els.departureTimeCustom.classList.add('hidden');
    }
  });

  // Saat Tablosu Kapatma
  els.modalTimetableClose?.addEventListener('click', () => {
    els.modalTimetable.style.opacity = '0';
    els.modalTimetable.style.pointerEvents = 'none';
  });

  els.modalTimetable?.addEventListener('click', (e) => {
    if (e.target === els.modalTimetable) {
      els.modalTimetable.style.opacity = '0';
      els.modalTimetable.style.pointerEvents = 'none';
    }
  });

  // Saat Panosu Tıklaması (Event Delegation)
  els.routeResults.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-timetable')) {
      e.stopPropagation();
      const routeCode = e.target.dataset.route;
      showTimetableModal(routeCode);
    }
  });

  // Arama Modu Şalteri
  const modeAll = $('#mode-all');
  const modeStops = $('#mode-stops');
  
  if (modeAll && modeStops) {
    modeAll.addEventListener('click', () => {
      state.searchMode = 'all';
      modeAll.style.background = 'var(--bg-card)';
      modeAll.style.color = 'var(--text-primary)';
      modeAll.style.boxShadow = 'var(--shadow-sm)';
      modeStops.style.background = 'transparent';
      modeStops.style.color = 'var(--text-secondary)';
      modeStops.style.boxShadow = 'none';
    });
    modeStops.addEventListener('click', () => {
      state.searchMode = 'stops';
      modeStops.style.background = 'var(--bg-card)';
      modeStops.style.color = 'var(--text-primary)';
      modeStops.style.boxShadow = 'var(--shadow-sm)';
      modeAll.style.background = 'transparent';
      modeAll.style.color = 'var(--text-secondary)';
      modeAll.style.boxShadow = 'none';
      
      // Geçiş yaptıysa açık olan Google tahminlerini gizle
      $('#suggestions-start').classList.add('hidden');
      $('#suggestions-end').classList.add('hidden');
    });
  }

  // Dışarı tıklayınca önerileri kapat
  document.addEventListener('click', (e) => {
    if (!els.inputStart.contains(e.target) && !els.suggestionsStart.contains(e.target)) els.suggestionsStart.classList.add('hidden');
    if (!els.inputEnd.contains(e.target) && !els.suggestionsEnd.contains(e.target)) els.suggestionsEnd.classList.add('hidden');
  });

  els.btnSwap.addEventListener('click', handleSwap);
  els.btnMyLocationStart.addEventListener('click', () => getLocation('start'));
  els.btnMyLocationEnd.addEventListener('click', () => getLocation('end'));
  els.btnThemeToggle.addEventListener('click', toggleTheme);
  els.langToggle.addEventListener('click', toggleLanguage);
  els.btnCenterMap.addEventListener('click', () => state.map.flyTo([DENIZLI_CENTER.lat, DENIZLI_CENTER.lng], DEFAULT_ZOOM));
  els.btnNearby.addEventListener('click', toggleNearby);
  els.btnRequestLocation?.addEventListener('click', () => getLocation('nearby'));

  els.inputStart.addEventListener('keydown', e => { if (e.key === 'Enter') els.inputEnd.focus(); });
  els.inputEnd.addEventListener('keydown', e => { if (e.key === 'Enter' && !els.btnSearch.disabled) handleSearch(); });

  state.map.on('click', handleMapClick);
}

// ===========================
// ARAMA GİRDİSİ
// ===========================
let geocodeAbort = null;

async function handleInput(query, type) {
  const sugEl = type === 'start' ? els.suggestionsStart : els.suggestionsEnd;
  if (query.length < 2) { sugEl.classList.add('hidden'); sugEl.innerHTML = ''; return; }

  const q = query.toLocaleLowerCase('tr');
  
  // 1. Duraklarda Ara (Lokal)
  const matches = state.allStations.filter(s => {
    const name = (s.stationName || '').toLocaleLowerCase('tr');
    const id = String(s.stationId || '');
    return name.includes(q) || id.includes(q);
  }).slice(0, 5);

  let htmlResult = '';

  // Durakları HTML'e dönüştür
  if (matches.length > 0) {
    htmlResult += `<div class="suggestion-group-title" style="font-size:0.75rem;opacity:0.6;padding: 5px 12px;margin-top:5px;">🚏 DURAKLAR</div>`;
    htmlResult += matches.map(s => {
      const name = s.stationName || `Durak ${s.stationId}`;
      const id = s.stationId;
      return `<li class="suggestion-item" data-id="${id}" data-name="${name}" data-lat="${s.latitude || 0}" data-lng="${s.longitude || 0}" data-type="${type}">
        <span class="stop-number">${id}</span>
        <span class="stop-name">${highlight(name, query)}</span>
      </li>`;
    }).join('');
  }

  // Ekranda hemen göster
  if (htmlResult) {
    sugEl.innerHTML = htmlResult;
    sugEl.querySelectorAll('.suggestion-item').forEach(el => el.addEventListener('click', () => selectSuggestion(el)));
    sugEl.classList.remove('hidden');
  }

  // 2. Mekan / Adres Arama (Google Places API Yönlendirmeli)
  if (state.searchMode === 'all' && q.length >= 3) {
    if (state[`googleAbortController_${type}`]) {
      state[`googleAbortController_${type}`].abort(); // Önceki isteği iptal et
    }
    state[`googleAbortController_${type}`] = new AbortController();
    
    try {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
      if (!apiKey) throw new Error('VITE_GOOGLE_MAPS_API_KEY bulunamadı!');
      
      const apiGoogleBase = import.meta.env.VITE_API_GOOGLE_BASE || 'https://otobusdenizli-api.cagdaspronebeklion.workers.dev/google/maps/api/place/autocomplete/json';
      
      // SADECE Denizli Merkezi ve 30km çap etrafına KESİN olarak odaklan (strictbounds eklendi)
      const gUrl = `${apiGoogleBase}?input=${encodeURIComponent(query)}&location=37.7749,29.0875&radius=30000&strictbounds=true&language=tr&key=${apiKey}`;
      const res = await fetch(gUrl, { signal: state[`googleAbortController_${type}`].signal });
      const data = await res.json();

      if (data.predictions && data.predictions.length > 0) {
        htmlResult += `<div class="suggestion-group-title" style="font-size:0.75rem;opacity:0.6;padding: 5px 12px;margin-top:5px;border-top:1px solid var(--border-color);">🌍 GOOGLE HARİTALAR (Mekanlar)</div>`;
        htmlResult += data.predictions.map(p => {
          return `<li class="suggestion-item place-item" data-place-id="${p.place_id}" data-name="${p.structured_formatting.main_text}" data-type="${type}">
            <span class="stop-number" style="background:#ea4335;color:white;font-size:12px;">📍</span>
            <span class="stop-name">${p.structured_formatting.main_text} <span style="font-size:0.7rem;opacity:0.6;">${p.structured_formatting.secondary_text || ''}</span></span>
          </li>`;
        }).join('');
        
        sugEl.innerHTML = htmlResult;
        sugEl.querySelectorAll('.suggestion-item').forEach(el => el.addEventListener('click', () => selectSuggestion(el)));
        sugEl.classList.remove('hidden');
      } else if (!matches.length) {
        sugEl.classList.add('hidden'); sugEl.innerHTML = '';
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Google Places hatası:', err);
    }
  } else if (!matches.length) {
    sugEl.classList.add('hidden'); sugEl.innerHTML = ''; 
  }
}

function highlight(text, q) {
    const i = text.toLocaleLowerCase('tr').indexOf(q.toLocaleLowerCase('tr'));
  if (i < 0) return text;
  return text.slice(0, i) + '<strong>' + text.slice(i, i + q.length) + '</strong>' + text.slice(i + q.length);
}

async function showFavoriteSuggestions(list, type) {
  const favs = JSON.parse(localStorage.getItem('cw_fav_locations') || '[]');
  if (favs.length === 0) {
    list.classList.add('hidden');
    return;
  }
  
  list.innerHTML = `<li style="padding:6px 14px; font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; background:var(--bg-tertiary); pointer-events:none;">⭐ Kayıtlı Konumlar</li>`;
  
  favs.forEach((fav, index) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
         <span>📍</span>
         <span style="font-weight:600; color:var(--text-primary);">${fav.name}</span>
      </div>
      <button class="fav-delete" data-index="${index}" style="margin:0; border:none; background:transparent; font-size:1.2rem; line-height:1; color:#ef4444; padding:0 8px; cursor:pointer;" title="Kaldır">×</button>
    `;
    
    li.addEventListener('click', (e) => {
      if(e.target.classList.contains('fav-delete')) {
         e.stopPropagation();
         favs.splice(index, 1);
         localStorage.setItem('cw_fav_locations', JSON.stringify(favs));
         showFavoriteSuggestions(list, type);
         window.__denizlibus.utils.loadFavorites && window.__denizlibus.utils.loadFavorites();
         return;
      }
      
      const point = fav.point;
      if (type === 'start') {
        state.startPoint = point; 
        document.getElementById('input-start').value = fav.name; 
        list.classList.add('hidden');
        placeMarker('start', point.lat, point.lng, fav.name);
      } else {
        state.endPoint = point; 
        document.getElementById('input-end').value = fav.name; 
        list.classList.add('hidden');
        placeMarker('end', point.lat, point.lng, fav.name);
      }
      
      // Butonu güncelle (Harici fonksiyonu bul)
      const btnSearch = document.getElementById('btn-search');
      if (state.startPoint && state.endPoint) {
        btnSearch.disabled = false;
        state.map.fitBounds(L.latLngBounds([state.startPoint.lat, state.startPoint.lng], [state.endPoint.lat, state.endPoint.lng]), { padding: [60, 60] });
      } else {
        btnSearch.disabled = true;
        state.map.flyTo([point.lat, point.lng], 15);
      }
    });
    
    list.appendChild(li);
  });
  list.classList.remove('hidden');
}

async function selectSuggestion(el) {
  const type = el.dataset.type;
  const isPlace = el.classList.contains('place-item');
  
  let lat, lng;

  if (isPlace) {
    // Google'dan Geocode Çek (İşaretleme için koordinat lazım)
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) showStatus('Sistemde Harita API Anahtarı eksik!', 3000);
    
    els.inputStart.disabled = true; els.inputEnd.disabled = true; // Kısa bir kitleme
    showStatus('Google Haritalar konumu alınıyor...', 2000);
    
    try {
      // Geocoding API aktif olmadığı için aynı yetkiyle çalışan Places Details API'den çekiyoruz
      const pUrl = `https://otobusdenizli-api.cagdaspronebeklion.workers.dev/google/maps/api/place/details/json?place_id=${el.dataset.placeId}&fields=geometry&key=${apiKey}`;
      const r = await fetch(pUrl);
      const d = await r.json();
      if (d.result && d.result.geometry && d.result.geometry.location) {
        lat = d.result.geometry.location.lat;
        lng = d.result.geometry.location.lng;
      }
    } catch (err) {
      console.warn("Otobüs resimleri alınamadı", err);
    }
    
    els.inputStart.disabled = false; els.inputEnd.disabled = false;
  } else {
    lat = parseFloat(el.dataset.lat);
    lng = parseFloat(el.dataset.lng);
  }

  if (!lat || !lng) {
    showStatus('Konum verisi alınamadı, tekrar deneyin.', 3000);
    return;
  }

  const point = { 
    lat: lat, 
    lng: lng, 
    stationId: null, // Her zaman alan taraması yap
    stationName: el.dataset.name 
  };

  if (type === 'start') {
    state.startPoint = point; els.inputStart.value = point.stationName; els.suggestionsStart.classList.add('hidden');
    placeMarker('start', point.lat, point.lng, point.stationName);
  } else {
    state.endPoint = point; els.inputEnd.value = point.stationName; els.suggestionsEnd.classList.add('hidden');
    placeMarker('end', point.lat, point.lng, point.stationName);
  }
  updateBtn();

  if (state.startPoint && state.endPoint) {
    state.map.fitBounds(L.latLngBounds([state.startPoint.lat, state.startPoint.lng], [state.endPoint.lat, state.endPoint.lng]), { padding: [60, 60] });
  } else {
    state.map.flyTo([point.lat, point.lng], 15);
  }
}

// ===========================
// HARİTA TIKLAMASI
// ===========================
function handleMapClick(e) {
  const { lat, lng } = e.latlng;
  if (!state.startPoint || (!state.startPoint && !state.endPoint)) {
    state.startPoint = { lat, lng };
    els.inputStart.value = `📍 Harita (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    placeMarker('start', lat, lng, '📍 Başlangıç Noktası');
  } else if (!state.endPoint) {
    state.endPoint = { lat, lng };
    els.inputEnd.value = `📍 Harita (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    placeMarker('end', lat, lng, '📍 Varış Noktası');
    state.map.fitBounds(L.latLngBounds([state.startPoint.lat, state.startPoint.lng], [state.endPoint.lat, state.endPoint.lng]), { padding: [60, 60] });
    // Her iki nokta da seçildiğinde otomatik rota araması yap
    handleSearch();
  } else {
    // İki nokta da varsa, önce bitişi sıfırlarız gibi davranıp tıklandığında bitişi güncelleyelim.
    state.endPoint = { lat, lng };
    els.inputEnd.value = `📍 Harita (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    placeMarker('end', lat, lng, '📍 Varış Noktası');
    handleSearch();
  }
  updateBtn();
}

// ===========================
// FAVORİLER (LOCAL STORAGE)
// ===========================
function loadFavorites() {
  let favs = JSON.parse(localStorage.getItem('cw_fav_locations') || '[]');
  
  // Eğer geçmiş koddan kalan bozuk kayıtlar varsa süpür
  const originalFavs = favs.length;
  favs = favs.filter(f => f.point && f.point.lat && f.point.lng);
  if (favs.length !== originalFavs) {
    localStorage.setItem('cw_fav_locations', JSON.stringify(favs));
  }

  const container = document.getElementById('favorites-container');
  const list = document.getElementById('favorites-list');
  
  if (!container || !list) return;

  if (favs.length === 0) {
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  list.innerHTML = '';
  
  favs.forEach((fav, index) => {
    const btn = document.createElement('button');
    btn.className = 'fav-chip';
    btn.innerHTML = `<span>⭐ ${fav.name}</span><button class="fav-delete" data-index="${index}" title="Kaldır">×</button>`;
    
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('fav-delete')) {
        e.stopPropagation();
        favs.splice(index, 1);
        localStorage.setItem('cw_fav_locations', JSON.stringify(favs));
        loadFavorites();
        return;
      }
      
      if (!state.startPoint) {
        state.startPoint = fav.point;
        els.inputStart.value = fav.name;
        placeMarker('start', fav.point.lat, fav.point.lng, fav.name);
        state.map.flyTo([fav.point.lat, fav.point.lng], 15);
      } else if (!state.endPoint) {
        state.endPoint = fav.point;
        els.inputEnd.value = fav.name;
        placeMarker('end', fav.point.lat, fav.point.lng, fav.name);
        state.map.fitBounds(L.latLngBounds([state.startPoint.lat, state.startPoint.lng], [state.endPoint.lat, state.endPoint.lng]), { padding: [60, 60] });
      } else {
        // İkisi de doluysa bitişi ez
        state.endPoint = fav.point;
        els.inputEnd.value = fav.name;
        placeMarker('end', fav.point.lat, fav.point.lng, fav.name);
        state.map.fitBounds(L.latLngBounds([state.startPoint.lat, state.startPoint.lng], [state.endPoint.lat, state.endPoint.lng]), { padding: [60, 60] });
      }
      
      updateBtn();
    });
    
    list.appendChild(btn);
  });
}

function handleSaveLocation(type) {
  const originPoint = type === 'start' ? state.startPoint : state.endPoint;
  
  if (!originPoint) {
    showStatus('Önce bir konum/durak seçmelisiniz!', 3000);
    return;
  }
  
  // Güvenlik Kalkanı: Kesin olarak lat/lng kopyalanacak. StationId varsa eklenecek, yoksa null
  const point = {
    lat: parseFloat(originPoint.lat) || 0,
    lng: parseFloat(originPoint.lng) || 0,
    stationId: originPoint.stationId || null,
    stationName: originPoint.stationName || null,
  };
  
  if (!point.lat || !point.lng) {
    showStatus('Geçerli bir koordinat/durak bulunamadı!', 3000);
    return;
  }
  
  const defaultName = point.stationName || 'Konumum';
  const name = prompt('Bu konumu kaydet (Örn: Ev, İş, Spor):', defaultName);
  
  if (!name || name.trim() === '') return;
  
  const favs = JSON.parse(localStorage.getItem('cw_fav_locations') || '[]');
  favs.push({ name: name.trim(), point });
  localStorage.setItem('cw_fav_locations', JSON.stringify(favs));
  
  loadFavorites();
  showStatus(`⭐ "${name.trim()}" listeye eklendi!`, 3000);
}


// ROTA ARAMA
// ===========================
function updateBtn() {
  const btnSave = document.getElementById('btn-save-fav');
  if (state.startPoint && state.endPoint) {
    els.btnSearch.disabled = false;
    if (btnSave) {
      btnSave.classList.remove('hidden');
      btnSave.style.display = 'flex';
    }
  } else {
    els.btnSearch.disabled = true;
    if (btnSave) {
      btnSave.style.display = 'none';
      btnSave.classList.add('hidden');
    }
  }
}

async function handleSearch() {
  if (!state.startPoint || !state.endPoint || state.isSearching) return;
  state.isSearching = true;
  els.btnSearch.classList.add('searching');
  els.btnSearch.querySelector('span').textContent = 'Aranıyor...';
  clearRouteDisplay();

  const depType = document.getElementById('departure-time')?.value || 'now';
  const depTimeVal = depType === 'custom' ? document.getElementById('departure-time-custom')?.value : null;

  try {
    const result = await findRoutes(state.startPoint, state.endPoint, state.allStations, showStatus, { 
      isNow: depType === 'now', 
      timeStr: depTimeVal,
      lang: state.lang || 'tr'
    });
    displayResults(result, 'fastest');
    if (result.routes.length > 0) showStatus(`${result.routes.length} rota bulundu!`, 3000);
    else showStatus(result.error || 'Rota bulunamadı.', 4000);
  } catch (err) {
    console.error('Arama hatası:', err);
    showStatus('Arama sırasında hata oluştu.', 4000);
    displayResults({ routes: [], error: `<strong>Debug:</strong> ${err.message || String(err)}<br><small style="font-size:10px; opacity:0.6;">${err.stack ? err.stack.replace(/\n/g, '<br>') : ''}</small>` }, 'fastest');
  } finally {
    state.isSearching = false;
    els.btnSearch.classList.remove('searching');
    els.btnSearch.querySelector('span').textContent = 'Rota Bul';
  }
}

let currentResults = null;

const displayCode = (code) => code ? String(code).replace(/[a-zA-Z]+$/, '') : '?';
const displayName = (name, code) => {
  if (!name) return `Hat ${code || '?'}`;
  return name.replace(new RegExp(`^${code}\\s*-\\s*`), '').trim();
};

function displayResults(result, sortType = 'all') {
  currentResults = result;
  state.currentSortType = sortType;
  els.routeResults.classList.remove('hidden');

  if (!result.routes.length) {
    els.routeResults.innerHTML = `<div class="no-results">
      <span class="no-results-icon">🔍</span>
      <p class="no-results-text">${result.error || 'Bu güzergâh için uygun rota bulunamadı.'}</p>
      <p class="no-results-text" style="font-size:.78rem;opacity:.7">Harita üzerine tıklayarak veya durak adı arayarak farklı noktalar seçebilirsiniz.</p>
    </div>`;
    return;
  }

  // Filtreleme (Aktarmasız)
  let visibleRoutes = result.routes.slice();
  if (sortType === 'direct') {
    visibleRoutes = visibleRoutes.filter(r => r.type === 'direct');
  }

  // Varsayılan olarak her zaman en hızlı (toplam dakika) en üstte olsun
  visibleRoutes.sort((a,b) => a.totalMinutes - b.totalMinutes);

  const header = `<div class="results-header">
    <span class="results-title">🚌 Bulunan Rotalar <span class="results-count">(${visibleRoutes.length} sonuç)</span></span>
    <button class="btn-clear-results" id="btn-clear-results" title="Sonuçları Temizle">&#x2715;</button>
  </div>
  <div class="results-filters">
    <button class="filter-btn ${sortType === 'all' ? 'active' : ''}" data-sort="all">📋 Tümü</button>
    <button class="filter-btn ${sortType === 'direct' ? 'active' : ''}" data-sort="direct">✨ Sadece Direkt</button>
  </div>`;

  let cards = '';
  if (visibleRoutes.length === 0) {
    cards = `<p style="padding:15px; text-align:center; opacity:0.7; font-size:0.85rem;">Bu kritere uygun rota bulunamadı.</p>`;
  } else {
    cards = visibleRoutes.map((r, i) => r.type === 'direct' ? directCard(r, i) : transferCard(r, i)).join('');
  }
  
  els.routeResults.innerHTML = header + cards;

  // Filtre tetikleyicileri
  els.routeResults.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      displayResults(currentResults, e.target.dataset.sort);
    });
  });

  $('#btn-clear-results')?.addEventListener('click', clearRouteDisplay);
  els.routeResults.querySelectorAll('.route-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      els.routeResults.querySelectorAll('.route-card').forEach(c => {
        c.classList.remove('active');
        const d = c.querySelector('.route-directions');
        if (d) d.style.display = 'none';
      });
      card.classList.add('active');
      const d = card.querySelector('.route-directions');
      if (d) d.style.display = 'block';
      showOnMap(visibleRoutes[i]);
    });
  });

  // İlk rotayı otomatik göster
  const firstCard = els.routeResults.querySelector('.route-card');
  if (firstCard) {
    firstCard.classList.add('active');
    const fd = firstCard.querySelector('.route-directions');
    if (fd) fd.style.display = 'block';
  }
  if (visibleRoutes.length) showOnMap(visibleRoutes[0]);
}

function directCard(r, i) {
  const sn = r.startStation?.name || '?', en = r.endStation?.name || '?';
  
  // UX REVIZYONU: bekleme süresi 45 dk'dan fazlaysa "Canlı" yerine "Gelecek Sefer" diyelim
  const isFarFuture = r.liveWaitMinutes > 45;
  const isAlert = r.liveStatusAlert; // Kaçırma riski
  const statusColor = isAlert ? '#ef4444' : (isFarFuture ? '#94a3b8' : '#10b981'); // Kırmızı vs Gri vs Yeşil
  const statusIcon = isAlert ? '⚠️' : (isFarFuture ? '⏰' : '🟢');
  const statusLabel = isAlert ? (state.lang === 'tr' ? 'Yetişilemez' : 'Unreachable') : (isFarFuture ? (state.lang === 'tr' ? 'Gelecek Sefer' : 'Next Trip') : (state.lang === 'tr' ? 'Canlı' : 'Live'));

  const liveInfo = r.liveStatus ? `<div class="route-live-status" style="margin-bottom:12px; border-radius:6px; background: ${isAlert ? 'rgba(239, 68, 68, 0.08)' : (isFarFuture ? 'var(--bg-tertiary)' : 'rgba(16, 185, 129, 0.1)')}; border: 1px solid ${statusColor}44; border-left: 3px solid ${statusColor};">${statusIcon} <strong style="color:${statusColor}">${statusLabel}:</strong> ${r.liveStatus}</div>` : '';
  
  const walkToStartMins = Math.round(r.startWalkDistance / 80);
  const walkBadge = `<div class="route-walk-badge" style="background:var(--bg-tertiary); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 0.82rem; border: 1px solid var(--border-subtle);">
    <span style="font-size:1.1rem">🚶</span>
    <span>${state.lang === 'tr' ? 'İlk durağa' : 'To first stop'}: <strong>${formatDistance(r.startWalkDistance)}</strong> (${walkToStartMins} ${state.lang === 'tr' ? 'dk yürüme' : 'min walk'})</span>
  </div>`;

  return `<div class="route-card" data-index="${i}">
    <div class="route-card-header">
      <span class="route-type-badge direct">&#x2713; ${translations[state.lang].direct}</span>
      <div class="route-line-numbers"><span class="line-badge">${r.routeCode}</span></div>
    </div>
    ${walkBadge}
    ${liveInfo}
    <div class="route-card-body">
      <div class="route-detail"><span class="route-detail-icon">⏱️</span><span>${state.lang === 'tr' ? 'Tahmini Toplam' : 'Total Est.'}: <strong>${formatDuration(r.totalMinutes)}</strong></span></div>
      <div class="route-detail"><span class="route-detail-icon">📛</span><span>${displayName(r.routeName, r.routeCode)}</span></div>
      <div class="route-detail"><span class="route-detail-icon">🚏</span><span><strong>${r.stopCount || '?'}</strong> ${translations[state.lang].stops} (${formatDuration(r.transitMinutes)} ${state.lang === 'tr' ? 'yolculuk' : 'trip'})</span></div>
      <div class="route-detail"><span class="route-detail-icon">🚶</span><span>${translations[state.lang].walk}: <strong>${formatDistance(r.startWalkDistance)}</strong> + <strong>${formatDistance(r.endWalkDistance)}</strong> (${formatDuration(r.walkMinutes)})</span></div>
      <div class="route-stops-summary">
        <span class="stop-label" title="${sn}">${sn}</span>
        <span class="stop-dot start"></span>
        <span class="stop-line"><span class="stop-line-fill"></span></span>
        <span class="stop-dot end"></span>
        <span class="stop-label" title="${en}">${en}</span>
      </div>
      <div class="route-directions" style="display:none; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-default); font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6;">
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🚶‍♂️</span><span>${state.lang === 'tr' ? 'Başlangıçtan' : 'From origin to'} <strong>${sn}</strong> ${state.lang === 'tr' ? 'durağına yürü' : 'stop walk'} (${formatDistance(r.startWalkDistance)}).</span></div>
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🚌</span><span><strong>${displayCode(r.routeCode)}</strong> ${state.lang === 'tr' ? 'numaralı otobüse bin.' : 'take bus number.'}</span></div>
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🚏</span><span>${r.intermediateStops ? Math.max(r.intermediateStops.length-2, 0) : '?'} ${state.lang === 'tr' ? 'durak yolculuk yap.' : 'stops trip.'}</span></div>
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🔴</span><span><strong>${en}</strong> ${state.lang === 'tr' ? 'durağında in.' : 'get off at stop.'}</span></div>
        <div style="display:flex; gap:8px;"><span>🚶‍♂️</span><span>${state.lang === 'tr' ? 'Varış noktasına yürü' : 'Walk to destination'} (${formatDistance(r.endWalkDistance)}).</span></div>
      </div>
      
      <div style="margin-top:10px; text-align:center; opacity:0.8; font-size:0.75rem;">
        <i>${translations[state.lang].disclaimer}</i>
      </div>
      <button class="btn-timetable" data-route="${r.routeCode}">📅 ${displayCode(r.routeCode)} ${translations[state.lang].timetable}</button>
    </div>
  </div>`;
}

function transferCard(r, i) {
  const l1 = r.legs?.[0], l2 = r.legs?.[1];
  const sn = r.startStation?.name || '?', en = r.endStation?.name || '?';
  const tn = r.transferStation?.name || 'Aktarma';
  
  // 1. Aşama bekleme süresi kontrolü
  const isFarFuture = r.liveWaitMinutes > 45;
  const isAlert = r.liveStatusAlert;
  const statusColor = isAlert ? '#ef4444' : (isFarFuture ? '#94a3b8' : '#10b981');
  const statusIcon = isAlert ? '⚠️' : (isFarFuture ? '⏰' : '🟢');
  const statusLabel = isAlert ? (state.lang === 'tr' ? 'Yetişilemez' : 'Unreachable') : (isFarFuture ? (state.lang === 'tr' ? 'Gelecek Sefer' : 'Next Trip') : (state.lang === 'tr' ? 'Canlı' : 'Live'));

  const liveInfo = r.liveStatus ? `<div class="route-live-status" style="margin-bottom:6px; border-radius:6px; background: ${isAlert ? 'rgba(239, 68, 68, 0.08)' : (isFarFuture ? 'var(--bg-tertiary)' : 'rgba(16, 185, 129, 0.1)')}; border: 1px solid ${statusColor}44; border-left: 3px solid ${statusColor};">${statusIcon} <strong>${displayCode(l1?.routeCode)}:</strong> ${r.liveStatus}</div>` : `<div class="route-live-status" style="margin-bottom:6px; font-size:0.75rem; opacity:0.6;">⚪ ${displayCode(l1?.routeCode)} için canlı veri yok (sefer saatine bakınız).</div>`;
  const liveInfo2 = r.liveStatusLeg2 ? `<div class="route-live-status" style="margin-bottom:12px; border-radius:6px; background: rgba(245, 158, 11, 0.08); color: var(--text-primary); border: 1px solid rgba(245, 158, 11, 0.4); border-left: 3px solid #f59e0b;">⏳ <strong>${displayCode(l2?.routeCode)}:</strong> ${r.liveStatusLeg2}</div>` : '';

  const walkToStartMins = Math.round(r.startWalkDistance / 80);
  const walkBadge = `<div class="route-walk-badge" style="background:var(--bg-tertiary); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 0.82rem; border: 1px solid var(--border-subtle);">
    <span style="font-size:1.1rem">🚶</span>
    <span>${state.lang === 'tr' ? 'İlk durağa' : 'To first stop'}: <strong>${formatDistance(r.startWalkDistance)}</strong> (${walkToStartMins} ${state.lang === 'tr' ? 'dk yürüme' : 'min walk'})</span>
  </div>`;

  return `<div class="route-card" data-index="${i}">
    <div class="route-card-header">
      <span class="route-type-badge transfer">&#x21C4; ${state.lang === 'tr' ? 'Aktarmalı' : 'Transfer'}</span>
      <div class="route-line-numbers">
        <span class="line-badge">${displayCode(l1?.routeCode)}</span>
        <span class="transfer-arrow">&#x2192;</span>
        <span class="line-badge">${displayCode(l2?.routeCode)}</span>
      </div>
    </div>
    ${walkBadge}
    ${liveInfo}
    ${liveInfo2}
    <div class="route-card-body">
      <div class="route-detail"><span class="route-detail-icon">⏱️</span><span>${state.lang === 'tr' ? 'Tahmini Toplam' : 'Total Est.'}: <strong>${formatDuration(r.totalMinutes)}</strong></span></div>
      <div class="route-detail"><span class="route-detail-icon">1&#xFE0F;&#x20E3;</span><span>${displayName(l1?.routeName, l1?.routeCode)}</span></div>
      <div class="route-detail"><span class="route-detail-icon">2&#xFE0F;&#x20E3;</span><span>${displayName(l2?.routeName, l2?.routeCode)}</span></div>
      
      <div class="route-detail" style="align-items:flex-start;">
        <span class="route-detail-icon">🔄</span>
        <div>
          <span>${state.lang === 'tr' ? 'Aktarma' : 'Transfer'}: <strong>${tn}</strong></span>
          ${r.transferStation.isNearby ? `
            <div style="font-size:0.75rem; color:var(--color-warning); margin-top:2px;">
              🚶 ${formatDistance(r.transferStation.nearbyTarget.dist)} ${state.lang === 'tr' ? 'yürü' : 'walk'} -> <strong>${r.transferStation.nearbyTarget.name}</strong>
            </div>
          ` : ''}
        </div>
      </div>
      
      <div class="route-detail"><span class="route-detail-icon">🚶</span><span>${state.lang === 'tr' ? 'Yürüme' : 'Walking'}: <strong>${formatDistance(r.totalWalkDistance)}</strong> (${formatDuration(r.walkMinutes)})</span></div>
      <div class="route-stops-summary">
        <span class="stop-label" title="${sn}">${sn}</span>
        <span class="stop-dot start"></span>
        <span class="stop-line"><span class="stop-line-fill" style="width:50%"></span></span>
        <span class="stop-dot transfer"></span>
        <span class="stop-line"><span class="stop-line-fill" style="width:50%"></span></span>
        <span class="stop-dot end"></span>
        <span class="stop-label" title="${en}">${en}</span>
      </div>
      <div class="route-directions" style="display:none; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-default); font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6;">
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🚶‍♂️</span><span>Başlangıçtan <strong>${sn}</strong> durağına yürü (${formatDistance(r.startWalkDistance)}).</span></div>
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🚌</span><span><strong>${displayCode(l1?.routeCode)}</strong> numaralı otobüse bin.</span></div>
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🔄</span><span><strong>${tn}</strong> durağında in ve <strong>${displayCode(l2?.routeCode)}</strong> otobüsüne aktarma yap.</span></div>
        <div style="display:flex; gap:8px; margin-bottom:6px;"><span>🔴</span><span><strong>${en}</strong> durağında in.</span></div>
        <div style="display:flex; gap:8px;"><span>🚶‍♂️</span><span>Varış noktasına yürü (${formatDistance(r.endWalkDistance)}).</span></div>
      </div>
      
      <div style="margin-top:10px; text-align:center; opacity:0.8; font-size:0.75rem;">
        <i>Uzun süreli tahminlerde lütfen güncel sefer saatlerini teyit ediniz.</i>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-timetable" data-route="${l1?.routeCode}">📅 ${displayCode(l1?.routeCode)} Tablosu</button>
        <button class="btn-timetable" data-route="${l2?.routeCode}">📅 ${displayCode(l2?.routeCode)} Tablosu</button>
      </div>
    </div>
  </div>`;
}

// Modal Fonksiyonları
async function showTimetableModal(routeCode) {
  if (!routeCode || routeCode === '?') return showStatus('Bu hat için saat verisi yok.', 3000);
  els.modalTimetable.style.opacity = '1';
  els.modalTimetable.style.pointerEvents = 'auto';
  
  $('#modal-timetable-title').innerText = `📅 ${routeCode} Resmi Saatleri`;
  els.modalTimetableImg.style.display = 'none';
  els.modalTimetableError.classList.add('hidden');
  els.modalTimetableLoader.style.display = 'block';

  const imageUrl = await getTimetableImage(routeCode);
  els.modalTimetableLoader.style.display = 'none';
  
  if (imageUrl) {
    els.modalTimetableImg.src = imageUrl;
    els.modalTimetableImg.style.display = 'block';
  } else {
    els.modalTimetableError.classList.remove('hidden');
  }
}

// ===========================
// HARİTADA ROTA GÖSTERİMİ
// ===========================
async function showOnMap(route) {
  clearMapRoute();

  if (route.type === 'direct' && route.intermediateStops?.length > 1) {
    showStatus('Gerçek yol güzergahı hesaplanıyor...', 1500);

    // OSRM API ile kuş uçuşunu gerçek yola dönüştür - bu işlem bekletirken (async)
    // harita zaten clearMapRoute() ile temizlendi.
    let latlngs = await fetchOSRMRoute(route.intermediateStops);
    
    // FETCH sonrası hala bu rotada mıyız diye bir ID kontrolü yapabilirdik 
    // ama clearLayers() işlemini eklemeden HEMEN ÖNCE tekrar yapıyoruz; en garantisi.
    if (!latlngs) {
      latlngs = route.intermediateStops.map(s => [s.lat, s.lng]);
    }
    
    // Çizimden hemen önce bir kez daha temizle (async bekleme sırasında başkası gelmiş olabilir)
    state.layers.routeLayer.clearLayers();
    
    const line = L.polyline(latlngs, { color: '#38bdf8', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(state.layers.routeLayer);

    route.intermediateStops.forEach((s, idx) => {
      const isEndpoint = idx === 0 || idx === route.intermediateStops.length - 1;
      const label = idx === 0 ? '🟢 Biniş: ' : (idx === route.intermediateStops.length - 1 ? '🔴 İniş: ' : '');
      const m = L.circleMarker([s.lat, s.lng], { 
        radius: isEndpoint ? 7 : 4, 
        color: '#ffffff', 
        fillColor: '#f59e0b', 
        fillOpacity: 1, 
        weight: 2 
      }).addTo(state.layers.routeLayer).bindPopup(`<div class="popup-title">${label}${s.name}</div><div class="popup-routes">Hat: ${route.routeCode}</div>`);
    });

    state.map.fitBounds(state.layers.routeLayer.getBounds(), { padding: [60, 60] });
  } else if (route.type === 'transfer') {
    showStatus('Gerçek yol güzergahı hesaplanıyor...', 1500);
    const s = route.startStation, e = route.endStation, t = route.transferStation;
    
    let leg1 = await fetchOSRMRoute([s, t]);
    if (!leg1) leg1 = [[s.lat, s.lng], [t.lat, t.lng]];
    
    let leg2 = await fetchOSRMRoute([t, e]);
    if (!leg2) leg2 = [[t.lat, t.lng], [e.lat, e.lng]];
    
    state.layers.routeLayer.clearLayers();
    
    const line1 = L.polyline(leg1, { color: '#f59e0b', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(state.layers.routeLayer);
    const line2 = L.polyline(leg2, { color: '#38bdf8', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round', dashArray: '10, 8' }).addTo(state.layers.routeLayer);
    
    const renderStop = (stop, typeLabel, radius = 7) => {
      L.circleMarker([stop.lat, stop.lng], { radius, color: '#ffffff', fillColor: '#f59e0b', fillOpacity: 1, weight: 2 })
        .addTo(state.layers.routeLayer).bindPopup(`<div class="popup-title">${typeLabel} ${stop.name}</div>`);
    };
    
    renderStop(s, '🟢 Biniş:');
    renderStop(t, '🔄 Aktarma:', 8);
    renderStop(e, '🔴 İniş:');
    state.map.fitBounds(state.layers.routeLayer.getBounds(), { padding: [60, 60] });
  } else {
    const s = route.startStation, e = route.endStation;
    if (s && e) {
      state.layers.routeLayer.clearLayers();
      const line = L.polyline([[s.lat, s.lng], [e.lat, e.lng]], { color: '#38bdf8', weight: 4, opacity: .8, dashArray: '10, 8' }).addTo(state.layers.routeLayer);
      const renderStop = (stop, typeLabel) => {
        L.circleMarker([stop.lat, stop.lng], { radius: 7, color: '#ffffff', fillColor: '#f59e0b', fillOpacity: 1, weight: 2 })
          .addTo(state.layers.routeLayer).bindPopup(`<div class="popup-title">${typeLabel} ${stop.name}</div>`);
      };
      renderStop(s, '🟢 Biniş:');
      renderStop(e, '🔴 İniş:');
      state.map.fitBounds(state.layers.routeLayer.getBounds(), { padding: [80, 80] });
    }
  }
}

function clearMapRoute() {
  if (state.layers.routeLayer) {
    state.layers.routeLayer.clearLayers();
  }
}

function clearRouteDisplay() {
  els.routeResults.classList.add('hidden');
  els.routeResults.innerHTML = '';
  clearMapRoute();
}

// ===========================
// SWAP
// ===========================
function handleSwap() {
  [state.startPoint, state.endPoint] = [state.endPoint, state.startPoint];
  [els.inputStart.value, els.inputEnd.value] = [els.inputEnd.value, els.inputStart.value];
  if (state.startPoint) placeMarker('start', state.startPoint.lat, state.startPoint.lng, state.startPoint.stationName || 'Başlangıç');
  if (state.endPoint) placeMarker('end', state.endPoint.lat, state.endPoint.lng, state.endPoint.stationName || 'Varış');
  updateBtn();
}

// ===========================
// KONUM
// ===========================
function getLocation(target) {
  if (!navigator.geolocation) { showStatus('Tarayıcınız konum özelliğini desteklemiyor.', 3000); return; }
  showStatus('Konumunuz alınıyor...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      if (target === 'start') {
        state.startPoint = { lat, lng }; els.inputStart.value = '📍 Konumum';
        placeMarker('start', lat, lng, 'Konumunuz'); state.map.flyTo([lat, lng], 15);
      } else if (target === 'end') {
        state.endPoint = { lat, lng }; els.inputEnd.value = '📍 Konumum';
        placeMarker('end', lat, lng, 'Konumunuz'); state.map.flyTo([lat, lng], 15);
      } else if (target === 'nearby') {
        loadNearby(lat, lng); 
        placeMarker('user', lat, lng, '📍 Şu anki konumunuz');
        state.map.flyTo([lat, lng], 15);
      }
      updateBtn(); showStatus('Konum alındı!', 2000);
    },
    err => {
      const msgs = { 1: 'Konum izni reddedildi.', 2: 'Konum bilgisi mevcut değil.', 3: 'Konum alma zaman aşımına uğradı.' };
      showStatus(msgs[err.code] || 'Konum alınamadı.', 4000);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// ===========================
// YAKIN DURAKLAR
// ===========================
function toggleNearby() {
  state.nearbyVisible = !state.nearbyVisible;
  if (state.nearbyVisible) { els.nearbyPanel.classList.remove('hidden'); getLocation('nearby'); }
  else { els.nearbyPanel.classList.add('hidden'); }
}

async function loadNearby(lat, lng) {
  state.userLat = lat;
  state.userLng = lng;
  const stops = findNearestStations(lat, lng, state.allStations, 8);
  if (!stops.length) {
    els.nearbyList.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><p>Yakınlarda durak bulunamadı.</p></div>';
    return;
  }

  els.nearbyList.innerHTML = stops.map(s => {
    const dc = s.distance <= 200 ? 'distance-close' : s.distance <= 500 ? 'distance-medium' : 'distance-far';
    return `<div class="nearby-stop-card" data-id="${s.stationId}" data-name="${s.stationName}" data-lat="${s.lat}" data-lng="${s.lng}">
      <span class="nearby-stop-number">${s.stationId}</span>
      <div class="nearby-stop-info">
        <div class="nearby-stop-name">${s.stationName}</div>
        <div class="nearby-lines" id="lines-${s.stationId}"></div>
      </div>
      <div class="nearby-stop-actions">
        <span class="nearby-stop-distance ${dc}">${formatDistance(s.distance)}</span>
        <button class="btn-stop-info" data-station="${s.stationId}" title="Geçen hatları göster">ℹ️</button>
      </div>
    </div>`;
  }).join('');

  // ℹ️ butonuna tıklayınca o durağın hatlarını API'den çek
  els.nearbyList.querySelectorAll('.btn-stop-info').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = btn.dataset.station;
      const container = document.getElementById(`lines-${sid}`);
      if (!container) return;

      // Zaten yüklendiyse kapat/aç toggle
      if (container.dataset.loaded === 'true') {
        container.classList.toggle('hidden');
        return;
      }

      container.innerHTML = '<span class="nearby-badge" style="opacity:0.6">Yükleniyor...</span>';
      try {
        const buses = await getBusDataForStation(sid);
        // Benzersiz hat numaralarını çek + yön bilgisiyle
        const uniqueLines = new Map();
        buses.forEach(b => {
          if (b.hatno && !uniqueLines.has(b.hatno)) {
            uniqueLines.set(b.hatno, b.hatadi || b.hatno);
          }
        });

        if (uniqueLines.size > 0) {
          container.innerHTML = Array.from(uniqueLines.entries())
            .map(([no, name]) => `<span class="bus-badge nearby-badge" title="${name}">${no}</span>`)
            .join('');
        } else {
          container.innerHTML = '<span class="nearby-badge" style="opacity:0.5; font-size:0.65rem">Şu an sefer yok</span>';
        }
        container.dataset.loaded = 'true';
      } catch {
        container.innerHTML = '<span class="nearby-badge" style="opacity:0.5">Veri alınamadı</span>';
      }
    });
  });

  // Durak tıklaması → başlangıç/bitiş olarak seç
  els.nearbyList.querySelectorAll('.nearby-stop-card').forEach(card => {
    card.addEventListener('click', () => {
      const p = { lat: parseFloat(card.dataset.lat), lng: parseFloat(card.dataset.lng), stationId: card.dataset.id, stationName: card.dataset.name };
      if (!state.startPoint) {
        state.startPoint = p; els.inputStart.value = p.stationName; placeMarker('start', p.lat, p.lng, p.stationName);
        showStatus('Başlangıç: ' + p.stationName, 2000);
      } else if (!state.endPoint) {
        state.endPoint = p; els.inputEnd.value = p.stationName; placeMarker('end', p.lat, p.lng, p.stationName);
        showStatus('Varış: ' + p.stationName, 2000);
      } else {
        state.startPoint = p; els.inputStart.value = p.stationName; placeMarker('start', p.lat, p.lng, p.stationName);
        showStatus('Başlangıç güncellendi: ' + p.stationName, 2000);
      }
      updateBtn();
    });
  });

  // Haritada göster
  state.markers.stops.forEach(m => state.map.removeLayer(m));
  state.markers.stops = [];
  stops.forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: createIcon('default') })
      .addTo(state.map).bindPopup(`<div class="popup-title">${s.stationName}</div><div class="popup-routes">Durak No: ${s.stationId}</div>`);
    state.markers.stops.push(m);
  });
}

// ===========================
// TEMA
// ===========================
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = state.theme;
  localStorage.setItem('denizlibus-theme', state.theme);
  updateMapTiles();
}

// ===========================
// YARDIMCILAR
// ===========================

function showStatus(text, duration = 0) {
  els.statusText.textContent = text;
  els.statusBar.classList.remove('hidden');
  if (duration > 0) setTimeout(() => els.statusBar.classList.add('hidden'), duration);
}

// ===========================
// BAŞLAT
// ===========================
// Favicon
const fav = document.querySelector("link[rel='icon']");
if (fav) fav.href = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚌</text></svg>";

document.addEventListener('DOMContentLoaded', init);
window.__denizlibus = state;
window.__denizlibus.utils = { handleSaveLocation };
