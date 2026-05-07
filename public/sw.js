// Service Worker — cache-first strategy for static GIBS tiles and textures.
// These assets never change (Blue Marble 2004, Black Marble 2016), so we cache
// indefinitely and serve from cache on every subsequent request.

// v2 — dropped Earth_Normal_2K.jpg (dead asset, no longer shipped).
// v3 — honor user-driven cache bypass (Ctrl+Shift+R) in the fetch handler;
//      reject 206 Partial Content from cache writes so a truncated cloud
//      texture can't poison the cache and persist across normal reloads.
//      Bumping the name evicts any caches already holding bad bytes.
const CACHE_NAME = 'gibs-tiles-v3'

// External URLs to cache — scoped to specific paths, not entire hostnames
const CACHEABLE_EXTERNAL = [
  { hostname: 'gibs.earthdata.nasa.gov', pathPrefix: '/wmts/epsg3857/best/' },
  { hostname: 's3.dualstack.us-east-1.amazonaws.com', pathPrefix: '/metadata.sosexplorer.gov/' },
]

// Same-origin paths to cache (proxied tiles, skybox, specular map, etc.)
// These are static textures that rarely change. If they do, bump CACHE_NAME above.
const CACHEABLE_LOCAL_PATHS = [
  '/api/tile/',
  '/assets/skybox/',
  '/assets/Earth_Specular_2K.jpg',
]

function shouldCache(url) {
  const parsed = new URL(url)

  // Match external cacheable origins + path prefixes
  if (CACHEABLE_EXTERNAL.some(
    rule => parsed.hostname === rule.hostname && parsed.pathname.startsWith(rule.pathPrefix)
  )) {
    return true
  }

  // Match local asset paths
  if (parsed.origin === self.location.origin &&
      CACHEABLE_LOCAL_PATHS.some(p => parsed.pathname.startsWith(p))) {
    return true
  }

  return false
}

self.addEventListener('install', event => {
  // Activate immediately without waiting for existing clients to close
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE_NAME))
})

self.addEventListener('activate', event => {
  // Claim all open clients so the SW starts intercepting immediately
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up any old cache versions
      caches.keys().then(names =>
        Promise.all(
          names
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        )
      ),
    ])
  )
})

self.addEventListener('fetch', event => {
  const { request } = event

  // Only intercept GET requests for cacheable URLs
  if (request.method !== 'GET' || !shouldCache(request.url)) {
    return
  }

  event.respondWith(
    (async () => {
      let cache
      try {
        cache = await caches.open(CACHE_NAME)
      } catch {
        // Cache API unavailable — let the browser handle the request normally
        return fetch(request.clone())
      }

      // Honor user-driven cache bypass. Ctrl+Shift+R / Cmd+Shift+R
      // sets request.cache === 'reload'; a normal Reload may pass
      // 'no-cache'; some clients use 'no-store'. In all three cases
      // skip the cached entry and re-populate so the next visitor
      // benefits from the fresh fetch — that's the recovery path
      // when the cache holds a poisoned response (truncated cloud
      // texture, etc.).
      const bypass =
        request.cache === 'reload' ||
        request.cache === 'no-cache' ||
        request.cache === 'no-store'

      if (!bypass) {
        const cached = await cache.match(request)
        if (cached) {
          return cached
        }
      }

      // Not cached (or bypass requested) — fetch from network
      const response = await fetch(request.clone())

      // Cache only verified-complete 200 responses. Specifically reject
      // 206 Partial Content (range responses are truncated bodies that
      // would silently decode to a gray/white band on the globe) and
      // opaque cross-origin responses (status 0). 'no-store' opts out
      // of writing too. response.ok would also accept 201-299, but
      // those don't apply to static assets and aren't safe to cache.
      const writable =
        response.status === 200 &&
        request.cache !== 'no-store'

      if (writable) {
        try {
          await cache.put(request, response.clone())
        } catch {
          // Cache write failed (e.g. quota exceeded, or the body
          // stream errored mid-read because the connection dropped) —
          // still return the response we already have headers for.
        }
      }

      return response
    })()
  )
})
