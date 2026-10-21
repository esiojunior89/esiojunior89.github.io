'use strict';

const VERSION = '1.3.1'; // mudar este número faz o navegador atualizar o service worker

/* =========================================================
   Service worker mínimo do MeuTube
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
    fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      // Navegações não aceitam resposta "já redirecionada": devolve o redirecionamento ao navegador.
      .then(res => (res.redirected ? Response.redirect(res.url, 302) : res))
      .catch(() => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
  );
});
