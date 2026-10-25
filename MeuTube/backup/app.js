'use strict';

/** Versão do app (SemVer: MAJOR.MINOR.PATCH). Mantenha igual à do index.html e do sw.js. */
const APP_VERSION = '1.15.0';

/* =========================================================
   MeuTube — só os vídeos dos canais que você escolher
   =========================================================
   As credenciais padrão (DEFAULT_CONFIG) ficam em config.js,
   carregado antes deste arquivo.
   ========================================================= */
const PAGE_SIZE = 20;
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'; // pasta oculta do app no Drive (sincronização)
const SCOPES = `openid email profile ${YT_SCOPE} ${DRIVE_SCOPE}`;
const YT_API = 'https://www.googleapis.com/youtube/v3/';
const VIDEO_ID_RE = /^[\w-]{11}$/;
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
const KEYS = {
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
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* =========================================================
   Utilitários
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]);

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
/** Canais que aparecem no Início e na lista de canais (os marcados "Apenas lives" ficam só em "Ao vivo"). */
const homeChannels = () => state.channels.filter(c => !c.livesOnly);

/* Limite de duração por canal (Configurações › Canais › "Até hh:mm:ss"): vídeos mais longos
   que o limite não aparecem e não contam nas Estatísticas. O limite inclui o tempo exato. */
const channelMaxDur = id => channelById(id)?.maxDur || 0;

function withinDurationLimit(v) {
  const max = channelMaxDur(v.channelId);
  return !max || !v.durationSec || v.durationSec <= max;
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
  keyInvalid: 'A chave de API é inválida. Verifique em Configurações.',
  badRequest: 'Requisição inválida para a API do YouTube.',
  accessNotConfigured: 'A YouTube Data API v3 não está ativada no seu projeto do Google Cloud.',
  commentsDisabled: 'Os comentários estão desativados neste vídeo.',
  playlistNotFound: 'Lista de uploads do canal não encontrada.',
  forbidden: 'Acesso negado pela API do YouTube.',
  ipRefererBlocked: 'A chave de API não permite requisições a partir deste endereço.',
  insufficientPermissions: 'O login do Google não tem permissão para esta função. Salve uma chave de API em Configurações para usá-la.',
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: 'O login do Google não tem permissão para esta função. Salve uma chave de API em Configurações para usá-la.',
};

// O Google só aceita ler comentários com login se o app pedir o escopo "youtube.force-ssl",
// que também permite gerenciar a conta. Para não pedir isso, comentários usam apenas a chave de API.
const KEY_ONLY_ENDPOINTS = new Set(['commentThreads', 'comments']);

