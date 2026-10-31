'use strict';

const VERSION = '1.25.0'; // mudar este número faz o navegador atualizar o service worker

/* =========================================================
   Service worker mínimo do Canais
   =========================================================
   Existe só para o Chrome do Android aceitar instalar o site
   como app (que abre em tela cheia). NÃO guarda nada em cache:
   a página é sempre conferida no servidor (cache: 'no-cache'),
   então uma versão nova aparece no próximo carregamento.
   Sem internet, mostra um aviso em vez da tela de erro.
   ========================================================= */
const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Canais</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 24px;
           background: #F5F5F7; color: #1D1D1F; font: 16px/1.45 -apple-system, "Inter", system-ui, sans-serif; text-align: center; }
    .ic { width: 64px; height: 64px; margin-bottom: 8px; border-radius: 16px; background: linear-gradient(145deg, #9C9DE6, #6667AB 48%, #0F4C81);
          box-shadow: 0 10px 24px rgba(15, 76, 129, .3); }
    strong { font-size: 22px; letter-spacing: -.02em; }
    span { color: #6E6E73; max-width: 320px; }
    button { margin-top: 10px; padding: 12px 24px; border: 0; border-radius: 999px; background: #6667AB; color: #fff; font: inherit; font-weight: 600; }
    @media (prefers-color-scheme: dark) { body { background: #000; color: #F5F5F7; } span { color: #A1A1A6; } button { background: #9A9BE0; color: #000; } }
  </style>
</head>
<body>
  <div class="ic"></div>
  <strong>Sem conexão</strong>
  <span>O Canais precisa de internet para carregar os vídeos.</span>
  <button onclick="location.reload()">Tentar de novo</button>
</body>
</html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return; // o resto vai direto para a rede, sem passar por aqui
  event.respondWith(
    fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      // Navegações não aceitam resposta "já redirecionada": devolve o redirecionamento ao navegador.
      .then(res => (res.redirected ? Response.redirect(res.url, 302) : res))
      .catch(() => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
  );
});
