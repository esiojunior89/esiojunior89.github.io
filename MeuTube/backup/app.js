'use strict';

// Não funciona dentro de outro site (moldura/iframe): evita "clickjacking", em que um site
// esconde o Canais por baixo de um botão falso para capturar os seus cliques.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  throw new Error('O Canais não pode ser aberto dentro de outro site.');
}

/** Versão do app (SemVer: MAJOR.MINOR.PATCH). Mantenha igual à do index.html e do sw.js. */
const APP_VERSION = '1.25.0';

/* =========================================================
   Canais — só os vídeos dos canais que você escolher
   =========================================================
   As credenciais padrão (DEFAULT_CONFIG) ficam em config.js,
   carregado antes deste arquivo.
   ========================================================= */
const PAGE_SIZE = 20;
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'; // pasta oculta do app no Drive (sincronização)
const SCOPES = `openid email profile ${YT_SCOPE} ${DRIVE_SCOPE}`;
const YT_API = 'https://www.googleapis.com/youtube/v3/';
const KEYS = {
  unplayable: 'meutube.unplayable', // vídeos que o player recusou (dono não permite tocar fora do YouTube)
  playFails: 'meutube.playFails',   // vídeos que travaram no meio: { vídeo: { n: dias com falha, day } }
  liveKnown: 'meutube.liveKnown',   // vídeos que já se sabe que não estão (nem vão estar) ao vivo
  noLives: 'meutube.noLives',       // canais sem lista de lives (nunca fizeram live): { canal: quando conferiu }
  config: 'meutube.config',
  channels: 'meutube.channels',
  autoplay: 'meutube.autoplay',
  auth: 'meutube.auth',
  account: 'meutube.account',
  seen: 'meutube.seen',
  progress: 'meutube.progress',
  hideWatched: 'meutube.hideWatched',
  chstats: 'meutube.channelStats',
  sync: 'meutube.sync',
  sidebar: 'meutube.sidebarMini',
  player: 'meutube.player',
  theater: 'meutube.theater', // modo teatro ligado (só no computador; vale para este aparelho)
  authSession: 'meutube.authSession', // chave de renovação do login (criptografada pelo servidor de login)
  oauthState: 'meutube.oauthState',   // pedido de login em andamento (volta do Google)
  clientMigrated: 'meutube.clientMigrated',
  device: 'meutube.device',
  watchLog: 'meutube.watchLog',
  videoChannels: 'meutube.videoChannels',
  statsPeriod: 'meutube.statsPeriod',
  syncOff: 'meutube.syncOff', // sincronização desligada neste aparelho (interruptor dos Ajustes)
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Movimento ("apple experience") ----------
   As curvas e durações ficam no styles.css (bloco "Movimento"). Aqui só ficam as
   animações que dependem de medir a tela: um elemento que muda de lugar "viaja"
   da posição antiga até a nova (técnica FLIP), alturas que mudam crescem suaves e
   botões que trocam de estado dão um pequeno pulo. Tudo desligado com o "Reduzir
   movimento" do sistema; nada disso muda o que o app faz, só como se move. */
const motionOK = () => !reducedMotion.matches;
const easeSmooth = () => getComputedStyle(document.documentElement).getPropertyValue('--ease-smooth').trim() || 'cubic-bezier(.16, 1, .3, 1)';

/** Faz o elemento viajar do retângulo antigo (from) até onde ele está agora. */
function playFlip(el, from, { scale = false, duration = 560, delay = 0 } = {}) {
  if (!el || !from || !el.isConnected) return;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = scale ? from.width / to.width : 1;
  const sy = scale ? from.height / to.height : 1;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
  el.animate([
    { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], { duration, delay, easing: easeSmooth(), fill: 'backwards' });
}

/** Entrada com "foco": surge subindo um pouco e saindo do desfoque. */
function focusIn(el, { delay = 0, duration = 560 } = {}) {
  el.animate([
    { opacity: 0, transform: 'translateY(14px) scale(.97)', filter: 'blur(6px)' },
    { opacity: 1, transform: 'none', filter: 'none' },
  ], { duration, delay, easing: easeSmooth(), fill: 'backwards' });
}

/** Saída com "foco" (desfoca e some). Retorna quando termina. */
function focusOut(el, { delay = 0, duration = 220 } = {}) {
  return el.animate([
    { opacity: 1, transform: 'none', filter: 'none' },
    { opacity: 0, transform: 'translateY(6px) scale(.95)', filter: 'blur(6px)' },
  ], { duration, delay, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).finished.catch(() => {});
}

/** Muda algo que altera a altura do elemento (mutate) e anima a altura da antiga até a nova. */
function animateHeight(el, mutate, duration = 460) {
  const h0 = el.offsetHeight;
  mutate();
  if (!motionOK()) return;
  const h1 = el.offsetHeight;
  if (Math.abs(h1 - h0) < 2) return;
  el.animate([{ height: `${h0}px`, overflow: 'hidden' }, { height: `${h1}px`, overflow: 'hidden' }], { duration, easing: easeSmooth() });
}

/** Pequeno "pulo" num botão que acabou de mudar de estado. */
function pop(el) {
  if (!el || !motionOK()) return;
  el.classList.remove('pop');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('pop');
  el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true });
}

/* =========================================================
   Utilitários
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]);

// Foto que não carrega (ex.: canal sem foto) some. Feito aqui, e não com onerror="…" no HTML,
// porque a política de segurança da página bloqueia código escrito dentro do HTML.
document.addEventListener('error', e => {
  if (!(e.target instanceof HTMLImageElement)) return;
  // Capa em alta resolução que o vídeo não tem: volta para a normal.
  const fallback = e.target.dataset.fallback;
  if (fallback && e.target.src !== fallback) { e.target.src = fallback; return; }
  if (e.target.hasAttribute('data-hide-broken')) e.target.style.visibility = 'hidden';
}, true);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento indisponível */ }
  },
};

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const TIME_UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

function timeAgo(ts) {
  const diff = (ts - Date.now()) / 1000;
  for (const [unit, secs] of TIME_UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return 'agora mesmo';
}

function fmtViews(n) {
  if (n == null) return '';
  const v = Number(n);
  return `${compact.format(v)} ${v === 1 ? 'visualização' : 'visualizações'}`;
}

function isoSeconds(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  return ((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 60 + Number(m[4] || 0);
}

function fmtDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return '';
  const h = Number(m[1] || 0) * 24 + Number(m[2] || 0);
  const min = Number(m[3] || 0);
  const s = Number(m[4] || 0);
  if (!h && !min && !s) return '';
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

/** Escapa o texto, transforma marcações de tempo (1:23) em botões e preserva quebras de linha. */
function richText(text) {
  return esc(text)
    .replace(/\b(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)\b/g, (m, h, mi, s) =>
      `<button type="button" class="ts" data-t="${Number(h || 0) * 3600 + Number(mi) * 60 + Number(s)}">${m}</button>`)
    .replace(/\r?\n/g, '<br>');
}

function toast(message, type = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

const ICONS = {
  google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/></svg>',
  channels: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 6h-7.6l3.3-3.3-.7-.7L12 6 8 2l-.7.7L10.6 6H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zm-11 11V9l6 4z"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 10A6 6 0 1 0 12.6 14H17v4h4v-4h2v-4zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
};

/** Ícone de traço do conjunto do index.html (símbolos "#i-…", no estilo dos da Apple). */
const SF = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Ícone do app: três telas de vidro empilhadas (os canais) sobre o degradê Very Peri → Classic Blue,
    com brilho Peach Fuzz no canto; a tela da frente mostra um pôr do sol (é vídeo, sem botão de play). */
let appIconSeq = 0;
function appIconSVG(size = 30) {
  const id = `ai${++appIconSeq}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" aria-hidden="true">
    <defs>
      <linearGradient id="${id}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9C9DE6"/><stop offset=".48" stop-color="#6667AB"/><stop offset="1" stop-color="#0F4C81"/></linearGradient>
      <radialGradient id="${id}gl" cx=".82" cy=".14" r=".6"><stop offset="0" stop-color="#FFBE98" stop-opacity=".9"/><stop offset="1" stop-color="#FFBE98" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE3D1"/><stop offset="1" stop-color="#FFBE98"/></linearGradient>
      <radialGradient id="${id}sun" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#FFF4C7"/><stop offset="1" stop-color="#FF6F61"/></radialGradient>
      <linearGradient id="${id}h1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8C8DD6"/><stop offset="1" stop-color="#6667AB"/></linearGradient>
      <linearGradient id="${id}h2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0F4C81"/><stop offset="1" stop-color="#BB2649"/></linearGradient>
      <clipPath id="${id}c"><rect width="1024" height="1024" rx="230"/></clipPath>
      <clipPath id="${id}f"><rect x="188" y="408" width="648" height="400" rx="98"/></clipPath>
    </defs>
    <g clip-path="url(#${id}c)">
      <rect width="1024" height="1024" fill="url(#${id}bg)"/>
      <rect width="1024" height="1024" fill="url(#${id}gl)"/>
      <rect x="292" y="232" width="440" height="262" rx="70" fill="#fff" fill-opacity=".3"/>
      <rect x="242" y="314" width="540" height="322" rx="82" fill="#fff" fill-opacity=".48"/>
      <g clip-path="url(#${id}f)">
        <rect x="188" y="408" width="648" height="400" fill="url(#${id}sky)"/>
        <circle cx="610" cy="560" r="78" fill="url(#${id}sun)"/>
        <path d="M188 700 C300 610 400 640 480 676 C560 712 660 600 836 650 V808 H188Z" fill="url(#${id}h1)"/>
        <path d="M188 760 C320 700 470 740 560 752 C660 766 760 712 836 730 V808 H188Z" fill="url(#${id}h2)"/>
      </g>
      <rect x="188" y="408" width="648" height="400" rx="98" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="10"/>
    </g>
  </svg>`;
}

/* =========================================================
   Estado
   ========================================================= */
/** Configuração salva neste aparelho + os valores padrão do topo do arquivo. */
function loadConfig() {
  const saved = store.get(KEYS.config, {});
  // 1.11.2: o app passou a usar um novo ID do cliente OAuth (o que tem chave secreta, para o servidor de
  // login). O ID antigo salvo nos aparelhos é trocado uma única vez; um ID escolhido depois é respeitado.
  if (!store.get(KEYS.clientMigrated, false)) {
    if ('clientId' in saved && saved.clientId !== DEFAULT_CONFIG.clientId) {
      delete saved.clientId;
      store.set(KEYS.config, saved);
    }
    store.set(KEYS.clientMigrated, true);
  }
  return { ...DEFAULT_CONFIG, ...saved };
}

const state = {
  config: loadConfig(),
  channels: store.get(KEYS.channels, []), // [{ id, title, handle, thumb, uploads }]
  autoplay: store.get(KEYS.autoplay, true),
  sidebarMini: store.get(KEYS.sidebar, false),
  pageSidebar: false, // menu aberto no vídeo/estatísticas/configurações (sempre começa fechado, como no YouTube)
  hideWatched: store.get(KEYS.hideWatched, false), // esconde os vídeos assistidos até o fim
  filter: null,      // ID do canal selecionado no menu lateral (null = todos)
  sort: 'new',       // ordem na página do canal: 'new' (mais recentes) | 'old' (mais antigos)
  watchFeed: null,   // feed de onde saem os "vídeos seguintes"
  view: null,
  currentVideoId: null,
  currentVideo: null,
  homeScroll: 0,
};

const channelById = id => state.channels.find(c => c.id === id);
const allowedChannels = () => new Set(state.channels.map(c => c.id));
/** Canais que aparecem no Início e na lista de canais (os marcados "Só lives" ficam só em "Ao vivo"). */
const homeChannels = () => state.channels.filter(c => !c.livesOnly);

/* Limite de duração por canal (Ajustes › Canais › "Até hh:mm:ss"): vídeos mais longos
   que o limite não aparecem e não contam nas Estatísticas. O limite inclui o tempo exato. */
const channelMaxDur = id => channelById(id)?.maxDur || 0;

function withinDurationLimit(v) {
  const max = channelMaxDur(v.channelId);
  return !max || !v.durationSec || v.durationSec <= max;
}

/* Vídeos que não tocam fora do YouTube (o dono não permite, restrição de idade ou de país) não
   existem no app. A API avisa a maioria; os poucos que ela não avisa são descobertos quando o
   player recusa e ficam guardados aqui, para nunca mais aparecer. */
const unplayableSaved = new Set(store.get(KEYS.unplayable, [])); // os que saíram de vez
const unplayable = new Set(unplayableSaved);                      // + os que saíram só até recarregar a página
const USER_COUNTRY = (/-([A-Za-z]{2})\b/.exec(navigator.language || '')?.[1] || 'BR').toUpperCase();

/** O dono não deixa tocar fora do YouTube? (pelos dados da API; v = item bruto de videos.list) */
function embedBlocked(v) {
  if (v.status?.embeddable === false) return true;
  if (v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') return true; // pede login no YouTube
  const r = v.contentDetails?.regionRestriction;
  return Boolean(r?.blocked?.includes(USER_COUNTRY) || (r?.allowed && !r.allowed.includes(USER_COUNTRY)));
}

/** Vídeo que aparece no Início, na página do canal e em "A seguir": da aba "Vídeos" (não ao vivo
    nem agendado), dentro do limite de duração e que toca no app. */
function shownInApp(v) {
  return Boolean(v) && v.live === 'none' && withinDurationLimit(v) && !v.blocked;
}

function fmtHms(sec) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}

/** "hh:mm:ss" -> segundos; '' -> 0 (sem limite); formato inválido -> null. */
function parseHms(text) {
  const t = text.trim();
  if (!t) return 0;
  const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
const isHomeChannel = id => homeChannels().some(c => c.id === id);
/** Ordem alfabética em português: ignora maiúsculas/acentos e põe "Canal 2" antes de "Canal 10". */
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const byName = (a, b) => collator.compare(a, b);
const hasCredentials = () => Boolean(state.config.apiKey || Auth.ytToken());

/* =========================================================
   Cliente da YouTube Data API
   ========================================================= */
class ApiError extends Error {
  constructor(message, status = 0, reason = '') {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

const ERROR_MESSAGES = {
  quotaExceeded: 'O Google recusou a requisição por cota do projeto. Confira em Google Cloud Console › YouTube Data API v3 › Cotas o limite de “Queries per day”.',
  dailyLimitExceeded: 'O Google recusou a requisição por limite diário do projeto. Confira as cotas da YouTube Data API v3 no Google Cloud Console.',
  rateLimitExceeded: 'Muitas requisições em pouco tempo. Aguarde alguns segundos e tente de novo.',
  keyInvalid: 'A chave de API é inválida. Verifique nos Ajustes.',
  badRequest: 'Requisição inválida para a API do YouTube.',
  accessNotConfigured: 'A YouTube Data API v3 não está ativada no seu projeto do Google Cloud.',
  commentsDisabled: 'Os comentários estão desativados neste vídeo.',
  playlistNotFound: 'Lista de uploads do canal não encontrada.',
  forbidden: 'Acesso negado pela API do YouTube.',
  ipRefererBlocked: 'A chave de API não permite requisições a partir deste endereço.',
  insufficientPermissions: 'O login do Google não tem permissão para esta função. Salve uma chave de API nos Ajustes para usá-la.',
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: 'O login do Google não tem permissão para esta função. Salve uma chave de API nos Ajustes para usá-la.',
};

// O Google só aceita ler comentários com login se o app pedir o escopo "youtube.force-ssl",
// que também permite gerenciar a conta. Para não pedir isso, comentários usam apenas a chave de API.
const KEY_ONLY_ENDPOINTS = new Set(['commentThreads', 'comments']);

async function api(endpoint, params = {}, { retry = true, useToken = true } = {}) {
  const { apiKey } = state.config;
  const keyOnly = KEY_ONLY_ENDPOINTS.has(endpoint);
  if (keyOnly && !apiKey) {
    throw new ApiError('Para ver os comentários, salve uma chave da YouTube Data API nos Ajustes › Credenciais da API. O Google não permite ler comentários só com o login de leitura.', 0, 'needsApiKey');
  }
  const token = useToken && !keyOnly ? Auth.ytToken() : null;
  if (!token && !apiKey) {
    throw new ApiError('Configure uma chave de API ou entre com sua conta Google nos Ajustes.', 0, 'noCredentials');
  }

  const url = new URL(endpoint, YT_API);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  if (apiKey) url.searchParams.set('key', apiKey);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  let res;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new ApiError('Falha de rede. Verifique sua conexão com a internet.', 0, 'network');
  }
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && token && retry) {
      Auth.clear(false);
      toast('Sua sessão do Google expirou. Entre novamente.', 'error');
      if (apiKey) return api(endpoint, params, { retry: false, useToken: false });
    }
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.details?.[0]?.reason || '';
    if (res.status === 403 && token && retry && apiKey && (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      // Escopo insuficiente só para ESTE endpoint: repete com a chave de API, sem mexer no login.
      return api(endpoint, params, { retry: false, useToken: false });
    }
    const googleMsg = (data?.error?.message || '').replace(/<[^>]*>/g, '');
    if (res.status !== 404) console.error('[YouTube API]', endpoint, res.status, reason, data?.error || data);
    const detail = googleMsg ? ` [${reason || res.status}: ${googleMsg}]` : ` [${reason || res.status}]`;
    const message = ERROR_MESSAGES[reason] ? ERROR_MESSAGES[reason] + detail : (googleMsg || `Erro ${res.status} na API do YouTube.`);
    throw new ApiError(message, res.status, reason);
  }
  return data;
}

function normalizeVideo(v) {
  const s = v.snippet;
  const t = s.thumbnails || {};
  return {
    id: v.id,
    title: s.title,
    description: s.description || '',
    channelId: s.channelId,
    channelTitle: s.channelTitle,
    publishedAt: Date.parse(s.publishedAt),
    thumb: (t.high || t.medium || t.default)?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    thumbSmall: (t.medium || t.high || t.default)?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    duration: fmtDuration(v.contentDetails?.duration),
    durationSec: isoSeconds(v.contentDetails?.duration),
    views: v.statistics?.viewCount,
    likes: v.statistics?.likeCount,
    comments: v.statistics?.commentCount,
    live: s.liveBroadcastContent || 'none',
    viewers: v.liveStreamingDetails?.concurrentViewers,
    liveSince: v.liveStreamingDetails?.actualStartTime ? Date.parse(v.liveStreamingDetails.actualStartTime) : null,
    blocked: embedBlocked(v) || unplayable.has(v.id),
  };
}

/**
 * Busca detalhes dos vídeos e DESCARTA qualquer vídeo cujo canal
 * não esteja na lista configurada pelo usuário.
 */
async function fetchVideos(ids) {
  const allowed = allowedChannels();
  const result = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await api('videos', {
      part: 'snippet,contentDetails,statistics,liveStreamingDetails,status', // status: se toca fora do YouTube (sem custo a mais)
      id: ids.slice(i, i + 50).join(','),
      maxResults: 50,
    });
    for (const v of data.items || []) {
      if (allowed.has(v.snippet?.channelId)) result.set(v.id, normalizeVideo(v));
    }
  }
  return result;
}

/* =========================================================
   Login com Google
   =========================================================
   Sem servidor de login: Google Identity Services (janela do
   Google), com login de 1 hora — depois aparece "Reconectar".

   Com servidor de login (Cloudflare Worker, worker.js): a página
   vai ao Google e volta com um código; o servidor troca o código
   pelo login de 1 hora + uma chave de renovação (criptografada,
   guardada neste aparelho). Antes de cada hora acabar, o app pede
   um login novo ao servidor, em segundo plano. A chave dura até 7
   dias (limite do Google para apps em modo "Teste"); depois disso,
   "Reconectar" de novo. Se o servidor sair do ar, o login atual
   continua até expirar, e o app volta a funcionar como antes.
   ========================================================= */
const Auth = {
  token: null,
  expiresAt: 0,
  profile: null,
  ytChannel: null,
  hasYtScope: false,
  hasDriveScope: false,
  remembered: null, // última conta usada, para oferecer "Reconectar" quando a sessão expira
  client: null,
  clientIdInUse: null,
  expiryTimer: 0,
  session: null,     // chave de renovação (só com servidor de login)
  refreshing: null,
  pendingCode: null, // código que voltou do Google, ainda não trocado

  // Guardado no localStorage (e não por aba) para valer em todas as abas enquanto o token for válido.
  restore() {
    this.takeRedirectResult();
    const saved = store.get(KEYS.auth, null);
    this.session = this.server() ? store.get(KEYS.authSession, null) : null;
    // Com chave de renovação, o login expirado é renovado em seguida (mantendo nome e foto).
    if (saved && (saved.expiresAt > Date.now() + 60_000 || this.session)) Object.assign(this, saved);
    this.remembered = store.get(KEYS.account, null);
    this.scheduleExpiry();
    if (this.pendingCode) this.exchangeCode();
    else if (this.session && !this.validToken()) this.refresh();
  },

  /** Endereço do servidor de login (sem a barra final), ou '' se não houver. */
  server() {
    return (state.config.loginServer || '').trim().replace(/\/+$/, '');
  },

  /** Volta do Google (login pela página inteira): guarda o código e limpa o endereço. */
  takeRedirectResult() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    const pending = store.get(KEYS.oauthState, null);
    try { localStorage.removeItem(KEYS.oauthState); } catch { /* ignora */ }
    history.replaceState(null, '', location.pathname + (pending?.hash || '#/'));
    if (!pending || pending.state !== q.get('state')) {
      setTimeout(() => toast('O login não foi concluído. Tente entrar de novo.', 'error'), 0);
    } else if (q.get('error') || !q.get('code')) {
      setTimeout(() => toast('Login cancelado ou não autorizado.', 'error'), 0);
    } else {
      this.pendingCode = { code: q.get('code'), redirectUri: pending.redirectUri, verifier: pending.verifier };
    }
  },

  /** Endereço de volta do Google (cadastrado no Google Cloud Console), ex.: https://esiojunior89.github.io/MeuTube/ */
  redirectUri() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  },

  /** Login com servidor: vai ao Google pedindo também a chave de renovação. */
  async signInWithServer(clientId) {
    const st = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    // PKCE: um segundo código secreto criado aqui. O código que volta do Google só vale junto
    // com ele, então quem interceptar o código (extensão, histórico) não consegue usá-lo.
    const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    store.set(KEYS.oauthState, { state: st, verifier, hash: location.hash || '#/', redirectUri: this.redirectUri(), at: Date.now() });
    const email = this.profile?.email || this.remembered?.profile?.email;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline', // pede a chave de renovação
      prompt: 'consent',      // o Google só manda a chave quando mostra a tela de permissões
      include_granted_scopes: 'true',
      state: st,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(email && { login_hint: email }),
    });
    location.assign(url);
  },

  async exchangeCode() {
    const { code, redirectUri, verifier } = this.pendingCode;
    this.pendingCode = null;
    let data = null;
    try {
      const res = await fetch(`${this.server()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: redirectUri, ...(verifier && { code_verifier: verifier }) }),
      });
      data = await res.json().catch(() => null);
      if (!res.ok || !data?.access_token) throw new Error(data?.error || `erro ${res.status}`);
    } catch (e) {
      toast(`Não foi possível concluir o login pelo servidor de login (${e.message}).`, 'error', 9000);
      return;
    }
    this.setSession(data.session || null);
    if (!data.session) toast('O Google não enviou a chave de renovação: este login vale por 1 hora.', 'info', 8000);
    await this.onToken(data);
  },

  setSession(session) {
    this.session = session;
    if (session) store.set(KEYS.authSession, session);
    else try { localStorage.removeItem(KEYS.authSession); } catch { /* ignora */ }
  },

  /** Pede um login novo ao servidor de login (em segundo plano). Retorna true se renovou. */
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const hadCredentials = hasCredentials();
      let res = null;
      let data = null;
      try {
        res = await fetch(`${this.server()}/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: this.session }),
        });
        data = await res.json().catch(() => null);
      } catch { res = null; }
      if (res?.ok && data?.access_token) {
        this.token = data.access_token;
        this.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
        if (data.scope) {
          const granted = String(data.scope).split(/\s+/);
          this.hasYtScope = granted.includes(YT_SCOPE);
          this.hasDriveScope = granted.includes(DRIVE_SCOPE);
        }
        this.persist();
        renderAccount();
        if (!hadCredentials) onCredentialsChanged();
        Sync.schedule(SYNC_QUICK_MS);
        return true;
      }
      if (res && (res.status === 401 || res.status === 400)) {
        // A chave de renovação expirou (7 dias) ou foi revogada: precisa entrar de novo.
        this.setSession(null);
        this.scheduleExpiry();
        renderAccount();
        if (!this.validToken()) toast('Seu login do Google precisa ser renovado (o Google pede a cada 7 dias). Clique em “Reconectar”.', 'info', 9000);
        return false;
      }
      // Sem conexão ou servidor fora do ar: tenta de novo em 1 minuto.
      clearTimeout(this.expiryTimer);
      this.expiryTimer = setTimeout(() => this.refresh(), 60_000);
      if (!this.validToken()) renderAccount();
      return false;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  },

  persist() {
    store.set(KEYS.auth, {
      token: this.token, expiresAt: this.expiresAt, profile: this.profile,
      ytChannel: this.ytChannel, hasYtScope: this.hasYtScope, hasDriveScope: this.hasDriveScope,
    });
    if (this.profile || this.ytChannel) {
      this.remembered = { profile: this.profile, ytChannel: this.ytChannel };
      store.set(KEYS.account, this.remembered);
    }
    this.scheduleExpiry();
  },

  /** O Google emite tokens de 1 hora para apps web: renova antes (com servidor) ou avisa quando expira. */
  scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (!this.token) return;
    if (this.session) {
      this.expiryTimer = setTimeout(() => this.refresh(), Math.max(0, this.expiresAt - Date.now() - 5 * 60_000));
      return;
    }
    this.expiryTimer = setTimeout(() => {
      renderAccount();
      if (!state.config.apiKey) toast('Sua sessão do Google expirou (o Google limita a 1 hora). Clique em “Reconectar”.', 'info', 8000);
    }, Math.max(0, this.expiresAt - Date.now() - 30_000));
  },

  validToken() {
    return this.token && this.expiresAt > Date.now() + 30_000 ? this.token : null;
  },

  /** Token só é usado na YouTube API se o usuário concedeu o escopo do YouTube. */
  ytToken() {
    return this.hasYtScope ? this.validToken() : null;
  },

  async waitForGis() {
    for (let i = 0; i < 60 && !window.google?.accounts?.oauth2; i++) await sleep(100);
    if (!window.google?.accounts?.oauth2) throw new Error('Não foi possível carregar o login do Google. Verifique bloqueadores de conteúdo.');
  },

  async signIn() {
    const { clientId } = state.config;
    if (!clientId) {
      toast('Informe o OAuth Client ID nos Ajustes › Credenciais da API para entrar com o Google.', 'error', 7000);
      if (state.view !== 'settings') location.hash = '#/settings';
      return;
    }
    if (location.protocol === 'file:') {
      toast('Abra o app por http:// ou https:// (ex.: um servidor local) para usar o login do Google.', 'error', 6000);
      return;
    }
    if (this.server()) {
      this.signInWithServer(clientId).catch(() => toast('Não foi possível iniciar o login com o Google. Tente de novo.', 'error'));
      return;
    }
    try {
      await this.waitForGis();
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    if (!this.client || this.clientIdInUse !== clientId) {
      this.client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: resp => this.onToken(resp),
        error_callback: err => {
          if (err?.type !== 'popup_closed') toast('Não foi possível abrir o login do Google.', 'error');
        },
      });
      this.clientIdInUse = clientId;
    }
    // Reconexão de quem já autorizou: sem repetir a tela de permissões.
    const known = (this.profile || this.remembered) && ((this.hasYtScope && this.hasDriveScope) || !this.validToken());
    this.client.requestAccessToken({ prompt: known ? '' : 'consent' });
  },

  async onToken(resp) {
    if (resp.error) {
      toast('Login cancelado ou não autorizado.', 'error');
      return;
    }
    this.token = resp.access_token;
    this.expiresAt = Date.now() + Number(resp.expires_in || 3600) * 1000;
    // O Google permite desmarcar permissões individualmente na tela de consentimento.
    const granted = String(resp.scope || '').split(/\s+/);
    const gisGranted = scope => Boolean(window.google?.accounts?.oauth2?.hasGrantedAllScopes?.(resp, scope));
    this.hasYtScope = granted.includes(YT_SCOPE) || gisGranted(YT_SCOPE);
    this.hasDriveScope = granted.includes(DRIVE_SCOPE) || gisGranted(DRIVE_SCOPE);
    await this.loadProfile();
    this.persist();
    renderAccount();
    if (this.hasYtScope) {
      toast(`Conectado como ${this.profile?.name || 'usuário Google'}.`, 'success');
    } else {
      toast('Você entrou, mas não autorizou o acesso ao YouTube. Clique em “Autorizar acesso ao YouTube” e marque a caixa do YouTube na tela do Google.', 'error', 9000);
    }
    onCredentialsChanged();
    Sync.run(); // baixa/mescla/envia os dados da nuvem
  },

  async loadProfile() {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) this.profile = await res.json();
    } catch { /* ignora */ }
    // Confirma a permissão do YouTube com uma chamada real, em vez de confiar só na resposta do login.
    const claimed = this.hasYtScope;
    this.ytChannel = null;
    this.hasYtScope = true;
    try {
      const data = await api('channels', { part: 'snippet', mine: true }, { retry: false });
      const c = data.items?.[0];
      this.ytChannel = c ? {
        id: c.id,
        title: c.snippet.title,
        thumb: c.snippet.thumbnails?.default?.url,
      } : null;
    } catch (e) {
      const scopeMissing = e.reason === 'insufficientPermissions' || e.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT';
      this.hasYtScope = scopeMissing ? false : claimed;
    }
  },

  /**
   * Esquece o login NESTE aparelho. Não revoga a autorização no Google: a revogação vale
   * para a conta inteira e derrubaria o login (e a sincronização) dos outros aparelhos.
   * Para remover o acesso do app de vez: myaccount.google.com/permissions.
   */
  clear() {
    this.token = null;
    this.expiresAt = 0;
    this.profile = null;
    this.ytChannel = null;
    this.hasYtScope = false;
    this.hasDriveScope = false;
    clearTimeout(this.expiryTimer);
    try { localStorage.removeItem(KEYS.auth); } catch { /* ignora */ }
    renderAccount();
  },

  signOut() {
    this.setSession(null);
    this.remembered = null;
    try { localStorage.removeItem(KEYS.account); } catch { /* ignora */ }
    this.clear();
    toast('Você saiu da conta Google neste aparelho.');
    onCredentialsChanged();
  },
};

/* =========================================================
   Feed: mescla os uploads dos canais por data
   =========================================================
   Cada canal tem playlists automáticas já ordenadas do mais
   novo para o mais antigo. A lista sai em RODADAS: 1 vídeo de
   cada canal por rodada, e dentro da rodada do mais novo para o
   mais antigo — um canal que posta muito não enche a tela sozinho.

   As vagas (qual canal ocupa cada posição) são sempre calculadas
   com todos os vídeos. Com o olho escondendo os assistidos, cada
   vaga de um canal recebe o próximo vídeo NÃO assistido dele: as
   posições não mudam, só o vídeo que ocupa a vaga.

   Só a aba "Vídeos" de cada canal: em vez da playlist de
   uploads completa (UU…), usamos a playlist automática de
   vídeos (UULF…). Shorts (UUSH…) e lives gravadas (UULV…) não
   entram no app; só as lives que estão no ar aparecem, no menu
   lateral, em "Ao vivo".
   ========================================================= */
class FeedStream {
  constructor(channels) {
    this.sources = channels.map(c => ({
      channelId: c.id,
      playlistId: 'UULF' + c.id.slice(2),
      list: [],        // vídeos do canal já lidos, do mais novo para o mais antigo
      ids: new Set(),
      token: null,
      done: false,
      slot: 0,         // próximo vídeo que define a vaga do canal na rodada
      show: 0,         // próximo não assistido (olho escondendo os assistidos)
    }));
    this.loading = null;
    this.error = null;
    this.dead = false;
    this.uiBusy = false;
    this.gen = 0;
    this.restart();
  }

  /** Recomeça a lista do zero (olho mudou, vídeo assistido...) sem buscar de novo o que já foi lido. */
  restart() {
    this.gen++;
    this.loading = null;
    this.items = [];
    this.roundTaken = new Set(); // canais que já entraram na rodada atual
    this.exhausted = this.sources.length === 0;
    this.error = null;
    this.hideMode = state.hideWatched;
    this.watchedSig = watchedSignature();
    this.info = this.hideMode ? store.get(VIDEO_INFO_KEY, {}) : null; // duração e "não toca", guardados pelas Estatísticas
    for (const s of this.sources) { s.slot = 0; s.show = 0; }
  }

  /** Olho escondendo os assistidos: a vaga de um vídeo assistido não aparece na tela, então basta saber se
      ele é válido — e isso as Estatísticas já guardam no aparelho (duração e "não toca"), sem gastar cota.
      true/false = válido ou não pelo que está guardado; null = não se sabe (pergunta ao YouTube). */
  cachedValid(s, it) {
    if (!this.hideMode || !isWatched(it.id)) return null;
    const d = this.info?.[s.channelId]?.[it.id];
    if (d == null) return null;
    if (d <= 0 || unplayable.has(it.id)) return false; // indisponível, live/estreia ou não toca fora do YouTube
    const max = channelMaxDur(s.channelId);
    return !max || d <= max;
  }

  dispose() {
    this.dead = true;
  }

  /** Algum vídeo válido já lido (com o olho escondendo tudo, diferencia "já assistiu tudo" de "sem vídeos"). */
  hasVideos() {
    return this.sources.some(s => s.list.some(it => it.video));
  }

