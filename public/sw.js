const CACHE_NAME = "vc-financas-v21-no-api-cache";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
];

const RUNTIME_ASSETS = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await Promise.all(
        RUNTIME_ASSETS.map((url) =>
          fetch(url, { mode: "no-cors" })
            .then((response) => cache.put(url, response))
            .catch(() => undefined),
        ),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Dados financeiros e sessões precisam vir sempre da rede. Guardar respostas
  // do Supabase no Cache Storage faz a interface exibir um estado anterior.
  if (url.hostname.endsWith(".supabase.co")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Recursos externos não fazem parte do app shell e não devem mascarar
  // atualizações de APIs ou serviços de terceiros.
  return;
});
