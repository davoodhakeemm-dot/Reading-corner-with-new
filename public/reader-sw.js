self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.mode !== "navigate" ||
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }
  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(
          `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline — Reading Corner</title><style>body{min-height:90vh;display:grid;place-items:center;background:#faf8ff;color:#2b193e;font:1rem/1.6 system-ui;margin:1rem}main{max-width:28rem}small{color:#6531bc;font-weight:700}button{background:#6531bc;color:white;border:0;padding:.8rem 1.4rem;border-radius:2rem;font:inherit}</style><main><small>READING CORNER</small><h1>You’re offline</h1><p>Reconnect to the internet to open your library and keep reading.</p><button onclick="location.reload()">Try again</button></main></html>`,
          {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          },
        ),
    ),
  );
});

function buildChatTargetUrl(data) {
  const peerId = data && typeof data.peerId === "string" ? data.peerId.trim() : "";
  if (peerId) {
    return `/messages?peer=${encodeURIComponent(peerId)}`;
  }
  const rawPath = data && typeof data.path === "string" ? data.path.trim() : "";
  if (rawPath.startsWith("/messages")) {
    return rawPath;
  }
  return "/messages";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.senderName || "New message";
  const body = notification.body || data.preview || "Open chat to view message";
  const peerId = typeof data.peerId === "string" ? data.peerId.trim() : "";
  const messageId = typeof data.messageId === "string" ? data.messageId.trim() : "";
  const targetUrl = buildChatTargetUrl(data);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: messageId ? `rc-msg-${messageId}` : peerId ? `rc-peer-${peerId}` : "rc-message",
      renotify: true,
      data: {
        peerId,
        targetUrl,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = buildChatTargetUrl(notifData);
  const peerId = typeof notifData.peerId === "string" ? notifData.peerId.trim() : "";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin && "focus" in client) {
            if ("postMessage" in client) {
              client.postMessage({
                type: "OPEN_CHAT_THREAD",
                peerId,
                targetUrl,
              });
            }
            return client.focus();
          }
        } catch {
          /* ignore */
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