  /** Lê a próxima página da playlist do canal. */
  async fetchPage(src) {
    let data;
    try {
      data = await api('playlistItems', {
        part: 'snippet,contentDetails',
        playlistId: src.playlistId,
        maxResults: 50,
        pageToken: src.token,
      });
    } catch (e) {
      // 404: o canal não tem essa playlist.
      if (e.status === 404) { src.done = true; return; }
      throw e;
    }
    if (this.dead) return;
    const page = [];
    for (const it of data.items || []) {
      const id = it.contentDetails?.videoId;
      const published = it.contentDetails?.videoPublishedAt; // ausente em vídeos privados/excluídos
      const owner = it.snippet?.videoOwnerChannelId;
      if (!id || !published || src.ids.has(id)) continue;
      if (owner && owner !== src.channelId) continue;
      src.ids.add(id);
      page.push({ id, ts: Date.parse(published) });
    }
    src.list.push(...page.sort((a, b) => b.ts - a.ts));
    src.token = data.nextPageToken || null;
    if (!src.token) src.done = true;
  }

  /** Detalhes de um lote de vídeos (até 50 por chamada, que custa o mesmo que 1): só fica válido
      o que é da aba "Vídeos", não está ao vivo/agendado e está dentro do limite de duração. */
  async check(items) {
    const details = await fetchVideos(items.map(it => it.id));
    for (const it of items) {
      const v = details.get(it.id);
      it.checked = true;
      it.video = shownInApp(v) ? v : null;
    }
  }

  /** Leva o cursor (slot ou show) de cada canal até o próximo vídeo válido (no "show", também
      não assistido), lendo páginas e detalhes quando falta. Os lotes juntam vários canais. */
  async advance(sources, key) {
    for (;;) {
      const fetches = [];
      const need = [];
      for (const s of sources) {
        for (;;) {
          const it = s.list[s[key]];
          if (!it) { if (!s.done) fetches.push(s); break; }
          if (key === 'show' && isWatched(it.id)) { s[key]++; continue; } // assistido não aparece: nem pergunta
          if (!it.checked) {
            const ok = key === 'slot' ? this.cachedValid(s, it) : null;
            if (ok === true) break;                // vaga válida pelo que está guardado
            if (ok === false) { s[key]++; continue; }
            need.push(s);
            break;
          }
          if (!it.video || (key === 'show' && isWatched(it.id))) { s[key]++; continue; }
          break;
        }
      }
      if (!fetches.length && !need.length) return;
      if (fetches.length) await Promise.all(fetches.map(s => this.fetchPage(s)));
      if (need.length) {
        const ahead = Math.max(2, Math.ceil(50 / need.length));
        await this.check(need.flatMap(s => s.list.slice(s[key], s[key] + ahead)
          .filter(it => !it.checked && (key === 'show' ? !isWatched(it.id) : this.cachedValid(s, it) === null))).slice(0, 50));
      }
      if (this.dead) return;
    }
  }

  loadMore(count = PAGE_SIZE) {
    if (this.loading) return this.loading;
    if (this.exhausted || this.dead) return Promise.resolve([]);
    const loading = this._load(count).finally(() => { if (this.loading === loading) this.loading = null; });
    this.loading = loading;
    return loading;
  }

  async _load(count) {
    const gen = this.gen;
    const added = [];
    const stale = () => this.dead || gen !== this.gen;
    while (added.length < count) {
      await this.advance(this.sources, 'slot');
      if (stale()) return [];
      // Rodadas: a vaga vai para o canal (que ainda não entrou nesta rodada) cujo próximo vídeo
      // é o mais novo. Quando todos os canais com vídeos já entraram, começa outra rodada.
      const pending = this.sources.filter(s => s.list[s.slot]);
      if (!pending.length) { this.exhausted = true; break; }
      if (pending.every(s => this.roundTaken.has(s))) this.roundTaken.clear();
      let best = null;
      for (const s of pending) {
        if (!this.roundTaken.has(s) && (!best || s.list[s.slot].ts > best.list[best.slot].ts)) best = s;
      }
      const slot = best.list[best.slot++];
      this.roundTaken.add(best);
      if (!this.hideMode) {
        added.push(slot.video);
        continue;
      }
      // Olho escondendo os assistidos: a vaga recebe o próximo não assistido do mesmo canal
      // (se o canal não tiver mais nenhum, a vaga sai e os seguintes sobem).
      await this.advance([best], 'show');
      if (stale()) return [];
      const show = best.list[best.show];
      if (show) {
        best.show++;
        added.push(show.video);
      }
    }
    this.items.push(...added);
    return added;
  }
}

/* =========================================================
   "Mais antigos" (página de um canal)
   =========================================================
   A API do YouTube só lista os vídeos de um canal do mais novo para
   o mais antigo. Para mostrar os mais antigos primeiro, o app lê a
   lista completa do canal (só IDs e datas: 1 unidade de cota a cada
   50 vídeos), inverte a ordem e carrega os detalhes de 20 em 20,
   como no Início. A lista fica guardada no aparelho: nas próximas
   visitas só são buscados os vídeos publicados desde a última.
   ========================================================= */
const UPLOAD_INDEX_KEY = 'meutube.uploadIndex';

/** Lê a lista guardada: "ID (11 letras) + segundos em base 36", separados por espaço. */
function parseIndexList(list) {
  return (list || '').split(' ').filter(Boolean).map(e => ({ id: e.slice(0, 11), ts: parseInt(e.slice(11), 36) * 1000 }));
}

/** Lista { id, ts } de uma playlist automática do canal, do cache + o que for novo.
    Com maxAge, uma lista conferida há menos tempo que isso é usada sem consultar o YouTube. */
async function playlistIndex(playlistId, onProgress, maxAge = 0) {
  const cache = store.get(UPLOAD_INDEX_KEY, {});
  const cached = parseIndexList(cache[playlistId]?.list);
  if (maxAge && cache[playlistId] && Date.now() - (cache[playlistId].checked || cache[playlistId].at) < maxAge) return cached;
  const known = new Set(cached.map(e => e.id));
  const fresh = [];
  let token = null;
  let reachedKnown = false;
  do {
    let data;
    try {
      data = await api('playlistItems', {
        part: 'contentDetails',
        playlistId,
        maxResults: 50,
        pageToken: token,
        fields: 'nextPageToken,items(contentDetails(videoId,videoPublishedAt))',
      });
    } catch (e) {
      if (e.status === 404) return []; // o canal não tem essa playlist (ex.: sem Shorts)
      throw e;
    }
    for (const it of data.items || []) {
      const id = it.contentDetails?.videoId;
      const published = it.contentDetails?.videoPublishedAt;
      if (!id || !published) continue;
      if (known.has(id)) { reachedKnown = true; continue; }
      fresh.push({ id, ts: Date.parse(published) });
    }
    onProgress?.(fresh.length + cached.length);
    token = data.nextPageToken || null;
  } while (token && !reachedKnown);

  const all = [...fresh, ...cached];
  // Esquece as listas de canais removidos e as de Shorts (de versões antigas).
  for (const key of Object.keys(cache)) {
    if (!key.startsWith('UULF') || !state.channels.some(c => c.id.slice(2) === key.slice(4))) delete cache[key];
  }
  cache[playlistId] = {
    at: fresh.length || !cache[playlistId] ? Date.now() : cache[playlistId].at,
    checked: Date.now(),
    list: all.map(e => e.id + Math.floor(e.ts / 1000).toString(36)).join(' '),
  };
  store.set(UPLOAD_INDEX_KEY, cache);
  return all;
}

class OldestFeedStream {
  constructor(channel) {
    this.playlists = ['UULF' + channel.id.slice(2)]; // só a aba "Vídeos" do canal
    this.ascending = true;
    this.items = [];
    this.order = null;
    this.pos = 0;
    this.loading = null;
    this.exhausted = false;
    this.error = null;
    this.dead = false;
    this.uiBusy = false;
  }

  dispose() {
    this.dead = true;
  }

  loadMore(count = PAGE_SIZE) {
    if (this.loading) return this.loading;
    if (this.exhausted || this.dead) return Promise.resolve([]);
    this.loading = this._load(count).finally(() => { this.loading = null; });
    return this.loading;
  }

  async _load(count) {
    if (!this.order) {
      const byId = new Map();
      for (const pl of this.playlists) {
        const before = byId.size;
        const list = await playlistIndex(pl, n => {
          if (this === currentFeed()) renderIndexProgress(before + n);
        });
        if (this.dead) return [];
        list.forEach(e => byId.set(e.id, e.ts));
      }
      this.order = [...byId].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    }
    const added = [];
    while (added.length < count && this.pos < this.order.length) {
      const ids = this.order.slice(this.pos, this.pos + (count - added.length));
      this.pos += ids.length;
      const details = await fetchVideos(ids);
      if (this.dead) return [];
      added.push(...ids.map(id => details.get(id)).filter(shownInApp));
    }
    if (this.pos >= this.order.length) this.exhausted = true;
    this.items.push(...added);
    return added;
  }
}

/** Enquanto lê a lista completa do canal (só na primeira vez), mostra quantos vídeos já leu. */
function renderIndexProgress(n) {
  if (state.view !== 'home') return;
  $('#feed-status').innerHTML = `<p class="muted">Buscando os vídeos mais antigos do canal… ${n.toLocaleString('pt-BR')} vídeos lidos</p>`;
}

/** Um feed por filtro: "all" (todos os canais), o ID de um canal ou "ID:old" (mais antigos). */
const feeds = new Map();

function currentFeed() {
  const oldest = Boolean(state.filter) && state.sort === 'old';
  const key = (state.filter || 'all') + (oldest ? ':old' : '');
  if (!feeds.has(key)) {
    const list = !state.filter ? homeChannels() : homeChannels().filter(c => c.id === state.filter);
    feeds.set(key, oldest && list.length ? new OldestFeedStream(list[0]) : new FeedStream(list));
  }
  return feeds.get(key);
}

/** Endereço de um vídeo levando o filtro atual (canal e ordem), para os vídeos seguintes continuarem nele. */
function watchContext() {
  return state.filter ? `/c/${state.filter}${state.sort === 'old' ? '/antigos' : ''}` : '';
}
function watchHref(id, context = watchContext()) {
  return `#/watch/${id}${context}`;
}

function findLoadedVideo(id) {
  for (const feed of feeds.values()) {
    const v = feed.items.find(item => item.id === id);
    if (v) return v;
  }
  return Lives.items.find(item => item.id === id) || null;
}

/* =========================================================
   Vídeos "Novo" (de hoje e nunca abertos)
   ========================================================= */
const seenVideos = new Set(store.get(KEYS.seen, []));

function isToday(ts) {
  return new Date(ts).toDateString() === new Date().toDateString();
}

function isNewVideo(v) {
  return !seenVideos.has(v.id) && isToday(v.publishedAt) && v.publishedAt <= Date.now();
}

function markSeen(id) {
  if (seenVideos.has(id)) return;
  seenVideos.add(id);
  store.set(KEYS.seen, [...seenVideos].slice(-3000));
  $$(`[data-vid="${id}"] .new-tag`).forEach(el => el.remove());
  Sync.schedule(SYNC_PROGRESS_MS);
}

/* =========================================================
   Início (grade de vídeos com rolagem infinita)
   ========================================================= */
let gridFeed = null;
let renderedCount = 0;
let gridGen; // versão da lista (FeedStream.gen) que está desenhada na grade

function thumbBadge(v) {
  if (v.live === 'live') return '<span class="badge badge-live">AO VIVO</span>';
  if (v.live === 'upcoming') return '<span class="badge badge-upcoming">EM BREVE</span>';
  return v.duration ? `<span class="badge">${v.duration}</span>` : '';
}

function metaLine(v) {
  return [fmtViews(v.views), timeAgo(v.publishedAt)].filter(Boolean).join(' · ');
}

function newTag(v) {
  return isNewVideo(v) ? ' <span class="new-tag">Novo</span>' : '';
}

/** Capa maior para o destaque (nem todo vídeo tem; se faltar, volta para a normal). */
const heroThumb = v => `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`;
/** Foto do canal em tamanho maior (as do YouTube aceitam outro tamanho no endereço). */
const bigAvatar = (url, size = 240) => (url || '').replace(/=s\d+(-)/, `=s${size}$1`);

function tileHTML(v, i, { hero = false } = {}) {
  const ch = channelById(v.channelId);
  return `
    <a class="tile${hero ? ' tile-hero' : ''}${isWatched(v.id) ? ' is-watched' : ''}" href="${watchHref(v.id)}" data-vid="${v.id}" style="--i:${i}">
      <div class="thumb">
        <img src="${esc(hero ? heroThumb(v) : v.thumb)}" ${hero ? `data-fallback="${esc(v.thumb)}" ` : ''}alt="" loading="${hero ? 'eager' : 'lazy'}" decoding="async">
        ${thumbBadge(v)}
        ${progressBarHTML(v.id)}
        ${hero ? `
        <div class="hero-txt">
          <div class="hero-eyebrow"><img src="${esc(ch?.thumb || '')}" alt="" referrerpolicy="no-referrer" data-hide-broken>${esc(v.channelTitle)} · ${isNewVideo(v) ? 'Novo' : esc(timeAgo(v.publishedAt))}</div>
          <h2 class="hero-title">${esc(v.title)}</h2>
          <p class="hero-meta">${esc([v.live === 'live' ? 'Ao vivo' : v.duration, fmtViews(v.views), timeAgo(v.publishedAt)].filter(Boolean).join(' · '))}</p>
          <div class="hero-actions"><span class="btn btn-white">${SF('play')}Assistir</span><span class="round glass-dark" data-action="tile-more" data-vid-more="${v.id}" role="button" aria-label="Mais opções" title="Mais opções">${SF('more')}</span></div>
        </div>` : ''}
      </div>
      <div class="tile-info">
        <img class="avatar" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
        <div>
          <h3 class="tile-title" title="${esc(v.title)}">${esc(v.title)}</h3>
          <p class="tile-channel">${esc(v.channelTitle)}</p>
          <p class="tile-meta">${esc(metaLine(v))}${newTag(v)}</p>
        </div>
        <span class="tile-more" data-action="tile-more" data-vid-more="${v.id}" role="button" aria-label="Mais opções">${SF('more')}</span>
      </div>
    </a>`;
}

function skeletonTileHTML() {
  return `
    <div aria-hidden="true">
      <div class="skeleton sk-thumb"></div>
      <div class="sk-row">
        <div class="skeleton sk-avatar"></div>
        <div class="sk-lines">
          <div class="skeleton sk-line w80"></div>
          <div class="skeleton sk-line w60"></div>
          <div class="skeleton sk-line w40"></div>
        </div>
      </div>
    </div>`;
}

function setSkeletons(show) {
  const box = $('#feed-skeletons');
  if (show && !box.childElementCount) {
    box.innerHTML = Array.from({ length: 10 }, skeletonTileHTML).join('');
  }
  box.hidden = !show;
}

function syncGrid() {
  const feed = currentFeed();
  const grid = $('#feed');
  if (gridFeed !== feed) {
    grid.innerHTML = '';
    renderedCount = 0;
    gridFeed = feed;
    gridGen = feed.gen;
  }
  if (gridGen !== feed.gen) return; // a lista está sendo remontada: rebuildFeed troca a grade de uma vez
  const fresh = feed.items.slice(renderedCount);
  if (!fresh.length) return;
  const start = renderedCount;
  grid.insertAdjacentHTML('beforeend', fresh.map((v, i) => tileHTML(v, Math.min(i, PAGE_SIZE - 1), { hero: heroAllowed() && start + i === 0 })).join(''));
  renderedCount = feed.items.length;
  updateGridDecor();
}

/** Destaque: o vídeo mais novo de "Todos os canais" ocupa a linha inteira (no celular, cartão normal). */
const heroAllowed = () => !state.filter;

function updateGridDecor() {
  const grid = $('#feed');
  grid.classList.toggle('with-hero', Boolean(grid.querySelector('.tile-hero')));
  const n = homeChannels().length;
  grid.dataset.sub = `Dos seus ${n} ${n === 1 ? 'canal' : 'canais'}`;
  applySearch();
}

/** A lista do Início depende do olho (com ele escondendo, cada vaga mostra o próximo não assistido
    do canal) e do que já foi assistido: se algo disso mudou desde que foi montada, precisa remontar. */
function feedIsStale(feed) {
  return feed instanceof FeedStream && (feed.hideMode !== state.hideWatched || (feed.hideMode && feed.watchedSig !== watchedSignature()));
}

/** Remonta a lista com o que já foi lido (quase sem chamadas à API) e troca a grade de uma vez,
    com o mesmo número de vídeos — a posição na tela não muda. Com animate (olho), os vídeos que
    continuam na tela deslizam até o novo lugar e os outros entram ou saem suavemente. */
async function rebuildFeed(feed, { animate = false } = {}) {
  const target = Math.max(renderedCount, feed.items.length, PAGE_SIZE);
  feed.restart();
  feed.uiBusy = true;
  try {
    await feed.loadMore(target);
  } catch (e) {
    if (!feed.dead) feed.error = e;
  }
  feed.uiBusy = false;
  if (feed.dead || feed !== currentFeed() || state.view !== 'home') return;
  const grid = $('#feed');
  const swap = () => {
    stopPreview();
    grid.innerHTML = feed.items.map((v, i) => tileHTML(v, Math.min(i, PAGE_SIZE - 1), { hero: heroAllowed() && i === 0 })).join('');
    grid.querySelectorAll('.tile').forEach(t => { t.style.animation = 'none'; }); // sem a entrada em cascata
    renderedCount = feed.items.length;
    updateGridDecor();
    gridFeed = feed;
    gridGen = feed.gen;
    setSkeletons(false);
    updateFeedStatus();
  };
  const visible = () => [...grid.querySelectorAll('.tile')].filter(t => t.offsetParent && inViewport(t)).slice(0, 40);
  const name = t => { t.style.viewTransitionName = `vt-${t.dataset.vid}`; t.style.viewTransitionClass = 'feed-tile'; };
  if (animate && motionOK() && document.startViewTransition) {
    visible().forEach(name);
    const transition = document.startViewTransition(() => { swap(); visible().forEach(name); });
    transition.finished.finally(() => grid.querySelectorAll('.tile').forEach(t => { t.style.viewTransitionName = ''; }));
  } else {
    swap();
  }
  requestAnimationFrame(checkSentinel);
}

function resetFeed() {
  feeds.forEach(feed => feed.dispose());
  feeds.clear();
  gridFeed = null;
  renderedCount = 0;
  $('#feed').innerHTML = '';
  $('#feed').classList.remove('with-hero');
  setSkeletons(false);
  $('#feed-status').innerHTML = '';
}

function renderFeedHeader() {
  const box = $('#feed-header');
  const ch = state.filter ? channelById(state.filter) : null;
  document.body.classList.toggle('channel-page', Boolean(ch));
  $('#home-head').hidden = Boolean(ch);
  if (!ch) {
    box.hidden = true;
    box.innerHTML = '';
    $('#home-actions').prepend($('#watched-toggle'));
    return;
  }
  const stats = channelStats[ch.id];
  const total = channelVideoTotal(ch);
  const meta = [ch.handle, subscribersText(ch.id), total != null ? `${intFmt.format(total)} vídeos` : stats?.videos ? `${intFmt.format(stats.videos)} vídeos` : '']
    .filter(Boolean).join(' · ');
  box.innerHTML = `
    <div class="cb-box">
      <img class="cb-bg" src="${esc(bigAvatar(ch.thumb, 240))}" alt="" referrerpolicy="no-referrer" data-hide-broken>
      <a class="round-glass cb-back" href="#/channels" aria-label="Voltar aos canais" title="Canais">${SF('chev-l')}</a>
      <div class="cb-main">
        <img class="cb-avatar" src="${esc(bigAvatar(ch.thumb, 240))}" alt="" referrerpolicy="no-referrer" data-hide-broken>
        <div style="min-width:0">
          <h1 class="t-large">${esc(ch.title)}</h1>
          <div class="cb-meta" id="cb-meta">${esc(meta)}</div>
        </div>
      </div>
      <div class="cb-actions" id="cb-actions"></div>
    </div>
    <div class="cb-bar">
      <h2 class="t-title2">Vídeos</h2>
      <nav class="seg seg-cap" aria-label="Ordem dos vídeos">
        <a href="#/c/${esc(ch.id)}"${state.sort !== 'old' ? ' aria-current="true"' : ''}>Mais novos</a>
        <a href="#/c/${esc(ch.id)}/antigos"${state.sort === 'old' ? ' aria-current="true"' : ''}>Mais antigos</a>
      </nav>
    </div>`;
  box.hidden = false;
  $('#cb-actions').append($('#watched-toggle'));
  placeSegThumb(box.querySelector('.seg'));
  if (!subscribersText(ch.id)) {
    ensureChannelStats(ch.id).then(() => {
      if (state.filter === ch.id && state.view === 'home') renderFeedHeaderMeta(ch);
    });
  }
}

function renderFeedHeaderMeta(ch) {
  const el = $('#cb-meta');
  if (!el) return;
  const total = channelVideoTotal(ch);
  const stats = channelStats[ch.id];
  el.textContent = [ch.handle, subscribersText(ch.id), total != null ? `${intFmt.format(total)} vídeos` : stats?.videos ? `${intFmt.format(stats.videos)} vídeos` : '']
    .filter(Boolean).join(' · ');
}

