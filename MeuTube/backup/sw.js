'use strict';

/* =========================================================
   Service worker mínimo do MeuTube
   =========================================================
   Existe só para o Chrome do Android aceitar instalar o site
   como app (que abre em tela cheia). NÃO guarda nada em cache:
   tudo continua vindo do servidor, sempre na versão mais nova.
   Sem internet, mostra um aviso em vez da tela de erro.
   ========================================================= */
const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeuTube</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 12px; padding: 24px;
           background: #0f0f12; color: #f2f2f5; font: 16px/1.5 system-ui, sans-serif; text-align: center; }
    button { justify-self: center; padding: 10px 20px; border: 0; border-radius: 999px;
             background: #ff3d3d; color: #fff; font: inherit; font-weight: 600; }
  </style>
</head>
<body>
  <strong>Sem conexão</strong>
  <span>O MeuTube precisa de internet para carregar os vídeos.</span>
  <button onclick="location.reload()">Tentar de novo</button>
</body>
</html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return; // o resto vai direto para a rede, sem passar por aqui
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })),
  );
});
