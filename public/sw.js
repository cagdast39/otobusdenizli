const CACHE_NAME = 'denizlibus-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/css/index.css',
  '/bus-icon.svg',
  '/public/og-image.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// Service Worker Kurulumu (Install)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Assetler cache\'leniyor...');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Cache Temizleme (Activate)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// İstek Yakalama (Fetch) - Cache First Strategy
self.addEventListener('fetch', (event) => {
  // Sadece GET isteklerini cache'le (API istekleri hariç olsun ki canlı kalsın)
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((response) => {
        // Geçerli bir cevap ise cache'e ekle (static assetler için)
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    }).catch(() => {
      // Çevrimdışı hatası - index.html dönebiliriz (SPA mantığı)
      if (event.request.mode === 'navigate') {
        return caches.match('/');
      }
    })
  );
});