/** Cabeçalho do Início: data (como nos apps da Apple) e, no celular, a foto da conta. */
function renderHomeHead() {
  $('#home-date').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Celular: atalhos para cada canal, numa faixa que rola para o lado. */
function renderHomeChips() {
  const box = $('#home-chips');
  if (!box) return;
  const list = [...homeChannels()].sort((a, b) => byName(a.title, b.title));
  box.innerHTML = list.length
    ? `<a class="chip${state.filter ? '' : ' on'}" href="#/">Todos</a>` + list.map(c => `
        <a class="chip${state.filter === c.id ? ' on' : ''}" href="#/c/${esc(c.id)}">
          <img src="${esc(c.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>${esc(c.title)}
        </a>`).join('')
    : '';
}

/** Segmentados: a pílula branca desliza até a opção escolhida. */
function placeSegThumb(seg, from = null) {
  if (!seg) return;
  const active = seg.querySelector('[aria-current="true"], [aria-pressed="true"]');
  let thumb = seg.querySelector('.seg-thumb');
  if (!active) { thumb?.remove(); return; }
  if (!thumb) {
    thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    seg.prepend(thumb);
  }
  const place = () => { thumb.style.left = `${active.offsetLeft}px`; thumb.style.width = `${active.offsetWidth}px`; };
  if (from && motionOK()) {
    thumb.style.transition = 'none';
    thumb.style.left = from.left;
    thumb.style.width = from.width;
    void thumb.offsetWidth;
    thumb.style.transition = '';
  }
  requestAnimationFrame(place);
}

/* ---------- Busca (menu lateral): canais e vídeos já carregados ---------- */
const searchText = s => s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function applySearch() {
  const input = $('#side-search');
  const q = input ? searchText(input.value.trim()) : '';
  $$('#side-channels .side-item').forEach(a => a.classList.toggle('search-miss', Boolean(q) && !searchText(a.title || '').includes(q)));
  const note = $('#search-note');
  if (!note) return;
  if (!q) {
    $$('#feed .tile.search-miss').forEach(t => t.classList.remove('search-miss'));
    note.hidden = true;
    return;
  }
  let shown = 0;
  $$('#feed .tile').forEach(t => {
    const v = findLoadedVideo(t.dataset.vid);
    const hit = v && (searchText(v.title).includes(q) || searchText(v.channelTitle).includes(q));
    t.classList.toggle('search-miss', !hit);
    if (hit) shown++;
  });
  note.innerHTML = shown
    ? `${shown} ${shown === 1 ? 'vídeo' : 'vídeos'} com <b>“${esc(input.value.trim())}”</b> entre os carregados`
    : `Nenhum vídeo carregado com <b>“${esc(input.value.trim())}”</b>. Role para carregar mais ou tente outro nome.`;
  note.hidden = state.view !== 'home';
}

function emptyState(icon, title, text, action = '') {
  return `
    <div class="empty-state">
      <div class="empty-icon">${ICONS[icon]}</div>
      <h2>${title}</h2>
      <p>${text}</p>
      ${action}
    </div>`;
}

/** Retorna false (e mostra a mensagem adequada) se o feed não pode ser carregado. */
function checkHomePrereqs() {
  const status = $('#feed-status');
  if (!state.channels.length) {
    status.innerHTML = emptyState('channels', 'Nenhum canal adicionado',
      'Adicione os canais do YouTube que você quer acompanhar. Apenas os vídeos deles aparecerão aqui.',
      '<a class="btn btn-primary" href="#/settings/canais">Adicionar canais</a>');
    return false;
  }
  if (!homeChannels().length) {
    status.innerHTML = emptyState('channels', 'Todos os canais estão como “Só lives”',
      'Eles aparecem só em “Ao Vivo”, quando estiverem transmitindo. Para ver vídeos aqui, desative “Só lives” em algum canal.',
      '<a class="btn btn-ghost" href="#/settings">Abrir os Ajustes</a>');
    return false;
  }
  if (!hasCredentials()) {
    status.innerHTML = emptyState('key', 'Falta configurar o acesso',
      'Entre com sua conta Google ou informe uma chave da YouTube Data API para carregar os vídeos.',
      '<a class="btn btn-primary" href="#/settings">Ir para os Ajustes</a>');
    return false;
  }
  return true;
}

function updateFeedStatus() {
  const feed = currentFeed();
  const status = $('#feed-status');
  if (feed.error) {
    status.innerHTML = emptyState('error', 'Não foi possível carregar os vídeos', esc(feed.error.message),
      '<button class="btn btn-ghost" type="button" data-action="retry-feed">Tentar novamente</button>');
  } else if (feed.exhausted && state.hideWatched && (feed.items.length ? feed.items.every(v => isWatched(v.id)) : Boolean(feed.hasVideos?.()))) {
    status.innerHTML = emptyState('channels', 'Você já assistiu tudo',
      'Todos os vídeos daqui foram assistidos até o fim. Clique no ícone de olho, no rodapé do menu lateral, para vê-los de novo.');
  } else if (feed.exhausted && !feed.items.length) {
    status.innerHTML = emptyState('channels', 'Nenhum vídeo encontrado',
      state.filter ? 'Este canal ainda não tem vídeos públicos.' : 'Os canais adicionados ainda não têm vídeos públicos.');
  } else if (feed.exhausted) {
    status.innerHTML = `<p>Você chegou ao fim. Esses são todos os vídeos ${state.filter ? 'deste canal' : 'dos seus canais'}.</p>`;
  } else {
    status.innerHTML = '';
  }
}

async function loadFeedPage() {
  if (state.view !== 'home' || !checkHomePrereqs()) return;
  const feed = currentFeed();
  if (feed.error || feed.uiBusy) return;
  if (feed.exhausted && !feed.loading) {
    syncGrid();
    updateFeedStatus();
    return;
  }

  feed.uiBusy = true;
  $('#feed-status').innerHTML = '';
  setSkeletons(true);
  try {
    await feed.loadMore();
  } catch (e) {
    if (!feed.dead) feed.error = e;
  }
  feed.uiBusy = false;
  if (feed.dead || feed !== currentFeed() || state.view !== 'home') return;
  setSkeletons(false);
  syncGrid();
  updateFeedStatus();
  // Se a tela ainda não foi preenchida, carrega mais um bloco.
  requestAnimationFrame(checkSentinel);
}

function checkSentinel() {
  if (state.view !== 'home' || !homeChannels().length) return;
  const feed = currentFeed();
  if (feed.error || feed.exhausted) return;
  const rect = $('#feed-sentinel').getBoundingClientRect();
  if (rect.top < innerHeight + 200) loadFeedPage();
}

function showHome() {
  const ch = state.filter ? channelById(state.filter) : null;
  document.title = ch ? `${ch.title} · Canais` : 'Início · Canais';
  renderHomeHead();
  renderHomeChips();
  renderFeedHeader();
  if (!checkHomePrereqs()) {
    $('#feed').innerHTML = '';
    gridFeed = null;
    renderedCount = 0;
    setSkeletons(false);
    return;
  }
  const feed = currentFeed();
  // Voltando de um vídeo: se algo foi assistido (olho escondendo) ou a lista foi remontada na
  // página do vídeo, remonta a grade sem animação; as posições continuam as mesmas.
  if (gridFeed === feed && (feedIsStale(feed) || gridGen !== feed.gen)) return rebuildFeed(feed);
  syncGrid();
  setSkeletons(feed.uiBusy);
  updateFeedStatus();
  if (!feed.exhausted) requestAnimationFrame(checkSentinel);
}

/* =========================================================
   Ao Vivo e Canais (páginas; no celular, abas)
   ========================================================= */
function liveTileHTML(v, i) {
  const ch = channelById(v.channelId);
  const viewers = v.viewers != null ? `${compact.format(Number(v.viewers))} assistindo` : '';
  return `
    <a class="tile" href="#/watch/${v.id}" data-vid="${v.id}" style="--i:${i}">
      <div class="thumb">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" decoding="async">
        <span class="badge badge-live">AO VIVO</span>
      </div>
      <div class="tile-info">
        <img class="avatar" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
        <div>
          <h3 class="tile-title" title="${esc(v.title)}">${esc(v.title)}</h3>
          <p class="tile-channel">${esc(v.channelTitle)}</p>
          ${viewers ? `<p class="tile-meta"><span class="viewers">${esc(viewers)}</span></p>` : ''}
        </div>
      </div>
    </a>`;
}

function renderLivePage() {
  const box = $('#live-list');
  if (!box) return;
  if (Lives.items.length) {
    box.innerHTML = Lives.items.map(liveTileHTML).join('');
    return;
  }
  const text = !state.channels.length
    ? 'Adicione canais para ver quando eles estiverem transmitindo.'
    : Lives.error ? 'Não foi possível verificar as lives agora. O app tenta de novo daqui a pouco.'
    : Lives.checked ? 'Quando um dos seus canais entrar ao vivo, ele aparece aqui.' : 'Procurando lives nos seus canais…';
  box.innerHTML = `<div class="live-empty">${emptyState('channels', Lives.checked || Lives.error ? 'Nenhum canal ao vivo agora' : 'Verificando as lives', text)}</div>`;
}

function renderChannelsPage() {
  const box = $('#channels-page');
  if (!box) return;
  const q = searchText($('#channels-search')?.value.trim() || '');
  const fresh = newCountsByChannel();
  const list = [...homeChannels()].sort((a, b) => byName(a.title, b.title))
    .filter(c => !q || searchText(c.title).includes(q) || searchText(c.handle || '').includes(q));
  const lives = Lives.items.filter(v => !q || searchText(v.title).includes(q) || searchText(v.channelTitle).includes(q));
  const live = lives.length ? `
    <h2 class="grp-title live-title">Ao vivo agora</h2>
    <div class="group">
      ${lives.map(v => `
        <a class="row row-link live-row" href="#/watch/${v.id}" data-vid="${v.id}">
          <span class="thumb"><img src="${esc(v.thumbSmall || v.thumb)}" alt="" loading="lazy"></span>
          <span class="grow"><b>${esc(v.title)}</b><span class="sub">${esc(v.channelTitle)}${v.viewers != null ? ` · ${compact.format(Number(v.viewers))} assistindo` : ''}</span></span>
        </a>`).join('')}
    </div>` : '';
  const rows = list.map(c => {
    const n = fresh.get(c.id) || 0;
    const sub = [n ? `<b>${n} ${n === 1 ? 'novo' : 'novos'}</b>` : '', esc(subscribersText(c.id) || c.handle || '')].filter(Boolean).join(' · ');
    return `
      <a class="row row-link ch-row" href="#/c/${esc(c.id)}" data-channel-row="${esc(c.id)}">
        <img src="${esc(c.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
        <span class="grow"><b>${esc(c.title)}</b><span class="sub">${sub}</span></span>
        ${SF('chev-r', 'ic chev')}
      </a>`;
  }).join('');
  box.innerHTML = `${live}
    <h2 class="grp-title"${live ? ' style="margin-top:26px"' : ''}>Seus canais · ${list.length}</h2>
    <div class="group">${rows || `<p class="channel-empty">${q ? 'Nenhum canal com esse nome.' : 'Nenhum canal adicionado ainda.'} <a class="link-btn" href="#/settings/canais">Adicionar canais</a></p>`}</div>`;
}

/* =========================================================
   Menu lateral (lista de canais)
   ========================================================= */
const overlayQuery = matchMedia('(max-width: 1099px)'); // janelas estreitas e celular: abas em vez do menu lateral

/** Vídeos "Novo" (de hoje e nunca abertos) de cada canal, entre os já carregados no Início. */
function newCountsByChannel() {
  const counts = new Map();
  for (const v of feeds.get('all')?.items || []) {
    if (isNewVideo(v)) counts.set(v.channelId, (counts.get(v.channelId) || 0) + 1);
  }
  return counts;
}

function renderSidebar() {
  const box = $('#side-channels');
  const list = [...homeChannels()].sort((a, b) => byName(a.title, b.title));
  const fresh = newCountsByChannel();
  box.innerHTML = list.length
    ? list.map(c => `
        <a class="side-item" href="#/c/${esc(c.id)}" data-channel="${esc(c.id)}" title="${esc(c.title)}">
          <img class="side-avatar" src="${esc(c.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
          <span class="side-label">${esc(c.title)}</span>
          ${fresh.get(c.id) ? `<span class="side-new" title="${fresh.get(c.id)} ${fresh.get(c.id) === 1 ? 'vídeo novo' : 'vídeos novos'}"></span>` : ''}
        </a>`).join('')
    : state.channels.length
    ? '<p class="side-empty">Todos os canais estão como “Só lives”.</p>'
    : `<a class="side-item" href="#/settings/canais" title="Adicionar canais">
         <span class="side-icon">${SF('plus')}</span>
         <span class="side-label">Adicionar canais</span>
       </a>`;
  updateSidebarActive();
  applySearch();
  if (state.view === 'channels') renderChannelsPage();
  if (state.view === 'home') renderHomeChips();
}

function updateSidebarActive() {
  const active = state.view === 'home' ? (state.filter || '') : null;
  $$('#sidebar [data-channel]').forEach(a => a.classList.toggle('active', a.dataset.channel === active));
  $$('#sidebar .side-nav [data-nav]:not([data-channel]), #sidebar .side-footer [data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === state.view));
  const watching = state.view === 'watch' ? state.currentVideoId : null;
  $$('#side-lives [data-vid]').forEach(a => a.classList.toggle('active', a.dataset.vid === watching));
  updateTabbar();
}

/** Abas (celular): marca a seção atual e desliza a pílula até ela. */
function updateTabbar() {
  const bar = $('#tabbar');
  if (!bar) return;
  const tab = state.view === 'watch' ? (mini.on ? null : 'home') : state.view === 'home' ? (state.filter ? 'channels' : 'home') : state.view;
  let on = null;
  bar.querySelectorAll('.tab').forEach(t => {
    const hit = t.dataset.tab === tab;
    t.classList.toggle('on', hit);
    if (hit) { on = t; t.setAttribute('aria-current', 'page'); } else t.removeAttribute('aria-current');
  });
  const pill = bar.querySelector('.tab-pill');
  if (!on || getComputedStyle(bar).display === 'none') { pill.style.opacity = on ? '' : '0'; return; }
  const place = () => {
    pill.style.opacity = '';
    pill.style.left = `${on.offsetLeft}px`;
    pill.style.width = `${on.offsetWidth}px`;
  };
  if (!bar.classList.contains('ready')) {
    pill.style.transition = 'none';
    place();
    void pill.offsetWidth;
    pill.style.transition = '';
    bar.classList.add('ready');
  } else place();
}

/* =========================================================
   Lives ativas (metade de baixo do menu lateral)
   =========================================================
   Só com o menu lateral expandido e o app visível, a cada 5 minutos.
   Para gastar quase nada de cota:
     • RSS: o servidor de login (Worker) lê o RSS público dos canais
       (os 15 vídeos mais recentes de cada; sem cota) e o app só
       pergunta ao YouTube sobre o que ainda não conhece, mais as lives
       e estreias em andamento (para saber quando começam e acabam);
     • vídeos já conhecidos (vídeos comuns, lives que acabaram) não são
       perguntados de novo;
     • parado há 20 min (sem mouse, teclado ou toque, e nada tocando),
       não verifica; ao voltar, verifica na hora.
   Método completo (a playlist de lives de cada canal, UULV…, 1 de cota
   por canal): na 1ª verificação de cada abertura (acha lives longas que
   já estavam no ar e não aparecem mais no RSS), a cada 30 min como rede
   de segurança, e como contorno quando o RSS falha (só no canal que
   falhou) ou o Worker não responde/é antigo (todos). Canais que nunca
   fizeram live são lembrados e só conferidos de novo a cada 12 h.
   ========================================================= */
const LIVE_REFRESH_MS = 5 * 60 * 1000;
const LIVE_FULL_MS = 30 * 60 * 1000;      // rede de segurança: método completo
const NO_LIVES_RECHECK_MS = 12 * 60 * 60 * 1000;
const LIVE_KNOWN_MAX = 6000;
const IDLE_MS = 20 * 60 * 1000;
const Lives = { items: [], loading: false, checked: false, lastFetch: 0, lastFull: 0, error: null, gen: 0, watch: new Set() };
const liveKnown = new Set(store.get(KEYS.liveKnown, []));
const noLives = store.get(KEYS.noLives, {});

/* Parado: sem mouse, teclado, toque ou rolagem há 20 min e nada tocando. */
let lastActivity = Date.now();
function isIdle() {
  return Date.now() - lastActivity > IDLE_MS && !((state.view === 'watch' || mini.on) && isPlaying());
}
function noteActivity() {
  const wasIdle = Date.now() - lastActivity > IDLE_MS;
  lastActivity = Date.now();
  if (wasIdle) refreshLives(); // voltou: verifica na hora (se a última tiver mais de 5 min)
}

/** RSS dos canais pelo Worker (até 50 por pedido). Retorna { canal: { ok, videos } } ou lança erro. */
async function fetchChannelFeeds(ids) {
  const server = Auth.server();
  if (!server) throw new Error('sem servidor de login');
  const feeds = {};
  for (let i = 0; i < ids.length; i += 50) {
    const res = await fetch(`${server}/rss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels: ids.slice(i, i + 50) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.feeds) throw new Error(`RSS: erro ${res.status}`); // Worker antigo responde 404
    Object.assign(feeds, data.feeds);
  }
  return feeds;
}

/** Método completo: a playlist de lives de cada canal (1 de cota por canal). */
async function livePlaylistIds(channels) {
  const now = Date.now();
  let changed = false;
  const lists = await Promise.all(channels.map(c => {
    if (noLives[c.id] && now - noLives[c.id] < NO_LIVES_RECHECK_MS) return []; // nunca fez live: confere a cada 12 h
    return api('playlistItems', { part: 'contentDetails', playlistId: `UULV${c.id.slice(2)}`, maxResults: 10 })
      .then(d => {
        if (noLives[c.id]) { delete noLives[c.id]; changed = true; }
        return (d.items || []).map(it => it.contentDetails?.videoId).filter(Boolean);
      })
      .catch(e => {
        if (e.status !== 404) throw e;
        noLives[c.id] = now; // 404: o canal nunca fez live
        changed = true;
        return [];
      });
  }));
  if (changed) store.set(KEYS.noLives, noLives);
  return lists.flat();
}

async function refreshLives(force = false) {
  if (!state.channels.length || !hasCredentials()) {
    Object.assign(Lives, { items: [], checked: true, error: null });
    renderLives();
    return;
  }
  // Economia de cota: só verifica com o menu lateral expandido, o app visível e você por perto.
  // Com o menu recolhido, nunca verifica; um pedido "forçado" (ex.: canais mudaram) fica para depois.
  if (!isSidebarExpanded() || document.visibilityState !== 'visible' || isIdle()) {
    if (force) Lives.lastFetch = 0;
    return;
  }
  if (Lives.loading) return;
  if (!force && Date.now() - Lives.lastFetch < LIVE_REFRESH_MS - 5000) return;

  Lives.loading = true;
  const gen = ++Lives.gen;
  try {
    const channels = state.channels;
    let full = force || !Lives.lastFull || Date.now() - Lives.lastFull >= LIVE_FULL_MS - 5000;
    let ids = [];
    if (!full) {
      let feeds = null;
      try {
        feeds = await fetchChannelFeeds(channels.map(c => c.id));
      } catch {
        full = true; // Worker fora do ar, com erro ou antigo: método completo para todos
      }
      if (feeds) {
        const failed = channels.filter(c => !feeds[c.id]?.ok);
        ids = channels.flatMap(c => feeds[c.id]?.ok ? feeds[c.id].videos.map(v => v.id) : []);
        if (failed.length) ids.push(...await livePlaylistIds(failed)); // RSS falhou: só esses canais
      }
    }
    if (full) ids = await livePlaylistIds(channels);
    // Pergunta só o que não se conhece, mais as lives e estreias em andamento (para ver se começaram/acabaram).
    const ask = [...new Set([...ids.filter(id => !liveKnown.has(id)), ...Lives.watch])];
    const details = ask.length ? await fetchVideos(ask) : new Map();
    if (gen !== Lives.gen) return;
    const watch = new Set();
    for (const id of ask) {
      const v = details.get(id);
      if (v && (v.live === 'live' || v.live === 'upcoming')) watch.add(id);
      else liveKnown.add(id); // vídeo comum, live que acabou, removido ou de fora: não pergunta de novo
    }
    if (liveKnown.size > LIVE_KNOWN_MAX) {
      const keep = [...liveKnown].slice(-LIVE_KNOWN_MAX);
      liveKnown.clear();
      keep.forEach(id => liveKnown.add(id));
    }
    store.set(KEYS.liveKnown, [...liveKnown]);
    Lives.watch = watch;
    Lives.items = [...details.values()]
      .filter(v => v.live === 'live' && !v.blocked)
      .sort((a, b) => byName(channelById(a.channelId)?.title || a.channelTitle, channelById(b.channelId)?.title || b.channelTitle));
    Lives.error = null;
    Lives.lastFetch = Date.now();
    if (full) Lives.lastFull = Lives.lastFetch;
  } catch (e) {
    if (gen === Lives.gen) Lives.error = e;
  } finally {
    if (gen === Lives.gen) {
      Lives.loading = false;
      Lives.checked = true;
      renderLives();
    }
  }
}

function renderLives() {
  const box = $('#side-lives');
  $('#lives-count').textContent = Lives.items.length || '';
  const dot = $('#tabbar .tab-dot');
  if (dot) dot.hidden = !Lives.items.length;
  if (Lives.items.length) {
    box.innerHTML = Lives.items.map(v => {
      const ch = channelById(v.channelId);
      const viewers = v.viewers != null ? compact.format(Number(v.viewers)) : '';
      return `
        <a class="side-item side-live" href="#/watch/${v.id}" data-vid="${v.id}"
           title="${esc(`${v.channelTitle} — ${v.title}${viewers ? ` (${viewers} assistindo)` : ''}`)}">
          <span class="live-avatar">
            <img class="side-avatar" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
          </span>
          <span class="side-label">
            <span class="side-live-title">${esc(v.title)}</span>
            <span class="side-live-name">${esc(v.channelTitle)}</span>
          </span>
          ${viewers ? `<span class="side-live-viewers">${viewers}</span>` : ''}
          <span class="live-dot"></span>
        </a>`;
    }).join('');
  } else if (!state.channels.length) {
    box.innerHTML = '';
  } else if (Lives.error) {
    box.innerHTML = '<p class="side-empty">Não foi possível verificar as lives.</p>';
  } else {
    box.innerHTML = Lives.checked ? '' : '<p class="side-empty">Verificando as lives…</p>';
  }
  updateSidebarActive();
  if (state.view === 'live') renderLivePage();
  if (state.view === 'channels') renderChannelsPage();
}

/** Modo Cinema na tela agora (página do vídeo no computador, com o modo ligado). */
function cinemaActive() {
  return state.view === 'watch' && !mini.on && !overlayQuery.matches && theaterActive();
}

/** Computador: o menu de vidro fica sempre ao lado do conteúdo, expandido ou recolhido (só ícones);
 *  no Modo Cinema ele some e o botão do menu o traz por cima. Janelas estreitas e celular: abas. */
function updateSidebarMode() {
  const compactLayout = overlayQuery.matches;
  const cinema = cinemaActive();
  const body = document.body;
  body.classList.toggle('sidebar-overlay', compactLayout);
  body.classList.toggle('sidebar-mini', !compactLayout && !cinema && state.sidebarMini);
  body.classList.toggle('sidebar-hidden', cinema);
  body.classList.toggle('cinema-side', cinema && state.pageSidebar);
  body.classList.toggle('cinema', cinema);
  body.classList.toggle('watching', state.view === 'watch');
  $('#menu-btn').setAttribute('aria-expanded', String(isSidebarExpanded()));
  // Lives visíveis (menu expandido ou páginas Ao Vivo/Canais): verifica na hora se a última tiver mais de 5 min.
  if (isSidebarExpanded()) refreshLives();
}

/** As lives estão à vista: menu lateral expandido (computador) ou as páginas Ao Vivo e Canais. */
function isSidebarExpanded() {
  if (state.view === 'live' || state.view === 'channels') return true;
  if (overlayQuery.matches) return false;
  return cinemaActive() ? state.pageSidebar : !state.sidebarMini;
}

function toggleSidebar() {
  if (overlayQuery.matches) return;
  if (cinemaActive()) {
    state.pageSidebar = !state.pageSidebar;
  } else {
    state.sidebarMini = !state.sidebarMini;
    store.set(KEYS.sidebar, state.sidebarMini);
  }
  updateSidebarMode();
  requestAnimationFrame(checkSentinel);
}

/** Modo Cinema com o menu aberto por cima: fecha ao navegar ou tocar fora. */
function closeSidebarOverlay() {
  if (!state.pageSidebar) return;
  state.pageSidebar = false;
  updateSidebarMode();
}

/* =========================================================
   Progresso dos vídeos (salvo neste navegador)
   =========================================================
   O Google não permite que apps de terceiros leiam ou gravem o
   histórico do YouTube, então o ponto onde você parou fica no
   localStorage, como { segundos, duração, concluído }.
   ========================================================= */
const PROGRESS_MIN_SECONDS = 10;   // antes disso não vale a pena retomar
const PROGRESS_END_SECONDS = 20;   // nos últimos 20 s (ou 95%) conta como assistido
const PROGRESS_MAX_ENTRIES = 1000;
const progressStore = store.get(KEYS.progress, {});

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/*
 * Cada registro de progresso: { t: ponto onde parou (0 = nenhum), d: duração, done, at }.
 * "done" (assistido) é uma marca permanente: rever o vídeo não a apaga. Assim um vídeo já
 * assistido continua oculto pelo "Ocultar assistidos", mas ainda lembra onde você parou.
 */
function progressPercent(id) {
  const p = progressStore[id];
  if (!p || p.gone) return 0;
  if (p.t > 0) return Math.min(100, (p.t / p.d) * 100); // assistindo (ou revendo): ponto atual
  return p.done ? 100 : 0;
}

function resumeTime(id) {
  const p = progressStore[id];
  return p && !p.gone && p.t > 0 ? Math.max(0, p.t - 3) : 0; // volta 3 s para retomar o contexto
}

function recordProgress(id, t, d, done = false) {
  if (!id || !d || !Number.isFinite(d)) return;
  const prev = progressStore[id];
  const wasWatched = Boolean(prev?.done && !prev.gone);
  if (done || t >= d - PROGRESS_END_SECONDS || t / d >= 0.95) {
    progressStore[id] = { t: 0, d: Math.round(d), done: true, at: Date.now() };
    logCompletion(id);
  } else if (t >= PROGRESS_MIN_SECONDS) {
    // Rever um vídeo assistido mantém a marca de assistido.
    progressStore[id] = { t: Math.floor(t), d: Math.round(d), ...(wasWatched && { done: true }), at: Date.now() };
  } else if (prev && !prev.gone && prev.t > 0) {
    // Voltou para o início: esquece o ponto salvo (mas não a marca de assistido). Sem a marca,
    // fica um registro "apagado" para a sincronização levar o esquecimento aos outros aparelhos.
    progressStore[id] = wasWatched ? { t: 0, d: prev.d, done: true, at: Date.now() } : { gone: true, at: Date.now() };
  } else {
    return;
  }
  const ids = Object.keys(progressStore);
  if (ids.length > PROGRESS_MAX_ENTRIES) {
    ids.sort((a, b) => progressStore[a].at - progressStore[b].at)
      .slice(0, ids.length - PROGRESS_MAX_ENTRIES)
      .forEach(k => delete progressStore[k]);
  }
  store.set(KEYS.progress, progressStore);
  updateProgressBars(id);
  Sync.schedule(SYNC_PROGRESS_MS);
}

function progressBarHTML(id) {
  const pct = progressPercent(id);
  return pct ? `<div class="watch-progress" aria-hidden="true"><span style="width:${pct.toFixed(1)}%"></span></div>` : '';
}

function isWatched(id) {
  return Boolean(progressStore[id]?.done);
}

/** Muda sempre que um vídeo passa a contar como assistido (aqui ou vindo de outro aparelho). */
function watchedSignature() {
  let n = 0;
  for (const id in progressStore) if (progressStore[id]?.done) n++;
  return n;
}

function updateProgressBars(id) {
  $$(`[data-vid="${id}"] .thumb`).forEach(thumb => {
    thumb.querySelector('.watch-progress')?.remove();
    thumb.insertAdjacentHTML('beforeend', progressBarHTML(id));
  });
  $$(`.tile[data-vid="${id}"], .mini[data-vid="${id}"]`).forEach(el => el.classList.toggle('is-watched', isWatched(id)));
}

/* =========================================================
   Ocultar assistidos
   =========================================================
   Esconde (sem reordenar) os vídeos assistidos até o fim; os "em
   progresso" e os não assistidos continuam. Na página inicial é só
   CSS (body.hide-watched), então ligar/desligar é instantâneo; em
   "A seguir" e na reprodução automática eles são pulados.
   ========================================================= */
const EYE_ICONS = {
  on: SF('eye-off'),
  off: SF('eye'),
};

function applyHideWatched() {
  const on = state.hideWatched;
  document.body.classList.toggle('hide-watched', on);
  const btn = $('#watched-toggle');
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on
    ? 'Assistidos ocultos (mostrando só os não assistidos e em progresso). Clique para mostrar todos.'
    : 'Ocultar os vídeos que você já assistiu até o fim';
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = `${on ? EYE_ICONS.on : EYE_ICONS.off}<span class="label">${on ? 'Assistidos ocultos' : 'Ocultar assistidos'}</span>`;
  $$('input[data-setting="hide-watched"]').forEach(i => { i.checked = on; });
}

function toggleHideWatched() {
  const run = () => {
    state.hideWatched = !state.hideWatched;
    store.set(KEYS.hideWatched, state.hideWatched);
    Sync.touch('prefs');
    applyHideWatched();
    pop($('#watched-toggle'));
    if (state.view === 'home') {
      if (feedIsStale(currentFeed())) {
        // Rodadas: as vagas ficam; com o olho escondendo, cada uma recebe o próximo não assistido do canal.
        rebuildFeed(currentFeed(), { animate: true });
        return;
      }
      updateFeedStatus();
      requestAnimationFrame(checkSentinel); // se sobrou pouco na tela, carrega mais
    } else if (state.view === 'watch' && state.currentVideo) {
      if (state.watchFeed instanceof FeedStream) state.watchFeed.restart();
      renderUpNext(state.currentVideo);
    }
  };
  // Rodadas ("Todos os canais", página do canal): a lista é remontada com animação (rebuildFeed).
  if (state.view === 'home' && currentFeed() instanceof FeedStream) { run(); return; }
  // "Mais antigos": os assistidos saem desfocando e os outros deslizam até o novo lugar (só os que estão na tela).
  const tiles = state.view === 'home' && motionOK() ? [...$$('#feed .tile')].filter(t => t.offsetParent && inViewport(t)) : [];
  if (!tiles.length) { run(); return; }
  const hiding = !state.hideWatched;
  const leaving = hiding ? tiles.filter(t => t.classList.contains('is-watched')) : [];
  const staying = tiles.filter(t => !leaving.includes(t));
  const rearrange = () => {
    const first = new Map(staying.map(t => [t, t.getBoundingClientRect()]));
    run();
    leaving.forEach(t => t.getAnimations().forEach(a => a.cancel()));
    staying.forEach((t, i) => {
      if (!t.offsetParent) return;
      t.style.animation = 'none';
      playFlip(t, first.get(t), { duration: 600, delay: Math.min(i, 12) * 12 });
    });
    if (!hiding) {
      let n = 0;
      $$('#feed .tile.is-watched').forEach(t => {
        if (!inViewport(t)) return;
        t.style.animation = 'none';
        focusIn(t, { delay: 120 + n++ * 30 });
      });
    }
  };
  if (!leaving.length) { rearrange(); return; }
  Promise.all(leaving.map((t, i) => focusOut(t, { delay: i * 15 }))).then(rearrange);
}

/** Salva o ponto atual do vídeo que está carregado no player. */
function videoForProgress(id) {
  return findLoadedVideo(id) || (state.currentVideo?.id === id ? state.currentVideo : null);
}

function saveProgress() {
  if (!playerVideoId || !player?.getCurrentTime) return;
  let t, d, loadedId, playerState;
  try {
    t = player.getCurrentTime();
    d = player.getDuration();
    loadedId = player.getVideoData?.()?.video_id;
    playerState = player.getPlayerState?.();
  } catch { return; }

  // Logo depois de trocar de vídeo (ex.: reprodução automática), o player do YouTube ainda
  // informa por um instante o vídeo, o tempo e a duração do ANTERIOR — que acabou de
  // terminar. Salvar nesse momento marcaria o vídeo novo como assistido. Por isso:
  if (loadedId && loadedId !== playerVideoId) return;                 // 1) o player ainda não trocou
  if (Date.now() - playerLoadedAt < 2000 && playerState !== window.YT?.PlayerState?.PLAYING) return; // 2) ainda carregando

  const video = videoForProgress(playerVideoId);
  if (video?.live === 'live' || video?.live === 'upcoming') return; // transmissão em andamento não tem "ponto"
  if (video?.durationSec) {
    d = video.durationSec;                                           // 3) duração da API, não a do player
    if (t > d + 5) return;                                           //    tempo maior que o vídeo = leitura do anterior
  }
  recordProgress(playerVideoId, t, d);
}

/* =========================================================
   Player do YouTube (IFrame API)
   ========================================================= */
let ytApiPromise = null;
let player = null;
let playerReady = null;
let playerVideoId = null; // vídeo realmente carregado no player (para salvar o progresso certo)
let playerLoadedAt = 0;   // quando o último vídeo foi carregado (o player demora a trocar os dados)

function loadYouTubeApi() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      ytApiPromise = null;
      reject(new Error('Não foi possível carregar o player do YouTube.'));
    };
    document.head.append(script);
  });
  return ytApiPromise;
}

async function playVideo(id) {
  let YT;
  try {
    YT = await loadYouTubeApi();
  } catch (e) {
    showPlayerError(e.message);
    return;
  }
  if (state.currentVideoId !== id || state.view !== 'watch') return;

  const start = Math.floor(resumeTime(id));
  if (!player) {
    playerVideoId = id;
    playerLoadedAt = Date.now();
    resetHealth(id);
    playerReady = new Promise(resolve => {
      player = new YT.Player('player', {
        videoId: id,
        // youtube.com (e não youtube-nocookie) para que a sessão do usuário
        // no YouTube — e os benefícios Premium, como não ter anúncios — se apliquem.
        host: 'https://www.youtube.com',
        playerVars: {
          autoplay: 1,
          rel: 0,             // ao final, sugestões apenas do mesmo canal
          modestbranding: 1,
          playsinline: 1,
          iv_load_policy: 3,
          controls: 0,        // sem os controles do YouTube: o app desenha os dele (#player-ui)
          disablekb: 1,       // os atalhos de teclado também são do app
          fs: 0,
          start,
          origin: location.origin,
        },
        events: {
          onReady: e => { onPlayerControlsReady(); e.target.playVideo(); resolve(); },
          onStateChange: onPlayerStateChange,
          onError: onPlayerError,
        },
      });
    });
    return;
  }
  await playerReady;
  if (state.currentVideoId !== id || state.view !== 'watch') return;
  if (playerVideoId && playerVideoId !== id) saveProgress();
  playerVideoId = id;
  playerLoadedAt = Date.now();
  resetHealth(id);
  player.loadVideoById({ videoId: id, startSeconds: start });
}

function onPlayerStateChange(e) {
  const S = window.YT.PlayerState;
  if (e.data === S.PLAYING && health.id === playerVideoId) health.played = true;
  onPlayerControlsState(e.data);
  if (e.data === S.PAUSED) saveProgress();
  if (e.data !== S.ENDED) return;
  // Aviso de "fim" atrasado do vídeo anterior, que chega logo depois da troca: ignora
  // (senão o vídeo novo seria marcado como assistido e pulado).
  const loadedId = player.getVideoData?.()?.video_id;
  if ((loadedId && loadedId !== playerVideoId) || Date.now() - playerLoadedAt < 2000) return;
  try {
    recordProgress(playerVideoId, 0, videoForProgress(playerVideoId)?.durationSec || player.getDuration(), true);
  } catch { /* ignora */ }
  if (!state.autoplay) return;
  const next = nextVideoAfter(state.currentVideo);
  if (mini.on) {
    if (next) miniPlay(next); // reprodução automática continua no mini player
    return;
  }
  if (state.view !== 'watch') return;
  if (next) location.hash = watchHref(next.id);
}

/** Vídeo que o player recusou: some do app (Início, página do canal, "A seguir", Estatísticas) e fica
    guardado. Com persist = false, some só até recarregar a página (falha que pode ser passageira). */
function markUnplayable(id, { persist = true } = {}) {
  if (persist && !unplayableSaved.has(id)) {
    unplayableSaved.add(id);
    store.set(KEYS.unplayable, [...unplayableSaved].slice(-3000));
  }
  if (unplayable.has(id) && !persist) return;
  unplayable.add(id);
  for (const feed of feeds.values()) {
    const i = feed.items.findIndex(v => v.id === id);
    if (i >= 0) {
      feed.items.splice(i, 1);
      if (gridFeed === feed && i < renderedCount) renderedCount--;
    }
    feed.sources?.forEach(s => s.list.forEach(it => { if (it.id === id) it.video = null; }));
  }
  $(`#feed .tile[data-vid="${id}"]`)?.remove();
  if (!persist) return; // nas Estatísticas, continua contando
  for (const catalog of channelCatalogs.values()) catalog.delete(id);
  const info = store.get(VIDEO_INFO_KEY, {});
  let touched = false;
  for (const ch of Object.values(info)) if (id in ch) { ch[id] = -3; touched = true; }
  if (touched) store.set(VIDEO_INFO_KEY, info);
}

/** O dono não deixa tocar fora do YouTube (ou o vídeo saiu do ar): sem mensagem, vai direto para o
    próximo de "A seguir" (sem voltar a ele pelo "voltar" do navegador). Sem próximo, volta. */
async function skipUnplayable(id, { persist = true } = {}) {
  const video = state.currentVideo?.id === id ? state.currentVideo : null;
  let next = video ? nextVideoAfter(video) : null;
  if (!next && video) {
    // "A seguir" ainda carregando (link direto, recarregou a página): espera mais uma página.
    try { await (state.watchFeed || currentFeed()).loadMore(); } catch { /* sem conexão */ }
    next = nextVideoAfter(video);
  }
  markUnplayable(id, { persist });
  if (mini.on && state.currentVideoId === id) {
    if (next) miniPlay(next);
    else closeMini();
    return;
  }
  if (state.view !== 'watch' || state.currentVideoId !== id) return;
  if (!next) {
    skipNonApp(id);
    return;
  }
  watchHistory.stack = watchHistory.stack.filter(x => x !== id);
  if (watchHistory.last === id) watchHistory.last = null;
  saveWatchHistory();
  replaceRoute(watchHref(next.id));
}

/* ---------- Vídeo que trava ou dá erro no meio ----------
   Às vezes o YouTube falha ao entregar um vídeo no meio (no próprio site também): o player mostra
   um erro — nem sempre avisando o app — e o vídeo fica parado. O app vigia: se o vídeo está
   "tocando" ou "carregando" e o tempo não anda por 15 s, ou se o player dá erro depois de já ter
   tocado, recarrega o vídeo do ponto em que estava (como atualizar a página). Falhando de novo,
   guarda o ponto e vai para o próximo de "A seguir"; o vídeo some até recarregar a página e só sai
   de vez se falhar em dois dias diferentes. A recusa logo de cara (o dono não permite fora do
   YouTube) continua tirando o vídeo do app na hora. Pausa e fim do vídeo nunca contam. */
const STALL_MS = 15_000;
const health = { id: null, lastT: 0, lastAt: 0, played: false, retried: new Set() };

function resetHealth(id) {
  Object.assign(health, { id, lastT: 0, lastAt: Date.now(), played: false });
}

function checkPlayerHealth() {
  const id = playerVideoId;
  const S = window.YT?.PlayerState;
  if (!id || !S || !player?.getPlayerState || !(state.view === 'watch' || mini.on) || state.currentVideoId !== id || document.hidden) {
    health.lastAt = Date.now();
    return;
  }
  if (health.id !== id) resetHealth(id);
  let st, t;
  try { st = player.getPlayerState(); t = player.getCurrentTime() || 0; } catch { return; }
  if (st === S.PLAYING) health.played = true;
  // Pausado, terminado ou esperando o clique no play (navegador bloqueou o início automático): não é falha.
  const stuckState = st === S.PLAYING || st === S.BUFFERING || (st === -1 && health.played);
  if (!stuckState || Math.abs(t - health.lastT) > 0.2) {
    health.lastT = t;
    health.lastAt = Date.now();
    return;
  }
  if (Date.now() - health.lastAt > STALL_MS) playbackFailed(id);
}

function playbackFailed(id) {
  if (state.currentVideoId !== id || playerVideoId !== id) return;
  const at = Math.max(health.lastT, resumeTime(id));
  if (!health.retried.has(id)) {
    // 1ª falha: recarrega do ponto em que estava.
    health.retried.add(id);
    resetHealth(id);
    health.lastT = at;
    playerLoadedAt = Date.now();
    player.loadVideoById({ videoId: id, startSeconds: Math.floor(at) });
    return;
  }
  // 2ª falha: guarda o ponto e vai para o próximo. Sai de vez só se falhar também em outro dia.
  const d = videoForProgress(id)?.durationSec || player.getDuration?.() || 0;
  if (health.lastT > 0 && d) recordProgress(id, health.lastT, d);
  const fails = store.get(KEYS.playFails, {});
  const today = dayKey();
  const f = fails[id] || { n: 0, day: '' };
  if (f.day !== today) fails[id] = { n: f.n + 1, day: today };
  const ids = Object.keys(fails);
  if (ids.length > 500) ids.sort((a, b) => fails[a].day.localeCompare(fails[b].day)).slice(0, ids.length - 500).forEach(k => delete fails[k]);
  store.set(KEYS.playFails, fails);
  resetHealth(null);
  skipUnplayable(id, { persist: fails[id].n >= 2 });
}

function onPlayerError(e) {
  const id = state.currentVideoId;
  if (!id) return;
  // Recusa logo de cara num vídeo que nunca tocou aqui (2 = identificador inválido; 100 = removido/
  // privado; 101/150 = o dono não permite fora do YouTube): sai do app. Se já tocou (agora, ou tem
  // ponto salvo de antes), é falha de entrega do YouTube: recupera em vez de descartar.
  const playedHere = (health.id === id && health.played) || health.retried.has(id) || progressStore[id]?.t > 0 || progressStore[id]?.done;
  if ([2, 100, 101, 150].includes(e.data) && !playedHere) {
    skipUnplayable(id);
    return;
  }
  playbackFailed(id); // sem mensagem: tenta de novo e, se preciso, segue para o próximo
}

function showPlayerError(message, action = '') {
  const box = $('#player-error');
  box.innerHTML = `<p>${esc(message)}</p>${action ? `<div>${action}</div>` : ''}`;
  box.hidden = false;
}

function pausePlayer() {
  saveProgress();
  try { player?.pauseVideo?.(); } catch { /* player ainda não pronto */ }
}

function seekTo(seconds) {
  if (!player?.seekTo) return;
  player.seekTo(seconds, true);
  player.playVideo();
  $('.player-wrap').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
}

/* =========================================================
   Controles do player (desenhados pelo app)
   =========================================================
   Os controles do YouTube ficam desligados (controls: 0) e o app
   desenha os dele por cima do vídeo, usando os comandos oficiais do
   player: play/pause, volume, tempo, barra de progresso, reprodução
   automática, legendas, velocidade e tela cheia. Como tudo fica numa
   camada do app, nenhum menu fica "atrás" de nada.

   • Mouse: clique pausa/continua; clique duplo entra/sai da tela cheia.
   • Toque: toque mostra/esconde os controles (no centro, pausa/continua);
     toque duplo nas laterais volta/avança 10 s; no centro, tela cheia.
   • Teclado: espaço/K, F, ←/→ (5 s), J/L (10 s), ↑/↓ (volume), M, C.

   Legendas usam um comando não documentado do YouTube (módulo
   "captions"): funciona hoje, mas pode parar se o YouTube mudar.
   A qualidade é escolhida pelo YouTube; o app só a mostra.
   ========================================================= */
const ICON = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}><path d="${d}"/></svg>`;
// "Gostei" dos comentários: polegar só com o contorno, como no YouTube.
const LIKE_ICON = SF('thumb');
const PLAY_ICONS = {
  play: SF('play'),
  pause: SF('pause'),
  replay: SF('replay'),
};
const SKIP_ICONS = {
  prev: SF('prev'),
  next: SF('next'),
};
const VOL_ICONS = {
  high: SF('vol'),
  low: SF('vol-low'),
  muted: SF('vol-off'),
};
const CC_ICON = SF('cc');
const GEAR_ICON = SF('sliders');
const MENU_ICONS = {
  speed: SF('timer'),
  cc: CC_ICON,
  quality: SF('film'),
  back: SF('chev-l'),
  check: SF('check'),
  cinema: SF('theater'),
  pip: SF('pip'),
  link: SF('copy'),
  channel: SF('person'),
};
const FS_ICONS = {
  enter: SF('expand'),
  exit: SF('collapse'),
};
const QUALITY_LABELS = {
  highres: ['Máxima', '8K'], hd2880: ['2880p', '5K'], hd2160: ['2160p', '4K'], hd1440: ['1440p', 'HD'],
  hd1080: ['1080p', 'HD'], hd720: ['720p', 'HD'], large: ['480p', ''], medium: ['360p', ''], small: ['240p', ''], tiny: ['144p', ''],
};

/** Preferências do player guardadas neste aparelho: volume, mudo, legendas. */
const playerPrefs = { volume: 100, muted: false, cc: false, ccLang: 'pt', ...store.get(KEYS.player, {}) };
const savePlayerPrefs = () => store.set(KEYS.player, playerPrefs);
let playbackRate = 1;       // vale para os próximos vídeos desta sessão
let ccAppliedFor = null;    // vídeo em que as legendas já foram aplicadas
let draggingProgress = false;

function isPlaying() {
  const S = window.YT?.PlayerState;
  const st = player?.getPlayerState?.();
  return Boolean(S) && (st === S.PLAYING || st === S.BUFFERING);
}

/** Ícone que aparece e some no centro do vídeo, como no YouTube. */
function flashPlayerIcon(kind, text = '') {
  const overlay = $('#player-overlay');
  overlay.querySelector('.player-flash')?.remove();
  overlay.insertAdjacentHTML('beforeend',
    `<span class="player-flash${text ? ' player-flash-text' : ''}">${text ? esc(text) : PLAY_ICONS[kind]}</span>`);
  overlay.querySelector('.player-flash').addEventListener('animationend', e => e.target.remove(), { once: true });
}

// O player real do YouTube demora um instante para informar que pausou/voltou a tocar.
// Guardamos o último comando para não ler um estado desatualizado em toques seguidos.
let lastPlayCommand = { at: 0, playing: false };

function togglePlay() {
  if (!player?.getPlayerState) return;
  const recent = Date.now() - lastPlayCommand.at < 800;
  const playing = recent ? lastPlayCommand.playing : isPlaying();
  lastPlayCommand = { at: Date.now(), playing: !playing };
  if (playing) {
    player.pauseVideo();
    flashPlayerIcon('pause');
  } else {
    player.playVideo();
    flashPlayerIcon('play');
  }
  updatePlayButton(!playing);
  pokeControls();
}

function togglePlayerFullscreen() {
  const wrap = $('.player-wrap');
  const current = document.fullscreenElement;
  if (current && (current === wrap || wrap.contains(current))) document.exitFullscreen?.();
  else wrap.requestFullscreen?.().catch(() => { /* navegador recusou */ });
}

function seekBy(delta) {
  if (!player?.getCurrentTime) return;
  player.seekTo(Math.max(0, player.getCurrentTime() + delta), true);
  pokeControls();
  updateProgressUI();
}

/* ---------- Visibilidade dos controles ---------- */
let controlsTimer = 0;
let pointerOnBar = false;

function setControlsVisible(visible) {
  $('.player-wrap').classList.toggle('pc-hidden', !visible);
}

/* ---------- Anterior / Próximo ---------- */
// "Próximo" toca o primeiro vídeo de "A seguir". "Anterior" volta ao último vídeo assistido
// antes deste (vale para esta aba, mesmo passando pelo Início; recarregar não apaga).
const WATCH_HISTORY_KEY = 'meutube.watchHistory';
const WATCH_HISTORY_MAX = 50;
const watchHistory = (() => {
  try { return { stack: [], last: null, ctx: {}, ...JSON.parse(sessionStorage.getItem(WATCH_HISTORY_KEY)) }; } catch { return { stack: [], last: null, ctx: {} }; }
})();
let goingBack = false;

function saveWatchHistory() {
  try { sessionStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(watchHistory)); } catch { /* sem sessionStorage */ }
}

/** Chamado quando um vídeo (já conferido como de um canal seu) começa a ser exibido. */
function recordWatchHistory(id) {
  if (goingBack) goingBack = false;
  else if (watchHistory.last && watchHistory.last !== id) {
    watchHistory.stack.push(watchHistory.last);
    watchHistory.stack = watchHistory.stack.slice(-WATCH_HISTORY_MAX);
  }
  watchHistory.last = id;
  // Filtro em que cada vídeo foi visto ("Anterior" volta para ele com os mesmos vídeos seguintes).
  watchHistory.ctx[id] = watchContext();
  const keep = new Set([...watchHistory.stack, id]);
  for (const k of Object.keys(watchHistory.ctx)) if (!keep.has(k)) delete watchHistory.ctx[k];
  saveWatchHistory();
  updateSkipButtons();
}

function previousVideoId() {
  return watchHistory.stack.findLast(id => id !== state.currentVideoId) || null;
}

function playPrevious() {
  const id = previousVideoId();
  if (!id) return;
  while (watchHistory.stack.length && watchHistory.stack.at(-1) !== id) watchHistory.stack.pop();
  watchHistory.stack.pop();
  saveWatchHistory();
  goingBack = true;
  location.hash = watchHref(id, watchHistory.ctx[id] ?? watchContext());
}

function playNext() {
  const next = nextVideoAfter(state.currentVideo);
  if (next) location.hash = watchHref(next.id);
}

function updateSkipButtons() {
  const set = (btn, enabled, label) => {
    btn.disabled = !enabled;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  const next = nextVideoAfter(state.currentVideo);
  set($('#pc-prev'), Boolean(previousVideoId()), previousVideoId() ? 'Anterior (Shift+P)' : 'Nenhum vídeo anterior');
  set($('#pc-next'), Boolean(next), next ? `Próximo: ${next.title} (Shift+N)` : 'Nenhum vídeo seguinte');
}

/* ---------- Faixa de título (em cima do vídeo) ---------- */
// O YouTube desenha o título dele dentro do vídeo quando pausa e por alguns segundos ao
// voltar a tocar. Nesses momentos a faixa do app fica escondida, para não aparecerem dois.
const YT_TITLE_MS = 3500;
let ytTitleTimer = 0;

function setYouTubeTitleShowing(showing) {
  $('.player-wrap').classList.toggle('yt-title', showing);
}

function renderPlayerTitle(v) {
  const ch = channelById(v.channelId);
  $('#pc-top').innerHTML = `
    <img class="pc-top-avatar" src="${esc(ch?.thumb || '')}" alt="" referrerpolicy="no-referrer" data-hide-broken>
    <div class="pc-top-text">
      <div class="pc-top-title">${esc(v.title)}</div>
      <div class="pc-top-channel">${esc(v.channelTitle)}</div>
    </div>`;
}

/** Mostra os controles e agenda o sumiço (só enquanto toca, sem menu aberto e sem o mouse na barra). */
function pokeControls() {
  setControlsVisible(true);
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    if (isPlaying() && !pointerOnBar && $('#pc-menu').hidden && !draggingProgress) setControlsVisible(false);
  }, 2500);
}

/* ---------- Estado visual da barra ---------- */
function updatePlayButton(playing = isPlaying()) {
  const S = window.YT?.PlayerState;
  const ended = S && player?.getPlayerState?.() === S.ENDED;
  const btn = $('#pc-play');
  btn.innerHTML = ended ? PLAY_ICONS.replay : (playing ? PLAY_ICONS.pause : PLAY_ICONS.play);
  btn.title = playing ? 'Pausar (k)' : 'Reproduzir (k)';
  btn.setAttribute('aria-label', btn.title);
  if (!playing) setControlsVisible(true);
}

function updateVolumeUI() {
  const muted = player?.isMuted?.() ?? playerPrefs.muted;
  const volume = player?.getVolume?.() ?? playerPrefs.volume;
  const btn = $('#pc-mute');
  btn.innerHTML = muted || volume === 0 ? VOL_ICONS.muted : volume < 50 ? VOL_ICONS.low : VOL_ICONS.high;
  btn.title = muted ? 'Ativar o som (m)' : 'Desativar o som (m)';
  btn.setAttribute('aria-label', btn.title);
  const slider = $('#pc-volume');
  slider.value = muted ? 0 : volume;
  slider.style.setProperty('--fill', `${muted ? 0 : volume}%`);
}

function setVolume(value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  player?.setVolume?.(v);
  if (v > 0) player?.unMute?.(); else player?.mute?.();
  playerPrefs.volume = v || playerPrefs.volume;
  playerPrefs.muted = v === 0;
  savePlayerPrefs();
  updateVolumeUI();
}

function toggleMute() {
  if (!player?.isMuted) return;
  if (player.isMuted()) {
    player.unMute();
    if (!player.getVolume?.()) player.setVolume?.(playerPrefs.volume || 50);
  } else {
    player.mute();
  }
  playerPrefs.muted = !playerPrefs.muted;
  savePlayerPrefs();
  setTimeout(updateVolumeUI, 50);
  pokeControls();
}

function updateAutoplayButton() {
  const btn = $('#pc-autoplay');
  btn.setAttribute('aria-checked', String(state.autoplay));
  btn.title = state.autoplay ? 'Reprodução automática ativada' : 'Reprodução automática desativada';
  btn.setAttribute('aria-label', btn.title);
}

function toggleAutoplay({ quiet = false } = {}) {
  state.autoplay = !state.autoplay;
  store.set(KEYS.autoplay, state.autoplay);
  Sync.touch('prefs');
  updateAutoplayButton();
  $$('input[data-setting="autoplay"]').forEach(i => { i.checked = state.autoplay; });
  if (quiet) return;
  pop($('#pc-autoplay'));
  flashPlayerIcon('play', state.autoplay ? 'Reprodução automática ativada' : 'Reprodução automática desativada');
}

/* ---------- Legendas (comando não documentado do YouTube) ---------- */
function captionTracks() {
  try { return player?.getOption?.('captions', 'tracklist') || []; } catch { return []; }
}

function trackName(t) {
  return t?.displayName || t?.languageName || t?.languageCode || 'Legenda';
}

function applyCaptions() {
  if (!player?.loadModule) return;
  try {
    if (!playerPrefs.cc) {
      player.setOption?.('captions', 'track', {});
      player.unloadModule?.('captions');
      return;
    }
    player.loadModule('captions');
    // A lista de legendas chega um instante depois de carregar o módulo.
    setTimeout(() => {
      const tracks = captionTracks();
      const pick = tracks.find(t => t.languageCode === playerPrefs.ccLang)
        || tracks.find(t => String(t.languageCode).startsWith('pt'))
        || tracks[0];
      if (pick) player.setOption?.('captions', 'track', { languageCode: pick.languageCode });
      renderMenu();
    }, 700);
  } catch { /* o YouTube mudou o comando: as legendas só não funcionam */ }
}

function toggleCaptions() {
  playerPrefs.cc = !playerPrefs.cc;
  savePlayerPrefs();
  applyCaptions();
  updateCcButton();
  pop($('#pc-cc'));
  flashPlayerIcon('play', playerPrefs.cc ? 'Legendas ativadas' : 'Legendas desativadas');
  pokeControls();
}

function updateCcButton() {
  const btn = $('#pc-cc');
  btn.classList.toggle('on', playerPrefs.cc);
  btn.setAttribute('aria-pressed', String(playerPrefs.cc));
  btn.title = playerPrefs.cc ? 'Desativar legendas (c)' : 'Ativar legendas (c)';
  btn.setAttribute('aria-label', btn.title);
}

/* ---------- Menu da engrenagem ---------- */
let menuPage = 'main';

function currentQuality() {
  const q = player?.getPlaybackQuality?.();
  return QUALITY_LABELS[q] ? { label: QUALITY_LABELS[q][0], badge: QUALITY_LABELS[q][1] } : { label: 'Automática', badge: '' };
}

function speedLabel(rate) {
  return rate === 1 ? 'Normal' : `${String(rate).replace('.', ',')}×`;
}

function renderMenu() {
  const menu = $('#pc-menu');
  if (menu.hidden) return;
  const row = (action, icon, label, value = '', extra = '') =>
    `<button class="pc-menu-row${extra}" type="button" data-pc="${action}">${icon}<span>${label}</span>${value ? `<span class="pc-menu-value">${esc(value)}</span>` : ''}</button>`;
  if (menuPage === 'speed') {
    const rates = player?.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    menu.innerHTML = row('menu:main', MENU_ICONS.back, 'Velocidade', '', ' pc-menu-head')
      + rates.map(r => row(`speed:${r}`, r === playbackRate ? MENU_ICONS.check : '<span class="pc-menu-gap"></span>', speedLabel(r))).join('');
  } else if (menuPage === 'cc') {
    const tracks = captionTracks();
    menu.innerHTML = row('menu:main', MENU_ICONS.back, 'Legendas', '', ' pc-menu-head')
      + row('cc:off', !playerPrefs.cc ? MENU_ICONS.check : '<span class="pc-menu-gap"></span>', 'Desativadas')
      + (tracks.length
        ? tracks.map(t => row(`cc:${t.languageCode}`, playerPrefs.cc && t.languageCode === playerPrefs.ccLang ? MENU_ICONS.check : '<span class="pc-menu-gap"></span>', trackName(t))).join('')
        : `<p class="pc-menu-note">${playerPrefs.cc ? 'Carregando as legendas…' : 'Ative as legendas para ver os idiomas disponíveis.'}</p>`);
  } else {
    const tracks = captionTracks();
    const ccTrack = tracks.find(t => t.languageCode === playerPrefs.ccLang);
    menu.innerHTML = row('menu:speed', MENU_ICONS.speed, 'Velocidade', `${speedLabel(playbackRate)} ›`)
      + row('menu:cc', MENU_ICONS.cc, 'Legendas', `${playerPrefs.cc ? trackName(ccTrack) || 'Ativadas' : 'Desativadas'} ›`)
      + row('noop', MENU_ICONS.quality, 'Qualidade', `${currentQuality().label} (automática)`, ' pc-menu-static')
      + '<div class="pc-menu-sep"></div>'
      + (desktopQuery.matches && !isMobile() && !document.fullscreenElement ? row('act:cinema', MENU_ICONS.cinema, theaterOn ? 'Sair do Modo Cinema' : 'Modo Cinema', 't') : '')
      + (document.fullscreenElement ? '' : row('act:mini', MENU_ICONS.pip, 'Mini player'))
      + row('act:copy', MENU_ICONS.link, 'Copiar link do vídeo');
  }
}

function openMenu(open = $('#pc-menu').hidden) {
  const menu = $('#pc-menu');
  menu.hidden = !open;
  $('#pc-settings').setAttribute('aria-expanded', String(open));
  $('#pc-more').setAttribute('aria-expanded', String(open));
  if (open) {
    menuPage = 'main';
    renderMenu();
    setControlsVisible(true);
  } else {
    pokeControls();
  }
}

/** Troca de página do menu (Velocidade, Legendas...) deslizando para o lado, como no iPhone. */
function renderMenuAnimated(dir) {
  const menu = $('#pc-menu');
  if (!motionOK() || menu.hidden) { renderMenu(); return; }
  animateHeight(menu, renderMenu, 380);
  [...menu.children].forEach((row, i) => row.animate([
    { opacity: 0, transform: `translateX(${dir * 28}px)`, filter: 'blur(3px)' },
    { opacity: 1, transform: 'none', filter: 'none' },
  ], { duration: 380, delay: i * 18, easing: easeSmooth(), fill: 'backwards' }));
}

function onMenuAction(action) {
  const [kind, value] = action.split(':');
  if (kind === 'act') {
    openMenu(false);
    if (value === 'cinema') toggleTheater();
    else if (value === 'mini') minimizeVideo();
    else if (value === 'copy') copyVideoLink(state.currentVideoId);
    return;
  }
  if (kind === 'menu') { menuPage = value; renderMenuAnimated(value === 'main' ? -1 : 1); return; }
  if (kind === 'speed') {
    playbackRate = Number(value);
    player?.setPlaybackRate?.(playbackRate);
    menuPage = 'main';
  }
  if (kind === 'cc') {
    if (value === 'off') playerPrefs.cc = false;
    else { playerPrefs.cc = true; playerPrefs.ccLang = value; }
    savePlayerPrefs();
    applyCaptions();
    updateCcButton();
    menuPage = 'main';
  }
  renderMenuAnimated(-1);
}

/* ---------- Barra de progresso e tempo ---------- */
function progressFraction(e) {
  const r = $('#pc-progress').getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}

// Roda 4 vezes por segundo: só mexe na página quando algo visível mudou (cada mudança
// repinta a barra por cima do vídeo, e repintar à toa custava quadros do vídeo).
const progressShown = {};
function setShown(key, value, apply) {
  if (progressShown[key] === value) return;
  progressShown[key] = value;
  apply(value);
}

function updateProgressUI(previewFraction = null) {
  if (!player?.getDuration) return;
  const live = state.currentVideo?.live === 'live';
  const d = player.getDuration() || 0;
  const t = previewFraction != null ? previewFraction * d : (player.getCurrentTime?.() || 0);
  const played = d ? Math.min(100, (t / d) * 100) : 0;
  const loaded = Math.min(100, (player.getVideoLoadedFraction?.() || 0) * 100);
  const bar = $('#pc-progress');
  setShown('played', `${live ? 100 : played.toFixed(2)}%`, v => bar.style.setProperty('--played', v));
  setShown('loaded', `${live ? 100 : loaded.toFixed(1)}%`, v => bar.style.setProperty('--loaded', v));
  setShown('time', live
    ? '<span class="pc-live-dot"></span>AO VIVO'
    : `${fmtClock(t)} <span>/ ${fmtClock(d)}</span>`, v => { $('#pc-time').innerHTML = v; });
  setShown('remain', live || !d ? '' : `−${fmtClock(Math.max(0, d - t))}`, v => { $('#pc-remain').textContent = v; });
  const q = currentQuality().badge;
  const badge = $('#pc-quality');
  setShown('quality', q, v => {
    badge.textContent = v;
    badge.hidden = !v;
    $('#pc-settings').classList.toggle('has-quality', Boolean(v));
  });
}

function setupProgressBar() {
  const bar = $('#pc-progress');
  const tip = $('#pc-tip');
  bar.addEventListener('pointermove', e => {
    const d = player?.getDuration?.() || 0;
    if (!d) return;
    const f = progressFraction(e);
    tip.textContent = fmtClock(f * d);
    tip.style.left = `${f * 100}%`;
    tip.hidden = false;
    if (draggingProgress) updateProgressUI(f);
  });
  bar.addEventListener('pointerleave', () => { if (!draggingProgress) tip.hidden = true; });
  bar.addEventListener('pointerdown', e => {
    if (!player?.getDuration) return;
    draggingProgress = true;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    updateProgressUI(progressFraction(e));
  });
  const finish = e => {
    if (!draggingProgress) return;
    draggingProgress = false;
    bar.classList.remove('dragging');
    tip.hidden = true;
    const d = player?.getDuration?.() || 0;
    player?.seekTo?.(progressFraction(e) * d, true);
    pokeControls();
  };
  bar.addEventListener('pointerup', finish);
  bar.addEventListener('pointercancel', finish);
}

/** Chamado quando o player fica pronto: aplica volume salvo e atualiza a barra. */
function onPlayerControlsReady() {
  if (playerPrefs.muted) player.mute?.(); else { player.unMute?.(); player.setVolume?.(playerPrefs.volume); }
  updateVolumeUI();
  updatePlayButton();
  updateProgressUI();
}

/** Chamado a cada mudança de estado do player (tocando, pausado, fim...). */
function onPlayerControlsState(stateCode) {
  const S = window.YT.PlayerState;
  tickWatchTime();
  updatePlayButton(stateCode === S.PLAYING || stateCode === S.BUFFERING);
  updateMiniUI();
  if (stateCode !== S.BUFFERING) {
    clearTimeout(ytTitleTimer);
    setYouTubeTitleShowing(true);
    if (stateCode === S.PLAYING) ytTitleTimer = setTimeout(() => setYouTubeTitleShowing(false), YT_TITLE_MS);
  }
  if (stateCode === S.PLAYING) {
    if (playbackRate !== 1) player.setPlaybackRate?.(playbackRate);
    if (playerPrefs.cc && ccAppliedFor !== playerVideoId) { ccAppliedFor = playerVideoId; applyCaptions(); }
    // Voltar a tocar não mostra os controles: depois de carregar um trecho ou trocar de
    // qualidade o YouTube avisa "tocando" de novo, e a barra aparecia sem ninguém mexer
    // no mouse. Se já estão visíveis (ex.: estava pausado), só começa a contar para sumir.
    if (!$('.player-wrap').classList.contains('pc-hidden')) pokeControls();
  }
}

/* ---------- Modo teatro (só no computador) ----------
   O player ocupa uma faixa preta de ponta a ponta; título, descrição e comentários ficam
   embaixo, à esquerda, e "A seguir" à direita, em lista. A escolha fica guardada neste
   aparelho. No celular o botão não existe (o player já ocupa a largura toda). */
const THEATER_ICONS = {
  on: SF('theater'),
  off: SF('theater-off'),
};
const desktopQuery = matchMedia('(min-width: 1100px)');
let theaterOn = store.get(KEYS.theater, false);

function theaterActive() {
  return theaterOn && desktopQuery.matches && !isMobile();
}

function applyTheater() {
  $('#view-watch').classList.toggle('theater', theaterActive());
  updateSidebarMode();
  const btn = $('#pc-theater');
  if (!btn) return;
  btn.innerHTML = theaterOn ? THEATER_ICONS.off : THEATER_ICONS.on;
  btn.setAttribute('aria-pressed', String(theaterOn));
  btn.title = theaterOn ? 'Sair do Modo Cinema (t)' : 'Modo Cinema (t)';
  btn.setAttribute('aria-label', btn.title);
}

function toggleTheater() {
  if (isMobile() || !desktopQuery.matches) return;
  theaterOn = !theaterOn;
  store.set(KEYS.theater, theaterOn);
  pop($('#pc-theater'));
  const update = () => {
    applyTheater();
    // A lista de "A seguir" muda de tamanho: 10 vídeos no modo teatro, 3 no normal.
    upNextCount = Math.max(upNextPage(), theaterOn ? upNextCount : normalUpNext());
    if (state.currentVideo) renderUpNext(state.currentVideo);
  };
  if (!motionOK() || document.fullscreenElement || state.view !== 'watch') { update(); pokeControls(); return; }

  // FLIP: mede onde cada coisa está, troca o layout e faz cada uma viajar até o novo lugar.
  // O player é movido de verdade (não é uma "foto"), então o vídeo continua tocando.
  const wrap = $('.player-wrap');
  const band = $('.watch-player');
  const parts = [$('.watch-info'), $('.watch-comments'), $('.watch-side .side-head'), $('#upnext-more')].filter(el => el && el.offsetParent);
  const firstWrap = wrap.getBoundingClientRect();
  const firstParts = new Map(parts.map(el => [el, el.getBoundingClientRect()]));
  const firstTiles = new Map([...$$('#upnext .mini')].map(m => [m.dataset.vid, {
    thumb: m.querySelector('.thumb')?.getBoundingClientRect(),
    text: m.querySelector('.thumb')?.nextElementSibling?.getBoundingClientRect(),
  }]));
  const bandFrom = getComputedStyle(band).backgroundColor;
  const go = () => {
    update();
    playFlip(wrap, firstWrap, { scale: true, duration: 620 });
    band.animate([{ backgroundColor: bandFrom }, { backgroundColor: getComputedStyle(band).backgroundColor }], { duration: 520, easing: 'ease' });
    parts.forEach((el, i) => playFlip(el, firstParts.get(el), { duration: 620, delay: 50 + i * 30 }));
    let fresh = 0;
    $$('#upnext .mini').forEach((m, i) => {
      const before = firstTiles.get(m.dataset.vid);
      const thumb = m.querySelector('.thumb');
      m.style.animation = 'none';
      if (before?.thumb && thumb) {
        playFlip(thumb, before.thumb, { scale: true, duration: 620, delay: 40 + i * 30 });
        playFlip(thumb.nextElementSibling, before.text, { duration: 620, delay: 40 + i * 30 });
      } else {
        focusIn(m, { delay: 220 + fresh++ * 45 });
      }
    });
    pokeControls();
  };
  // Saindo do modo teatro: os vídeos extras de "A seguir" saem antes, desfocando.
  const extras = theaterOn ? [] : [...$$('#upnext .mini')].slice(normalUpNext());
  if (extras.length) Promise.all(extras.map((m, i) => focusOut(m, { delay: (extras.length - 1 - i) * 15 }))).then(go);
  else go();
}

/** Atualiza o ícone do botão de tela cheia do app (entrar/sair). */
function updateFullscreenButton() {
  const btn = $('#player-fs');
  const inside = Boolean(document.fullscreenElement?.closest?.('.player-wrap'));
  btn.innerHTML = inside ? FS_ICONS.exit : FS_ICONS.enter;
  btn.title = inside ? 'Sair da tela cheia (f)' : 'Tela cheia (f)';
  btn.setAttribute('aria-label', btn.title);
}

/** Player estreito (celular em pé): anterior/próximo vão para o centro, ao lado do play, e legendas e
    qualidade sobem para o canto. Mover os botões (em vez de duplicar) mantém tudo funcionando igual. */
let controlsCompact = null;
function layoutPlayerControls(width) {
  const compact = width > 0 && width < 560;
  if (compact === controlsCompact) return;
  controlsCompact = compact;
  $('.player-wrap').classList.toggle('pc-compact', compact);
  const center = $('#pc-center');
  const play = $('#pc-play');
  const skip = $('.pc-skip');
  const right = $('.pc-right');
  const topRight = $('#pc-topright');
  if (compact) {
    center.insertBefore($('#pc-prev'), play);
    play.after($('#pc-next'));
    topRight.append($('#pc-cc'), $('#pc-settings'));
  } else {
    skip.append($('#pc-prev'), $('#pc-next'));
    $('.pc-volume').after($('#pc-cc'));
    $('#pc-autoplay').after($('#pc-settings'));
  }
  if (!$('#pc-menu').hidden) openMenu(false);
}

/** Link do vídeo no YouTube, para compartilhar. */
function copyVideoLink(id) {
  if (!id) return;
  const url = `https://www.youtube.com/watch?v=${id}`;
  (navigator.clipboard?.writeText(url) || Promise.reject())
    .then(() => toast('Link copiado.', 'success'))
    .catch(() => toast(url));
}

function setupPlayerControls() {
  // Ícones fixos e estado inicial da barra (antes de tocar, o YouTube mostra o título dele).
  setYouTubeTitleShowing(true);
  $('#pc-settings').insertAdjacentHTML('afterbegin', GEAR_ICON);
  $('#pc-cc').innerHTML = CC_ICON;
  $('#pc-prev').innerHTML = SKIP_ICONS.prev;
  $('#pc-next').innerHTML = SKIP_ICONS.next;
  updateSkipButtons();
  updatePlayButton(false);
  updateVolumeUI();
  updateAutoplayButton();
  updateCcButton();
  updateFullscreenButton();
  setupProgressBar();

  // Botões da barra (o clique com mouse tira o foco, para não ficar contorno sobre o vídeo).
  const onClick = (sel, fn) => $(sel).addEventListener('click', e => {
    e.stopPropagation();
    fn(e);
    if (e.detail > 0) e.currentTarget.blur();
  });
  // Play do centro (em cima do vídeo): um clique pausa/continua; clique duplo é tela cheia, como no resto do vídeo.
  let playTapTimer = 0;
  onClick('#pc-play', e => {
    if (e.detail === 0) { togglePlay(); return; } // teclado
    clearTimeout(playTapTimer);
    if (e.detail >= 2) { togglePlayerFullscreen(); return; }
    playTapTimer = setTimeout(togglePlay, 260);
  });
  $('#pc-play').addEventListener('dblclick', e => e.preventDefault());
  onClick('#pc-prev', playPrevious);
  onClick('#pc-next', playNext);
  onClick('#pc-back10', () => { seekBy(-10); flashPlayerIcon('play', '« 10 s'); });
  onClick('#pc-fwd10', () => { seekBy(10); flashPlayerIcon('play', '10 s »'); });
  onClick('#pc-pip', () => minimizeVideo());
  onClick('#pc-down', () => (document.fullscreenElement ? document.exitFullscreen?.() : minimizeVideo()));
  onClick('#pc-more', () => openMenu());
  onClick('#pc-mute', toggleMute);
  onClick('#pc-autoplay', toggleAutoplay);
  onClick('#pc-cc', toggleCaptions);
  onClick('#pc-settings', () => openMenu());
  onClick('#player-fs', togglePlayerFullscreen);
  if (isMobile()) $('#pc-theater').remove(); // modo teatro: só no computador
  else onClick('#pc-theater', toggleTheater);
  applyTheater();
  desktopQuery.addEventListener('change', applyTheater);
  $('#pc-volume').addEventListener('input', e => setVolume(Number(e.target.value)));
  $('#pc-menu').addEventListener('click', e => {
    e.stopPropagation();
    const row = e.target.closest('[data-pc]');
    if (row && row.dataset.pc !== 'noop') onMenuAction(row.dataset.pc);
  });
  // Fecha o menu ao clicar fora dele.
  document.addEventListener('click', e => {
    if (!$('#pc-menu').hidden && !e.target.closest('#pc-menu, #pc-settings, #pc-more')) openMenu(false);
  });

  // Mantém os controles visíveis enquanto o mouse está sobre a barra. Trocar um ícone que está
  // sob o cursor faz o navegador avisar uma "saída" falsa, então a saída é conferida pela posição.
  const inside = (el, e) => {
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  for (const el of [$('.pc-bar'), $('#pc-progress'), $('.pc-topbar'), $('#pc-center')]) {
    el.addEventListener('pointerenter', () => { pointerOnBar = true; setControlsVisible(true); });
    el.addEventListener('pointerleave', e => {
      if (inside(el, e)) return;
      pointerOnBar = false;
      pokeControls();
    });
  }
  $('.player-wrap').addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse' || inside(e.currentTarget, e)) return;
    pointerOnBar = false;
    if (isPlaying() && $('#pc-menu').hidden) setControlsVisible(false);
  });

  // Atualiza tempo e barra de progresso enquanto a página do vídeo está aberta.
  setInterval(() => {
    if (state.view === 'watch' && !draggingProgress) updateProgressUI();
  }, 250);

  document.addEventListener('fullscreenchange', () => { updateFullscreenButton(); pokeControls(); });

  // A altura do player define o tamanho dos tiles de "A seguir"; a largura escolhe o arranjo dos controles.
  new ResizeObserver(([entry]) => {
    $('#view-watch').style.setProperty('--player-h', `${Math.round(entry.contentRect.height)}px`);
    layoutPlayerControls(entry.contentRect.width);
  }).observe($('.player-wrap'));

  // Camada sobre o vídeo: clique (mouse) ou toque, simples ou duplo.
  const overlay = $('#player-overlay');
  let lastPointerType = 'mouse';
  let tapTimer = 0;
  let lastTapAt = 0;
  overlay.addEventListener('pointerdown', e => { lastPointerType = e.pointerType || 'mouse'; });
  const zoneOf = e => {
    const r = overlay.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
  };
  const single = zone => {
    if (lastPointerType === 'touch') {
      const hidden = $('.player-wrap').classList.contains('pc-hidden');
      if (hidden) pokeControls();
      else if (zone === 'center') togglePlay();
      else setControlsVisible(false);
    } else {
      togglePlay();
    }
  };
  const double = zone => {
    window.getSelection()?.removeAllRanges();
    if (lastPointerType === 'touch' && zone !== 'center') {
      seekBy(zone === 'left' ? -10 : 10);
      flashPlayerIcon('play', zone === 'left' ? '« 10 s' : '10 s »');
    } else {
      togglePlayerFullscreen();
    }
  };
  overlay.addEventListener('click', e => {
    if (!$('#pc-menu').hidden) { openMenu(false); return; }
    const zone = zoneOf(e);
    const now = Date.now();
    if (now - lastTapAt < 300) {
      clearTimeout(tapTimer);
      lastTapAt = 0;
      double(zone);
      return;
    }
    lastTapAt = now;
    tapTimer = setTimeout(() => single(zone), 260);
  });
  overlay.addEventListener('dblclick', e => e.preventDefault());
  // Impede que o clique duplo selecione texto (a "marcação azul").
  overlay.addEventListener('mousedown', e => {
    if (e.detail > 1) e.preventDefault();
  });
  // Só o mouse de verdade (o toque também gera "mousemove", que mostraria os controles antes da hora).
  overlay.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') pokeControls(); });

  document.addEventListener('keydown', e => {
    if (state.view !== 'watch' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input:not(#pc-volume), textarea, select, [contenteditable="true"]')) return;
    // Botões fora do player mantêm o comportamento normal; os do player não bloqueiam os atalhos.
    if (e.target.closest?.('button') && !e.target.closest('.player-wrap')) return;
    if (e.key === 'Escape' && !$('#pc-menu').hidden) { openMenu(false); return; }
    if (e.shiftKey && (e.key === 'N' || e.key === 'P')) {
      e.preventDefault();
      (e.key === 'N' ? playNext : playPrevious)();
      return;
    }
    const actions = {
      ' ': togglePlay,
      k: togglePlay,
      f: togglePlayerFullscreen,
      t: toggleTheater,
      c: toggleCaptions,
      ArrowLeft: () => seekBy(-5),
      ArrowRight: () => seekBy(5),
      ArrowUp: () => setVolume((player?.isMuted?.() ? 0 : player?.getVolume?.() ?? 0) + 5),
      ArrowDown: () => setVolume((player?.getVolume?.() ?? 0) - 5),
      j: () => seekBy(-10),
      l: () => seekBy(10),
      m: toggleMute,
    };
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!action) return;
    e.preventDefault();
    action();
    pokeControls();
  });
}

/* =========================================================
   Mini player
   =========================================================
   Saindo da página do vídeo, o vídeo continua no mesmo player, que
   só muda de tamanho e lugar (canto inferior direito; no celular, uma
   faixa no rodapé) — nada é recarregado. Expandir volta à página do
   vídeo do ponto em que está; clicar em outro vídeo fecha o mini player
   e abre o outro normalmente; fechar salva o ponto e para o vídeo.
   O tempo assistido nele conta nas Estatísticas, como na página do vídeo. */
const MINI_ICONS = {
  expand: SF('expand'),
  close: SF('close'),
};
const mini = { on: false, context: '', timer: 0 };

/** Dá para continuar no mini player? (há um vídeo carregado e sem erro no player) */
function canMini() {
  return Boolean(player && state.currentVideo && playerVideoId === state.currentVideo.id && $('#player-error').hidden);
}

function startMini() {
  mini.on = true;
  clearDragMini(); // veio do gesto de arrastar: a barra assume daqui
  mini.context = watchContext(); // filtro em que o vídeo estava (para expandir no mesmo "A seguir")
  $('#pc-menu').hidden = true;
  $('#pc-settings').setAttribute('aria-expanded', 'false');
  $('#view-watch').classList.remove('theater');
  document.body.classList.add('mini-player');
  renderMiniInfo();
  updateMiniUI();
  clearInterval(mini.timer);
  mini.timer = setInterval(updateMiniUI, 500);
}

function endMini() {
  if (!mini.on) return;
  mini.on = false;
  clearInterval(mini.timer);
  document.body.classList.remove('mini-player');
  applyTheater();
}

/** Fechar (✕): salva o ponto, para o vídeo e some. */
function closeMini() {
  if (!mini.on) return;
  saveProgress();
  try { player?.pauseVideo?.(); } catch { /* player ainda não pronto */ }
  tickWatchTime();
  const box = $('#view-watch');
  const done = () => {
    endMini();
    if (state.view !== 'watch') {
      box.hidden = true;
      state.currentVideoId = null;
      state.currentVideo = null;
    }
  };
  if (motionOK()) box.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(16px) scale(.96)' }], { duration: 260, easing: 'ease-in' }).finished.then(done, done);
  else done();
}

/** Expandir: volta à página do vídeo (o player continua de onde está). */
function expandMini() {
  if (mini.on && state.currentVideo) location.hash = watchHref(state.currentVideo.id, mini.context);
}

/** Fim do vídeo no mini player (reprodução automática) ou vídeo recusado: o próximo toca ali mesmo. */
function miniPlay(video) {
  saveProgress();
  state.currentVideo = video;
  state.currentVideoId = video.id;
  recordWatchHistory(video.id);
  markSeen(video.id);
  playerVideoId = video.id;
  playerLoadedAt = Date.now();
  resetHealth(video.id);
  player.loadVideoById({ videoId: video.id, startSeconds: Math.floor(resumeTime(video.id)) });
  renderPlayerTitle(video);
  renderMiniInfo();
}

function renderMiniInfo() {
  const v = state.currentVideo;
  if (!v) return;
  $('#mini-info .mini-info-title').textContent = v.title;
  $('#mini-info .mini-info-channel').innerHTML = `${esc(v.channelTitle)}<span class="mini-time"></span>`;
}

/** Mini player: próximo de "A seguir" ou o anterior, tocando ali mesmo. */
function miniNext() {
  const next = nextVideoAfter(state.currentVideo);
  if (next) miniPlay(next);
}

async function miniPrev() {
  const id = previousVideoId();
  if (!id) return;
  let v = findLoadedVideo(id);
  if (!v) {
    try { v = (await fetchVideos([id])).get(id); } catch { v = null; }
  }
  if (!v || !mini.on) return;
  while (watchHistory.stack.length && watchHistory.stack.at(-1) !== id) watchHistory.stack.pop();
  watchHistory.stack.pop();
  saveWatchHistory();
  goingBack = true;
  miniPlay(v);
}

function updateMiniUI() {
  if (!mini.on) return;
  const playing = isPlaying();
  $$('[data-mini="play"]').forEach(b => {
    b.innerHTML = playing ? PLAY_ICONS.pause : PLAY_ICONS.play;
    b.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
    b.title = b.getAttribute('aria-label');
  });
  $('#mini-ui').classList.toggle('paused', !playing);
  let t = 0, d = 0;
  try { t = player.getCurrentTime() || 0; d = player.getDuration() || 0; } catch { /* ignora */ }
  $('#mini-ui .mini-progress span').style.width = d ? `${Math.min(100, (t / d) * 100)}%` : '0';
  const time = $('#mini-info .mini-time');
  if (time) time.textContent = state.currentVideo?.live === 'live' ? 'ao vivo' : d ? `${fmtClock(t)} de ${fmtClock(d)}` : '';
  $('#mini-info .mini-prev').disabled = !previousVideoId();
  $('#mini-info .mini-next').disabled = !nextVideoAfter(state.currentVideo);
}

function setupMini() {
  $$('[data-mini="expand"].mini-btn').forEach(b => { b.innerHTML = MINI_ICONS.expand; });
  $$('[data-mini="close"]').forEach(b => { b.innerHTML = MINI_ICONS.close; });
  $$('[data-mini="prev"]').forEach(b => { b.innerHTML = SKIP_ICONS.prev; });
  $$('[data-mini="next"]').forEach(b => { b.innerHTML = SKIP_ICONS.next; });
  setupMiniSwipe();
  const act = e => {
    if (!mini.on) return;
    const btn = e.target.closest('[data-mini]');
    const action = btn?.dataset.mini || 'expand'; // clicar no vídeo ou no título expande
    e.preventDefault();
    e.stopPropagation();
    if (action === 'play') {
      if (isPlaying()) player.pauseVideo(); else player.playVideo();
      setTimeout(updateMiniUI, 150);
    } else if (action === 'next') {
      miniNext();
    } else if (action === 'prev') {
      miniPrev();
    } else if (action === 'close') {
      closeMini();
    } else {
      expandMini();
    }
  };
  $('#mini-ui').addEventListener('click', act);
  $('#mini-info').addEventListener('click', act);
}

/** Celular: arrastar a cápsula do mini player para baixo fecha o vídeo. */
function setupMiniSwipe() {
  const box = $('#view-watch');
  let y0 = 0;
  let dy = 0;
  let on = false;
  box.addEventListener('touchstart', e => {
    on = mini.on && dragMiniQuery.matches && e.touches.length === 1;
    if (!on) return;
    y0 = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  box.addEventListener('touchmove', e => {
    if (!on) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 6 && e.cancelable) e.preventDefault();
    box.style.transform = dy ? `translateY(${dy}px)` : '';
    box.style.opacity = String(Math.max(.3, 1 - dy / 160));
  }, { passive: false });
  const end = () => {
    if (!on) return;
    on = false;
    if (dy > 60) {
      const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
      addEventListener('click', block, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', block, { capture: true }), 400);
      box.style.transform = '';
      box.style.opacity = '';
      closeMini();
      return;
    }
    if (dy && motionOK()) box.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: easeSmooth() });
    box.style.transform = '';
    box.style.opacity = '';
  };
  box.addEventListener('touchend', end);
  box.addEventListener('touchcancel', end);
}

/** Minimizar (botão do player, menu, "voltar" do Modo Cinema): o vídeo vai para o mini player e
    abre a última página que não é de vídeo, como o gesto de arrastar para baixo. */
function minimizeVideo() {
  if (state.view !== 'watch' || mini.on) return;
  if (document.fullscreenElement) document.exitFullscreen?.();
  dragToMini();
}

/* =========================================================
   Celular: arrastar o vídeo para baixo
   =========================================================
   Na página do vídeo, arrastar o vídeo para baixo o leva para a barra
   inferior; ao fundo abre a última página que não é de vídeo (a mesma
   em que você estava antes de abrir vídeos, na mesma posição), como o
   botão voltar. Soltando antes de ~1/4 da tela, ele volta ao lugar.
   Em tela cheia, o mesmo gesto só sai da tela cheia. No PC, nada muda. */
const DRAG_MINI_SLOP = 10;          // px até decidir se o gesto é para baixo
const DRAG_MINI_DISTANCE = 0.25;    // fração da altura da tela para soltar e virar barra
const DRAG_MINI_FLICK = 0.6;        // ou um puxão rápido (px/ms)...
const DRAG_MINI_FLICK_MIN = 40;     // ...de pelo menos 40 px
const drag = { on: false, active: false, x: 0, y: 0, dy: 0, fs: false, samples: [], leaving: 0 };
const dragMiniQuery = matchMedia('(max-width: 760px)');

const dragMiniAllowed = () => isMobile() && dragMiniQuery.matches && state.view === 'watch' && !mini.on;

/** Tira o vídeo da posição do arrasto (a barra inferior ou a página do vídeo assumem). */
function clearDragMini() {
  clearTimeout(drag.leaving);
  drag.leaving = 0;
  const view = $('#view-watch');
  view.classList.remove('drag-mini', 'drag-ready');
  view.style.removeProperty('--drag-p');
  $('.watch-player').style.transform = '';
}

/** Leva à página de fundo: volta no histórico até ela (ou troca o endereço, se ela não estiver lá). */
function dragToMini() {
  const page = lastPage?.hash ? lastPage : null;
  const target = page?.hash || '#/';
  navRestore = { hash: target, scroll: page?.scroll ?? 0 };
  if (page && page.idx < nav.idx && nav.hashes[page.idx] === page.hash) history.go(page.idx - nav.idx);
  else replaceRoute(target);
  // Se a navegação não acontecer (não deveria), o vídeo volta ao lugar.
  drag.leaving = setTimeout(() => { if (state.view === 'watch') snapBackDragMini(); }, 1200);
}

function snapBackDragMini() {
  const box = $('.watch-player');
  const from = box.style.transform;
  const view = $('#view-watch');
  if (!from || !motionOK()) { clearDragMini(); return; }
  const p = parseFloat(view.style.getPropertyValue('--drag-p')) || 0;
  box.animate([{ transform: from }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2, .9, .3, 1)' });
  view.querySelectorAll(':is(.watch-info, .watch-side, .watch-comments)').forEach(el => {
    el.animate([{ opacity: 1 - p }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
  });
  clearDragMini();
}

function setupDragToMini() {
  const wrap = $('.player-wrap');
  // Começa em qualquer ponto do vídeo (até em cima dos botões: só vira arrasto depois de 10 px), menos na barra de tempo e no menu.
  const ignore = t => t.closest('input, .pc-progress, .pc-menu');
  wrap.addEventListener('touchstart', e => {
    drag.on = false;
    if (e.touches.length !== 1 || ignore(e.target)) return;
    const fs = document.fullscreenElement;
    drag.fs = Boolean(fs && (fs === wrap || wrap.contains(fs)));
    if (!drag.fs && !dragMiniAllowed()) return;
    if (drag.fs && !isMobile()) return;
    const t = e.touches[0];
    Object.assign(drag, { on: true, active: false, x: t.clientX, y: t.clientY, dy: 0, samples: [{ y: t.clientY, at: performance.now() }] });
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (!drag.on) return;
    const t = e.touches[0];
    const dx = t.clientX - drag.x;
    const dy = t.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < DRAG_MINI_SLOP && Math.abs(dy) < DRAG_MINI_SLOP) {
        if (dy > 0 && e.cancelable) e.preventDefault(); // ainda decidindo: a página não rola para baixo
        return;
      }
      if (dy <= 0 || dy < Math.abs(dx) * 1.2) { drag.on = false; return; } // para cima ou para o lado: não é o gesto
      drag.active = true;
      setControlsVisible(false);
      if (!drag.fs) {
        renderMiniInfo();
        $('#view-watch').classList.add('drag-mini');
      }
    }
    if (e.cancelable) e.preventDefault();
    drag.dy = Math.max(0, dy);
    drag.samples.push({ y: t.clientY, at: performance.now() });
    if (drag.samples.length > 6) drag.samples.shift();
    if (drag.fs) return;
    const p = Math.min(1, drag.dy / (innerHeight * 0.6));
    $('.watch-player').style.transform = `translateY(${drag.dy}px) scale(${1 - p * 0.3})`;
    $('#view-watch').style.setProperty('--drag-p', p.toFixed(3));
    $('#view-watch').classList.toggle('drag-ready', drag.dy > innerHeight * DRAG_MINI_DISTANCE);
  }, { passive: false });

  const end = e => {
    if (!drag.on) return;
    drag.on = false;
    if (!drag.active) return;
    drag.active = false;
    // Depois de arrastar, o toque não conta como clique (pausar/continuar).
    const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
    addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', block, { capture: true }), 400);
    const first = drag.samples[0];
    const last = drag.samples.at(-1);
    const speed = last && first && last.at > first.at ? (last.y - first.y) / (last.at - first.at) : 0;
    const go = e.type === 'touchend'
      && (drag.dy > innerHeight * DRAG_MINI_DISTANCE || (speed > DRAG_MINI_FLICK && drag.dy > DRAG_MINI_FLICK_MIN));
    if (drag.fs) {
      if (go) document.exitFullscreen?.();
      return;
    }
    if (go && dragMiniAllowed()) dragToMini();
    else snapBackDragMini();
  };
  wrap.addEventListener('touchend', end);
  wrap.addEventListener('touchcancel', end);
}

/* =========================================================
   Prévia ao passar o mouse (só com mouse)
   =========================================================
   Início e página do canal: parando o mouse sobre um vídeo, ele
   toca sem som dentro do bloco (até o fim, se o mouse ficar), com
   botão de som e barrinha de progresso. É um player separado do
   principal: não salva progresso, não marca como assistido e não
   conta nas Estatísticas. Clicar abre o vídeo normalmente (do começo
   ou do ponto salvo antes). "A seguir": a capa e os 3 quadros que o
   YouTube publica de cada vídeo (~25%, 50% e 75%) alternando em loop. */
const hoverQuery = matchMedia('(hover: hover) and (pointer: fine)');
const PREVIEW_DELAY = 600;
const preview = { tile: null, timer: 0, player: null, box: null, tick: 0, muted: true, seq: 0 };
const frames = { mini: null, timer: 0, wait: 0, layers: [] };
const FRAME_HOLD = 1500; // cada quadro fica 1,5 s inteiro na tela
const FRAME_FADE = 600;  // e entra/sai com fade (igual a --frame-fade no styles.css)

function startPreview(tile) {
  const id = tile.dataset.vid;
  const thumb = tile.querySelector('.thumb');
  if (!id || !thumb || !tile.isConnected) return;
  const seq = ++preview.seq;
  const box = document.createElement('div');
  box.className = 'tile-preview';
  box.innerHTML = `<div id="tp-player-${seq}"></div><div class="tp-shield"></div>
    <button class="tp-mute" type="button" aria-label="Ativar o som" title="Ativar o som">${VOL_ICONS.muted}</button>
    <div class="tp-progress" aria-hidden="true"><span></span></div>`;
  thumb.append(box);
  preview.box = box;
  preview.muted = true;
  box.querySelector('.tp-mute').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const p = preview.player;
    if (!p?.isMuted) return;
    preview.muted = !preview.muted;
    if (preview.muted) p.mute(); else p.unMute();
    e.currentTarget.innerHTML = preview.muted ? VOL_ICONS.muted : VOL_ICONS.high;
    e.currentTarget.title = preview.muted ? 'Ativar o som' : 'Desativar o som';
    e.currentTarget.setAttribute('aria-label', e.currentTarget.title);
  });
  loadYouTubeApi().then(YT => {
    if (seq !== preview.seq) return;
    preview.player = new YT.Player(`tp-player-${seq}`, {
      videoId: id,
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1,
        iv_load_policy: 3, modestbranding: 1, start: Math.floor(resumeTime(id)), origin: location.origin,
      },
      events: {
        onReady: e => { if (seq === preview.seq) { e.target.mute(); e.target.playVideo(); } },
        onStateChange: e => { if (seq === preview.seq && e.data === YT.PlayerState.PLAYING) box.classList.add('playing'); },
        // Não toca fora do YouTube: some do app, como no player principal.
        onError: e => { if (seq === preview.seq && [100, 101, 150].includes(e.data)) { stopPreview(); markUnplayable(id); } },
      },
    });
    preview.tick = setInterval(() => {
      const p = preview.player;
      let t = 0, d = 0;
      try { t = p.getCurrentTime() || 0; d = p.getDuration() || 0; } catch { return; }
      box.querySelector('.tp-progress span').style.width = d ? `${Math.min(100, (t / d) * 100)}%` : '0';
    }, 250);
  }).catch(() => { /* sem o player do YouTube: fica só a capa */ });
}