async function api(endpoint, params = {}, { retry = true, useToken = true } = {}) {
  const { apiKey } = state.config;
  const keyOnly = KEY_ONLY_ENDPOINTS.has(endpoint);
  if (keyOnly && !apiKey) {
    throw new ApiError('Para ver os comentários, salve uma chave da YouTube Data API em Configurações › Credenciais da API. O Google não permite ler comentários só com o login de leitura.', 0, 'needsApiKey');
  }
  const token = useToken && !keyOnly ? Auth.ytToken() : null;
  if (!token && !apiKey) {
    throw new ApiError('Configure uma chave de API ou entre com sua conta Google em Configurações.', 0, 'noCredentials');
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
      part: 'snippet,contentDetails,statistics,liveStreamingDetails',
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
      this.pendingCode = { code: q.get('code'), redirectUri: pending.redirectUri };
    }
  },

  /** Endereço de volta do Google (cadastrado no Google Cloud Console), ex.: https://esiojunior89.github.io/MeuTube/ */
  redirectUri() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  },

  /** Login com servidor: vai ao Google pedindo também a chave de renovação. */
  signInWithServer(clientId) {
    const st = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    store.set(KEYS.oauthState, { state: st, hash: location.hash || '#/', redirectUri: this.redirectUri(), at: Date.now() });
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
      ...(email && { login_hint: email }),
    });
    location.assign(url);
  },

  async exchangeCode() {
    const { code, redirectUri } = this.pendingCode;
    this.pendingCode = null;
    let data = null;
    try {
      const res = await fetch(`${this.server()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: redirectUri }),
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
      toast('Informe o OAuth Client ID em Configurações › Credenciais da API para entrar com o Google.', 'error', 7000);
      if (state.view !== 'settings') location.hash = '#/settings';
      return;
    }
    if (location.protocol === 'file:') {
      toast('Abra o app por http:// ou https:// (ex.: um servidor local) para usar o login do Google.', 'error', 6000);
      return;
    }
    if (this.server()) {
      this.signInWithServer(clientId);
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
   novo para o mais antigo. Mantemos um buffer por playlist e
   fazemos uma mescla (k-way merge) sempre pegando o vídeo mais
   recente entre os topos dos buffers. Assim a ordem global por
   data é sempre correta, página após página.

   Só a aba "Vídeos" de cada canal: em vez da playlist de
   uploads completa (UU…), usamos a playlist automática de
   vídeos (UULF…). Shorts (UUSH…) e lives gravadas (UULV…) não
   entram no app; só as lives que estão no ar aparecem, no menu
   lateral, em "Ao vivo".
   ========================================================= */
class FeedStream {
  constructor(channels) {
    this.sources = channels.flatMap(c => ['UULF'].map(prefix => ({
      channelId: c.id,
      playlistId: prefix + c.id.slice(2),
      buffer: [],
      token: null,
      done: false,
    })));
    this.items = [];
    this.seen = new Set();
    this.loading = null;
    this.exhausted = this.sources.length === 0;
    this.error = null;
    this.dead = false;
    this.uiBusy = false;
  }

  dispose() {
    this.dead = true;
  }

  async fill(src) {
    while (!src.buffer.length && !src.done) {
      let data;
      try {
        data = await api('playlistItems', {
          part: 'snippet,contentDetails',
          playlistId: src.playlistId,
          maxResults: 50,
          pageToken: src.token,
        });
      } catch (e) {
        // 404: o canal não tem essa playlist (ex.: nunca fez live).
        if (e.status === 404) { src.done = true; return; }
        throw e;
      }
      if (this.dead) return;
      for (const it of data.items || []) {
        const id = it.contentDetails?.videoId;
        const published = it.contentDetails?.videoPublishedAt; // ausente em vídeos privados/excluídos
        const owner = it.snippet?.videoOwnerChannelId;
        if (!id || !published) continue;
        if (owner && owner !== src.channelId) continue;
        src.buffer.push({ id, ts: Date.parse(published) });
      }
      src.buffer.sort((a, b) => b.ts - a.ts);
      src.token = data.nextPageToken || null;
      if (!src.token) src.done = true;
    }
  }

  loadMore(count = PAGE_SIZE) {
    if (this.loading) return this.loading;
    if (this.exhausted || this.dead) return Promise.resolve([]);
    this.loading = this._load(count).finally(() => { this.loading = null; });
    return this.loading;
  }

  async _load(count) {
    const added = [];
    // Repete até completar a página: vídeos descartados pelo filtro de canal são repostos.
    while (added.length < count && !this.exhausted) {
      const picked = [];
      while (picked.length < count - added.length) {
        await Promise.all(this.sources.map(s => this.fill(s)));
        if (this.dead) return [];

        let best = null;
        for (const s of this.sources) {
          if (s.buffer.length && (!best || s.buffer[0].ts > best.buffer[0].ts)) best = s;
        }
        if (!best) { this.exhausted = true; break; }

        const next = best.buffer.shift();
        if (!this.seen.has(next.id)) {
          this.seen.add(next.id);
          picked.push(next);
        }
      }
      if (!picked.length) break;

      const details = await fetchVideos(picked.map(p => p.id));
      if (this.dead) return [];
      // Garantia extra: nada que esteja ao vivo ou agendado entra na página inicial.
      added.push(...picked.map(p => details.get(p.id)).filter(v => v && v.live === 'none' && withinDurationLimit(v)));
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
      added.push(...ids.map(id => details.get(id)).filter(v => v && v.live === 'none' && withinDurationLimit(v)));
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

function thumbBadge(v) {
  if (v.live === 'live') return '<span class="badge badge-live">AO VIVO</span>';
  if (v.live === 'upcoming') return '<span class="badge badge-upcoming">EM BREVE</span>';
  return v.duration ? `<span class="badge">${v.duration}</span>` : '';
}

function metaLine(v) {
  return [fmtViews(v.views), timeAgo(v.publishedAt)].filter(Boolean).join(' • ');
}

function newTag(v) {
  return isNewVideo(v) ? ' <span class="new-tag">Novo</span>' : '';
}

function tileHTML(v, i) {
  const ch = channelById(v.channelId);
  return `
    <a class="tile${isWatched(v.id) ? ' is-watched' : ''}" href="#/watch/${v.id}" data-vid="${v.id}" style="--i:${i}">
      <div class="thumb">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" decoding="async">
        ${thumbBadge(v)}
        ${progressBarHTML(v.id)}
      </div>
      <div class="tile-info">
        <img class="avatar" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <div>
          <h3 class="tile-title" title="${esc(v.title)}">${esc(v.title)}</h3>
          <p class="tile-channel">${esc(v.channelTitle)}</p>
          <p class="tile-meta">${esc(metaLine(v))}${newTag(v)}</p>
        </div>
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
  }
  const fresh = feed.items.slice(renderedCount);
  if (!fresh.length) return;
  grid.insertAdjacentHTML('beforeend', fresh.map((v, i) => tileHTML(v, Math.min(i, PAGE_SIZE - 1))).join(''));
  renderedCount = feed.items.length;
}

function resetFeed() {
  feeds.forEach(feed => feed.dispose());
  feeds.clear();
  gridFeed = null;
  renderedCount = 0;
  $('#feed').innerHTML = '';
  setSkeletons(false);
  $('#feed-status').innerHTML = '';
}

function renderFeedHeader() {
  const box = $('#feed-header');
  const ch = state.filter ? channelById(state.filter) : null;
  if (!ch) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <img class="avatar lg" src="${esc(ch.thumb || '')}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
    <div>
      <h1>${esc(ch.title)}</h1>
      <span class="muted">${esc(ch.handle || '')}</span>
    </div>
    <a class="btn btn-ghost btn-sm" href="#/">Ver todos os canais</a>
    <nav class="chips" aria-label="Ordem dos vídeos">
      <a class="chip" href="#/c/${esc(ch.id)}"${state.sort !== 'old' ? ' aria-current="true"' : ''}>Mais recentes</a>
      <a class="chip" href="#/c/${esc(ch.id)}/antigos"${state.sort === 'old' ? ' aria-current="true"' : ''}>Mais antigos</a>
    </nav>`;
  box.hidden = false;
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
      '<a class="btn btn-primary" href="#/settings">Adicionar canais</a>');
    return false;
  }
  if (!homeChannels().length) {
    status.innerHTML = emptyState('channels', 'Todos os canais estão como “Apenas lives”',
      'Eles aparecem só no menu lateral, em “Ao vivo”, quando estiverem transmitindo. Para ver vídeos aqui, desative “Apenas lives” em algum canal.',
      '<a class="btn btn-ghost" href="#/settings">Abrir Configurações</a>');
    return false;
  }
  if (!hasCredentials()) {
    status.innerHTML = emptyState('key', 'Falta configurar o acesso',
      'Entre com sua conta Google ou informe uma chave da YouTube Data API para carregar os vídeos.',
      '<a class="btn btn-primary" href="#/settings">Ir para Configurações</a>');
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
  } else if (feed.exhausted && !feed.items.length) {
    status.innerHTML = emptyState('channels', 'Nenhum vídeo encontrado',
      state.filter ? 'Este canal ainda não tem vídeos públicos.' : 'Os canais adicionados ainda não têm vídeos públicos.');
  } else if (feed.exhausted && state.hideWatched && feed.items.every(v => isWatched(v.id))) {
    status.innerHTML = emptyState('channels', 'Você já assistiu tudo',
      'Todos os vídeos daqui foram assistidos até o fim. Clique no ícone de olho, no rodapé do menu lateral, para vê-los de novo.');
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
  document.title = ch ? `${ch.title} · MeuTube` : 'MeuTube';
  renderFeedHeader();
  if (!checkHomePrereqs()) {
    $('#feed').innerHTML = '';
    gridFeed = null;
    renderedCount = 0;
    setSkeletons(false);
    return;
  }
  const feed = currentFeed();
  syncGrid();
  setSkeletons(feed.uiBusy);
  updateFeedStatus();
  if (!feed.exhausted) requestAnimationFrame(checkSentinel);
}

/* =========================================================
   Menu lateral (lista de canais)
   ========================================================= */
const overlayQuery = matchMedia('(max-width: 1099px)');

function renderSidebar() {
  const box = $('#side-channels');
  const list = [...homeChannels()].sort((a, b) => byName(a.title, b.title));
  box.innerHTML = list.length
    ? list.map(c => `
        <a class="side-item" href="#/c/${esc(c.id)}" data-channel="${esc(c.id)}" title="${esc(c.title)}">
          <img class="side-avatar" src="${esc(c.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
          <span class="side-label">${esc(c.title)}</span>
        </a>`).join('')
    : state.channels.length
    ? '<p class="side-empty">Todos os canais estão como “Apenas lives”.</p>'
    : `<a class="side-item" href="#/settings" title="Adicionar canais">
         <span class="side-icon">${ICONS.add}</span>
         <span class="side-label">Adicionar canais</span>
       </a>`;
  updateSidebarActive();
}

function updateSidebarActive() {
  const active = state.view === 'home' ? (state.filter || '') : null;
  $$('#sidebar [data-channel]').forEach(a => a.classList.toggle('active', a.dataset.channel === active));
  const watching = state.view === 'watch' ? state.currentVideoId : null;
  $$('#side-lives [data-vid]').forEach(a => a.classList.toggle('active', a.dataset.vid === watching));
}

/* =========================================================
   Lives ativas (metade de baixo do menu lateral)
   =========================================================
   A busca oficial de lives custa 100 de cota por canal, então
   lemos a playlist automática de lives de cada canal (UULV…,
   1 de cota) e confirmamos quais estão ao vivo agora pelo status
   do vídeo. Atualiza a cada 5 minutos, mas SÓ com o menu lateral
   expandido e o app visível (menu recolhido = nenhuma verificação).
   ========================================================= */
const LIVE_REFRESH_MS = 5 * 60 * 1000;
const Lives = { items: [], loading: false, checked: false, lastFetch: 0, error: null, gen: 0 };

async function refreshLives(force = false) {
  if (!state.channels.length || !hasCredentials()) {
    Object.assign(Lives, { items: [], checked: true, error: null });
    renderLives();
    return;
  }
  // Economia de cota: só verifica com o menu lateral expandido e o app visível. Com o menu
  // recolhido, nunca verifica; um pedido "forçado" (ex.: canais mudaram) fica para quando expandir.
  if (!isSidebarExpanded() || document.visibilityState !== 'visible') {
    if (force) Lives.lastFetch = 0;
    return;
  }
  if (Lives.loading) return;
  if (!force && Date.now() - Lives.lastFetch < LIVE_REFRESH_MS - 5000) return;

  Lives.loading = true;
  const gen = ++Lives.gen;
  try {
    const perChannel = await Promise.all(state.channels.map(c =>
      api('playlistItems', { part: 'contentDetails', playlistId: `UULV${c.id.slice(2)}`, maxResults: 10 })
        .then(d => (d.items || []).map(it => it.contentDetails?.videoId).filter(Boolean))
        .catch(e => { if (e.status === 404) return []; throw e; }))); // 404: canal nunca fez live
    const ids = [...new Set(perChannel.flat())];
    const details = ids.length ? await fetchVideos(ids) : new Map();
    if (gen !== Lives.gen) return;
    Lives.items = [...details.values()]
      .filter(v => v.live === 'live')
      .sort((a, b) => byName(channelById(a.channelId)?.title || a.channelTitle, channelById(b.channelId)?.title || b.channelTitle));
    Lives.error = null;
    Lives.lastFetch = Date.now();
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
  if (Lives.items.length) {
    box.innerHTML = Lives.items.map(v => {
      const ch = channelById(v.channelId);
      const viewers = v.viewers != null ? compact.format(Number(v.viewers)) : '';
      return `
        <a class="side-item side-live" href="#/watch/${v.id}" data-vid="${v.id}"
           title="${esc(`${v.channelTitle} — ${v.title}${viewers ? ` (${viewers} assistindo)` : ''}`)}">
          <span class="live-avatar">
            <img class="side-avatar" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
            <span class="live-dot"></span>
          </span>
          <span class="side-label">
            <span class="side-live-name">${esc(v.channelTitle)}</span>
            <span class="side-live-title">${esc(v.title)}</span>
          </span>
          ${viewers ? `<span class="side-live-viewers">${viewers}</span>` : ''}
        </a>`;
    }).join('');
  } else if (!state.channels.length) {
    box.innerHTML = '<p class="side-empty">Adicione canais para ver as lives.</p>';
  } else if (Lives.error) {
    box.innerHTML = `<p class="side-empty">Não foi possível verificar as lives.</p>`;
  } else {
    box.innerHTML = `<p class="side-empty">${Lives.checked ? 'Nenhum canal ao vivo agora.' : 'Verificando…'}</p>`;
  }
  updateSidebarActive();
}

/** Telas estreitas e a página do vídeo usam o menu como gaveta sobreposta (igual ao YouTube). */
function updateSidebarMode() {
  const overlay = overlayQuery.matches || state.view === 'watch';
  const body = document.body;
  body.classList.toggle('sidebar-overlay', overlay);
  body.classList.toggle('sidebar-mini', !overlay && state.sidebarMini);
  if (!overlay) body.classList.remove('sidebar-open');
  $('#menu-btn').setAttribute('aria-expanded', String(overlay
    ? body.classList.contains('sidebar-open')
    : !state.sidebarMini));
  // Ao expandir o menu, verifica as lives na hora se a última verificação tiver mais de 5 min.
  if (isSidebarExpanded()) refreshLives();
}

/** Menu lateral expandido: no PC, aberto com os nomes; no celular/página do vídeo, gaveta aberta. */
function isSidebarExpanded() {
  const body = document.body;
  return body.classList.contains('sidebar-overlay') ? body.classList.contains('sidebar-open') : !state.sidebarMini;
}

function toggleSidebar() {
  if (document.body.classList.contains('sidebar-overlay')) {
    document.body.classList.toggle('sidebar-open');
  } else {
    state.sidebarMini = !state.sidebarMini;
    store.set(KEYS.sidebar, state.sidebarMini);
  }
  updateSidebarMode();
  requestAnimationFrame(checkSentinel);
}

function closeSidebarOverlay() {
  if (!document.body.classList.contains('sidebar-open')) return;
  document.body.classList.remove('sidebar-open');
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
  on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 4.2 4.2 2.8l17 17-1.4 1.4-3.3-3.3A10.8 10.8 0 0 1 12 19C6.5 19 2.7 15 1 12a14.7 14.7 0 0 1 4-4.9zM12 5c5.5 0 9.3 4 11 7a14.4 14.4 0 0 1-2.9 3.7l-3.2-3.2A5 5 0 0 0 11.5 7.1L9.3 4.9A11 11 0 0 1 12 5zM7 12a5 5 0 0 0 6.5 4.8l-1.6-1.6A3 3 0 0 1 8.8 12l-1.6-1.6A5 5 0 0 0 7 12z"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.5 0 9.3 4 11 7-1.7 3-5.5 7-11 7S2.7 15 1 12c1.7-3 5.5-7 11-7zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>',
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
  btn.innerHTML = on ? EYE_ICONS.on : EYE_ICONS.off;
}

function toggleHideWatched() {
  state.hideWatched = !state.hideWatched;
  store.set(KEYS.hideWatched, state.hideWatched);
  Sync.touch('prefs');
  applyHideWatched();
  if (state.view === 'home') {
    updateFeedStatus();
    requestAnimationFrame(checkSentinel); // se sobrou pouco na tela, carrega mais
  } else if (state.view === 'watch' && state.currentVideo) {
    renderUpNext(state.currentVideo);
  }
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
  player.loadVideoById({ videoId: id, startSeconds: start });
}

function onPlayerStateChange(e) {
  const S = window.YT.PlayerState;
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
  if (!state.autoplay || state.view !== 'watch') return;
  const next = nextVideoAfter(state.currentVideo);
  if (next) location.hash = `#/watch/${next.id}`;
}

function onPlayerError(e) {
  const messages = {
    2: 'O identificador do vídeo é inválido.',
    5: 'Este vídeo não pode ser reproduzido no player HTML5.',
    100: 'O vídeo foi removido ou é privado.',
    101: 'O dono do vídeo não permite a reprodução fora do YouTube.',
    150: 'O dono do vídeo não permite a reprodução fora do YouTube.',
  };
  const id = state.currentVideoId;
  showPlayerError(messages[e.data] || 'Não foi possível reproduzir este vídeo.',
    [101, 150].includes(e.data) && id
      ? `<a class="btn btn-ghost btn-sm" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">Assistir no YouTube</a>`
      : '');
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
const PLAY_ICONS = {
  play: ICON('M8 5v14l11-7z'),
  pause: ICON('M6 5h4v14H6zm8 0h4v14h-4z'),
  replay: ICON('M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z'),
};
const SKIP_ICONS = {
  prev: ICON('M6 6h2v12H6zm3.5 6 8.5 6V6z'),
  next: ICON('M6 18l8.5-6L6 6zM16 6v12h2V6z'),
};
const VOL_ICONS = {
  high: ICON('M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z'),
  low: ICON('M5 9v6h4l5 5V4L9 9zm13.5 3A4.5 4.5 0 0 0 16 8v8a4.5 4.5 0 0 0 2.5-4z'),
  muted: ICON('M3 9v6h4l5 5V4L7 9zm18.3 1.7-1.4-1.4L17.6 11.6 15.3 9.3l-1.4 1.4 2.3 2.3-2.3 2.3 1.4 1.4 2.3-2.3 2.3 2.3 1.4-1.4-2.3-2.3z'),
};
const CC_ICON = ICON('M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z');
const GEAR_ICON = ICON('M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.3 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z');
const MENU_ICONS = {
  speed: ICON('M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6zm7.1-.5-6.5 6.5a2 2 0 1 0 1.4 1.4l6.5-6.5z'),
  cc: CC_ICON,
  quality: ICON('M3 5v14h18V5zm16 12H5V7h14zM7 9h4v2H7zm0 4h6v2H7z'),
  back: ICON('M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z'),
  check: ICON('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'),
};
const FS_ICONS = {
  enter: ICON('M14 3h7v7h-2V6.4l-4.3 4.3-1.4-1.4L17.6 5H14zM3 14h2v3.6l4.3-4.3 1.4 1.4L6.4 19H10v2H3z'),
  exit: ICON('M21 4.4 19.6 3 15 7.6V4h-2v7h7V9h-3.6zM3 19.6 4.4 21 9 16.4V20h2v-7H4v2h3.6z'),
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
  try { return { stack: [], last: null, ...JSON.parse(sessionStorage.getItem(WATCH_HISTORY_KEY)) }; } catch { return { stack: [], last: null }; }
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
  location.hash = `#/watch/${id}`;
}

function playNext() {
  const next = nextVideoAfter(state.currentVideo);
  if (next) location.hash = `#/watch/${next.id}`;
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
    <img class="pc-top-avatar" src="${esc(ch?.thumb || '')}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
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

function toggleAutoplay() {
  state.autoplay = !state.autoplay;
  store.set(KEYS.autoplay, state.autoplay);
  Sync.touch('prefs');
  updateAutoplayButton();
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
      + row('noop', MENU_ICONS.quality, 'Qualidade', `${currentQuality().label} (automática)`, ' pc-menu-static');
  }
}

function openMenu(open = $('#pc-menu').hidden) {
  const menu = $('#pc-menu');
  menu.hidden = !open;
  $('#pc-settings').setAttribute('aria-expanded', String(open));
  if (open) {
    menuPage = 'main';
    renderMenu();
    setControlsVisible(true);
  } else {
    pokeControls();
  }
}

function onMenuAction(action) {
  const [kind, value] = action.split(':');
  if (kind === 'menu') { menuPage = value; renderMenu(); return; }
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
  renderMenu();
}

/* ---------- Barra de progresso e tempo ---------- */
function progressFraction(e) {
  const r = $('#pc-progress').getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}

function updateProgressUI(previewFraction = null) {
  if (!player?.getDuration) return;
  const live = state.currentVideo?.live === 'live';
  const d = player.getDuration() || 0;
  const t = previewFraction != null ? previewFraction * d : (player.getCurrentTime?.() || 0);
  const played = d ? Math.min(100, (t / d) * 100) : 0;
  const loaded = Math.min(100, (player.getVideoLoadedFraction?.() || 0) * 100);
  const bar = $('#pc-progress');
  bar.style.setProperty('--played', `${live ? 100 : played}%`);
  bar.style.setProperty('--loaded', `${live ? 100 : loaded}%`);
  $('#pc-time').innerHTML = live
    ? '<span class="pc-live-dot"></span>AO VIVO'
    : `${fmtClock(t)} <span>/ ${fmtClock(d)}</span>`;
  const q = currentQuality().badge;
  const badge = $('#pc-quality');
  badge.textContent = q;
  badge.hidden = !q;
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
  if (stateCode !== S.BUFFERING) {
    clearTimeout(ytTitleTimer);
    setYouTubeTitleShowing(true);
    if (stateCode === S.PLAYING) ytTitleTimer = setTimeout(() => setYouTubeTitleShowing(false), YT_TITLE_MS);
  }
  if (stateCode === S.PLAYING) {
    if (playbackRate !== 1) player.setPlaybackRate?.(playbackRate);
    if (playerPrefs.cc && ccAppliedFor !== playerVideoId) { ccAppliedFor = playerVideoId; applyCaptions(); }
    pokeControls();
  }
}

/* ---------- Modo teatro (só no computador) ----------
   O player ocupa uma faixa preta de ponta a ponta; título, descrição e comentários ficam
   embaixo, à esquerda, e "A seguir" à direita, em lista. A escolha fica guardada neste
   aparelho. No celular o botão não existe (o player já ocupa a largura toda). */
const THEATER_ICONS = {
  on: ICON('M19 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 10H5V8h14z'),
  off: ICON('M17 8H7a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2zm0 6H7v-4h10z'),
};
const desktopQuery = matchMedia('(min-width: 1001px)');
let theaterOn = store.get(KEYS.theater, false);

function theaterActive() {
  return theaterOn && desktopQuery.matches && !isMobile();
}

function applyTheater() {
  $('#view-watch').classList.toggle('theater', theaterActive());
  const btn = $('#pc-theater');
  if (!btn) return;
  btn.innerHTML = theaterOn ? THEATER_ICONS.off : THEATER_ICONS.on;
  btn.setAttribute('aria-pressed', String(theaterOn));
  btn.title = theaterOn ? 'Sair do modo teatro (t)' : 'Modo teatro (t)';
  btn.setAttribute('aria-label', btn.title);
}

function toggleTheater() {
  if (isMobile() || !desktopQuery.matches) return;
  theaterOn = !theaterOn;
  store.set(KEYS.theater, theaterOn);
  const update = () => {
    applyTheater();
    // A lista de "A seguir" muda de tamanho: 10 vídeos no modo teatro, 3 no normal.
    upNextCount = Math.max(upNextPage(), theaterOn ? upNextCount : UPNEXT_PAGE);
    if (state.currentVideo) renderUpNext(state.currentVideo);
  };
  if (document.startViewTransition && !reducedMotion.matches && !document.fullscreenElement) document.startViewTransition(update);
  else update();
  pokeControls();
}

/** Atualiza o ícone do botão de tela cheia do app (entrar/sair). */
function updateFullscreenButton() {
  const btn = $('#player-fs');
  const inside = Boolean(document.fullscreenElement?.closest?.('.player-wrap'));
  btn.innerHTML = inside ? FS_ICONS.exit : FS_ICONS.enter;
  btn.title = inside ? 'Sair da tela cheia (f)' : 'Tela cheia (f)';
  btn.setAttribute('aria-label', btn.title);
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
  onClick('#pc-play', togglePlay);
  onClick('#pc-prev', playPrevious);
  onClick('#pc-next', playNext);
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
    if (!$('#pc-menu').hidden && !e.target.closest('#pc-menu, #pc-settings')) openMenu(false);
  });

  // Mantém os controles visíveis enquanto o mouse está sobre a barra. Trocar um ícone que está
  // sob o cursor faz o navegador avisar uma "saída" falsa, então a saída é conferida pela posição.
  const inside = (el, e) => {
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  for (const el of [$('.pc-bar'), $('#pc-progress')]) {
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

  // A altura do player define o tamanho dos tiles de "A seguir" (3 tiles = altura do player).
  new ResizeObserver(([entry]) => {
    $('#view-watch').style.setProperty('--player-h', `${Math.round(entry.contentRect.height)}px`);
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
   Página do vídeo
   ========================================================= */
const UPNEXT_PAGE = 3;          // "A seguir" mostra 3 vídeos; "Mostrar mais" acrescenta outros 3
const UPNEXT_PAGE_THEATER = 10; // no modo teatro, a coluna fica ao lado dos comentários: 10 por vez
const upNextPage = () => (theaterActive() ? UPNEXT_PAGE_THEATER : UPNEXT_PAGE);
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
      <div class="watch-channel">
        <img class="avatar watch-avatar" src="${esc(ch?.thumb || '')}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <div>
          <strong>${esc(v.channelTitle)}</strong>
          <span class="muted" id="watch-subs">${esc(subscribersText(v.channelId) || ch?.handle || '')}</span>
        </div>
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
  document.title = `${v.title} · MeuTube`;
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

function enterWatch(id) {
  if (playerVideoId && playerVideoId !== id) saveProgress();
  state.currentVideoId = id;
  state.currentVideo = null;
  updateSkipButtons();
  upNextCount = upNextPage();
  Comments.req++; // cancela respostas de comentários do vídeo anterior
  $('#player-error').hidden = true;

  state.watchFeed = currentFeed();
  const known = state.watchFeed.items.find(v => v.id === id) || findLoadedVideo(id);
  if (known) renderWatchInfo(known);
  else $('#watch-info').innerHTML = watchInfoSkeleton();
  $('#upnext').innerHTML = miniSkeletons(upNextPage());
  $('#upnext-more').hidden = true;
  $('#comments-list').innerHTML = commentSkeletons(3);
  $('#comments-more').hidden = true;

  if (!state.channels.length || !hasCredentials()) {
    showWatchBlocked(!state.channels.length
      ? 'Adicione canais em Configurações para assistir aos vídeos.'
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
    // O que não é do MeuTube (outro canal, Short, live gravada, acima do limite de duração)
    // simplesmente não existe no app: sem aviso, segue para outro lugar.
    if (!video || !(await isMeuTubeVideo(video))) {
      if (state.currentVideoId === id) skipNonMeuTube(id);
      return;
    }
    if (state.currentVideoId !== id) return;
    if (!known) renderWatchInfo(video);
    state.currentVideo = video;
    recordWatchHistory(id);
    markSeen(id);
    playVideo(id);
    loadComments(id, true);
    renderUpNext(video);
  })();
}

/** Vídeo que o MeuTube mostra: live no ar (menu "Ao vivo") ou vídeo da aba "Vídeos" do canal,
    dentro do limite de duração. Shorts e lives gravadas ficam de fora. */
async function isMeuTubeVideo(v) {
  if (v.live === 'live') return true;
  if (v.live !== 'none' || !withinDurationLimit(v)) return false;
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

/** Vídeo que não é do MeuTube: vai para o anterior válido (se veio do "Anterior") ou para o Início. */
function skipNonMeuTube(id) {
  watchHistory.stack = watchHistory.stack.filter(x => x !== id);
  if (watchHistory.last === id) watchHistory.last = null;
  saveWatchHistory();
  if (goingBack && previousVideoId()) {
    playPrevious();
    return;
  }
  goingBack = false;
  location.replace('#/');
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
    <a class="mini${isWatched(v.id) ? ' is-watched' : ''}" href="#/watch/${v.id}" data-vid="${v.id}" style="--i:${i}">
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
    box.innerHTML = failure
      ? `<p class="error">${esc(failure.message)}</p>`
      : '<p class="muted">Não há vídeos seguintes. Este é o vídeo mais antigo dos seus canais.</p>';
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
      <img class="avatar sm" src="${esc(s.authorProfileImageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div class="comment-content">
        <div class="comment-head">
          <strong>${esc(s.authorDisplayName)}</strong>
          <span class="muted">${esc(timeAgo(Date.parse(s.publishedAt)) + edited)}</span>
        </div>
        <div class="comment-text">${richText(s.textOriginal ?? s.textDisplay)}</div>
        ${s.likeCount ? `<div class="comment-likes">👍 ${esc(compact.format(s.likeCount))}</div>` : ''}
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
   Configurações
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
  const header = $('#account');
  const panel = $('#account-panel');
  const connected = Boolean(Auth.validToken());
  const account = connected ? { profile: Auth.profile, ytChannel: Auth.ytChannel } : Auth.remembered;

  if (!account) {
    header.innerHTML = `
      <button class="btn btn-google btn-sm" type="button" data-action="signin">${ICONS.google}<span>Entrar</span></button>`;
    panel.innerHTML = `
      <div class="account-panel">
        <p class="muted" style="margin:0">Entre com sua conta Google para usar o app com a sua conta do YouTube.
          ${state.config.apiKey ? 'Com a chave de API salva, o login é opcional.' : ''}</p>
        <div><button class="btn btn-google" type="button" data-action="signin">${ICONS.google}Entrar com o Google</button></div>
        <div id="sync-status"></div>
        ${premiumNote()}
      </div>`;
    renderSyncStatus();
    return;
  }

  const p = account.profile;
  const name = p?.name || account.ytChannel?.title || 'Conta Google';
  const pic = p?.picture || account.ytChannel?.thumb || '';
  const avatar = cls => `<img class="${cls}" src="${esc(pic)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;

  header.innerHTML = connected
    ? `<a class="account-chip" href="#/settings" title="${esc(name)}">${avatar('')}<span>${esc(p?.given_name || name)}</span></a>`
    : `<button class="btn btn-google btn-sm" type="button" data-action="signin" title="Sessão expirada">${ICONS.google}<span>Reconectar</span></button>`;

  let status;
  if (!connected) {
    status = `
      <p class="note">
        <strong>Sessão expirada.</strong> ${Auth.server()
          ? 'A renovação automática do login vale por até 7 dias (limite do Google); depois disso é preciso entrar de novo.'
          : 'Por segurança, o Google limita o login de apps web a 1 hora.'}
        ${state.config.apiKey
          ? 'Como você tem uma chave de API salva, o app continua funcionando normalmente — reconectar é opcional.'
          : 'Clique em “Reconectar” para continuar carregando vídeos.'}
      </p>`;
  } else if (Auth.hasYtScope) {
    const until = new Date(Auth.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    status = Auth.session
      ? '<span class="tier">Conectado · acesso ao YouTube autorizado · login renovado automaticamente neste aparelho</span>'
      : `<span class="tier">Conectado · acesso ao YouTube autorizado · sessão válida até ${until}</span>`;
    if (Auth.server() && !Auth.session) {
      // Servidor de login configurado, mas este login ainda é o de 1 hora: entra de novo para receber a chave.
      status += `
        <p class="note">Servidor de login configurado. Entre de novo uma vez para o login se renovar sozinho por até 7 dias.</p>
        <div><button class="btn btn-primary btn-sm" type="button" data-action="signin">Ativar renovação automática</button></div>`;
    }
  } else {
    status = `
      <p class="note note-warn">
        <strong>Falta autorizar o acesso ao YouTube.</strong> Na tela do Google, marque a caixa
        “Ver sua conta do YouTube”, senão o app não consegue listar vídeos e canais com a sua conta.
      </p>
      <div><button class="btn btn-primary btn-sm" type="button" data-action="signin">Autorizar acesso ao YouTube</button></div>`;
  }

  panel.innerHTML = `
    <div class="account-panel">
      <div class="account-card">
        ${avatar('avatar lg')}
        <div>
          <strong>${esc(name)}</strong>
          ${p?.email ? `<span>${esc(p.email)}</span>` : ''}
          ${account.ytChannel ? `<span>Canal no YouTube: ${esc(account.ytChannel.title)}</span>` : ''}
        </div>
        ${connected ? '' : `<button class="btn btn-google btn-sm" type="button" data-action="signin">${ICONS.google}Reconectar</button>`}
        <button class="btn btn-ghost btn-sm" type="button" data-action="signout">Sair</button>
      </div>
      ${status}
      <div id="sync-status"></div>
      ${premiumNote()}
    </div>`;
  renderSyncStatus();
}

function renderChannelList() {
  const ul = $('#channel-list');
  $('#channel-count').textContent = state.channels.length || '';
  if (!state.channels.length) {
    ul.innerHTML = '<li class="channel-empty">Nenhum canal adicionado ainda.</li>';
    return;
  }
  ul.innerHTML = state.channels.map(c => `
    <li class="channel-item" data-id="${esc(c.id)}">
      <img class="avatar" src="${esc(c.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div>
        <strong>${esc(c.title)}</strong>
        <span>${esc(c.handle || c.id)}</span>
      </div>
      <label class="channel-dur" title="Duração máxima dos vídeos deste canal (hh:mm:ss). Vídeos mais longos não aparecem e não contam nas Estatísticas. Vazio = sem limite.">
        <span>Até</span>
        <input type="text" inputmode="numeric" placeholder="hh:mm:ss" maxlength="8" spellcheck="false" autocomplete="off"
          value="${c.maxDur ? fmtHms(c.maxDur) : ''}" data-max-dur="${esc(c.id)}" aria-label="Duração máxima dos vídeos de ${esc(c.title)} (hh:mm:ss)">
      </label>
      <label class="switch channel-switch" title="Quando ativado, o canal só aparece em “Ao vivo” (no menu lateral) enquanto estiver transmitindo">
        <input type="checkbox" data-lives-only="${esc(c.id)}" ${c.livesOnly ? 'checked' : ''}>
        <span class="switch-track" aria-hidden="true"></span>
        <span class="switch-label">Apenas lives</span>
      </label>
      <button class="btn-icon" type="button" data-action="remove-channel" data-id="${esc(c.id)}" aria-label="Remover ${esc(c.title)}" title="Remover">${ICONS.remove}</button>
    </li>`).join('');
}

function renderSettings() {
  document.title = 'Configurações · MeuTube';
  renderInstallPanel();
  renderVersionInfo();
  renderAccount();
  renderChannelList();
}

function parseChannelInput(raw) {
  const s = raw.trim();
  if (!s) return null;

  if (/^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(s)) {
    let url;
    try { url = new URL(/^https?:/i.test(s) ? s : `https://${s}`); } catch { return null; }
    if (url.hostname.endsWith('youtu.be')) {
      const id = url.pathname.slice(1, 12);
      return VIDEO_ID_RE.test(id) ? { videoId: id } : null;
    }
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    const v = url.searchParams.get('v');
    if (parts[0] === 'watch' && v && VIDEO_ID_RE.test(v)) return { videoId: v };
    if (['shorts', 'live', 'embed'].includes(parts[0]) && VIDEO_ID_RE.test(parts[1] || '')) return { videoId: parts[1] };
    if (parts[0]?.startsWith('@')) return { handle: parts[0] };
    if (parts[0] === 'channel' && CHANNEL_ID_RE.test(parts[1] || '')) return { id: parts[1] };
    if (parts[0] === 'user' && parts[1]) return { username: parts[1] };
    if (parts[0] === 'c' && parts[1]) return { search: parts[1] };
    if (parts[0]) return { search: parts[0] };
    return null;
  }
  if (CHANNEL_ID_RE.test(s)) return { id: s };
  if (s.startsWith('@')) return { handle: s };
  return { handle: `@${s.replace(/\s+/g, '')}`, search: s };
}

async function resolveChannel(raw) {
  const q = parseChannelInput(raw);
  if (!q) throw new Error(`Não reconheci “${raw}” como um canal do YouTube.`);

  let channelId = q.id;
  if (q.videoId) {
    const data = await api('videos', { part: 'snippet', id: q.videoId });
    channelId = data.items?.[0]?.snippet?.channelId;
    if (!channelId) throw new Error('Vídeo não encontrado para identificar o canal.');
  }

  const part = 'snippet,contentDetails';
  let item = null;
  if (channelId) item = (await api('channels', { part, id: channelId })).items?.[0];
  else if (q.handle) item = (await api('channels', { part, forHandle: q.handle })).items?.[0];
  else if (q.username) item = (await api('channels', { part, forUsername: q.username })).items?.[0];

  if (!item && q.search) {
    // Último recurso (URLs antigas /c/... ou nome solto): busca do canal — custa mais cota.
    const found = await api('search', { part: 'snippet', type: 'channel', q: q.search, maxResults: 1 });
    const id = found.items?.[0]?.snippet?.channelId || found.items?.[0]?.id?.channelId;
    if (id) item = (await api('channels', { part, id })).items?.[0];
  }
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
  const entries = input.value.split(/,+|\s(?=https?:|@|www\.|youtube\.com)/).map(s => s.trim()).filter(Boolean);
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

/** Canais alterados em outra aba (ex.: limite de duração nas Configurações com as Estatísticas abertas): aplica na hora. */
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

  enabled() {
    return Boolean(Auth.validToken() && Auth.hasDriveScope);
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
  const box = $('#sync-status');
  if (!box) return;
  const time = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  let html;
  if (!Auth.validToken()) {
    html = `<p class="note"><strong>Sincronização na nuvem:</strong> entre com o Google para salvar canais, opções e
      progresso na sua conta e carregá-los em outros aparelhos.
      ${Sync.meta.lastSync ? `Última sincronização: ${new Date(Sync.meta.lastSync).toLocaleString('pt-BR')}.` : ''}</p>`;
  } else if (!Auth.hasDriveScope) {
    html = `
      <p class="note note-warn"><strong>Sincronização na nuvem desligada.</strong> Na tela do Google, marque a permissão
        do Google Drive (“ver, criar e excluir os próprios dados de configuração”). O app só usa uma pasta oculta,
        exclusiva dele — não vê nem mexe nos seus arquivos.</p>
      <div><button class="btn btn-primary btn-sm" type="button" data-action="signin">Ativar sincronização</button></div>`;
  } else if (Sync.status === 'error') {
    html = `
      <p class="note note-warn"><strong>Não foi possível sincronizar:</strong> ${esc(Sync.error?.message || 'erro desconhecido')}
        ${Sync.meta.lastSync ? ` Última sincronização: ${time(Sync.meta.lastSync)}.` : ''}</p>
      <div><button class="btn btn-ghost btn-sm" type="button" data-action="sync-now">Tentar de novo</button></div>`;
  } else {
    const text = Sync.status === 'syncing'
      ? 'sincronizando…'
      : Sync.meta.lastSync ? `ativa · última sincronização às ${time(Sync.meta.lastSync)}` : 'ativa';
    const c = Sync.meta.cloud;
    html = `
      <span class="tier sync-ok">☁ Sincronização na nuvem ${text}</span>
      ${c ? `<p class="sync-summary muted">Na nuvem: <strong>${c.channels}</strong> ${c.channels === 1 ? 'canal' : 'canais'} ·
        <strong>${c.progress}</strong> ${c.progress === 1 ? 'vídeo' : 'vídeos'} com progresso ·
        atualizado em ${new Date(c.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>` : ''}
      <div><button class="btn btn-ghost btn-sm" type="button" data-action="sync-now"${Sync.status === 'syncing' ? ' disabled' : ''}>Sincronizar agora</button></div>`;
  }
  box.innerHTML = html;
}

/* =========================================================
   Roteamento + transições entre telas
   ========================================================= */
let pendingHero = null;

function parseRoute() {
  const hash = location.hash || '#/';
  const watch = /^#\/watch\/([\w-]{11})$/.exec(hash);
  if (watch) return { view: 'watch', id: watch[1] };
  if (hash === '#/settings') return { view: 'settings' };
  if (hash === '#/stats') return { view: 'stats' };
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

function applyView(view, id, channel, sort = 'new') {
  const prev = state.view;
  if (prev === 'home') state.homeScroll = scrollY;
  if (prev === 'watch' && view !== 'watch') {
    pausePlayer();
    state.currentVideoId = null;
  }

  state.view = view;
  $('#view-home').hidden = view !== 'home';
  $('#view-watch').hidden = view !== 'watch';
  $('#view-settings').hidden = view !== 'settings';
  $('#view-stats').hidden = view !== 'stats';
  $$('.side-footer [data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  updateSidebarMode();

  if (view === 'home') {
    const filter = channel && isHomeChannel(channel) ? channel : null;
    const order = filter ? sort : 'new';
    const filterChanged = filter !== state.filter || order !== state.sort;
    state.filter = filter;
    state.sort = order;
    showHome();
    window.scrollTo({ top: filterChanged ? 0 : state.homeScroll, behavior: 'instant' });
  } else if (view === 'watch') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    enterWatch(id);
  } else if (view === 'stats') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderStats();
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderSettings();
  }
  updateSidebarActive();
  updateToTop();
}

function route(animate = true) {
  const { view, id, channel, sort } = parseRoute();
  const prevView = state.view;
  closeSidebarOverlay();
  const prevVideo = state.currentVideoId;
  const canAnimate = animate && !reducedMotion.matches;

  // Estado "antes": a miniatura clicada vira o player (ou o player volta para o tile).
  clearHeroNames();
  if (view === 'watch' && pendingHero?.isConnected && inViewport(pendingHero)) setHero(pendingHero);
  else if (prevView === 'watch' && view === 'home') setHero($('.player-wrap'));
  pendingHero = null;

  const update = () => {
    clearHeroNames();
    applyView(view, id, channel, sort);
    if (view === 'watch') {
      setHero($('.player-wrap'));
    } else if (view === 'home' && prevView === 'watch' && prevVideo) {
      const thumb = $(`#feed [data-vid="${prevVideo}"] .thumb`);
      if (thumb && inViewport(thumb)) setHero(thumb);
    }
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

function bindEvents() {
  window.addEventListener('hashchange', () => route(true));

  document.addEventListener('click', e => {
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
      case 'toggle-desc':
      case 'expand-desc': {
        const box = $('#description');
        if (actionEl.dataset.action === 'expand-desc' && !box.classList.contains('collapsed')) break;
        if (getSelection()?.toString()) break; // estava selecionando texto, não clicando
        const collapsed = box.classList.toggle('collapsed');
        box.querySelector('.desc-toggle').textContent = collapsed ? 'mais' : 'Mostrar menos';
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
  $('#sidebar-backdrop').addEventListener('click', closeSidebarOverlay);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebarOverlay();
  });
  overlayQuery.addEventListener('change', () => {
    updateSidebarMode();
    requestAnimationFrame(checkSentinel);
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
    if (state.view === 'watch' && player?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING) saveProgress();
  }, 5000);
  window.addEventListener('pagehide', saveProgress);

  // Tela cheia: a entrada é animada só com CSS (iframe:fullscreen); a saída, por esta classe.
  // No celular, o vídeo em tela cheia gira sozinho para a horizontal.
  let playerWasFullscreen = false;
  const onFullscreenChange = () => {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
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
    // Saiu do vídeo em tela cheia (a página pode continuar em tela cheia no celular).
    if (playerWasFullscreen) {
      playerWasFullscreen = false;
      if (isMobile()) {
        try { screen.orientation?.unlock?.(); } catch { /* ignora */ }
      }
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
   • Instalado ("Instalar app" no Chrome), o MeuTube abre sempre
     em tela cheia, sem a barra do navegador (manifest.json).
   • Aberto pelo navegador, entra em tela cheia no primeiro toque
     (o navegador não permite fazer isso sem um toque).
   ========================================================= */
let installPrompt = null;
let lastRotation = 'ainda não testada'; // resultado da última tentativa de girar a tela (diagnóstico)

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
    box.innerHTML = '<span class="tier">Você está usando o MeuTube instalado como app.</span>';
  } else if (installPrompt) {
    box.innerHTML = `
      <p class="muted">Instale o MeuTube para ele abrir pelo ícone, sempre em tela cheia, sem a barra do navegador.</p>
      <div><button class="btn btn-primary" type="button" data-action="install-app">Instalar app</button></div>`;
  } else {
    box.innerHTML = `
      <p class="muted" style="margin:0">Para abrir sempre em tela cheia, sem a barra do navegador, instale o MeuTube:
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
    toast('MeuTube instalado. Abra pelo ícone para usar em tela cheia.', 'success');
  });

  if (!isMobile()) return;
  // Pelo navegador: entra (ou volta) em tela cheia a cada toque, se não estiver.
  document.addEventListener('click', () => {
    if (document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches) return;
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => { /* ignora */ });
  }, true);
}

/** No PC, os botões de Estatísticas e Configurações do rodapé do menu (e o de Credenciais) abrem numa aba nova.
    No celular (e no app instalado) continuam abrindo na mesma tela. */
function setupFooterLinks() {
  if (isMobile()) return;
  $$('.side-footer a[data-nav="stats"], .side-footer a[data-nav="settings"], #cred-link').forEach(a => {
    a.target = '_blank';
    a.rel = 'noopener';
  });
}

/** Versão discreta no menu lateral e, em Configurações, versão + diagnóstico do celular. */
function renderVersionInfo() {
  const side = $('#app-version');
  if (side) side.textContent = `v${APP_VERSION}`;
  const footer = $('#settings-footer');
  if (!footer) return;
  const htmlVersion = document.querySelector('meta[name="app-version"]')?.content;
  const sw = navigator.serviceWorker?.controller ? 'ativo' : 'inativo';
  const mode = isInstalledApp() ? 'app instalado' : 'navegador';
  footer.innerHTML = `
    <span>MeuTube <strong>v${APP_VERSION}</strong></span>
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
   Canais marcados como "Apenas lives" ficam de fora: não contam e não
   aparecem. Ao desmarcar, voltam a contar e aparecem nas estatísticas.
   ========================================================= */
const STATS_TICK_MS = 5000;

/** Canais "Apenas lives" (fora das estatísticas). */
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
  watchTick = same && state.view === 'watch' && isPlaying() ? now : 0;
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
   Vídeos de cada canal no MeuTube (base das Estatísticas)
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
const VIDEO_INFO_KEY = 'meutube.videoInfo'; // { canal: { vídeo: segundos | -1 indisponível | -2 estreia/ao vivo } }
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
    channelCatalogs.set(c.id, new Map(parseIndexList(list).filter(e => durations[e.id] > 0).map(e => [e.id, durations[e.id]])));
  }
}

/** Total de vídeos do canal no MeuTube (respeitando o limite de duração), ou undefined se ainda não foi contado. */
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
  let changed = false;
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
      const missing = ids.filter(id => !(id in info) || info[id] === -2); // novos + estreias que podem ter saído
      for (let j = 0; j < missing.length; j += 50) {
        const batch = missing.slice(j, j + 50);
        const data = await api('videos', {
          part: 'contentDetails,snippet',
          id: batch.join(','),
          maxResults: 50,
          fields: 'items(id,contentDetails(duration),snippet(liveBroadcastContent))',
        });
        const found = new Map((data.items || []).map(v => [v.id, v]));
        batch.forEach(id => {
          const v = found.get(id);
          info[id] = !v ? -1 : (v.snippet?.liveBroadcastContent || 'none') !== 'none' ? -2 : (isoSeconds(v.contentDetails?.duration) || -1);
        });
      }
      const next = new Map(ids.filter(id => info[id] > 0).map(id => [id, info[id]]));
      if (!catalog || catalog.size !== next.size || missing.length) changed = true;
      channelCatalogs.set(c.id, next);
    } catch { /* sem cota/conexão: usa o que já está guardado e tenta na próxima visita */ }
  }
  onProgress?.(channels.length, channels.length);
  store.set(VIDEO_INFO_KEY, all);
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
  return { since, daySec, dayChSec, dayVids, chSec, doneByCh, started, done, estimated };
}

/* ---------- Períodos (dia, semana, mês) ---------- */
const STATS_PERIODS = {
  day: { label: 'Dia', count: 14, now: 'hoje', prev: 'ontem', span: 'últimos 14 dias' },
  week: { label: 'Semana', count: 12, now: 'esta semana', prev: 'semana passada', span: 'últimas 12 semanas' },
  month: { label: 'Mês', count: 12, now: 'este mês', prev: 'mês passado', span: 'últimos 12 meses' },
};
let statsPeriod = STATS_PERIODS[store.get(KEYS.statsPeriod, 'day')] ? store.get(KEYS.statsPeriod, 'day') : 'day';
let statsMonthOffset = 0; // calendário: 0 = mês atual, -1 = anterior...

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

function periodLabel(start, period, long = false) {
  if (period === 'month') {
    return long
      ? start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : start.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace(' de ', '/').replace('.', '');
  }
  const short = start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (!long) return short;
  if (period === 'week') {
    const end = shiftBucket(start, 'day', 6);
    return `Semana de ${short} a ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  }
  return start.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
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
      <linearGradient id="st-ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#39c6ff"/><stop offset="1" stop-color="#3f5bff"/>
      </linearGradient>
      <linearGradient id="st-bar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#39c6ff"/><stop offset="1" stop-color="#3f5bff"/>
      </linearGradient>
      <linearGradient id="st-area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4f7cff" stop-opacity=".45"/><stop offset="1" stop-color="#4f7cff" stop-opacity="0"/>
      </linearGradient>
    </defs>
  </svg>`;

function ringSVG(pct, size = 150) {
  const r = size * 0.4;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0));
  const text = `${p < 10 && p > 0 ? p.toFixed(1).replace('.', ',') : Math.round(p)}%`;
  return `
    <svg class="st-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${size * 0.1}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#st-ring)" stroke-width="${size * 0.1}"
        stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.32}" class="st-ring-core"/>
      <text x="50%" y="50%" dy=".35em" text-anchor="middle" class="st-ring-text" style="font-size:${size * 0.17}px">${text}</text>
    </svg>`;
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
    tip.style.left = `${Math.max(70, Math.min(r.width - 70, p.x))}px`;
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
  return Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 64))));
}

/** Linha do tempo em linha (com área), no estilo do painel: grade, pontos laranja e dica com o valor. */
function drawLineChart(box, series, { toValue, axis, tipValue, tipTitle, integer = false }) {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return;
  const pad = { l: 52, r: 18, t: 22, b: 30 };
  const values = series.map(s => toValue(s.value));
  const { step, max } = niceScale(Math.max(...values), 4, integer);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = i => pad.l + (series.length === 1 ? iw / 2 : (i * iw) / (series.length - 1));
  const y = v => pad.t + (1 - v / max) * ih;
  const grid = [];
  for (let v = 0; v <= max + 1e-9; v += step) {
    grid.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="st-grid-line"/>`
      + `<text x="${pad.l - 10}" y="${y(v)}" dy=".32em" text-anchor="end" class="st-axis">${esc(axis(v))}</text>`);
  }
  const every = xLabelStep(series.length, iw);
  series.forEach((s, i) => {
    grid.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${H - pad.b}" class="st-grid-line st-grid-v"/>`);
    if ((series.length - 1 - i) % every === 0) {
      grid.push(`<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="st-axis">${esc(s.label)}</text>`);
    }
  });
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(values.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const dots = values.map((v, i) => `<circle data-i="${i}" cx="${x(i)}" cy="${y(v)}" r="5" class="st-dot"/>`).join('');
  box.innerHTML = `
    <svg width="${W}" height="${H}" aria-hidden="true">
      ${grid.join('')}
      <path d="${area}" fill="url(#st-area)"/>
      <path d="${line}" class="st-line"/>
      ${dots}
    </svg>`;
  attachChartTip(box, series.map((s, i) => ({ x: x(i), y: y(values[i]), value: tipValue(s.value), title: tipTitle(s) })));
}

/** Linha do tempo em barras. */
function drawBarChart(box, series, { axis, tipValue, tipTitle }) {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return;
  const pad = { l: 40, r: 12, t: 22, b: 30 };
  const { step, max } = niceScale(Math.max(...series.map(s => s.value)), 4, true);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / series.length;
  const bw = Math.max(4, Math.min(34, slot * 0.56));
  const cx = i => pad.l + slot * (i + 0.5);
  const y = v => pad.t + (1 - v / max) * ih;
  const parts = [];
  for (let v = 0; v <= max + 1e-9; v += step) {
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="st-grid-line"/>`
      + `<text x="${pad.l - 10}" y="${y(v)}" dy=".32em" text-anchor="end" class="st-axis">${esc(axis(v))}</text>`);
  }
  const every = xLabelStep(series.length, iw);
  series.forEach((s, i) => {
    const h = Math.max(s.value ? 3 : 0, y(0) - y(s.value));
    parts.push(`<rect data-i="${i}" x="${cx(i) - bw / 2}" y="${y(0) - h}" width="${bw}" height="${h}" rx="${Math.min(6, bw / 2)}" class="st-bar"/>`);
    if ((series.length - 1 - i) % every === 0) {
      parts.push(`<text x="${cx(i)}" y="${H - 8}" text-anchor="middle" class="st-axis">${esc(s.label)}</text>`);
    }
  });
  box.innerHTML = `<svg width="${W}" height="${H}" aria-hidden="true">${parts.join('')}</svg>`;
  attachChartTip(box, series.map((s, i) => ({ x: cx(i), y: y(s.value), value: tipValue(s.value), title: tipTitle(s) })));
}

/** Quebra um nome em até 2 linhas de no máximo `max` letras (corta com … só se ainda não couber). */
function wrapLabel(text, max) {
  if (text.length <= max) return [text];
  const words = text.split(' ');
  let line1 = '';
  while (words.length && (line1 ? `${line1} ${words[0]}` : words[0]).length <= max) line1 = line1 ? `${line1} ${words.shift()}` : words.shift();
  if (!line1) line1 = words.shift();
  let line2 = words.join(' ');
  if (line1.length > max) line1 = `${line1.slice(0, max - 1)}…`;
  if (line2.length > max) line2 = `${line2.slice(0, max - 1)}…`;
  return line2 ? [line1, line2] : [line1];
}

/** Radar (teia) com as horas de cada canal. */
function drawRadarChart(box, items) {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return;
  if (items.length < 3) {
    box.innerHTML = `<p class="st-empty">O radar aparece quando você tiver assistido a pelo menos 3 canais.</p>`;
    return;
  }
  const n = items.length;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const LABEL_W = 84; // espaço reservado para os nomes nas laterais
  const R = Math.max(36, Math.min(H / 2 - 34, (W / 2 - LABEL_W) / 1.14));
  const max = Math.max(...items.map(i => i.value)) || 1;
  const pt = (i, f) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  const parts = [];
  for (const f of [0.25, 0.5, 0.75, 1]) parts.push(`<circle cx="${cx}" cy="${cy}" r="${R * f}" class="st-radar-ring"/>`);
  items.forEach((it, i) => {
    const [x2, y2] = pt(i, 1);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" class="st-radar-axis"/>`);
    const [lx, ly] = pt(i, 1.14);
    const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
    // Nome em até 2 linhas, cabendo no espaço até a borda do cartão (~6,3 px por letra).
    const room = anchor === 'middle' ? 150 : (anchor === 'start' ? W - lx : lx) - 4;
    const lines = wrapLabel(it.label, Math.max(6, Math.floor(room / 6.3)));
    const first = ly < cy - R * 0.3 ? -(lines.length + 0.2) : ly > cy + R * 0.3 ? 0.9 : -(lines.length * 0.6);
    parts.push(`<text x="${lx}" y="${ly}" text-anchor="${anchor}" class="st-radar-label">`
      + lines.map((l, j) => `<tspan x="${lx}" dy="${j ? '1.15em' : `${first.toFixed(2)}em`}">${esc(l)}</tspan>`).join('')
      + `<tspan x="${lx}" dy="1.2em" class="st-radar-value">${esc(fmtHours(it.value))}</tspan></text>`);
  });
  const poly = items.map((it, i) => pt(i, Math.max(0.02, it.value / max)).map(v => v.toFixed(1)).join(',')).join(' ');
  parts.push(`<polygon points="${poly}" class="st-radar-shape"/>`);
  items.forEach((it, i) => {
    const [x, y] = pt(i, Math.max(0.02, it.value / max));
    parts.push(`<circle cx="${x}" cy="${y}" r="3.5" class="st-radar-dot"/>`);
  });
  box.innerHTML = `<svg width="${W}" height="${H}" aria-hidden="true">${parts.join('')}</svg>`;
}

/* ---------- Página ---------- */
let statsData = null;

function channelAvatar(ch, cls = 'st-avatar') {
  return `<img class="${cls}" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
}

function statsCalendarHTML(data) {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + statsMonthOffset, 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = month.getDay(); // domingo = 0, como no calendário da imagem
  const values = Array.from({ length: days }, (_, i) => data.daySec.get(dayKey(new Date(month.getFullYear(), month.getMonth(), i + 1))) || 0);
  const max = Math.max(...values, 1);
  const today = dayKey();
  const cells = Array.from({ length: lead }, () => '<span></span>');
  values.forEach((sec, i) => {
    const date = new Date(month.getFullYear(), month.getMonth(), i + 1);
    const key = dayKey(date);
    const vids = data.dayVids.get(key)?.size || 0;
    const alpha = sec ? (0.25 + 0.75 * (sec / max)).toFixed(2) : 0;
    const title = `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}: ${sec ? fmtHours(sec) : 'nada'}${vids ? ` · ${vids} ${vids === 1 ? 'vídeo' : 'vídeos'}` : ''}`;
    cells.push(`<span class="st-day${sec ? ' has' : ''}${key === today ? ' today' : ''}" style="--a:${alpha}" title="${esc(title)}">${i + 1}</span>`);
  });
  const name = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return `
    <div class="st-cal-head">
      <button class="st-cal-nav" type="button" data-cal="-1" aria-label="Mês anterior">‹</button>
      <h2>${esc(name)}</h2>
      <button class="st-cal-nav" type="button" data-cal="1" aria-label="Próximo mês"${statsMonthOffset >= 0 ? ' disabled' : ''}>›</button>
    </div>
    <div class="st-cal-grid">
      ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<b>${d}</b>`).join('')}
      ${cells.join('')}
    </div>`;
}

function renderStats({ refresh = true } = {}) {
  const box = $('#stats');
  if (!box) return;
  loadCatalogsFromCache(homeChannels());
  const data = computeStats();
  statsData = data;
  const period = statsPeriod;
  const P = STATS_PERIODS[period];
  const channels = homeChannels(); // sem os "Apenas lives"
  const chName = id => channels.find(c => c.id === id)?.title || 'Outros canais';

  // Período atual x anterior
  const hoursSeries = statsSeries(data.daySec, period, P.count);
  const vidsSeries = statsSeries(data.dayVids, period, P.count, s => s.size);
  const curH = hoursSeries.at(-1).value;
  const prevH = hoursSeries.at(-2)?.value || 0;
  const curV = vidsSeries.at(-1).value;
  const prevV = vidsSeries.at(-2)?.value || 0;
  const curStart = bucketStart(new Date(), period).getTime();
  const curByCh = new Map();
  for (const [day, m] of data.dayChSec) {
    if (bucketStart(parseDay(day), period).getTime() !== curStart) continue;
    for (const [ch, sec] of m) curByCh.set(ch, (curByCh.get(ch) || 0) + sec);
  }
  const topCur = [...curByCh].filter(([ch]) => ch).sort((a, b) => b[1] - a[1])[0];

  // Últimos 30 dias
  const last30 = Array.from({ length: 30 }, (_, i) => data.daySec.get(dayKey(Date.now() - i * 864e5)) || 0);
  const active30 = last30.filter(Boolean).length;
  const avg30 = last30.reduce((a, b) => a + b, 0) / 30;

  // Por canal
  const totalSec = [...data.chSec.values()].reduce((a, b) => a + b, 0);
  const byHours = channels.map(c => ({ ch: c, value: data.chSec.get(c.id) || 0 })).sort((a, b) => b.value - a.value);
  const top = byHours[0];
  const byVideos = channels.map(c => ({ ch: c, value: data.doneByCh.get(c.id) || 0 })).sort((a, b) => b.value - a.value);
  const maxVideos = Math.max(1, ...byVideos.map(i => i.value));
  const catalog = channels.map(c => {
    const total = channelVideoTotal(c);
    const doneN = data.doneByCh.get(c.id) || 0;
    return { ch: c, done: doneN, total, pct: total ? (doneN / total) * 100 : 0 };
  }).sort((a, b) => b.pct - a.pct || b.done - a.done);
  const catalogTotal = catalog.reduce((a, c) => a + (c.total || 0), 0);
  const catalogDone = catalog.reduce((a, c) => a + c.done, 0);

  const deltaHTML = (cur, prev) => {
    const d = fmtDelta(cur, prev);
    return `<span class="st-delta ${d.dir}">${d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : ''} ${esc(d.text)}</span><span class="st-vs">vs ${P.prev}</span>`;
  };
  const sinceText = new Date(data.since).toLocaleDateString('pt-BR');

  box.innerHTML = `
    ${STATS_DEFS}
    <header class="st-head">
      <h1>Estatísticas</h1>
      <p>Registro desde ${sinceText}</p>
      <details class="st-info">
        <summary aria-label="Como os números são calculados" title="Como os números são calculados">i</summary>
        <p>
          Contam só os vídeos que aparecem no MeuTube: os da aba “Vídeos” de cada canal, dentro do limite de duração
          (“Até hh:mm:ss”, nas Configurações). Horas são o tempo em que o vídeo esteve tocando no MeuTube, incluindo as
          lives assistidas ao vivo (neste e nos seus outros aparelhos, pela sincronização). Um vídeo conta como
          assistido quando é visto até o fim.
          ${data.estimated ? `Antes de ${sinceText}, horas e vídeos são <strong>estimados</strong> pelo progresso salvo
            (o vídeo inteiro, se assistido, ou até onde parou, no dia do último acesso).` : ''}
          O total de cada canal é o número de vídeos que o MeuTube mostra para ele; mudar o limite de duração
          recalcula tudo na hora. As horas registradas antes da versão 1.13.0 não podem ser separadas por limite.
        </p>
      </details>
      <div class="st-tabs" role="group" aria-label="Período">
        ${Object.entries(STATS_PERIODS).map(([k, p]) => `<button type="button" data-period="${k}" aria-pressed="${k === period}">${p.label}</button>`).join('')}
      </div>
    </header>

    ${channels.some(c => !channelCatalogs.has(c.id)) ? '<p id="st-counting" class="st-counting" role="status">Contando os vídeos dos canais…</p>' : ''}
    <div class="st-grid">
      <article class="st-card st-kpi">
        <span class="st-kpi-label">Vídeos assistidos ${P.now}</span>
        <strong class="st-kpi-value">${intFmt.format(curV)}</strong>
        <div class="st-kpi-foot">${deltaHTML(curV, prevV)}</div>
      </article>
      <article class="st-card st-kpi">
        <span class="st-kpi-label">Horas assistidas ${P.now}</span>
        <strong class="st-kpi-value">${fmtHours(curH)}</strong>
        <div class="st-kpi-foot">${deltaHTML(curH, prevH)}</div>
      </article>
      <article class="st-card st-kpi st-kpi-top">
        <span class="st-kpi-label">Canal mais assistido ${P.now}</span>
        <strong class="st-kpi-value st-kpi-name" title="${topCur ? esc(chName(topCur[0])) : ''}">${topCur ? esc(chName(topCur[0])) : '—'}</strong>
        <div class="st-kpi-foot"><span class="st-delta">${topCur ? fmtHours(topCur[1]) : 'nada ainda'}</span></div>
      </article>
      <article class="st-card st-kpi st-kpi-ring">
        ${ringSVG((active30 / 30) * 100, 64)}
        <div>
          <span class="st-kpi-label">Média diária</span>
          <strong class="st-kpi-value">${fmtHours(avg30)}</strong>
          <span class="st-vs">${active30} de 30 dias com vídeos</span>
        </div>
      </article>
      <article class="st-card st-rings">
        <div class="st-ring-item" title="${intFmt.format(data.done)} de ${intFmt.format(data.started)} vídeos começados">
          ${ringSVG(data.started ? (data.done / data.started) * 100 : 0, 64)}
          <h3>Concluídos</h3>
        </div>
        <div class="st-ring-item" title="${catalogTotal ? `${intFmt.format(catalogDone)} de ${intFmt.format(catalogTotal)} vídeos dos seus canais` : 'carregando o total de vídeos…'}">
          ${ringSVG(catalogTotal ? (catalogDone / catalogTotal) * 100 : 0, 64)}
          <h3>Catálogo</h3>
        </div>
        <div class="st-ring-item" title="${top?.value ? `${esc(top.ch.title)} · ${fmtHours(top.value)} do total` : 'ainda sem horas assistidas'}">
          ${ringSVG(totalSec && top ? (top.value / totalSec) * 100 : 0, 64)}
          <h3>Canal nº 1</h3>
        </div>
      </article>

      <article class="st-card st-hours">
        <div class="st-card-head"><h2>Horas assistidas</h2><span class="st-sub">por ${P.label.toLowerCase()} · ${P.span}</span></div>
        <div class="st-chart" id="st-hours" role="img" aria-label="Linha do tempo das horas assistidas"></div>
      </article>
      <article class="st-card st-videos">
        <div class="st-card-head"><h2>Vídeos assistidos</h2><span class="st-sub">até o fim · ${P.span}</span></div>
        <div class="st-chart" id="st-videos" role="img" aria-label="Linha do tempo dos vídeos assistidos"></div>
      </article>
      <article class="st-card st-radar">
        <div class="st-card-head"><h2>Horas por canal</h2></div>
        <div class="st-chart" id="st-radar" role="img" aria-label="Horas assistidas por canal"></div>
      </article>

      <article class="st-card st-cal">${statsCalendarHTML(data)}</article>
      <article class="st-card st-perch">
        <div class="st-card-head"><h2>Vídeos por canal</h2><span class="st-sub">até o fim</span></div>
        <ul class="st-bars">
          ${byVideos.map(({ ch, value }) => `
            <li>
              ${channelAvatar(ch)}
              <span class="st-bars-name" title="${esc(ch.title)}">${esc(ch.title)}</span>
              <span class="st-bars-track"><span style="width:${((value / maxVideos) * 100).toFixed(1)}%"></span></span>
              <b>${intFmt.format(value)}</b>
            </li>`).join('') || '<li class="st-empty">Adicione canais nas Configurações.</li>'}
        </ul>
      </article>
      <article class="st-card st-catalog-card">
        <div class="st-card-head"><h2>Assistidos x total do canal</h2><span class="st-sub">vistos até o fim, do total publicado</span></div>
        <div class="st-catalog">
          ${catalog.map(c => `
            <div class="st-catalog-item" title="${esc(c.ch.title)}: ${intFmt.format(c.done)} de ${c.total != null ? intFmt.format(c.total) : '…'} vídeos">
              ${ringSVG(c.pct, 64)}
              <div class="st-catalog-name">${channelAvatar(c.ch, 'st-avatar sm')}<span>${esc(c.ch.title)}</span></div>
              <p>${intFmt.format(c.done)} de ${c.total != null ? intFmt.format(c.total) : '…'}</p>
            </div>`).join('') || '<p class="st-empty">Adicione canais nas Configurações.</p>'}
        </div>
      </article>
    </div>`;

  drawStatsCharts();

  if (refresh) {
    // Busca o que falta (canal dos vídeos antigos, total de vídeos dos canais) e redesenha uma vez.
    // Primeira vez (nada guardado ainda): mostra o andamento da contagem.
    const counting = channels.some(c => !channelCatalogs.has(c.id));
    refreshCatalogs(channels, (done, total) => {
      const el = $('#st-counting');
      if (el && counting) el.textContent = `Contando os vídeos dos canais… (${done} de ${total})`;
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
  const label = s => ({ ...s, label: periodLabel(s.start, period) });
  const hours = $('#st-hours');
  if (hours) {
    drawLineChart(hours, statsSeries(data.daySec, period, P.count).map(label), {
      toValue: sec => sec / 3600,
      axis: fmtHoursAxis,
      tipValue: sec => fmtHours(sec),
      tipTitle: s => periodLabel(s.start, period, true),
    });
  }
  const videos = $('#st-videos');
  if (videos) {
    drawBarChart(videos, statsSeries(data.dayVids, period, P.count, s => s.size).map(label), {
      axis: v => intFmt.format(v),
      tipValue: n => `${intFmt.format(n)} ${n === 1 ? 'vídeo' : 'vídeos'}`,
      tipTitle: s => periodLabel(s.start, period, true),
    });
  }
  const radar = $('#st-radar');
  if (radar) {
    const items = homeChannels()
      .map(c => ({ label: c.title, value: data.chSec.get(c.id) || 0 }))
      .filter(i => i.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    drawRadarChart(radar, items);
  }
}

function setupStats() {
  const box = $('#stats');
  box.addEventListener('click', e => {
    const tab = e.target.closest('[data-period]');
    if (tab) {
      statsPeriod = tab.dataset.period;
      store.set(KEYS.statsPeriod, statsPeriod);
      renderStats({ refresh: false });
      return;
    }
    const nav = e.target.closest('[data-cal]');
    if (nav && !nav.disabled) {
      statsMonthOffset = Math.min(0, statsMonthOffset + Number(nav.dataset.cal));
      box.querySelector('.st-cal').innerHTML = statsCalendarHTML(statsData || computeStats());
    }
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
  Auth.restore();
  renderAccount();
  renderSidebar();
  renderLives();
  applyHideWatched();
  renderVersionInfo();
  console.info(`MeuTube v${APP_VERSION}`);
  setupMobileApp();
  setupFooterLinks();
  setupPlayerControls();
  setupStats();
  bindEvents();
  route(false);
  refreshLives(true);
  Sync.run();
}

init();
