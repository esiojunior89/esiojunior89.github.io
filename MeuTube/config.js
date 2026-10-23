'use strict';

/* =========================================================
   MeuTube — credenciais padrão
   =========================================================
   Usadas pelo app (index.html) e pela página protegida de
   credenciais (credenciais.html). O que for salvo na página
   de credenciais tem prioridade sobre estes valores.
   ========================================================= */
const DEFAULT_CONFIG = {
  apiKey: '', // Chave da YouTube Data API v3
  clientId: '797093121512-2rg9lgs89th97ei5cvfg111rmnu77bo0.apps.googleusercontent.com', // OAuth 2.0 Client ID (tipo "Aplicativo da Web")
  loginServer: 'https://meutube-login.esiosalazar.workers.dev', // Servidor de login (Cloudflare Worker, arquivo worker.js)
};