function stopPreview() {
  clearTimeout(preview.timer);
  clearInterval(preview.tick);
  preview.seq++;
  try { preview.player?.destroy?.(); } catch { /* ignora */ }
  preview.box?.remove();
  Object.assign(preview, { tile: null, timer: 0, player: null, box: null, tick: 0 });
}

function startFrames(mini) {
  const id = mini.dataset.vid;
  const thumb = mini.querySelector('.thumb');
  if (!id || !thumb) return;
  const urls = ['hq1', 'hq2', 'hq3'].map(n => `https://i.ytimg.com/vi/${id}/${n}.jpg`);
  urls.forEach(u => { new Image().src = u; }); // já baixa os 3 quadros
  // Duas camadas: o próximo quadro entra com fade por cima enquanto o atual sai (só depois de carregado).
  const layers = [0, 1].map(() => {
    const img = document.createElement('img');
    img.className = 'mini-frames';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    thumb.append(img);
    return img;
  });
  frames.layers = layers;
  let i = 0;
  const show = () => {
    const incoming = layers[i % 2];
    const outgoing = layers[(i + 1) % 2];
    incoming.src = urls[i++ % urls.length];
    const reveal = () => {
      if (frames.layers !== layers) return;
      incoming.classList.add('on');
      outgoing.classList.remove('on');
    };
    incoming.decode().then(reveal, reveal);
  };
  frames.wait = setTimeout(() => { show(); frames.timer = setInterval(show, FRAME_HOLD + FRAME_FADE); }, 250);
}

