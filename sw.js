// ================================================
// SERVICE WORKER — Rafa Medica Kasir
// Versi: 1.0
// Fungsi: Cache app agar bisa dibuka tanpa internet
// ================================================

const CACHE_APP = 'rafa-app-v1';
const CACHE_CDN = 'rafa-cdn-v1';

// File utama yang di-cache
const APP_FILES = [
  '/',
  '/index.html',
  '/cha-ching.mp3'
];

// Domain CDN yang di-cache otomatis saat pertama kali diload
const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// ================================================
// INSTALL: Cache file utama aplikasi
// ================================================
self.addEventListener('install', event => {
  console.log('[SW] Install — caching app files');
  event.waitUntil(
    caches.open(CACHE_APP).then(cache => {
      return cache.addAll(APP_FILES).catch(err => {
        console.warn('[SW] Beberapa file tidak bisa di-cache saat install:', err);
      });
    })
  );
  self.skipWaiting();
});

// ================================================
// ACTIVATE: Hapus cache lama
// ================================================
self.addEventListener('activate', event => {
  console.log('[SW] Aktif');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_CDN)
          .map(k => {
            console.log('[SW] Hapus cache lama:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

// ================================================
// FETCH: Strategi cache
// ================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip: Firebase/Firestore (dihandle Firestore SDK sendiri)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('gstatic.com') && url.pathname.includes('firebase')
  ) {
    return; // Biarkan Firestore SDK yang urus offline-nya
  }

  // CDN: Cache First (ambil dari cache, kalau tidak ada baru fetch)
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CACHE_CDN).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) {
            return cached; // Langsung dari cache
          }
          return fetch(event.request)
            .then(response => {
              if (response && response.status === 200) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => cached || new Response('Offline', { status: 503 }));
        })
      )
    );
    return;
  }

  // Halaman utama & file lokal: Network First, fallback ke cache
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_APP).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Fallback ke root jika halaman tidak ditemukan
            return caches.match('/') || caches.match('/index.html');
          });
        })
    );
  }
});
