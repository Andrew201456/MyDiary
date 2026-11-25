const CACHE="mydiary-shell-v8";
const SHELL=["/","/index.html","/app.css","/app.js","/cloud.js","/remember.js","/food.js","/fpc-import.js","/manifest.webmanifest","/icon.svg","/icon-192.png","/icon-512.png"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("mydiary-shell-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const req=event.request;
  // Never cache authenticated responses or private vault blobs.
  if(req.method!=="GET"||new URL(req.url).origin!==location.origin||
     new URL(req.url).pathname.startsWith("/api/"))return;
  event.respondWith(fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;}).catch(()=>caches.match(req).then(r=>r||caches.match("/index.html"))));
});