function stopFrames() {
  clearTimeout(frames.wait);
  clearInterval(frames.timer);
  // Sai com fade, voltando à capa.
  const old = frames.layers;
  old.forEach(img => img.classList.remove('on'));
  setTimeout(() => old.forEach(img => img.remove()), FRAME_FADE);
  Object.assign(frames, { mini: null, timer: 0, wait: 0, layers: [] });
}

function setupPreviews() {
  const isMouse = e => e.pointerType === 'mouse' && hoverQuery.matches;
  const feed = $('#feed');
  feed.addEventListener('pointerover', e => {
    if (!isMouse(e)) return;
    const tile = e.target.closest('.tile');
    if (!tile || tile === preview.tile) return;
    stopPreview();
    preview.tile = tile;
    preview.timer = setTimeout(() => startPreview(tile), PREVIEW_DELAY);
  });
  feed.addEventListener('pointerout', e => {
    const tile = e.target.closest('.tile');
    if (tile && tile === preview.tile && !tile.contains(e.relatedTarget)) stopPreview();
  });
  const up = $('#upnext');
  up.addEventListener('pointerover', e => {
    if (!isMouse(e)) return;
    const mini = e.target.closest('.mini');
    if (!mini || mini === frames.mini) return;
    stopFrames();
    frames.mini = mini;
    startFrames(mini);
  });
  up.addEventListener('pointerout', e => {
    const mini = e.target.closest('.mini');
    if (mini && mini === frames.mini && !mini.contains(e.relatedTarget)) stopFrames();
  });
  // Rolando a página com o mouse parado, o vídeo sai de baixo do mouse: a prévia para.
  addEventListener('scroll', () => {
    if (preview.tile && !preview.tile.matches(':hover')) stopPreview();
    if (frames.mini && !frames.mini.matches(':hover')) stopFrames();
  }, { passive: true });
}

/* =========================================================
   Página do vídeo
   ========================================================= */
const UPNEXT_PAGE = 6;          // "A seguir" mostra 6 vídeos (4 no celular); "Mostrar mais" acrescenta outros tantos
const UPNEXT_PAGE_PHONE = 4;
const UPNEXT_PAGE_THEATER = 10; // no Modo Cinema, os cartões ficam ao lado das informações: 10 por vez
const normalUpNext = () => (overlayQuery.matches ? UPNEXT_PAGE_PHONE : UPNEXT_PAGE);
const upNextPage = () => (theaterActive() ? UPNEXT_PAGE_THEATER : normalUpNext());
let upNextCount = UPNEXT_PAGE;

function watchInfoSkeleton() {
  return `
    <div class="sk-lines" aria-hidden="true">
      <div class="skeleton sk-line lg w80"></div>
      <div class="sk-row"><div class="skeleton sk-avatar"></div><div class="sk-lines"><div class="skeleton sk-line w40"></div><div class="skeleton sk-line w40"></div></div></div>
    </div>`;
}

function miniSkeletons(n) {
  return Array.from({ length: n }, () => `
    <div class="sk-mini" aria-hidden="true">
      <div class="skeleton sk-thumb"></div>
      <div class="sk-lines"><div class="skeleton sk-line w80"></div><div class="skeleton sk-line w60"></div><div class="skeleton sk-line w40"></div></div>
    </div>`).join('');
}

function commentSkeletons(n) {
  return Array.from({ length: n }, () => `
    <div class="sk-row" aria-hidden="true"><div class="skeleton sk-avatar"></div>
      <div class="sk-lines"><div class="skeleton sk-line w40"></div><div class="skeleton sk-line w80"></div><div class="skeleton sk-line w60"></div></div>
    </div>`).join('');
}

/* Inscritos dos canais (para "13,4 mi de inscritos"): uma chamada para todos os canais,
   guardada por 24 h — custa ~1 unidade de cota por dia. */
const CHANNEL_STATS_TTL = 24 * 60 * 60 * 1000;
const channelStats = store.get(KEYS.chstats, {});
let channelStatsLoading = null;

function subscribersText(channelId) {
  const subs = channelStats[channelId]?.subs;
  if (subs == null) return '';
  return `${compact.format(subs)} ${subs === 1 ? 'inscrito' : 'de inscritos'}`;
}

async function ensureChannelStats(channelId) {
  const cached = channelStats[channelId];
  if (cached && cached.videos != null && Date.now() - cached.at < CHANNEL_STATS_TTL) return;
  if (!channelStatsLoading) {
    const ids = state.channels.map(c => c.id).slice(0, 50);
    if (!ids.includes(channelId)) ids[ids.length ? ids.length - 1 : 0] = channelId;
    channelStatsLoading = api('channels', { part: 'statistics', id: ids.join(','), maxResults: 50 })
      .then(data => {
        for (const c of data.items || []) {
          const s = c.statistics || {};
          channelStats[c.id] = {
            subs: s.hiddenSubscriberCount ? null : Number(s.subscriberCount),
            videos: Number(s.videoCount) || 0, // total de vídeos públicos (para as Estatísticas)
            at: Date.now(),
          };
        }
        store.set(KEYS.chstats, channelStats);
      })
      .catch(() => { /* sem o número de inscritos, mostra o @ do canal */ })
      .finally(() => { channelStatsLoading = null; });
  }
  await channelStatsLoading;
}

