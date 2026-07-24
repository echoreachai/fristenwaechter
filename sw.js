const CACHE_NAME = "fristen-waechter-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Netzwerk-zuerst für die eigenen App-Dateien: Solange Internet da ist,
// wird immer die aktuelle, gerade hochgeladene Version geladen (und der
// Cache dabei nebenbei aktualisiert). Nur wenn das Netzwerk nicht
// erreichbar ist, springt der zuletzt gecachte Stand als Offline-Fallback
// ein. So bleiben Updates sichtbar, ohne dass die Cache-Version jedes Mal
// von Hand hochgezählt werden muss.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Best-effort: periodische Hintergrund-Prüfung, falls der Browser
// die Periodic Background Sync API unterstützt (aktuell nur Chrome/Android,
// und nur wenn die App installiert + regelmäßig genutzt wird).
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "fristen-check") {
    event.waitUntil(checkDeadlinesAndNotify());
  }
});

// Fallback: einmaliger Hintergrund-Sync, wenn die App das anfordert.
self.addEventListener("sync", (event) => {
  if (event.tag === "fristen-check-once") {
    event.waitUntil(checkDeadlinesAndNotify());
  }
});

async function checkDeadlinesAndNotify() {
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  if (clientsList.length > 0) {
    // App ist offen — die App selbst kümmert sich ums Prüfen/Anzeigen.
    return;
  }
  // Kein offenes Fenster: Service Worker hat keinen Zugriff auf localStorage,
  // daher nur ein allgemeiner Hinweis, falls die API tatsächlich feuert.
  await self.registration.showNotification("Fristen-Wächter", {
    body: "Öffne die App, um zu prüfen, ob eine Frist bald abläuft.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "fristen-reminder",
  });
}
