// sw.js — Service Worker Apotek Rafa Medica
// Strategi: Cache First untuk aset lokal, Network First untuk Firebase API

const CACHE_NAME = 'rafa-medica-v1';

// File-file yang di-cache saat install (App Shell)
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './cha-ching.mp3',
];

// Domain eksternal yang di-cache saat diakses (runtime cache)
const CACHE_DOMAINS = [
    'cdn.tailwindcss.com',
    'unpkg.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
];

// Domain yang TIDAK boleh di-cache (selalu network — Firebase data)
const NETWORK_ONLY_DOMAINS = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebasedatabase.app',
];

// =============================================
// INSTALL — cache App Shell
// =============================================
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching App Shell');
            // Cache satu per satu agar error satu file tidak gagalkan semua
            return Promise.allSettled(
                APP_SHELL.map(url => cache.add(url).catch(e => console.warn('[SW] Failed to cache:', url, e)))
            );
        }).then(() => self.skipWaiting())
    );
});

// =============================================
// ACTIVATE — bersihkan cache lama
// =============================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// =============================================
// FETCH — strategi per jenis request
// =============================================
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Firebase & auth API → Network Only (jangan di-cache)
    if (NETWORK_ONLY_DOMAINS.some(d => url.hostname.includes(d))) {
        return; // biarkan browser handle normal
    }

    // 2. Aset CDN eksternal → Stale While Revalidate
    //    (serve dari cache dulu, update di background)
    if (CACHE_DOMAINS.some(d => url.hostname.includes(d))) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }

    // 3. File lokal (.html, .js, .css, .mp3, manifest.json) → Cache First
    if (url.origin === self.location.origin || event.request.mode === 'navigate') {
        event.respondWith(cacheFirst(event.request));
        return;
    }
});

// =============================================
// STRATEGI: Cache First
// Serve dari cache. Jika tidak ada, ambil dari network & simpan ke cache.
// =============================================
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        // Offline & tidak ada cache → kembalikan halaman utama (fallback)
        const fallback = await caches.match('./index.html');
        return fallback || new Response('Aplikasi sedang offline. Silakan buka kembali setelah ada koneksi internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

// =============================================
// STRATEGI: Stale While Revalidate
// Serve dari cache (cepat), sambil update cache di background.
// =============================================
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const networkFetch = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(() => null);

    return cached || await networkFetch;
}

// =============================================
// BACKGROUND SYNC — kirim ulang data yang tertunda saat online
// (Firebase IndexedDB Persistence sudah handle ini secara otomatis,
//  bagian ini sebagai notifikasi tambahan)
// =============================================
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-pending') {
        console.log('[SW] Background sync triggered');
    }
});

// =============================================
// MESSAGE — handle perintah dari app (misal: force update cache)
// =============================================
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME).then(() => {
            event.ports[0].postMessage({ success: true });
        });
    }
});