function renderWatchInfo(v) {
  const ch = channelById(v.channelId);
  const published = new Date(v.publishedAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

  renderPlayerTitle(v);
  $('#watch-info').innerHTML = `
    <h1 class="watch-title">${esc(v.title)}</h1>
    <div class="watch-meta">
      <${isHomeChannel(v.channelId) ? `a href="#/c/${esc(v.channelId)}" title="Ver os vídeos de ${esc(v.channelTitle)}"` : 'div'} class="watch-channel">
        <img class="avatar watch-avatar" src="${esc(ch?.thumb || '')}" alt="" referrerpolicy="no-referrer" data-hide-broken>
        <div>
          <strong>${esc(v.channelTitle)}</strong>
          <span class="muted" id="watch-subs">${esc(subscribersText(v.channelId) || ch?.handle || '')}</span>
        </div>
      </${isHomeChannel(v.channelId) ? 'a' : 'div'}>
      <div class="watch-actions">
        ${v.likes != null ? `<span class="btn btn-fill" title="Curtidas no YouTube">${SF('heart')}${esc(compact.format(Number(v.likes)))}</span>` : ''}
        <button class="btn btn-fill btn-icon-only" type="button" data-action="watch-more" aria-label="Mais opções" title="Mais opções">${SF('more')}</button>
      </div>
    </div>
    <div class="description collapsed" id="description" data-action="expand-desc">
      <div class="description-stats">
        ${v.views != null ? `<span>${esc(fmtViews(v.views))}</span>` : ''}
        <span title="${esc(published)}">${esc(timeAgo(v.publishedAt))}</span>
      </div>
      ${v.description.trim() ? `<div class="description-text">${richText(v.description)}</div>` : ''}
      <button class="link-btn desc-toggle" type="button" data-action="toggle-desc">mais</button>
    </div>`;

  // Sem texto escondido (descrição curta), não há o que expandir.
  requestAnimationFrame(() => {
    const box = $('#description');
    const text = box?.querySelector('.description-text');
    if (box && (!text || text.scrollHeight <= text.clientHeight + 1)) {
      box.classList.remove('collapsed');
      box.classList.add('short');
      box.querySelector('.desc-toggle').hidden = true;
    }
  });

  if (!subscribersText(v.channelId)) {
    ensureChannelStats(v.channelId).then(() => {
      const el = $('#watch-subs');
      const text = subscribersText(v.channelId);
      if (el && text && state.currentVideoId === v.id) el.textContent = text;
    });
  }

  $('#comments-title').textContent = v.comments != null
    ? `Comentários · ${compact.format(Number(v.comments))}`
    : 'Comentários';
  document.title = `${v.title} · Canais`;
  renderUpNextSeg(v);
}

/** "A seguir": Todos os canais ou só os vídeos deste canal (o mesmo filtro do endereço). */
function renderUpNextSeg(v) {
  const seg = $('#upnext-seg');
  if (!seg) return;
  if (!v || !isHomeChannel(v.channelId)) { seg.hidden = true; seg.innerHTML = ''; return; }
  const one = state.filter === v.channelId;
  seg.innerHTML = `
    <button type="button" data-ctx="" aria-pressed="${!one}">Todos</button>
    <button type="button" data-ctx="${esc(v.channelId)}" aria-pressed="${one}" title="${esc(v.channelTitle)}">${esc(v.channelTitle)}</button>`;
  seg.hidden = false;
  placeSegThumb(seg);
}

function setUpNextContext(channelId) {
  const v = state.currentVideo;
  if (!v || (state.filter || '') === channelId) return;
  const seg = $('#upnext-seg');
  const thumb = seg?.querySelector('.seg-thumb');
  const from = thumb ? { left: thumb.style.left, width: thumb.style.width } : null;
  state.filter = channelId || null;
  state.sort = 'new';
  state.watchFeed = currentFeed();
  history.replaceState(history.state, '', watchHref(v.id));
  nav.hashes[nav.idx] = currentHash();
  watchHistory.ctx[v.id] = watchContext();
  saveWatchHistory();
  seg?.querySelectorAll('[data-ctx]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ctx === channelId)));
  placeSegThumb(seg, from);
  upNextCount = upNextPage();
  $('#upnext').innerHTML = miniSkeletons(upNextPage());
  renderUpNext(v);
}

function showWatchBlocked(message) {
  pausePlayer();
  showPlayerError(message, '<a class="btn btn-primary btn-sm" href="#/">Voltar ao início</a>');
  $('#watch-info').innerHTML = '';
  $('#upnext').innerHTML = '';
  $('#upnext-more').hidden = true;
  $('#comments-list').innerHTML = '';
  $('#comments-more').hidden = true;
  $('#comments-title').textContent = 'Comentários';
}

function enterWatch(id, { resume = false } = {}) {
  if (playerVideoId && playerVideoId !== id) saveProgress();
  const miniVideo = resume && state.currentVideo?.id === id ? state.currentVideo : null;
  state.currentVideoId = id;
  state.currentVideo = null;
  pokeControls(); // abrindo um vídeo (ou voltando do mini player): os controles aparecem por um instante
  updateSkipButtons();
  upNextCount = upNextPage();
  Comments.req++; // cancela respostas de comentários do vídeo anterior
  $('#player-error').hidden = true;

  state.watchFeed = currentFeed();
  const known = state.watchFeed.items.find(v => v.id === id) || findLoadedVideo(id) || miniVideo;
  if (known) renderWatchInfo(known);
  else $('#watch-info').innerHTML = watchInfoSkeleton();
  $('#upnext').innerHTML = miniSkeletons(upNextPage());
  $('#upnext-more').hidden = true;
  $('#comments-list').innerHTML = commentSkeletons(3);
  $('#comments-more').hidden = true;

  if (!state.channels.length || !hasCredentials()) {
    showWatchBlocked(!state.channels.length
      ? 'Adicione canais nos Ajustes para assistir aos vídeos.'
      : 'Entre com o Google ou configure uma chave de API para assistir aos vídeos.');
    return;
  }

  (async () => {
    let video = known;
    if (!video) {
      // Link direto, recarregamento, "Anterior": só vale vídeo de um canal configurado.
      try {
        video = (await fetchVideos([id])).get(id);
      } catch (e) {
        if (state.currentVideoId === id) showWatchBlocked(e.message);
        return;
      }
      if (state.currentVideoId !== id) return;
    }
    // O que não é do app (outro canal, Short, live gravada, acima do limite de duração)
    // simplesmente não existe no app: sem aviso, segue para outro lugar.
    if (!video || !(await isAppVideo(video))) {
      if (state.currentVideoId === id) skipNonApp(id);
      return;
    }
    if (state.currentVideoId !== id) return;
    if (!known) renderWatchInfo(video);
    state.currentVideo = video;
    recordWatchHistory(id);
    markSeen(id);
    if (resume && playerVideoId === id) {
      // Veio do mini player: o vídeo já está tocando no mesmo player; só volta ao tamanho normal.
      updatePlayButton();
      updateProgressUI();
    } else {
      playVideo(id);
    }
    loadComments(id, true);
    renderUpNext(video);
  })();
}

/** Vídeo que o app mostra: live no ar (menu "Ao vivo") ou vídeo da aba "Vídeos" do canal,
    dentro do limite de duração. Shorts e lives gravadas ficam de fora. */
async function isAppVideo(v) {
  if (v.blocked) return false; // não toca fora do YouTube
  if (v.live === 'live') return true;
  if (!shownInApp(v)) return false;
  for (const feed of feeds.values()) if (feed.items.some(item => item.id === v.id)) return true; // veio da aba "Vídeos"
  return inVideosTab(v);
}

const videosTabChecks = new Map(); // vídeo -> está na aba "Vídeos"? (vale até recarregar)

async function inVideosTab(v) {
  if (videosTabChecks.has(v.id)) return videosTabChecks.get(v.id);
  const playlistId = 'UULF' + v.channelId.slice(2);
  let found = parseIndexList(store.get(UPLOAD_INDEX_KEY, {})[playlistId]?.list).some(e => e.id === v.id);
  if (!found) {
    try {
      // Pergunta ao YouTube se o vídeo está na aba "Vídeos" do canal (1 unidade de cota).
      const data = await api('playlistItems', { part: 'id', playlistId, videoId: v.id, maxResults: 1 });
      found = Boolean(data.items?.length);
    } catch (e) {
      found = e.status === 404 ? false : true; // sem conexão/cota: não esconde o que pode ser válido
    }
  }
  videosTabChecks.set(v.id, found);
  return found;
}

/** Vídeo que não é do app: vai para o anterior válido (se veio do "Anterior") ou para o Início. */
function skipNonApp(id) {
  watchHistory.stack = watchHistory.stack.filter(x => x !== id);
  if (watchHistory.last === id) watchHistory.last = null;
  saveWatchHistory();
  if (goingBack && previousVideoId()) {
    playPrevious();
    return;
  }
  goingBack = false;
  replaceRoute('#/');
}

/** Vídeos seguintes = os próximos do feed (mais antigos) depois do vídeo atual. */
function upNextSlice(video) {
  const feed = state.watchFeed || currentFeed();
  let start = feed.items.findIndex(v => v.id === video.id);
  if (start >= 0) start += 1;
  else {
    start = feed.items.findIndex(v => (feed.ascending ? v.publishedAt > video.publishedAt : v.publishedAt < video.publishedAt));
    if (start < 0) return { list: [], ready: feed.exhausted, hasMore: !feed.exhausted };
  }
  const rest = feed.items.slice(start).filter(v => !state.hideWatched || !isWatched(v.id));
  const list = rest.slice(0, upNextCount);
  const hasMore = rest.length > upNextCount || !feed.exhausted;
  return { list, ready: list.length >= upNextCount || feed.exhausted, hasMore };
}

function nextVideoAfter(video) {
  if (!video) return null;
  return upNextSlice(video).list[0] || null;
}

function miniHTML(v, i) {
  return `
    <a class="mini${isWatched(v.id) ? ' is-watched' : ''}" href="${watchHref(v.id)}" data-vid="${v.id}" style="--i:${i}">
      <div class="thumb">
        <img src="${esc(v.thumbSmall)}" alt="" loading="lazy" decoding="async">
        ${thumbBadge(v)}
        ${progressBarHTML(v.id)}
      </div>
      <div>
        <h3 class="mini-title" title="${esc(v.title)}">${esc(v.title)}</h3>
        <p class="mini-meta">${esc(v.channelTitle)}</p>
        <p class="mini-meta">${esc(metaLine(v))}${newTag(v)}</p>
      </div>
    </a>`;
}

async function renderUpNext(video) {
  const id = video.id;
  const box = $('#upnext');
  const more = $('#upnext-more');
  more.disabled = true;

  let slice = upNextSlice(video);
  let failure = null;
  // No máximo 5 páginas por vez (economiza cota quando "Ocultar assistidos" esconde muita coisa).
  for (let guard = 0; !slice.ready && guard < 5; guard++) {
    try {
      await (state.watchFeed || currentFeed()).loadMore();
    } catch (e) {
      failure = e;
      break;
    }
    if (state.currentVideoId !== id) return;
    slice = upNextSlice(video);
  }
  if (state.currentVideoId !== id) return;

  if (slice.list.length) {
    box.innerHTML = slice.list.map(miniHTML).join('');
  } else {
    // "Mais antigo" só quando a lista acabou de verdade; se ainda há o que buscar, fica o "Mostrar mais".
    box.innerHTML = failure
      ? `<p class="error">${esc(failure.message)}</p>`
      : slice.hasMore ? ''
      : `<p class="muted">Não há vídeos seguintes. Este é o vídeo mais antigo ${state.filter ? 'deste canal' : 'dos seus canais'}.</p>`;
  }
  more.hidden = !slice.hasMore || Boolean(failure);
  more.disabled = false;
  updateSkipButtons();
}

/* ---------- Comentários ---------- */
const Comments = { videoId: null, token: null, done: false, req: 0, loading: false };

function commentBody(s) {
  const edited = s.updatedAt && s.updatedAt !== s.publishedAt ? ' (editado)' : '';
  return `
    <div class="comment-row">
      <img class="avatar sm" src="${esc(s.authorProfileImageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
      <div class="comment-content">
        <div class="comment-head">
          <strong>${esc(s.authorDisplayName)}</strong>
          <span class="muted">${esc(timeAgo(Date.parse(s.publishedAt)) + edited)}</span>
        </div>
        <div class="comment-text">${richText(s.textOriginal ?? s.textDisplay)}</div>
        ${s.likeCount ? `<div class="comment-likes">${LIKE_ICON}${esc(compact.format(s.likeCount))}</div>` : ''}
      </div>
    </div>`;
}

function commentThreadHTML(thread) {
  const top = thread.snippet.topLevelComment;
  const n = thread.snippet.totalReplyCount || 0;
  const label = `${n} ${n === 1 ? 'resposta' : 'respostas'}`;
  return `
    <article class="comment">
      ${commentBody(top.snippet)}
      ${n ? `
        <div class="comment-replies">
          <button class="link-btn" type="button" data-action="replies" data-parent="${esc(top.id)}" data-label="${label}">▾ ${label}</button>
          <div class="replies" hidden></div>
        </div>` : ''}
    </article>`;
}

async function loadComments(videoId, reset = false) {
  const list = $('#comments-list');
  const more = $('#comments-more');
  if (reset) {
    Object.assign(Comments, { videoId, token: null, done: false, loading: false });
    Comments.req++;
  }
  if (Comments.loading || Comments.done || Comments.videoId !== videoId) return;

  const req = Comments.req;
  Comments.loading = true;
  more.disabled = true;
  try {
    const data = await api('commentThreads', {
      part: 'snippet',
      videoId,
      maxResults: 20,
      order: 'relevance',
      textFormat: 'plainText',
      pageToken: Comments.token,
    });
    if (req !== Comments.req) return;
    const html = (data.items || []).map(commentThreadHTML).join('');
    if (reset) list.innerHTML = html || '<p class="muted">Ainda não há comentários neste vídeo.</p>';
    else list.insertAdjacentHTML('beforeend', html);
    Comments.token = data.nextPageToken || null;
    Comments.done = !Comments.token;
  } catch (e) {
    if (req !== Comments.req) return;
    if (reset) list.innerHTML = `<p class="${['commentsDisabled', 'needsApiKey'].includes(e.reason) ? 'muted' : 'error'}">${esc(e.message)}</p>`;
    else toast(e.message, 'error');
    Comments.done = true;
  } finally {
    if (req === Comments.req) {
      Comments.loading = false;
      more.disabled = false;
      more.hidden = Comments.done;
    }
  }
}

async function toggleReplies(btn) {
  const box = btn.nextElementSibling;
  if (box.dataset.loaded) {
    box.hidden = !box.hidden;
    btn.textContent = box.hidden ? `▾ ${btn.dataset.label}` : '▴ Ocultar respostas';
    return;
  }
  btn.disabled = true;
  try {
    const data = await api('comments', {
      part: 'snippet',
      parentId: btn.dataset.parent,
      maxResults: 50,
      textFormat: 'plainText',
    });
    box.innerHTML = (data.items || []).map(c => `<div class="comment">${commentBody(c.snippet)}</div>`).join('');
    box.dataset.loaded = '1';
    box.hidden = false;
    btn.textContent = '▴ Ocultar respostas';
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* =========================================================
   Ajustes
   ========================================================= */
function premiumNote() {
  return `
    <p class="note">
      <strong>Sobre anúncios e YouTube Premium:</strong> o Google não informa o plano da conta (Premium ou não)
      para aplicativos de terceiros — não existe API para isso. Este app não exibe nenhum anúncio próprio, e os
      anúncios dentro dos vídeos dependem só da sua sessão no <strong>youtube.com</strong> neste navegador (não
      deste login): com <strong>YouTube Premium</strong> conectado lá, os vídeos tocam sem anúncios.
    </p>`;
}

function renderAccount() {
  const side = $('#account');
  const miniBox = $('#account-mini');
  const card = $('#account-card');
  const panel = $('#account-panel');
  const connected = Boolean(Auth.validToken());
  const account = connected ? { profile: Auth.profile, ytChannel: Auth.ytChannel } : Auth.remembered;
  const syncing = connected && Auth.hasDriveScope && !Sync.off;
  const syncLine = !connected ? '' : syncing
    ? (Sync.status === 'syncing' ? 'Sincronizando…' : Sync.meta.lastSync ? `Sincronizado ${timeAgo(Sync.meta.lastSync)}` : 'Sincronização ativa')
    : 'Conectado';

  if (!account) {
    side.innerHTML = `<button class="btn btn-google btn-sm" type="button" data-action="signin">${ICONS.google}<span>Entrar com o Google</span></button>`;
    miniBox.innerHTML = SF('person');
    miniBox.title = 'Entrar com o Google';
    card.innerHTML = `
      <div class="row acct-card">
        <span class="acct-ph">${SF('person')}</span>
        <span class="grow"><b>Conta Google</b><span class="sub">Entre para usar a sua conta do YouTube e sincronizar</span></span>
        <button class="btn btn-google btn-sm" type="button" data-action="signin">${ICONS.google}Entrar</button>
        ${SF('chev-r', 'ic chev')}
      </div>`;
    panel.innerHTML = `
      <div class="account-panel">
        <p class="muted">Entre com sua conta Google para usar o app com a sua conta do YouTube.
          ${state.config.apiKey ? 'Com a chave de API salva, o login é opcional.' : ''}</p>
        <div><button class="btn btn-google" type="button" data-action="signin">${ICONS.google}Entrar com o Google</button></div>
        ${premiumNote()}
      </div>`;
    renderSyncStatus();
    return;
  }

  const p = account.profile;
  const name = p?.name || account.ytChannel?.title || 'Conta Google';
  const pic = p?.picture || account.ytChannel?.thumb || '';
  const avatar = cls => `<img class="${cls}" src="${esc(pic)}" alt="" referrerpolicy="no-referrer" data-hide-broken>`;

  side.innerHTML = connected
    ? `<a class="acct" href="#/settings/conta" title="${esc(name)}">${avatar('')}<span class="acct-text"><b>${esc(p?.given_name || name)}</b><span>${esc(syncLine)}</span></span>${SF('chev-r')}</a>`
    : `<button class="btn btn-google btn-sm" type="button" data-action="signin" title="Sessão expirada">${ICONS.google}<span>Reconectar</span></button>`;
  miniBox.innerHTML = pic ? avatar('') : esc([...name.trim()][0] || '?');
  miniBox.title = name;

  card.innerHTML = `
    <div class="row acct-card" data-action="open-account">
      ${avatar('')}
      <span class="grow"><b>${esc(name)}</b><span class="sub">${connected ? (Auth.hasYtScope ? 'Conectada · YouTube só leitura' : 'Falta autorizar o YouTube') : 'Sessão expirada'}</span></span>
      ${connected
        ? '<button class="btn btn-fill btn-sm" type="button" data-action="signout">Sair</button>'
        : `<button class="btn btn-google btn-sm" type="button" data-action="signin">${ICONS.google}Reconectar</button>`}
      ${SF('chev-r', 'ic chev')}
    </div>`;

  let status;
  if (!connected) {
    status = `
      <p class="note">
        <strong>Sessão expirada.</strong> ${Auth.server()
          ? 'A renovação automática do login vale por até 7 dias (limite do Google); depois disso é preciso entrar de novo.'
          : 'Por segurança, o Google limita o login de apps web a 1 hora.'}
        ${state.config.apiKey
          ? 'Como você tem uma chave de API salva, o app continua funcionando normalmente — reconectar é opcional.'
          : 'Toque em “Reconectar” para continuar carregando vídeos.'}
      </p>`;
  } else if (Auth.hasYtScope) {
    const until = new Date(Auth.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    status = Auth.session
      ? '<span class="tier">Conectado · acesso ao YouTube autorizado · login renovado automaticamente neste aparelho</span>'
      : `<span class="tier">Conectado · acesso ao YouTube autorizado · sessão válida até ${until}</span>`;
    if (Auth.server() && !Auth.session) {
      status += `
        <p class="note">Servidor de login configurado. Entre de novo uma vez para o login se renovar sozinho por até 7 dias.</p>
        <div><button class="btn btn-tint btn-sm" type="button" data-action="signin">Ativar renovação automática</button></div>`;
    }
  } else {
    status = `
      <p class="note note-warn">
        <strong>Falta autorizar o acesso ao YouTube.</strong> Na tela do Google, marque a caixa
        “Ver sua conta do YouTube”, senão o app não consegue listar vídeos e canais com a sua conta.
      </p>
      <div><button class="btn btn-tint btn-sm" type="button" data-action="signin">Autorizar acesso ao YouTube</button></div>`;
  }

  panel.innerHTML = `
    <div class="account-panel group group-pad">
      <div>
        <strong>${esc(name)}</strong>
        ${p?.email ? `<div class="muted">${esc(p.email)}</div>` : ''}
        ${account.ytChannel ? `<div class="muted">Canal no YouTube: ${esc(account.ytChannel.title)}</div>` : ''}
      </div>
      ${status}
      ${premiumNote()}
      <div><button class="btn btn-fill btn-sm" type="button" data-action="signout">Sair da conta</button></div>
    </div>`;
  renderSyncStatus();
}

function renderChannelList() {
  const ul = $('#channel-list');
  const n = state.channels.length;
  $('#channel-count').textContent = n ? `· ${n}` : '';
  const row = $('#channel-count-row');
  if (row) row.textContent = n || '';
  if (!n) {
    ul.innerHTML = '<li class="channel-empty">Nenhum canal adicionado ainda.</li>';
    return;
  }
  ul.innerHTML = state.channels.map(c => `
    <li class="channel-item" data-id="${esc(c.id)}">
      <img src="${esc(c.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
      <div class="ci-text">
        <strong>${esc(c.title)}</strong>
        <span>${esc(c.handle || c.id)}</span>
      </div>
      <label class="channel-dur" title="Duração máxima dos vídeos deste canal (hh:mm:ss). Vídeos mais longos não aparecem e não contam nas Estatísticas. Vazio = sem limite.">
        ${SF('timer')}
        <input type="text" inputmode="numeric" placeholder="Sem limite" maxlength="8" spellcheck="false" autocomplete="off"
          value="${c.maxDur ? fmtHms(c.maxDur) : ''}" data-max-dur="${esc(c.id)}" aria-label="Duração máxima dos vídeos de ${esc(c.title)} (hh:mm:ss)">
      </label>
      <label class="channel-switch" title="Quando ativado, o canal só aparece em “Ao Vivo” enquanto estiver transmitindo">
        <span class="switch-label">Só lives</span>
        <input class="switch sm" type="checkbox" data-lives-only="${esc(c.id)}" ${c.livesOnly ? 'checked' : ''}>
      </label>
      <button class="ci-remove" type="button" data-action="remove-channel" data-id="${esc(c.id)}" aria-label="Remover ${esc(c.title)}" title="Remover">${SF('minus-c')}</button>
    </li>`).join('');
}

const SETTINGS_SUBS = { canais: 'Canais', conta: 'Conta Google', app: 'App no celular', sobre: 'Sobre' };

function renderSettings(sub = '') {
  const view = $('#view-settings');
  if (SETTINGS_SUBS[sub]) view.dataset.sub = sub;
  else delete view.dataset.sub;
  $('#settings-title').textContent = SETTINGS_SUBS[sub] || 'Ajustes';
  document.title = `${SETTINGS_SUBS[sub] || 'Ajustes'} · Canais`;
  $$('input[data-setting="autoplay"]').forEach(i => { i.checked = state.autoplay; });
  $$('input[data-setting="hide-watched"]').forEach(i => { i.checked = state.hideWatched; });
  $$('[data-version]').forEach(el => { el.textContent = APP_VERSION; });
  const icon = $('#about-icon');
  if (icon && !icon.firstChild) icon.innerHTML = appIconSVG(64);
  renderInstallPanel();
  renderVersionInfo();
  renderAccount();
  renderChannelList();
  if (sub === 'canais') requestAnimationFrame(() => { if (!state.channels.length && !isMobile()) $('#channel-input').focus(); });
}

/** Interruptores dos Ajustes (reprodução automática, ocultar assistidos, sincronização). */
function onSettingChange(input) {
  const kind = input.dataset.setting;
  if (kind === 'autoplay') {
    if (input.checked !== state.autoplay) toggleAutoplay({ quiet: true });
    $$('input[data-setting="autoplay"]').forEach(i => { i.checked = state.autoplay; });
  } else if (kind === 'hide-watched') {
    if (input.checked !== state.hideWatched) toggleHideWatched();
  } else if (kind === 'sync') {
    if (!Auth.validToken() || !Auth.hasDriveScope) {
      input.checked = false;
      Auth.signIn();
      return;
    }
    Sync.setOff(!input.checked);
  }
}

/* Adicionar canal: só pelo link do canal com @ (https://www.youtube.com/@canal), como aparece na barra
   do navegador ao abrir o canal no YouTube. Também vale o link do "Compartilhar" do app do YouTube
   (youtube.com/@canal, m.youtube.com/@canal, com ?si=… ou /videos no fim). Nome, ID e link de vídeo
   não são aceitos. O canal é encontrado pelo @ (1 unidade de cota). */
const CHANNEL_LINK_RE = /^https:\/\/(?:(?:www|m)\.)?youtube\.com\/(@[\p{L}\p{N}._-]{3,100})(?:\/(?:videos|featured|streams|shorts|live|playlists|about|community))?\/?(?:[?#].*)?$/iu;
const CHANNEL_LINK_HELP = 'Use o link do canal no formato https://www.youtube.com/@canal (abra o canal no YouTube e copie o endereço).';

function parseChannelInput(raw) {
  let s = raw.trim();
  try { s = decodeURI(s); } catch { /* endereço com % inválido: testa como está */ }
  const m = CHANNEL_LINK_RE.exec(s);
  return m ? { handle: m[1] } : null;
}

async function resolveChannel(raw) {
  const q = parseChannelInput(raw);
  if (!q) throw new Error(`“${raw}” não é um link de canal. ${CHANNEL_LINK_HELP}`);
  const item = (await api('channels', { part: 'snippet,contentDetails', forHandle: q.handle })).items?.[0];
  if (!item) throw new Error(`Canal não encontrado: ${raw}`);

  const t = item.snippet.thumbnails || {};
  return {
    id: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl || '',
    thumb: (t.default || t.medium || t.high)?.url || '',
    uploads: item.contentDetails?.relatedPlaylists?.uploads || `UU${item.id.slice(2)}`,
  };
}

/** Grava os canais neste aparelho e atualiza a tela (usado também quando chegam da nuvem). */
function persistChannels() {
  store.set(KEYS.channels, state.channels);
  if (state.filter && !isHomeChannel(state.filter)) state.filter = null;
  renderChannelList();
  renderSidebar();
  resetFeed();
  Lives.items = Lives.items.filter(v => channelById(v.channelId));
  refreshLives(true);
}

function saveChannels() {
  persistChannels();
  Sync.touch('channels');
}

async function onChannelSubmit(e) {
  e.preventDefault();
  const input = $('#channel-input');
  const btn = $('#channel-form button[type="submit"]');
  const entries = input.value.split(/,+|\s+/).map(s => s.trim()).filter(Boolean);
  if (!entries.length) return;
  if (!hasCredentials()) {
    toast('Entre com o Google ou salve uma chave de API antes de adicionar canais.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Adicionando…';
  let added = 0;
  const failed = [];
  for (const entry of entries) {
    try {
      const ch = await resolveChannel(entry);
      if (state.channels.some(c => c.id === ch.id)) {
        toast(`“${ch.title}” já está na sua lista.`);
        continue;
      }
      state.channels.push(ch);
      added++;
    } catch (err) {
      failed.push(entry);
      toast(err.message, 'error', 10000);
    }
  }
  btn.disabled = false;
  btn.textContent = 'Adicionar';
  if (added) {
    saveChannels();
    toast(added === 1 ? 'Canal adicionado.' : `${added} canais adicionados.`, 'success');
  }
  input.value = failed.join(', ');
  input.focus();
}

function setLivesOnly(id, enabled) {
  const ch = channelById(id);
  if (!ch) return;
  ch.livesOnly = enabled;
  store.set(KEYS.channels, state.channels);
  Sync.touch('channels');
  if (state.filter === id) state.filter = null;
  renderSidebar();
  resetFeed(); // as lives não mudam: a verificação de "Ao vivo" já inclui todos os canais
  toast(enabled
    ? `“${ch.title}” agora aparece só em “Ao vivo”, quando estiver transmitindo.`
    : `“${ch.title}” voltou para o Início e para a lista de canais.`, 'success');
}

function setMaxDuration(id, input) {
  const ch = channelById(id);
  if (!ch) return;
  const sec = parseHms(input.value);
  if (sec === null) {
    toast('Use o formato hh:mm:ss, por exemplo 00:20:00 para vídeos de até 20 minutos.', 'error', 6000);
    input.value = ch.maxDur ? fmtHms(ch.maxDur) : '';
    return;
  }
  input.value = sec ? fmtHms(sec) : '';
  if (sec === (ch.maxDur || 0)) return;
  if (sec) ch.maxDur = sec;
  else delete ch.maxDur;
  store.set(KEYS.channels, state.channels);
  Sync.touch('channels');
  resetFeed();
  toast(sec
    ? `“${ch.title}”: só vídeos de até ${fmtHms(sec)}.`
    : `“${ch.title}”: sem limite de duração.`, 'success');
}

function removeChannel(id) {
  const ch = channelById(id);
  const li = $(`.channel-item[data-id="${CSS.escape(id)}"]`);
  const apply = () => {
    state.channels = state.channels.filter(c => c.id !== id);
    saveChannels();
    if (ch) toast(`“${ch.title}” removido.`);
  };
  if (li && !reducedMotion.matches) {
    li.classList.add('removing');
    setTimeout(apply, 220);
  } else apply();
}

/** Canais alterados em outra aba (ex.: limite de duração nos Ajustes com as Estatísticas abertas): aplica na hora. */
function onChannelsStored() {
  state.channels = store.get(KEYS.channels, []);
  if (state.filter && !isHomeChannel(state.filter)) state.filter = null;
  renderSidebar();
  resetFeed();
  if (state.view === 'stats') renderStats({ refresh: false });
  else if (state.view === 'settings') renderChannelList();
  else if (state.view === 'home') showHome();
}

/** A página de credenciais (credenciais.html) salvou algo: aplica na hora, sem recarregar o app. */
function onConfigStored() {
  const before = state.config;
  state.config = loadConfig();
  const saved = store.get(KEYS.sync, {});
  Sync.meta.at = { ...Sync.meta.at, ...(saved.at || {}) };
  if ((state.config.loginServer || '') !== (before.loginServer || '')) {
    Auth.setSession(null); // a chave de renovação era do servidor antigo
    Auth.scheduleExpiry();
  }
  renderAccount();
  if (state.config.apiKey !== before.apiKey) Sync.schedule(SYNC_QUICK_MS);
  if (state.config.apiKey !== before.apiKey || state.config.clientId !== before.clientId) onCredentialsChanged();
}

function onCredentialsChanged() {
  const feed = currentFeed();
  if (feed.error || !feed.items.length) resetFeed();
  if (Lives.error || !Lives.lastFetch) refreshLives(true);
  if (state.view === 'home') showHome();
}

/* =========================================================
   Sincronização na nuvem (pasta oculta do app no Google Drive)
   =========================================================
   Um único arquivo JSON fica na "appDataFolder" do Google Drive
   da sua conta: é privada deste app, não aparece entre os seus
   arquivos e nenhum outro app consegue ler. A cada sincronização
   o app baixa o arquivo, MESCLA com os dados deste aparelho e
   envia o resultado — então nenhum aparelho apaga o outro:
     • canais, opções e chave de API: vale a alteração mais recente;
     • progresso: vale o registro mais recente de cada vídeo;
     • estatísticas: cada aparelho tem o seu registro; juntam-se todos;
     • vídeos já vistos ("Novo"): soma dos dois aparelhos.
   ========================================================= */
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SYNC_FILE = 'meutube-sync.json';
const SYNC_QUICK_MS = 1500;      // depois de mudar canais/opções
const SYNC_PROGRESS_MS = 30_000; // progresso muda o tempo todo: no máximo a cada 30 s
const SYNC_PULL_MS = 2 * 60_000; // busca novidades de outros aparelhos a cada 2 min

async function driveFetch(url, opts = {}) {
  const token = Auth.validToken();
  if (!token || !Auth.hasDriveScope) throw new Error('Entre com o Google para sincronizar.');
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  } catch {
    throw new Error('Sem conexão com o Google Drive.');
  }
  if (res.status === 401 && !opts.retried && Auth.session && await Auth.refresh()) {
    return driveFetch(url, { ...opts, retried: true }); // renovou pelo servidor de login: tenta de novo
  }
  if (res.status === 401) {
    // Login recusado pelo Google (expirou antes da hora ou foi encerrado em outro lugar):
    // trata como sessão expirada, e o painel passa a oferecer "Reconectar".
    Auth.clear();
    toast('Sua sessão do Google foi encerrada. Clique em “Reconectar” para voltar a sincronizar.', 'info', 8000);
    const err = new Error('Sessão do Google encerrada. Clique em “Reconectar”.');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
    const message = reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(data?.error?.message || '')
      ? 'A Google Drive API não está ativada no seu projeto do Google Cloud.'
      : reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
        ? 'Falta a permissão do Google Drive.'
        : data?.error?.message || `Erro ${res.status} no Google Drive.`;
    const err = new Error(message);
    err.status = res.status;
    err.reason = reason;
    throw err;
  }
  return res;
}

const Sync = {
  meta: { fileId: null, lastSync: 0, at: {}, ...store.get(KEYS.sync, {}) },
  timer: 0,
  due: 0,
  running: null,
  again: false,
  status: 'idle', // idle | syncing | ok | error
  error: null,
  lastUploaded: '',
  off: store.get(KEYS.syncOff, false),

  enabled() {
    return Boolean(!this.off && Auth.validToken() && Auth.hasDriveScope);
  },

  /** Interruptor dos Ajustes: liga ou desliga a sincronização neste aparelho. */
  setOff(off) {
    this.off = off;
    store.set(KEYS.syncOff, off);
    if (!off) this.run();
    renderSyncStatus();
    renderAccount();
  },

  saveMeta() {
    store.set(KEYS.sync, this.meta);
  },

  /** Marca uma seção (channels | prefs | apiKey) como alterada agora neste aparelho. */
  touch(section) {
    this.meta.at[section] = Date.now();
    this.saveMeta();
    this.schedule(SYNC_QUICK_MS);
  },

  /** Agenda uma sincronização; um agendamento mais cedo nunca é adiado por um mais tarde. */
  schedule(delay = SYNC_QUICK_MS) {
    if (!this.enabled()) return;
    const due = Date.now() + delay;
    if (this.timer && this.due <= due) return;
    clearTimeout(this.timer);
    this.due = due;
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.run();
    }, delay);
  },

  snapshot() {
    // Seções que já existiam antes da sincronização (sem data) contam como "bem antigas" (1),
    // para que qualquer alteração real feita em outro aparelho prevaleça sobre elas.
    const at = section => this.meta.at[section] || 1;
    return {
      version: 1,
      channels: { at: at('channels'), value: state.channels },
      prefs: { at: at('prefs'), value: { hideWatched: state.hideWatched, autoplay: state.autoplay } },
      apiKey: { at: state.config.apiKey ? at('apiKey') : (this.meta.at.apiKey || 0), value: state.config.apiKey },
      progress: progressStore,
      seen: [...seenVideos].slice(-3000),
      watchLog,
      videoChannels,
    };
  },

  run() {
    if (!this.enabled()) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    clearTimeout(this.timer);
    this.timer = 0;
    this.running = this._run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.schedule(SYNC_QUICK_MS);
      }
    });
    return this.running;
  },

  async _run() {
    this.status = 'syncing';
    renderSyncStatus();
    try {
      let fileId = this.meta.fileId;
      let remote = null;
      if (fileId) {
        try {
          remote = await (await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`)).json();
        } catch (e) {
          if (e.status !== 404) throw e;
          fileId = null; // o arquivo foi apagado: procura de novo / recria
        }
      }
      if (!fileId) {
        const q = encodeURIComponent(`name='${SYNC_FILE}'`);
        const list = await (await driveFetch(
          `${DRIVE_FILES}?spaces=appDataFolder&q=${q}&orderBy=modifiedTime%20desc&fields=files(id)`)).json();
        fileId = list.files?.[0]?.id || null;
        if (fileId) remote = await (await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`)).json();
      }

      const changed = remote ? this.merge(remote) : false;
      const remoteBody = remote ? JSON.stringify({ ...remote, updatedAt: undefined }) : '';
      const body = JSON.stringify(this.snapshot());

      if (body !== remoteBody && body !== this.lastUploaded) {
        const payload = JSON.stringify({ ...JSON.parse(body), updatedAt: Date.now() });
        if (fileId) {
          await driveFetch(`${DRIVE_UPLOAD}/${fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          });
        } else {
          const boundary = `meutube${Math.random().toString(36).slice(2)}`;
          const metadata = { name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' };
          const multipart = [
            `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata),
            `--${boundary}`, 'Content-Type: application/json', '', payload,
            `--${boundary}--`,
          ].join('\r\n');
          const res = await driveFetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: multipart,
          });
          fileId = (await res.json()).id;
        }
        this.lastUploaded = body;
      }

      // Resumo do que ficou na nuvem (após a mescla, a nuvem tem exatamente o snapshot deste aparelho).
      const final = JSON.parse(body);
      this.meta.cloud = {
        channels: final.channels.value.length,
        progress: Object.values(final.progress || {}).filter(p => p && !p.gone).length,
        updatedAt: body === remoteBody ? (remote.updatedAt || Date.now()) : Date.now(),
      };

      const firstSync = !this.meta.lastSync;
      this.meta.fileId = fileId;
      this.meta.lastSync = Date.now();
      this.saveMeta();
      this.status = 'ok';
      this.error = null;
      if (changed && firstSync) toast('Seus canais, opções e progresso foram carregados da nuvem.', 'success', 6000);
    } catch (e) {
      this.status = 'error';
      this.error = e;
      if (e.reason === 'insufficientPermissions' || e.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
        Auth.hasDriveScope = false;
        Auth.persist();
        renderAccount();
      }
    }
    renderSyncStatus();
  },

  /** Junta os dados da nuvem com os deste aparelho. Retorna true se algo local mudou. */
  merge(remote) {
    const changes = {};
    const local = this.meta.at;

    const rc = remote.channels;
    if (rc && Array.isArray(rc.value)) {
      if (!local.channels && state.channels.length && rc.value.length) {
        // Primeira sincronização deste aparelho, que já tinha canais: junta as duas listas.
        const ids = new Set(rc.value.map(c => c.id));
        const extra = state.channels.filter(c => !ids.has(c.id));
        if (extra.length || rc.value.length !== state.channels.length) changes.channels = [...rc.value, ...extra];
        local.channels = extra.length ? Date.now() : rc.at;
      } else if ((rc.at || 0) > (local.channels || 0)) {
        changes.channels = rc.value;
        local.channels = rc.at;
      }
    }
    if (remote.prefs?.value && (remote.prefs.at || 0) > (local.prefs || 0)) {
      changes.prefs = remote.prefs.value;
      local.prefs = remote.prefs.at;
    }
    if (typeof remote.apiKey?.value === 'string' && (remote.apiKey.at || 0) > (local.apiKey || 0)
        && (remote.apiKey.value || !state.config.apiKey)) {
      changes.apiKey = remote.apiKey.value;
      local.apiKey = remote.apiKey.at;
    }

    const progressIds = [];
    for (const [id, r] of Object.entries(remote.progress || {})) {
      const l = progressStore[id];
      if (r && (!l || (r.at || 0) > (l.at || 0))) {
        progressStore[id] = r;
        progressIds.push(id);
      }
    }
    const seenIds = (remote.seen || []).filter(id => !seenVideos.has(id));

    const statsChanged = mergeWatchLog(remote.watchLog, remote.videoChannels);

    this.saveMeta();
    this.apply(changes, progressIds, seenIds);
    if ((statsChanged || progressIds.length || changes.channels) && state.view === 'stats') renderStats({ refresh: false });
    return Boolean(Object.keys(changes).length || progressIds.length || seenIds.length || statsChanged);
  },

  apply(changes, progressIds, seenIds) {
    if (changes.channels) {
      state.channels = changes.channels;
      persistChannels();
    }
    if (changes.prefs) {
      const p = changes.prefs;
      if (typeof p.hideWatched === 'boolean') {
        state.hideWatched = p.hideWatched;
        store.set(KEYS.hideWatched, state.hideWatched);
        applyHideWatched();
      }
      if (typeof p.autoplay === 'boolean') {
        state.autoplay = p.autoplay;
        store.set(KEYS.autoplay, state.autoplay);
        updateAutoplayButton();
      }
    }
    if (typeof changes.apiKey === 'string' && changes.apiKey !== state.config.apiKey) {
      state.config.apiKey = changes.apiKey;
      store.set(KEYS.config, state.config);
      onCredentialsChanged();
    }
    if (progressIds.length) {
      store.set(KEYS.progress, progressStore);
      progressIds.forEach(updateProgressBars);
    }
    if (seenIds.length) {
      seenIds.forEach(id => seenVideos.add(id));
      store.set(KEYS.seen, [...seenVideos].slice(-3000));
      seenIds.forEach(id => $$(`[data-vid="${id}"] .new-tag`).forEach(el => el.remove()));
    }
    if (state.view === 'settings' && (changes.channels || changes.prefs || changes.apiKey !== undefined)) renderSettings();
    else if (state.view === 'home' && (changes.channels || changes.prefs || progressIds.length)) showHome();
  },
};

function renderSyncStatus() {
  const group = $('#sync-group');
  const box = $('#sync-status');
  if (!box || !group) return;
  const time = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const connected = Boolean(Auth.validToken());
  const on = connected && Auth.hasDriveScope && !Sync.off;
  let sub;
  if (!connected) sub = 'Entre com o Google para sincronizar';
  else if (!Auth.hasDriveScope) sub = 'Falta autorizar o Google Drive';
  else if (Sync.off) sub = 'Desligada neste aparelho';
  else if (Sync.status === 'syncing') sub = 'Sincronizando…';
  else if (Sync.status === 'error') sub = 'Não foi possível sincronizar';
  else sub = Sync.meta.lastSync ? `Última vez: hoje às ${time(Sync.meta.lastSync)}` : 'Ativa';
  if (Sync.meta.lastSync && !isToday(Sync.meta.lastSync) && Sync.status !== 'syncing' && on) {
    sub = `Última vez: ${new Date(Sync.meta.lastSync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
  }
  group.innerHTML = `
    <label class="row" style="min-height:58px">
      <span class="sq-ic" style="--c:var(--blue)">${SF('sync')}</span>
      <span class="grow">Sincronizar com o Google Drive<span class="sub">${esc(sub)}</span></span>
      <input class="switch" type="checkbox" data-setting="sync"${on ? ' checked' : ''}>
    </label>`;

  let html = '';
  if (!connected) {
    html = `<p>Com a sincronização, canais, opções e progresso ficam salvos na sua conta e aparecem nos seus outros aparelhos.
      ${Sync.meta.lastSync ? `Última sincronização: ${new Date(Sync.meta.lastSync).toLocaleString('pt-BR')}.` : ''}</p>`;
  } else if (!Auth.hasDriveScope) {
    html = `
      <p class="note note-warn"><strong>Sincronização na nuvem desligada.</strong> Na tela do Google, marque a permissão
        do Google Drive (“ver, criar e excluir os próprios dados de configuração”). O app só usa uma pasta oculta,
        exclusiva dele — não vê nem mexe nos seus arquivos.</p>
      <button class="btn btn-tint btn-sm" type="button" data-action="signin">Ativar sincronização</button>`;
  } else if (Sync.off) {
    html = '<p>Neste aparelho, nada é enviado nem recebido da nuvem até você ligar de novo.</p>';
  } else if (Sync.status === 'error') {
    html = `
      <p class="note note-warn"><strong>Não foi possível sincronizar:</strong> ${esc(Sync.error?.message || 'erro desconhecido')}
        ${Sync.meta.lastSync ? ` Última sincronização: ${time(Sync.meta.lastSync)}.` : ''}</p>
      <button class="btn btn-fill btn-sm" type="button" data-action="sync-now">Tentar de novo</button>`;
  } else {
    const c = Sync.meta.cloud;
    html = `
      ${c ? `<p class="sync-summary">Na nuvem: <strong>${c.channels}</strong> ${c.channels === 1 ? 'canal' : 'canais'} ·
        <strong>${c.progress}</strong> ${c.progress === 1 ? 'vídeo' : 'vídeos'} com progresso ·
        atualizado em ${new Date(c.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>` : ''}
      <button class="btn btn-fill btn-sm" type="button" data-action="sync-now"${Sync.status === 'syncing' ? ' disabled' : ''}>Sincronizar agora</button>`;
  }
  box.innerHTML = html;
  // O nome da conta no menu mostra quando foi a última sincronização.
  const line = $('#account .acct-text span');
  if (line && connected) line.textContent = on ? (Sync.status === 'syncing' ? 'Sincronizando…' : Sync.meta.lastSync ? `Sincronizado ${timeAgo(Sync.meta.lastSync)}` : 'Sincronização ativa') : 'Conectado';
}

/* =========================================================
   Roteamento + transições entre telas
   ========================================================= */
let pendingHero = null;

/* Histórico do navegador: cada entrada ganha um número (history.state.mtIdx). Assim o gesto de
   arrastar o vídeo para baixo (celular) volta exatamente à entrada da última página que não é de
   vídeo, como o botão voltar faria, e o voltar do Android depois dele não reabre o vídeo. */
const nav = { idx: -1, hashes: [], replacing: false };
/** Última página que não é de vídeo: endereço, entrada do histórico e posição da rolagem. */
let lastPage = null;
/** Rolagem a restaurar quando o gesto chega à página de fundo. */
let navRestore = null;

const currentHash = () => location.hash || '#/';

function trackNav() {
  const s = history.state;
  if (nav.replacing) nav.replacing = false;           // location.replace: mesma posição no histórico
  else if (Number.isInteger(s?.mtIdx)) nav.idx = s.mtIdx; // voltar/avançar (ou F5)
  else {
    nav.idx += 1;                                      // entrada nova: as da frente deixam de existir
    nav.hashes.length = nav.idx;
  }
  if (s?.mtIdx !== nav.idx) history.replaceState({ ...(s && typeof s === 'object' ? s : {}), mtIdx: nav.idx }, '');
  nav.hashes[nav.idx] = currentHash();
}

/** Troca o endereço sem criar entrada no histórico. */
function replaceRoute(hash) {
  if (hash === currentHash()) return;
  nav.replacing = true;
  location.replace(hash);
}

function parseRoute() {
  const hash = location.hash || '#/';
  // O filtro de canal vai junto no endereço do vídeo (#/watch/ID/c/UC…[/antigos]): recarregar
  // a página mantém os vídeos seguintes do mesmo canal.
  const watch = /^#\/watch\/([\w-]{11})(?:\/c\/(UC[\w-]{22})(\/antigos)?)?$/.exec(hash);
  if (watch) return { view: 'watch', id: watch[1], channel: watch[2] || null, sort: watch[3] ? 'old' : 'new' };
  const settings = /^#\/settings(?:\/(canais|conta|app|sobre))?$/.exec(hash);
  if (settings) return { view: 'settings', sub: settings[1] || '' };
  if (hash === '#/stats') return { view: 'stats' };
  if (hash === '#/live') return { view: 'live' };
  if (hash === '#/channels') return { view: 'channels' };
  const channel = /^#\/c\/(UC[\w-]{22})(\/antigos)?$/.exec(hash);
  return { view: 'home', channel: channel?.[1] || null, sort: channel?.[2] ? 'old' : 'new' };
}

function clearHeroNames() {
  $$('[data-hero]').forEach(el => {
    el.style.viewTransitionName = '';
    delete el.dataset.hero;
  });
}

function setHero(el) {
  if (!el) return;
  el.style.viewTransitionName = 'hero';
  el.dataset.hero = '1';
}

function inViewport(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
}

/** Retorna uma promessa quando o Início está remontando a lista (a transição espera por ela). */
function applyView(view, id, channel, sort = 'new', sub = '') {
  let pending = null;
  const prev = state.view;
  if (prev === 'home') state.homeScroll = scrollY;
  if (prev === 'watch' && view !== 'watch') {
    // Saindo do vídeo (canal, filtro do menu, voltar): ele continua no mini player.
    if (canMini()) {
      startMini();
    } else {
      clearDragMini();
      pausePlayer();
      state.currentVideoId = null;
    }
  }
  // Voltando para um vídeo com o mini player aberto: o mesmo vídeo continua de onde está.
  let resume = false;
  if (view === 'watch' && mini.on) {
    resume = playerVideoId === id;
    endMini();
  }

  if (view !== prev) state.pageSidebar = false;
  state.view = view;
  $('#view-home').hidden = view !== 'home';
  $('#view-watch').hidden = view !== 'watch' && !mini.on;
  $('#view-settings').hidden = view !== 'settings';
  $('#view-stats').hidden = view !== 'stats';
  $('#view-live').hidden = view !== 'live';
  $('#view-channels').hidden = view !== 'channels';
  updateSidebarMode();
  $('#search-note').hidden = view !== 'home' || !$('#side-search').value.trim();

  if (view === 'home') {
    const filter = channel && isHomeChannel(channel) ? channel : null;
    const order = filter ? sort : 'new';
    const filterChanged = filter !== state.filter || order !== state.sort;
    state.filter = filter;
    state.sort = order;
    pending = showHome();
    window.scrollTo({ top: filterChanged ? 0 : state.homeScroll, behavior: 'instant' });
  } else if (view === 'watch') {
    const filter = channel && isHomeChannel(channel) ? channel : null;
    state.filter = filter;
    state.sort = filter ? sort : 'new';
    window.scrollTo({ top: 0, behavior: 'instant' });
    enterWatch(id, { resume });
  } else if (view === 'stats') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    statsForecast = ''; // a Previsão sempre abre em "Todos"
    renderStats();
  } else if (view === 'live') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.title = 'Ao Vivo · Canais';
    renderLivePage();
  } else if (view === 'channels') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.title = 'Canais';
    renderChannelsPage();
    if (state.channels.length) ensureChannelStats(state.channels[0].id).then(() => { if (state.view === 'channels') renderChannelsPage(); });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderSettings(sub);
  }
  updateSidebarActive();
  updateToTop();
  // Gesto de arrastar o vídeo para baixo: a página de fundo volta na mesma posição.
  if (navRestore && view !== 'watch') {
    if (navRestore.hash === currentHash()) {
      const top = navRestore.scroll;
      const restore = () => window.scrollTo({ top, behavior: 'instant' });
      restore();
      pending?.then(restore);
      requestAnimationFrame(restore);
    }
    navRestore = null;
  }
  return pending;
}

function route(animate = true) {
  stopPreview();
  stopFrames();
  const { view, id, channel, sort, sub } = parseRoute();
  const prevView = state.view;
  // Saindo de uma página que não é de vídeo: ela vira a página de fundo do gesto de arrastar.
  if (prevView && prevView !== 'watch' && nav.idx >= 0) lastPage = { hash: nav.hashes[nav.idx], idx: nav.idx, scroll: scrollY };
  trackNav();
  closeSidebarOverlay();
  const prevVideo = state.currentVideoId;
  const canAnimate = animate && !reducedMotion.matches;

  // Estado "antes": a miniatura clicada vira o player (ou o player volta para o tile).
  clearHeroNames();
  const toMini = prevView === 'watch' && view !== 'watch' && canMini();
  const fromMini = view === 'watch' && mini.on && playerVideoId === id;
  if (view === 'watch' && !fromMini && pendingHero?.isConnected && inViewport(pendingHero)) setHero(pendingHero);
  else if (toMini || fromMini || (prevView === 'watch' && view === 'home')) setHero($('.player-wrap'));
  pendingHero = null;

  const update = () => {
    clearHeroNames();
    const pending = applyView(view, id, channel, sort, sub);
    const heroes = () => {
      if (view === 'watch' || toMini) {
        setHero($('.player-wrap')); // o player vira o mini player (ou volta a ser o grande)
      } else if (view === 'home' && prevView === 'watch' && prevVideo) {
        const thumb = $(`#feed [data-vid="${prevVideo}"] .thumb`);
        if (thumb && inViewport(thumb)) setHero(thumb);
      }
    };
    // Início remontando a lista (vídeo assistido com o olho escondendo): a transição espera.
    if (pending) return pending.then(heroes);
    heroes();
  };

  if (canAnimate && document.startViewTransition) {
    const transition = document.startViewTransition(update);
    transition.finished.finally(clearHeroNames);
  } else {
    update();
    clearHeroNames();
    if (canAnimate) {
      const section = $(`#view-${view}`);
      section.classList.remove('view-enter');
      void section.offsetWidth; // reinicia a animação
      section.classList.add('view-enter');
    }
  }
}

/* =========================================================
   Eventos
   ========================================================= */
function updateToTop() {
  $('#to-top').classList.toggle('show', state.view === 'home' && scrollY > 1200);
}

/* ---------- Menu de vidro (botão "…") ---------- */
function closeMenuPop() {
  const pop = $('#menu-pop');
  if (pop && !pop.hidden) pop.hidden = true;
}

/** Abre o menu ao lado do botão. items: [{ icon, label, href?, run? }]. */
function openMenuPop(anchor, items) {
  const pop = $('#menu-pop');
  if (!pop.hidden && pop.dataset.for === anchor.dataset.popId) { closeMenuPop(); return; }
  anchor.dataset.popId ||= String(Math.random()).slice(2);
  pop.dataset.for = anchor.dataset.popId;
  pop.innerHTML = items.map((it, i) => it.href
    ? `<a class="mp-row" role="menuitem" href="${esc(it.href)}" data-mp="${i}">${SF(it.icon)}<span>${esc(it.label)}</span></a>`
    : `<button class="mp-row" role="menuitem" type="button" data-mp="${i}">${SF(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
  pop.onclick = e => {
    const row = e.target.closest('[data-mp]');
    if (!row) return;
    closeMenuPop();
    items[Number(row.dataset.mp)].run?.();
  };
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.max(10, Math.min(innerWidth - w - 10, r.right - w));
  const below = r.bottom + 8 + h < innerHeight - 10;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + 8 : Math.max(10, r.top - h - 8)}px`;
  pop.style.setProperty('--origin', `${r.right - left - r.width / 2}px ${below ? '0' : '100%'}`);
}

function videoMenuItems(id, { watch = false } = {}) {
  const v = findLoadedVideo(id) || (state.currentVideo?.id === id ? state.currentVideo : null);
  const items = [];
  if (!watch) items.push({ icon: 'play', label: 'Assistir', href: watchHref(id) });
  if (v && isHomeChannel(v.channelId)) items.push({ icon: 'person', label: `Ir para ${v.channelTitle}`, href: `#/c/${v.channelId}` });
  if (watch) {
    items.push({ icon: 'pip', label: 'Mini player', run: minimizeVideo });
    if (desktopQuery.matches && !isMobile()) items.push({ icon: 'theater', label: theaterOn ? 'Sair do Modo Cinema' : 'Modo Cinema', run: toggleTheater });
  }
  items.push({ icon: 'copy', label: 'Copiar link do vídeo', run: () => copyVideoLink(id) });
  return items;
}

/** Atualizar o Início: busca os vídeos de novo (o ícone gira enquanto isso). */
function refreshHome() {
  const icon = $('#refresh-btn .ic');
  if (motionOK()) icon?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 700, easing: easeSmooth() });
  resetFeed();
  if (state.view === 'home') showHome();
  refreshLives(true);
}

function bindEvents() {
  window.addEventListener('hashchange', () => route(true));

  document.addEventListener('click', e => {
    // "…" dentro de um cartão (que é um link): abre o menu sem abrir o vídeo.
    const more = e.target.closest('[data-action="tile-more"]');
    if (more) {
      e.preventDefault();
      e.stopPropagation();
      openMenuPop(more, videoMenuItems(more.dataset.vidMore));
      return;
    }
    if (!e.target.closest('#menu-pop')) closeMenuPop();
    const videoLink = e.target.closest('a[data-vid]');
    if (videoLink) {
      pendingHero = videoLink.querySelector('.thumb');
      markSeen(videoLink.dataset.vid);
      return;
    }

    // Clicar no que já está aberto apenas volta ao topo.
    const sameLink = e.target.closest('a[href^="#/"]');
    if (sameLink && sameLink.getAttribute('href') === (location.hash || '#/') && state.view === 'home') {
      e.preventDefault();
      closeSidebarOverlay();
      window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      return;
    }

    const navHome = e.target.closest('a[data-nav="home"]');
    if (navHome && state.view === 'home' && !state.filter) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      return;
    }

    const ts = e.target.closest('.ts');
    if (ts) {
      seekTo(Number(ts.dataset.t));
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    switch (actionEl.dataset.action) {
      case 'signin': Auth.signIn(); break;
      case 'signout': Auth.signOut(); break;
      case 'remove-channel': removeChannel(actionEl.dataset.id); break;
      case 'sync-now': Sync.run(); break;
      case 'install-app': installApp(); break;
      case 'replies': toggleReplies(actionEl); break;
      case 'retry-feed':
        currentFeed().error = null;
        updateFeedStatus();
        loadFeedPage();
        break;
      case 'watch-more': openMenuPop(actionEl, videoMenuItems(state.currentVideoId, { watch: true })); break;
      case 'open-account':
        if (e.target.closest('button, a')) break;
        if (location.hash !== '#/settings/conta') location.hash = '#/settings/conta';
        break;
      case 'cinema-sidebar': toggleSidebar(); break;
      case 'cinema-back': minimizeVideo(); break;
      case 'toggle-desc':
      case 'expand-desc': {
        const box = $('#description');
        if (actionEl.dataset.action === 'expand-desc' && !box.classList.contains('collapsed')) break;
        if (getSelection()?.toString()) break; // estava selecionando texto, não clicando
        animateHeight(box, () => {
          const collapsed = box.classList.toggle('collapsed');
          box.querySelector('.desc-toggle').textContent = collapsed ? 'mais' : 'Mostrar menos';
        });
        break;
      }
    }
  });

  $('#channel-form').addEventListener('submit', onChannelSubmit);
  $('#channel-list').addEventListener('change', e => {
    const input = e.target.closest('input[data-lives-only]');
    if (input) setLivesOnly(input.dataset.livesOnly, input.checked);
    const dur = e.target.closest('input[data-max-dur]');
    if (dur) setMaxDuration(dur.dataset.maxDur, dur);
  });
  // Enter no campo de duração confirma (o "change" acontece ao sair do campo).
  $('#channel-list').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input[data-max-dur]')) e.target.blur();
  });

  $('#menu-btn').addEventListener('click', toggleSidebar);
  $('#watched-toggle').addEventListener('click', toggleHideWatched);
  $('#refresh-btn').addEventListener('click', refreshHome);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSidebarOverlay(); closeMenuPop(); }
  });
  overlayQuery.addEventListener('change', () => {
    updateSidebarMode();
    updateTabbar();
    requestAnimationFrame(checkSentinel);
  });
  addEventListener('resize', () => requestAnimationFrame(updateTabbar), { passive: true });
  addEventListener('scroll', closeMenuPop, { passive: true });
  // Cliques no menu de canais quando ele está aberto por cima (Modo Cinema): fecha ao escolher.
  $('#sidebar').addEventListener('click', e => { if (e.target.closest('a[href^="#/"]')) closeSidebarOverlay(); });
  // Modo Cinema com o menu por cima: um clique fora dele fecha.
  document.addEventListener('pointerdown', e => {
    if (!state.pageSidebar || !cinemaActive() || e.target.closest('#sidebar, [data-action="cinema-sidebar"]')) return;
    closeSidebarOverlay();
    // Esse toque só fecha o menu (não pausa o vídeo nem abre nada).
    const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
    addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', block, { capture: true }), 500);
  });

  // Busca do menu lateral: canais e vídeos já carregados no Início.
  $('#side-search').addEventListener('input', () => {
    if ($('#side-search').value.trim() && state.view !== 'home') location.hash = '#/';
    applySearch();
  });
  $('#side-search').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.target.value = ''; applySearch(); e.target.blur(); }
  });
  // Clique na lupa do menu recolhido: expande o menu e vai para a busca.
  $('.side-search').addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-mini')) { toggleSidebar(); setTimeout(() => $('#side-search').focus(), 300); }
  });
  $('#channels-search').addEventListener('input', renderChannelsPage);

  // Interruptores dos Ajustes.
  $('#view-settings').addEventListener('change', e => {
    const input = e.target.closest('input[data-setting]');
    if (input) onSettingChange(input);
  });

  // "A seguir": Todos os canais ou só este canal.
  $('#upnext-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-ctx]');
    if (b) setUpNextContext(b.dataset.ctx);
  });
  addEventListener('storage', e => {
    if (e.key === KEYS.config) onConfigStored();
    if (e.key === KEYS.channels) onChannelsStored();
  });

  $('#comments-more').addEventListener('click', () => loadComments(state.currentVideoId));
  $('#upnext-more').addEventListener('click', () => {
    if (!state.currentVideo) return;
    upNextCount += upNextPage();
    renderUpNext(state.currentVideo);
  });

  $('#to-top').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  });

  // Rolagem infinita: carrega mais 20 quando o fim da grade se aproxima.
  new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) loadFeedPage();
  }, { rootMargin: '0px 0px 200px 0px' }).observe($('#feed-sentinel'));

  // Comentários carregam sozinhos ao chegar no fim da lista.
  new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting) && state.view === 'watch' && !$('#comments-more').hidden) {
      loadComments(state.currentVideoId);
    }
  }, { rootMargin: '0px 0px 200px 0px' }).observe($('#comments-more'));

  // Progresso: salva a cada 5 s enquanto toca, e ao esconder/fechar a aba.
  setInterval(() => {
    if ((state.view === 'watch' || mini.on) && player?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING) saveProgress();
  }, 5000);
  window.addEventListener('pagehide', saveProgress);
  setInterval(checkPlayerHealth, 2000);

  // Tela cheia: a entrada é animada só com CSS (iframe:fullscreen); a saída, por esta classe.
  // No celular, o vídeo em tela cheia gira sozinho para a horizontal; fora dele, a tela fica em pé.
  let playerWasFullscreen = false;
  const onFullscreenChange = () => {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    document.documentElement.classList.toggle('is-fullscreen', !!el);
    if (el?.closest?.('.player-wrap')) {
      playerWasFullscreen = true;
      if (isMobile()) {
        if (!screen.orientation?.lock) lastRotation = 'não suportada neste navegador';
        else {
          screen.orientation.lock('landscape')
            .then(() => { lastRotation = 'girou para horizontal'; renderVersionInfo(); })
            .catch(err => { lastRotation = `recusada (${err?.name || 'erro'})`; renderVersionInfo(); });
        }
      }
      return;
    }
    // Fora do vídeo em tela cheia, o celular fica sempre em pé (a rotação automática não vale para o app).
    lockPortrait();
    // Saiu do vídeo em tela cheia (a página pode continuar em tela cheia no celular).
    if (playerWasFullscreen) {
      playerWasFullscreen = false;
      if (reducedMotion.matches) return;
      const wrap = $('.player-wrap');
      wrap.classList.remove('fs-exit');
      void wrap.offsetWidth; // reinicia a animação
      wrap.classList.add('fs-exit');
      wrap.addEventListener('animationend', () => wrap.classList.remove('fs-exit'), { once: true });
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.view === 'watch') saveProgress();
    if (document.visibilityState === 'visible') refreshLives(); // só se a última verificação tiver mais de 5 min
    // Nuvem: envia ao sair da aba; ao voltar, busca o que mudou em outros aparelhos.
    if (document.visibilityState === 'hidden') Sync.run();
    else if (Date.now() - Sync.meta.lastSync > 60_000) Sync.run();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - Sync.meta.lastSync >= SYNC_PULL_MS - 5000) Sync.run();
  }, 30_000);
  // Lives: a cada 5 minutos, só com o menu lateral expandido (a checagem fica em refreshLives).
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshLives();
  }, 60_000);
  // Você por perto (mouse, teclado, toque, rolagem): sem nada disso por 20 min, as lives não são verificadas.
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    addEventListener(type, noteActivity, { passive: true, capture: true });
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      updateToTop();
    });
  }, { passive: true });

  window.addEventListener('resize', () => requestAnimationFrame(checkSentinel), { passive: true });
}

/* =========================================================
   Celular: app instalável e tela cheia
   =========================================================
   • Instalado ("Instalar app" no Chrome), o Canais abre sempre
     em tela cheia, sem a barra do navegador (manifest.json).
   • Aberto pelo navegador, entra em tela cheia no primeiro toque
     (o navegador não permite fazer isso sem um toque).
   ========================================================= */
let installPrompt = null;
let lastRotation = 'ainda não testada'; // resultado da última tentativa de girar a tela (diagnóstico)

/** Celular: deixa a tela em pé (só o vídeo em tela cheia gira). O navegador só permite isso no app
    instalado ou com a página em tela cheia; fora disso, quem manda é a rotação automática do Android. */
function lockPortrait() {
  if (!isMobile() || !screen.orientation?.lock) return;
  screen.orientation.lock('portrait').catch(() => { /* não permitido agora (página fora da tela cheia) */ });
}

function isMobile() {
  const mobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return Boolean(mobile) && matchMedia('(pointer: coarse)').matches;
}

/** Aberto pelo ícone do app instalado (a tela cheia da própria página também conta como "fullscreen", por isso a checagem extra). */
const isInstalledApp = () => matchMedia('(display-mode: standalone)').matches
  || (matchMedia('(display-mode: fullscreen)').matches && !document.fullscreenElement);

function renderInstallPanel() {
  const box = $('#install-panel');
  if (!box) return;
  if (isInstalledApp()) {
    box.innerHTML = '<span class="tier">Você está usando o Canais instalado como app.</span>';
  } else if (installPrompt) {
    box.innerHTML = `
      <p class="muted">Instale o Canais para ele abrir pelo ícone, sempre em tela cheia, sem a barra do navegador.</p>
      <div><button class="btn btn-primary" type="button" data-action="install-app">Instalar app</button></div>`;
  } else {
    box.innerHTML = `
      <p class="muted" style="margin:0">Para abrir sempre em tela cheia, sem a barra do navegador, instale o Canais:
        no Chrome do celular, toque em <strong>⋮</strong> › <strong>Instalar app</strong> (ou
        <strong>Adicionar à tela inicial</strong>) e abra pelo ícone criado. No Samsung Internet: <strong>☰</strong> ›
        <strong>Adicionar página a › Tela inicial</strong>.</p>`;
  }
}

function setupMobileApp() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sem service worker, só não fica instalável */ });
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    renderInstallPanel();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    renderInstallPanel();
    toast('Canais instalado. Abra pelo ícone para usar em tela cheia.', 'success');
  });

  if (!isMobile()) return;
  lockPortrait();
  // Pelo navegador: entra (ou volta) em tela cheia a cada toque, se não estiver.
  document.addEventListener('click', () => {
    if (document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches) return;
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => { /* ignora */ });
  }, true);
}

/** No PC, os botões de Estatísticas e Ajustes do rodapé do menu (e o de Credenciais) abrem numa aba nova.
    No celular (e no app instalado) continuam abrindo na mesma tela. */
function setupFooterLinks() {
  if (isMobile()) return;
  $$('.side-footer a[data-nav="stats"], .side-footer a[data-nav="settings"], #cred-link').forEach(a => {
    a.target = '_blank';
    a.rel = 'noopener';
  });
  // A página abre em outra aba; nesta, o menu aberto por cima (Modo Cinema) fecha.
  $$('.side-footer a[data-nav="stats"], .side-footer a[data-nav="settings"]').forEach(a => {
    a.addEventListener('click', () => closeSidebarOverlay());
  });
}

/** Versão discreta no menu lateral e, nos Ajustes, versão + diagnóstico do celular. */
function renderVersionInfo() {
  const side = $('#app-version');
  if (side) side.textContent = `Canais ${APP_VERSION}`;
  const footer = $('#settings-footer');
  if (!footer) return;
  const htmlVersion = document.querySelector('meta[name="app-version"]')?.content;
  const sw = navigator.serviceWorker?.controller ? 'ativo' : 'inativo';
  const mode = isInstalledApp() ? 'app instalado' : 'navegador';
  footer.innerHTML = `
    <span>Canais <strong>v${APP_VERSION}</strong></span>
    <span>Celular: ${isMobile() ? 'sim' : 'não'} · Aberto como: ${mode} · Service worker: ${sw} · Rotação: ${esc(lastRotation)}</span>
    ${htmlVersion && htmlVersion !== APP_VERSION
      ? `<span class="error">Arquivos de versões diferentes (página v${esc(htmlVersion)}). Recarregue a página.</span>` : ''}`;
}

async function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  renderInstallPanel();
}

/* =========================================================
   Estatísticas
   =========================================================
   O app não pode ler o histórico do YouTube, então registra por
   conta própria, por dia e por canal:
     • tempo assistido: enquanto um vídeo toca, a cada 5 s o tempo
       é somado ao dia de hoje e ao canal do vídeo;
     • vídeos assistidos: um vídeo conta no dia em que é visto até
       o fim (a mesma regra do "assistido" do app).
   Cada aparelho guarda o próprio registro e a sincronização junta
   os de todos (o total é a soma dos aparelhos). O que aconteceu
   antes de o registro existir é estimado pelo progresso salvo.
   Canais marcados como "Só lives" ficam de fora: não contam e não
   aparecem. Ao desmarcar, voltam a contar e aparecem nas estatísticas.
   ========================================================= */
const STATS_TICK_MS = 5000;

/** Canais "Só lives" (fora das estatísticas). */
function livesOnlyIds() {
  return new Set(state.channels.filter(c => c.livesOnly).map(c => c.id));
}
const DEVICE_ID = (() => {
  let id = store.get(KEYS.device, '');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    store.set(KEYS.device, id);
  }
  return id;
})();
// { aparelho: { since, days: { 'AAAA-MM-DD': { s: { canal: segundos }, v: { vídeo: canal } } } } }
const watchLog = store.get(KEYS.watchLog, {});
if (!watchLog[DEVICE_ID]) {
  watchLog[DEVICE_ID] = { since: Date.now(), days: {} };
  store.set(KEYS.watchLog, watchLog);
}
const videoChannels = store.get(KEYS.videoChannels, {}); // vídeo -> canal ('' = não encontrado)
let watchTick = 0;

const pad2 = n => String(n).padStart(2, '0');
function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayLog() {
  const days = watchLog[DEVICE_ID].days;
  return (days[dayKey()] ||= { s: {}, v: {} });
}

function saveWatchLog() {
  store.set(KEYS.watchLog, watchLog);
  Sync.schedule(SYNC_PROGRESS_MS);
}

/** Soma o tempo desde a última medição, se o vídeo estava tocando. Chamado a cada 5 s e a cada mudança do player. */
function tickWatchTime() {
  const now = Date.now();
  const v = state.currentVideo;
  const same = Boolean(v && v.id === playerVideoId && v.channelId);
  if (watchTick && same && !livesOnlyIds().has(v.channelId) && withinDurationLimit(v)) {
    const sec = Math.min(now - watchTick, 3 * STATS_TICK_MS) / 1000;
    const log = todayLog();
    log.s[v.channelId] = Math.round(((log.s[v.channelId] || 0) + sec) * 10) / 10;
    if (!videoChannels[v.id]) {
      videoChannels[v.id] = v.channelId;
      store.set(KEYS.videoChannels, videoChannels);
    }
    saveWatchLog();
  }
  watchTick = same && (state.view === 'watch' || mini.on) && isPlaying() ? now : 0;
}

/** Registra que o vídeo foi assistido até o fim hoje (uma vez por dia). */
function logCompletion(id) {
  const ch = videoForProgress(id)?.channelId || videoChannels[id];
  if (!ch || livesOnlyIds().has(ch)) return;
  const d = videoForProgress(id)?.durationSec || progressStore[id]?.d;
  if (channelMaxDur(ch) && d > channelMaxDur(ch)) return; // acima do limite do canal: não conta
  if (videoChannels[id] !== ch) {
    videoChannels[id] = ch;
    store.set(KEYS.videoChannels, videoChannels);
  }
  const log = todayLog();
  if (log.v[id]) return;
  log.v[id] = ch;
  saveWatchLog();
}

/** Junta o registro vindo da nuvem: por aparelho, dia e canal vale o maior tempo; vídeos se somam. */
function mergeWatchLog(remoteLog, remoteChannels) {
  let changed = false;
  for (const [dev, r] of Object.entries(remoteLog || {})) {
    if (!r || typeof r.days !== 'object') continue;
    if (!watchLog[dev]) {
      watchLog[dev] = { since: r.since || Date.now(), days: {} };
      changed = true;
    }
    const l = watchLog[dev];
    if (r.since && r.since < l.since) {
      l.since = r.since;
      changed = true;
    }
    for (const [day, rd] of Object.entries(r.days)) {
      const ld = (l.days[day] ||= { s: {}, v: {} });
      for (const [ch, sec] of Object.entries(rd?.s || {})) {
        if (sec > (ld.s[ch] || 0)) { ld.s[ch] = sec; changed = true; }
      }
      for (const [id, ch] of Object.entries(rd?.v || {})) {
        if (!ld.v[id]) { ld.v[id] = ch; changed = true; }
      }
    }
  }
  if (changed) store.set(KEYS.watchLog, watchLog);
  let mapped = false;
  for (const [id, ch] of Object.entries(remoteChannels || {})) {
    if (ch && !videoChannels[id]) { videoChannels[id] = ch; mapped = true; }
  }
  if (mapped) store.set(KEYS.videoChannels, videoChannels);
  return changed || mapped;
}

/* =========================================================
   Vídeos de cada canal no app (base das Estatísticas)
   =========================================================
   O total de cada canal e o que conta como assistido seguem a
   mesma regra do que aparece no app: vídeos da aba "Vídeos" do
   canal (sem Shorts e sem lives gravadas), disponíveis e dentro
   do limite de duração do canal. O app lê a lista do canal (a
   mesma do "Mais antigos") e a duração de cada vídeo uma vez
   (~4 unidades de cota a cada 100 vídeos) e guarda no aparelho;
   depois, só confere os vídeos novos, no máximo a cada 3 horas.
   Mudar o limite de duração recalcula tudo na hora, sem cota.
   ========================================================= */
const VIDEO_INFO_KEY = 'meutube.videoInfo'; // { canal: { vídeo: segundos | -1 indisponível | -2 estreia/ao vivo | -3 não toca fora do YouTube } }
// 2 = guarda também "não toca fora do YouTube": com cache antigo, confere de novo uma vez.
const VIDEO_INFO_VERSION = 2;
const VIDEO_INFO_VERSION_KEY = 'meutube.videoInfoVersion';
const CATALOG_MAX_AGE = 3 * 60 * 60 * 1000;
const channelCatalogs = new Map(); // canal -> Map(vídeo -> segundos): só os vídeos exibíveis da aba "Vídeos"

/** Monta, a partir do que está guardado no aparelho, o catálogo dos canais que ainda não estão na memória. */
function loadCatalogsFromCache(channels) {
  const missing = channels.filter(c => !channelCatalogs.has(c.id));
  if (!missing.length) return;
  const index = store.get(UPLOAD_INDEX_KEY, {});
  const info = store.get(VIDEO_INFO_KEY, {});
  for (const c of missing) {
    const list = index['UULF' + c.id.slice(2)]?.list;
    const durations = info[c.id];
    if (list == null || !durations) continue;
    channelCatalogs.set(c.id, new Map(parseIndexList(list).filter(e => durations[e.id] > 0 && !unplayable.has(e.id)).map(e => [e.id, durations[e.id]])));
  }
}

/** Total de vídeos do canal no app (respeitando o limite de duração), ou undefined se ainda não foi contado. */
function channelVideoTotal(c) {
  const catalog = channelCatalogs.get(c.id);
  if (!catalog) return undefined;
  if (!c.maxDur) return catalog.size;
  let n = 0;
  for (const d of catalog.values()) if (d <= c.maxDur) n++;
  return n;
}

/** Confere no YouTube o que mudou nos canais (vídeos novos, removidos) e atualiza os catálogos. */
let catalogsLoading = null;
function refreshCatalogs(channels, onProgress) {
  catalogsLoading ||= loadCatalogs(channels, onProgress).finally(() => { catalogsLoading = null; });
  return catalogsLoading;
}

async function loadCatalogs(channels, onProgress) {
  if (!hasCredentials() || !channels.length) return false;
  const all = store.get(VIDEO_INFO_KEY, {});
  for (const id of Object.keys(all)) if (!channelById(id)) delete all[id]; // canais removidos
  const indexes = store.get(UPLOAD_INDEX_KEY, {});
  const recheck = store.get(VIDEO_INFO_VERSION_KEY, 1) < VIDEO_INFO_VERSION; // cache sem a informação nova
  let changed = false;
  let failed = false;
  for (const [i, c] of channels.entries()) {
    onProgress?.(i, channels.length);
    try {
      const playlistId = 'UULF' + c.id.slice(2);
      const info = (all[c.id] ||= {});
      // Assistiu a um vídeo publicado depois da última conferência: confere a lista agora.
      const checkedAt = indexes[playlistId]?.checked || indexes[playlistId]?.at || 0;
      const catalog = channelCatalogs.get(c.id);
      const watchedNew = Object.entries(progressStore).some(([id, p]) =>
        videoChannels[id] === c.id && (p.at || 0) > checkedAt && !catalog?.has(id) && !(id in info));
      const list = await playlistIndex(playlistId, null, watchedNew ? 0 : CATALOG_MAX_AGE);
      const ids = list.map(e => e.id);
      const inList = new Set(ids);
      for (const id of Object.keys(info)) if (!inList.has(id)) delete info[id];
      // novos + estreias que podem ter saído (+ todos, uma vez, quando o cache é de versão antiga)
      const missing = ids.filter(id => !(id in info) || info[id] === -2 || (recheck && info[id] > 0));
      for (let j = 0; j < missing.length; j += 50) {
        const batch = missing.slice(j, j + 50);
        const data = await api('videos', {
          part: 'contentDetails,snippet,status',
          id: batch.join(','),
          maxResults: 50,
          fields: 'items(id,status(embeddable),contentDetails(duration,regionRestriction,contentRating/ytRating),snippet(liveBroadcastContent))',
        });
        const found = new Map((data.items || []).map(v => [v.id, v]));
        batch.forEach(id => {
          const v = found.get(id);
          info[id] = !v ? -1 : (v.snippet?.liveBroadcastContent || 'none') !== 'none' ? -2
            : embedBlocked(v) || unplayable.has(id) ? -3 : (isoSeconds(v.contentDetails?.duration) || -1);
        });
      }
      const next = new Map(ids.filter(id => info[id] > 0 && !unplayable.has(id)).map(id => [id, info[id]]));
      if (!catalog || catalog.size !== next.size || missing.length) changed = true;
      channelCatalogs.set(c.id, next);
    } catch {
      failed = true; // sem cota/conexão: usa o que já está guardado e tenta na próxima visita
    }
  }
  onProgress?.(channels.length, channels.length);
  store.set(VIDEO_INFO_KEY, all);
  if (recheck && !failed) store.set(VIDEO_INFO_VERSION_KEY, VIDEO_INFO_VERSION);
  try { localStorage.removeItem('meutube.durations'); } catch { /* cache da versão 1.13.0 */ }
  return changed;
}

/** Junta o registro de todos os aparelhos + a estimativa do período anterior a ele. */
function computeStats() {
  const since = Math.min(...Object.values(watchLog).map(d => d.since || Date.now()));
  const hidden = livesOnlyIds();
  // Vídeos que contam: os da aba "Vídeos" dos canais, dentro do limite de duração (vídeo -> canal).
  const owner = new Map();
  for (const c of homeChannels()) {
    const catalog = channelCatalogs.get(c.id);
    if (!catalog) continue;
    for (const [id, d] of catalog) if (!c.maxDur || d <= c.maxDur) owner.set(id, c.id);
  }
  const daySec = new Map();     // dia -> segundos
  const dayChSec = new Map();   // dia -> Map(canal -> segundos)
  const dayVids = new Map();    // dia -> Set(vídeos assistidos até o fim)
  const chSec = new Map();      // canal -> segundos
  const add = (map, k, n) => map.set(k, (map.get(k) || 0) + n);
  const addTime = (day, ch, sec) => {
    add(daySec, day, sec);
    add(chSec, ch, sec);
    if (!dayChSec.has(day)) dayChSec.set(day, new Map());
    add(dayChSec.get(day), ch, sec);
  };
  const addVid = (day, id) => {
    if (!dayVids.has(day)) dayVids.set(day, new Set());
    dayVids.get(day).add(id);
  };
  for (const dev of Object.values(watchLog)) {
    for (const [day, d] of Object.entries(dev.days || {})) {
      for (const [ch, sec] of Object.entries(d.s || {})) if (!hidden.has(ch)) addTime(day, ch, sec);
      for (const id of Object.keys(d.v || {})) if (owner.has(id)) addVid(day, id);
    }
  }
  const doneByCh = new Map();
  let started = 0;
  let done = 0;
  let estimated = false;
  for (const [id, p] of Object.entries(progressStore)) {
    if (!p || p.gone) continue;
    const ch = owner.get(id);
    if (!ch) continue; // Short, live gravada, acima do limite, de outro canal ou removido
    started++;
    if (p.done) {
      done++;
      add(doneByCh, ch, 1);
    }
    if ((p.at || 0) < since) {
      // Antes do registro: conta o vídeo inteiro (assistido) ou até onde parou, no dia do último acesso.
      estimated = true;
      const day = dayKey(p.at);
      const sec = p.done ? p.d : p.t;
      if (sec) addTime(day, ch, sec);
      if (p.done) addVid(day, id);
    }
  }
  return { since, daySec, dayChSec, dayVids, chSec, doneByCh, started, done, estimated, owner };
}

/* ---------- Períodos (Semana, Mês, Ano, Tudo) ----------
   Semana e Mês: os últimos 7 e 30 dias, dia a dia. Ano: os últimos 12 meses. Tudo: mês a mês,
   desde o começo do registro. Os números de cima comparam com o período anterior de mesmo tamanho. */
const STATS_PERIODS = {
  week: { label: 'Semana', bucket: 'day', days: 7, now: 'esta semana', prev: 'os 7 dias anteriores', span: 'últimos 7 dias' },
  month: { label: 'Mês', bucket: 'day', days: 30, now: 'este mês', prev: 'os 30 dias anteriores', span: 'últimos 30 dias' },
  year: { label: 'Ano', bucket: 'month', months: 12, now: 'este ano', prev: 'os 12 meses anteriores', span: 'últimos 12 meses' },
  all: { label: 'Tudo', bucket: 'month', now: 'no total', prev: '', span: 'desde o começo' },
};
let statsPeriod = STATS_PERIODS[store.get(KEYS.statsPeriod, 'week')] ? store.get(KEYS.statsPeriod, 'week') : 'week';

function bucketStart(date, period) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // semana começa na segunda
  if (period === 'month') d.setDate(1);
  return d;
}

function shiftBucket(date, period, n) {
  const d = new Date(date);
  if (period === 'day') d.setDate(d.getDate() + n);
  else if (period === 'week') d.setDate(d.getDate() + 7 * n);
  else d.setMonth(d.getMonth() + n);
  return d;
}

/** Série dos últimos N períodos: [{ start, value }], somando o valor de cada dia no seu período. */
function statsSeries(dayMap, period, count, valueOf = v => v) {
  const totals = new Map();
  for (const [day, v] of dayMap) {
    const k = bucketStart(parseDay(day), period).getTime();
    totals.set(k, (totals.get(k) || 0) + valueOf(v));
  }
  const first = shiftBucket(bucketStart(new Date(), period), period, -(count - 1));
  return Array.from({ length: count }, (_, i) => {
    const start = shiftBucket(first, period, i);
    return { start, value: totals.get(start.getTime()) || 0 };
  });
}

/** Quantos pontos o gráfico do período tem (dias ou meses). */
function periodCount(period, since) {
  const P = STATS_PERIODS[period];
  if (P.days) return P.days;
  if (P.months) return P.months;
  const a = new Date(since);
  const b = new Date();
  return Math.min(60, Math.max(2, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1));
}

/** Intervalo do período atual e do anterior (para comparar): [início, fim) em ms. */
function periodRange(period, since) {
  const today = bucketStart(new Date(), 'day');
  const end = shiftBucket(today, 'day', 1).getTime();
  const P = STATS_PERIODS[period];
  let start;
  if (P.days) start = shiftBucket(today, 'day', -(P.days - 1)).getTime();
  else if (P.months) start = shiftBucket(bucketStart(new Date(), 'month'), 'month', -(P.months - 1)).getTime();
  else start = bucketStart(new Date(since), 'day').getTime();
  const len = end - start;
  return { start, end, prevStart: P.prev ? start - len : null, prevEnd: P.prev ? start : null, days: Math.max(1, Math.round(len / 864e5)) };
}

function periodLabel(start, bucket, long = false) {
  if (bucket === 'month') {
    return long
      ? start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  }
  if (long) return start.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return start.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
}

/* ---------- Formatos ---------- */
const intFmt = new Intl.NumberFormat('pt-BR');
function fmtHours(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${intFmt.format(h)}h ${pad2(r)}min` : `${intFmt.format(h)}h`;
}
function fmtHoursAxis(h) {
  if (h === 0) return '0';
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${String(Math.round(h * 10) / 10).replace('.', ',')} h`;
}
function fmtDelta(cur, prev) {
  if (!prev) return cur ? { text: 'novo', dir: 'up' } : { text: '—', dir: '' };
  const pct = ((cur - prev) / prev) * 100;
  const text = `${pct > 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0).replace('.', ',')}%`;
  return { text, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : '' };
}

/** Escala "redonda" para os eixos (ex.: 0, 0,5, 1, 1,5 h). */
function niceScale(max, ticks = 4, integer = false) {
  if (!(max > 0)) max = integer ? ticks : 1;
  let step = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(step));
  step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step - 1e-9);
  if (integer) step = Math.max(1, Math.ceil(step));
  return { step, max: step * Math.ceil(max / step - 1e-9) };
}

/* ---------- Gráficos (SVG desenhado pelo app) ---------- */
const STATS_DEFS = `
  <svg class="st-defs" aria-hidden="true" width="0" height="0">
    <defs>
      <linearGradient id="st-area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FF6F61" stop-opacity=".32"/><stop offset="1" stop-color="#FF6F61" stop-opacity="0"/>
      </linearGradient>
    </defs>
  </svg>`;

/** Anel de progresso (no estilo do Fitness): cor sólida com o fundo da mesma cor, mais clara. */
function ringSVG(pct, size = 70, color = 'var(--coral)', sw = 10) {
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0));
  return `
    <svg class="st-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" style="transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-opacity=".18" stroke-width="${sw}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" class="st-ring-arc" style="--c:${c.toFixed(2)}"
        stroke-linecap="round" stroke-dasharray="${((c * p) / 100).toFixed(2)} ${c.toFixed(2)}"/>
    </svg>`;
}

/** Mini gráfico de linha (canto do cartão "Média diária"). */
function sparkSVG(values, color = 'var(--peri)', w = 110, h = 34) {
  if (values.length < 2) return '';
  const max = Math.max(...values) || 1;
  const step = w / (values.length - 1);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`).join('');
  return `<svg class="st-spark" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" pathLength="1" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Dica que acompanha o ponteiro: mostra o ponto mais próximo (mouse ou toque). */
function attachChartTip(box, pts) {
  const tip = document.createElement('div');
  tip.className = 'st-tip';
  tip.hidden = true;
  box.append(tip);
  const marks = [...box.querySelectorAll('[data-i]')];
  const show = e => {
    if (!pts.length) return;
    const r = box.getBoundingClientRect();
    const mx = e.clientX - r.left;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p.x - mx) < Math.abs(pts[best].x - mx)) best = i; });
    const p = pts[best];
    tip.innerHTML = `<strong>${esc(p.value)}</strong><span>${esc(p.title)}</span>`;
    tip.style.left = `${Math.max(60, Math.min(r.width - 60, p.x))}px`;
    tip.style.top = `${p.y}px`;
    tip.hidden = false;
    marks.forEach(m => m.classList.toggle('active', Number(m.dataset.i) === best));
  };
  box.onpointermove = show;
  box.onpointerdown = show;
  box.onpointerleave = () => {
    tip.hidden = true;
    marks.forEach(m => m.classList.remove('active'));
  };
}

function xLabelStep(n, width) {
  return Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 54))));
}

/** Barras (como no Tempo de Uso do iPhone): a de agora mais forte e a média tracejada em verde. */
function drawBarChart(box, series, { toValue = v => v, axis, tipValue, tipTitle, integer = false, avg = true }) {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return;
  const pad = { l: 6, r: 44, t: 18, b: 26 };
  const values = series.map(s => toValue(s.value));
  const { step, max } = niceScale(Math.max(...values), 4, integer);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / series.length;
  const bw = Math.max(3, Math.min(42, slot * 0.56));
  const cx = i => pad.l + slot * (i + 0.5);
  const y = v => pad.t + (1 - v / max) * ih;
  const parts = [];
  for (let v = 0; v <= max + 1e-9; v += step) {
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r + 6}" y1="${y(v)}" y2="${y(v)}" class="st-grid-line"/>`
      + `<text x="${W - pad.r + 12}" y="${y(v)}" dy=".32em" class="st-axis">${esc(axis(v))}</text>`);
  }
  const every = xLabelStep(series.length, iw);
  series.forEach((s, i) => {
    const now = i === series.length - 1;
    const h = Math.max(values[i] ? 3 : 0, y(0) - y(values[i]));
    parts.push(`<rect data-i="${i}" x="${cx(i) - bw / 2}" y="${y(0) - h}" width="${bw}" height="${h}" rx="${Math.min(7, bw / 3)}" class="st-bar${now ? ' now' : ''}" style="--i:${i}"/>`);
    if ((series.length - 1 - i) % every === 0) {
      parts.push(`<text x="${cx(i)}" y="${H - 6}" text-anchor="middle" class="st-axis${now ? ' now' : ''}">${esc(s.label)}</text>`);
    }
  });
  if (avg && values.some(Boolean)) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r + 6}" y1="${y(mean)}" y2="${y(mean)}" class="st-avg"/>`
      + `<text x="${pad.l + 2}" y="${y(mean) - 6}" class="st-avg-label">média</text>`);
  }
  box.innerHTML = `<svg width="${W}" height="${H}" aria-hidden="true">${parts.join('')}</svg>`;
  attachChartTip(box, series.map((s, i) => ({ x: cx(i), y: y(values[i]), value: tipValue(s.value), title: tipTitle(s) })));
}

/** Linha com área em degradê (Living Coral) e pontos. */
function drawLineChart(box, series, { toValue = v => v, axis, tipValue, tipTitle, integer = false }) {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return;
  const pad = { l: 10, r: 10, t: 14, b: 26 };
  const values = series.map(s => toValue(s.value));
  const { max } = niceScale(Math.max(...values), 2, integer);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = i => pad.l + (series.length === 1 ? iw / 2 : (i * iw) / (series.length - 1));
  const y = v => pad.t + (1 - v / max) * ih;
  const parts = [0, 0.5, 1].map(f => `<line x1="0" x2="${W}" y1="${pad.t + f * ih}" y2="${pad.t + f * ih}" class="st-grid-line"/>`);
  const every = xLabelStep(series.length, iw);
  series.forEach((s, i) => {
    if ((series.length - 1 - i) % every === 0) {
      parts.push(`<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="st-axis${i === series.length - 1 ? ' now' : ''}">${esc(s.label)}</text>`);
    }
  });
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(values.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const r = series.length > 20 ? 2.5 : 3.5;
  const dots = values.map((v, i) => `<circle data-i="${i}" cx="${x(i)}" cy="${y(v)}" r="${i === values.length - 1 ? r + 1.5 : r}" class="st-dot${i === values.length - 1 ? ' now' : ''}" style="--i:${Math.min(i, 20)}"/>`).join('');
  box.innerHTML = `
    <svg width="${W}" height="${H}" aria-hidden="true">
      ${parts.join('')}
      <path d="${area}" class="st-area"/>
      <path d="${line}" class="st-line" pathLength="1"/>
      ${dots}
    </svg>`;
  attachChartTip(box, series.map((s, i) => ({ x: x(i), y: y(values[i]), value: tipValue(s.value), title: tipTitle(s) })));
}

/** Cores dos canais nos gráficos (pares de Cores do Ano da Pantone). */
const CHANNEL_HUES = [['#6667AB', '#0F4C81'], ['#A47864', '#FFBE98'], ['#88B04B', '#0F4C81'], ['#FF6F61', '#FFBE98'], ['#5F4B8B', '#0F4C81'], ['#939597', '#F5DF4D'], ['#BB2649', '#FF6F61'], ['#F5DF4D', '#A47864']];
const channelHue = i => CHANNEL_HUES[i % CHANNEL_HUES.length];

/* ---------- Página ---------- */
let statsData = null;

function channelAvatar(ch, cls = 'st-avatar') {
  return `<img class="${cls}" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>`;
}

/* ---------- Previsão: quanto falta para assistir tudo, no seu ritmo ---------- */
// Base: só o que o app mostra (aba "Vídeos", dentro do limite de duração, sem os canais
// "Só lives"). Ritmo: média por dia dos últimos 30 dias (ou desde o início do registro, se
// for mais recente), contando também os dias sem vídeo — o mesmo tempo assistido do resto da página.
const FORECAST_DAYS = 30;
let statsForecast = ''; // '' = Todos; ou o ID do canal escolhido

function forecastFor(data, chId) {
  const channels = chId ? homeChannels().filter(c => c.id === chId) : homeChannels();
  let remaining = 0;
  let total = 0;
  let done = 0;
  let known = true;
  for (const c of channels) {
    const catalog = channelCatalogs.get(c.id);
    if (!catalog) { known = false; continue; }
    for (const [id, dur] of catalog) {
      if (c.maxDur && dur > c.maxDur) continue;
      total++;
      const p = progressStore[id];
      if (p?.done) { done++; continue; }
      remaining += Math.max(0, dur - (p && !p.gone ? p.t || 0 : 0)); // começado: só o que falta
    }
  }
  const today = new Date();
  const first = new Date(data.since);
  const elapsed = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(first.getFullYear(), first.getMonth(), first.getDate())) / 864e5) + 1;
  const span = Math.max(1, Math.min(FORECAST_DAYS, elapsed));
  let watched = 0;
  for (let i = 0; i < span; i++) {
    const day = dayKey(Date.now() - i * 864e5);
    watched += chId ? data.dayChSec.get(day)?.get(chId) || 0 : data.daySec.get(day) || 0;
  }
  const pace = watched / span; // segundos por dia
  const days = pace > 0 ? Math.max(1, Math.ceil(remaining / pace)) : null;
  return {
    remaining, total, done, known, pace, span, days,
    hours: chId ? data.chSec.get(chId) || 0 : 0,
    finish: days != null ? new Date(Date.now() + days * 864e5) : null,
  };
}

function forecastText(data, chId) {
  const ch = chId ? channelById(chId) : null;
  const f = forecastFor(data, chId);
  if (!f.known && !f.total) return { big: '…', short: '…', line: 'contando os vídeos dos canais', f };
  if (f.total && f.done >= f.total) return { big: 'Tudo assistido ✓', short: 'tudo visto', line: ch ? `você viu todos os vídeos de ${esc(ch.title)}` : 'você viu todos os vídeos do Canais', f };
  if (f.days == null) return { big: '—', short: '—', line: ch ? 'assista algo deste canal para estimar' : 'assista algo para estimar', f };
  const days = `${intFmt.format(f.days)} ${f.days === 1 ? 'dia' : 'dias'}`;
  return { big: `~ ${days}`, short: days, line: `para assistir ${ch ? `o que falta de ${esc(ch.title)}` : 'tudo o que está no Canais'}`, f };
}

function forecastBodyHTML(data) {
  const ch = statsForecast ? channelById(statsForecast) : null;
  const { big, line, f } = forecastText(data, statsForecast);
  const year = f.finish && f.finish.getFullYear() !== new Date().getFullYear();
  const finish = f.finish ? f.finish.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) }).replace(/\./g, '') : '';
  const pct = f.total ? Math.round((f.done / f.total) * 100) : 0;
  const support = [
    f.remaining ? `${fmtHours(f.remaining)} restantes` : '',
    f.pace ? `ritmo${ch ? ' neste canal' : ''}: ${f.pace < 30 ? 'menos de 1 min' : fmtHours(f.pace)} por dia` : '',
    finish && f.days != null && f.done < f.total ? `por volta de ${finish}` : '',
    ch && f.total ? `${pct}% concluído (${intFmt.format(f.done)} de ${intFmt.format(f.total)})` : '',
  ].filter(Boolean);
  return `
    <strong class="st-fc-big">${big}</strong>
    <span class="st-fc-line">${line}</span>
    ${support.length ? `<span class="st-fc-support">${support.join(' · ')}</span>` : ''}`;
}

function forecastCardHTML(data) {
  const channels = [...homeChannels()].sort((a, b) => byName(a.title, b.title));
  if (statsForecast && !channels.some(c => c.id === statsForecast)) statsForecast = '';
  const rows = channels
    .map(c => ({ c, t: forecastText(data, c.id) }))
    .sort((a, b) => (b.t.f.days ?? -1) - (a.t.f.days ?? -1));
  const row = (id, img, name, value) => `
    <button type="button" class="st-fc-row" data-fc="${esc(id)}" aria-pressed="${statsForecast === id}">
      ${img}<span>${esc(name)}</span><b>${esc(value)}</b>
    </button>`;
  return `
    <div class="st-lab">${SF('calendar')}Previsão <span class="st-lab-sub">· no seu ritmo dos últimos ${FORECAST_DAYS} dias</span></div>
    <div class="st-fc-body" aria-live="polite">${forecastBodyHTML(data)}</div>
    <div class="st-fc-list">
      ${row('', `<span style="display:grid;width:22px">${appIconSVG(22)}</span>`, 'Todos os canais', forecastText(data, '').short)}
      ${rows.map(({ c, t }) => row(c.id, channelAvatar(c, ''), c.title, t.short)).join('')}
    </div>`;
}

/** Troca Todos/canal: só o miolo do cartão muda, com uma transição suave. */
function selectForecast(id) {
  if (id === statsForecast) return;
  statsForecast = id;
  $$('#stats .st-fc-row').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fc === id)));
  const body = $('#stats .st-fc-body');
  if (!body) return;
  body.innerHTML = forecastBodyHTML(statsData || computeStats());
  if (motionOK()) {
    body.classList.remove('st-fc-swap');
    void body.offsetWidth;
    body.classList.add('st-fc-swap');
  }
}

let statsAnimTimer = 0;

/** Tempo em "2 h 8 min" com os minutos menores (como no Tempo de Uso). */
function bigTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} <small>min</small>`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${intFmt.format(h)} h <small>${r} min</small>` : `${intFmt.format(h)} <small>h</small>`;
}

function renderStats({ refresh = true, animate = refresh } = {}) {
  const box = $('#stats');
  if (!box) return;
  // Gráficos se desenhando e cartões em cascata só ao abrir a página ou trocar o período.
  const prevThumb = box.querySelector('.st-head .seg-thumb');
  const thumbFrom = prevThumb ? { left: prevThumb.style.left, width: prevThumb.style.width } : null;
  clearTimeout(statsAnimTimer);
  box.classList.toggle('st-anim', animate && motionOK());
  if (animate) statsAnimTimer = setTimeout(() => box.classList.remove('st-anim'), 2200);
  loadCatalogsFromCache(homeChannels());
  const data = computeStats();
  statsData = data;
  const period = statsPeriod;
  const P = STATS_PERIODS[period];
  const range = periodRange(period, data.since);
  const channels = homeChannels(); // sem os "Só lives"
  const inRange = (day, a, b) => { const t = parseDay(day).getTime(); return t >= a && t < b; };

  // Tempo: média por dia no período e no anterior
  let total = 0;
  let prevTotal = 0;
  for (const [day, sec] of data.daySec) {
    if (inRange(day, range.start, range.end)) total += sec;
    else if (range.prevStart != null && inRange(day, range.prevStart, range.prevEnd)) prevTotal += sec;
  }
  const avg = total / range.days;
  const prevAvg = range.prevStart != null ? prevTotal / range.days : null;
  const count = periodCount(period, data.since);
  const hoursSeries = statsSeries(data.daySec, P.bucket, count);
  const sparkVals = hoursSeries.map(s => s.value);

  // Concluídos: vídeos abertos no período e quantos foram até o fim
  let started = 0;
  let done = 0;
  for (const [id, p] of Object.entries(progressStore)) {
    if (!p || p.gone || !data.owner.has(id)) continue;
    if ((p.at || 0) < range.start || (p.at || 0) >= range.end) continue;
    started++;
    if (p.done) done++;
  }
  const donePct = started ? (done / started) * 100 : 0;

  // Catálogo: vídeos que o app mostra (dentro do limite de duração) e as horas de todos eles
  let catalogVideos = 0;
  let catalogSec = 0;
  for (const c of channels) {
    const catalog = channelCatalogs.get(c.id);
    if (!catalog) continue;
    for (const [, d] of catalog) {
      if (c.maxDur && d > c.maxDur) continue;
      catalogVideos++;
      catalogSec += d || 0;
    }
  }

  // Por canal no período
  const byCh = new Map();
  for (const [day, m] of data.dayChSec) {
    if (!inRange(day, range.start, range.end)) continue;
    for (const [ch, sec] of m) byCh.set(ch, (byCh.get(ch) || 0) + sec);
  }
  const perCh = channels.map((c, i) => ({ c, i, sec: byCh.get(c.id) || 0 })).filter(x => x.sec > 0).sort((a, b) => b.sec - a.sec);
  const top = perCh[0];
  const maxCh = top?.sec || 1;
  const hueOf = c => channelHue(Math.max(0, channels.findIndex(x => x.id === c.id)));

  // Assistidos x total de cada canal
  const catalog = channels.map(c => {
    const totalN = channelVideoTotal(c);
    const doneN = data.doneByCh.get(c.id) || 0;
    return { c, done: doneN, total: totalN, pct: totalN ? (doneN / totalN) * 100 : 0 };
  }).sort((a, b) => b.pct - a.pct || b.done - a.done);

  const delta = (cur, prev) => {
    if (prev == null) return `${P.now === 'no total' ? 'desde' : ''}`;
    const d = fmtDelta(cur, prev);
    return d.dir ? `<span class="st-delta ${d.dir}">${d.dir === 'up' ? '▲' : '▼'} ${esc(d.text.replace(/^[+-]/, ''))}</span> em relação a ${P.prev}` : `igual a ${P.prev}`;
  };
  const sinceText = new Date(data.since).toLocaleDateString('pt-BR');

  box.innerHTML = `
    ${STATS_DEFS}
    <header class="page-head st-head">
      <div class="page-title">
        <h1 class="t-large">Estatísticas<details class="st-info">
          <summary aria-label="Como os números são calculados" title="Como os números são calculados">i</summary>
          <p>
            Contam só os vídeos que aparecem no app: os da aba “Vídeos” de cada canal, dentro do limite de duração
            (nos Ajustes, em Canais). Horas são o tempo em que o vídeo esteve tocando no app, incluindo as
            lives assistidas ao vivo (neste e nos seus outros aparelhos, pela sincronização). Um vídeo conta como
            assistido quando é visto até o fim. Concluídos: dos vídeos abertos no período, quantos foram até o fim.
            ${data.estimated ? `Antes de ${sinceText}, horas e vídeos são <strong>estimados</strong> pelo progresso salvo
              (o vídeo inteiro, se assistido, ou até onde parou, no dia do último acesso).` : ''}
            O total de cada canal é o número de vídeos que o app mostra para ele; mudar o limite de duração
            recalcula tudo na hora.
          </p>
        </details></h1>
        <div class="st-since">Registro desde ${sinceText}</div>
      </div>
      <div class="seg st-tabs" role="group" aria-label="Período">
        ${Object.entries(STATS_PERIODS).map(([k, p]) => `<button type="button" data-period="${k}" aria-pressed="${k === period}">${p.label}</button>`).join('')}
      </div>
    </header>

    ${channels.some(c => !channelCatalogs.has(c.id)) ? '<p id="st-counting" class="st-counting" role="status">Contando os vídeos dos canais…</p>' : ''}
    <div class="st-tiles">
      <article class="st-tile st-avg-tile">
        <div class="st-lab">${SF('clock')}Média diária</div>
        <div class="st-big">${bigTime(avg)}</div>
        <div class="st-note">${delta(avg, prevAvg) || `${P.span}`}</div>
        ${sparkSVG(sparkVals)}
      </article>
      <article class="st-tile st-tile-ring">
        <div class="st-ringbox">${ringSVG(donePct, 70, 'var(--coral)', 10)}<b>${Math.round(donePct)}%</b></div>
        <div>
          <div class="st-lab" style="margin-bottom:4px">Concluídos</div>
          <div class="st-big">${intFmt.format(done)} <small>de ${intFmt.format(started)}</small></div>
          <div class="st-note">vídeos abertos ${P.now}</div>
        </div>
      </article>
      <article class="st-tile">
        <div class="st-lab">${SF('film')}Catálogo</div>
        <div class="st-big">${intFmt.format(catalogVideos)} <small>vídeos</small></div>
        <div class="st-note">em ${channels.length} ${channels.length === 1 ? 'canal' : 'canais'}${catalogSec ? ` · ${intFmt.format(Math.round(catalogSec / 3600))} h no total` : ''}</div>
      </article>
      <article class="st-tile st-tile-top">
        ${top ? channelAvatar(top.c, '') : `<span style="width:54px;height:54px;border-radius:50%;background:var(--fill);flex-shrink:0"></span>`}
        <div style="min-width:0">
          <div class="st-lab" style="margin-bottom:2px">${SF('medal')}Canal nº 1</div>
          <div class="st-top-name">${top ? esc(top.c.title) : '—'}</div>
          <div class="st-note" style="margin-top:0">${top ? `${fmtHours(top.sec)} ${P.now}` : 'nada assistido ainda'}</div>
        </div>
      </article>
    </div>

    <div class="st-charts">
      <article class="st-card st-hours">
        <div class="st-lab split"><span style="display:flex;gap:6px;align-items:center">${SF('chart')}Horas assistidas</span><span class="st-lab-sub">Total: ${fmtHours(total)}</span></div>
        <div class="st-chart" id="st-hours" role="img" aria-label="Horas assistidas por ${P.bucket === 'day' ? 'dia' : 'mês'}"></div>
      </article>
      <article class="st-card st-perch-hours">
        <div class="st-lab">${SF('stack')}Horas por canal <span class="st-lab-sub">· ${P.span}</span></div>
        <div class="st-hbars">
          ${perCh.slice(0, 7).map(({ c, sec }, i) => {
            const [c1, c2] = hueOf(c);
            return `
            <div class="st-hbar">
              ${channelAvatar(c, '')}
              <div>
                <div class="st-hbar-top"><span>${esc(c.title)}</span><span>${fmtHours(sec)}</span></div>
                <div class="st-track"><span style="width:${((sec / maxCh) * 100).toFixed(1)}%;--c1:${c1};--c2:${c2};--i:${i}"></span></div>
              </div>
            </div>`;
          }).join('') || '<p class="st-empty">Nada assistido neste período.</p>'}
        </div>
      </article>
      <article class="st-card st-videos">
        <div class="st-lab">${SF('check-c')}Vídeos assistidos <span class="st-lab-sub">· até o fim</span></div>
        <div class="st-chart short" id="st-videos" role="img" aria-label="Vídeos assistidos até o fim"></div>
      </article>
      <article class="st-card st-fc">${forecastCardHTML(data)}</article>
      <article class="st-card st-perch">
        <div class="st-lab">${SF('check-c')}Por canal <span class="st-lab-sub">· vistos até o fim, do total publicado</span></div>
        <div class="st-perch-grid">
          ${catalog.map(({ c, done: d, total: t, pct }, i) => {
            const [c1, c2] = hueOf(c);
            return `
            <div class="st-hbar" title="${esc(c.title)}: ${intFmt.format(d)} de ${t != null ? intFmt.format(t) : '…'} vídeos">
              ${channelAvatar(c, '')}
              <div>
                <div class="st-hbar-top"><span>${esc(c.title)}</span><span><b>${intFmt.format(d)}</b> de ${t != null ? intFmt.format(t) : '…'}</span></div>
                <div class="st-track"><span style="width:${pct.toFixed(1)}%;--c1:${c1};--c2:${c2};--i:${i}"></span></div>
              </div>
            </div>`;
          }).join('') || '<p class="st-empty">Adicione canais nos Ajustes.</p>'}
        </div>
      </article>
    </div>`;

  drawStatsCharts();
  placeSegThumb(box.querySelector('.st-head .seg'), thumbFrom);

  if (refresh) {
    // Busca o que falta (canal dos vídeos antigos, total de vídeos dos canais) e redesenha uma vez.
    const counting = channels.some(c => !channelCatalogs.has(c.id));
    refreshCatalogs(channels, (doneN, totalN) => {
      const el = $('#st-counting');
      if (el && counting) el.textContent = `Contando os vídeos dos canais… (${doneN} de ${totalN})`;
    }).then(changed => {
      if ((changed || counting) && state.view === 'stats') renderStats({ refresh: false });
    });
  }
}

/** Desenha os gráficos com o tamanho real de cada cartão (refeito quando o tamanho muda). */
function drawStatsCharts() {
  const data = statsData;
  if (!data || state.view !== 'stats') return;
  const period = statsPeriod;
  const P = STATS_PERIODS[period];
  const count = periodCount(period, data.since);
  const label = s => ({ ...s, label: P.bucket === 'month' ? periodLabel(s.start, 'month') : (P.days > 7 ? String(s.start.getDate()) : periodLabel(s.start, 'day')) });
  const title = s => periodLabel(s.start, P.bucket, true);
  const hours = $('#st-hours');
  if (hours) {
    drawBarChart(hours, statsSeries(data.daySec, P.bucket, count).map(label), {
      toValue: sec => sec / 3600,
      axis: fmtHoursAxis,
      tipValue: sec => fmtHours(sec),
      tipTitle: title,
    });
  }
  const videos = $('#st-videos');
  if (videos) {
    drawLineChart(videos, statsSeries(data.dayVids, P.bucket, count, s => s.size).map(label), {
      integer: true,
      axis: v => intFmt.format(v),
      tipValue: n => `${intFmt.format(n)} ${n === 1 ? 'vídeo' : 'vídeos'}`,
      tipTitle: title,
    });
  }
}

function setupStats() {
  const box = $('#stats');
  box.addEventListener('click', e => {
    const tab = e.target.closest('[data-period]');
    if (tab) {
      if (tab.dataset.period === statsPeriod) return;
      statsPeriod = tab.dataset.period;
      store.set(KEYS.statsPeriod, statsPeriod);
      renderStats({ refresh: false, animate: true });
      return;
    }
    const pick = e.target.closest('[data-fc]');
    if (pick) selectForecast(pick.dataset.fc);
  });
  let lastSize = '';
  let frame = 0;
  new ResizeObserver(([entry]) => {
    const size = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
    if (size === lastSize) return;
    lastSize = size;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(drawStatsCharts);
  }).observe(box);
  setInterval(tickWatchTime, STATS_TICK_MS);
}

/* =========================================================
   Inicialização
   ========================================================= */
function init() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  $('#brand-icon').innerHTML = appIconSVG(30);
  Auth.restore();
  renderAccount();
  renderSidebar();
  renderLives();
  applyHideWatched();
  renderVersionInfo();
  console.info(`Canais v${APP_VERSION}`);
  setupMobileApp();
  setupFooterLinks();
  setupPlayerControls();
  setupMini();
  setupDragToMini();
  setupPreviews();
  setupStats();
  bindEvents();
  route(false);
  refreshLives(true);
  Sync.run();
}

init();
