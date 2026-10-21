'use strict';

/* =========================================================
   MeuTube — só os vídeos dos canais que você escolher
   =========================================================
   Credenciais padrão (também podem ser definidas na tela de
   Configurações; o que for salvo lá tem prioridade).
   ========================================================= */
const DEFAULT_CONFIG = {
  apiKey: '',   // Chave da YouTube Data API v3
  clientId: '', // OAuth 2.0 Client ID (tipo "Aplicativo da Web")
};

const PAGE_SIZE = 20;
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const SCOPES = `openid email profile ${YT_SCOPE}`;
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
  hideShorts: 'meutube.hideShorts',
  sidebar: 'meutube.sidebarMini',
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
const state = {
  config: { ...DEFAULT_CONFIG, ...store.get(KEYS.config, {}) },
  channels: store.get(KEYS.channels, []), // [{ id, title, handle, thumb, uploads }]
  autoplay: store.get(KEYS.autoplay, true),
  hideShorts: store.get(KEYS.hideShorts, true),
  sidebarMini: store.get(KEYS.sidebar, false),
  hideWatched: store.get(KEYS.hideWatched, false), // esconde os vídeos assistidos até o fim
  filter: null,      // ID do canal selecionado no menu lateral (null = todos)
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
   Login com Google (Google Identity Services — token OAuth)
   ========================================================= */
const Auth = {
  token: null,
  expiresAt: 0,
  profile: null,
  ytChannel: null,
  hasYtScope: false,
  remembered: null, // última conta usada, para oferecer "Reconectar" quando a sessão expira
  client: null,
  clientIdInUse: null,
  expiryTimer: 0,

  // Guardado no localStorage (e não por aba) para valer em todas as abas enquanto o token for válido.
  restore() {
    const saved = store.get(KEYS.auth, null);
    if (saved && saved.expiresAt > Date.now() + 60_000) Object.assign(this, saved);
    this.remembered = store.get(KEYS.account, null);
    this.scheduleExpiry();
  },

  persist() {
    store.set(KEYS.auth, {
      token: this.token, expiresAt: this.expiresAt, profile: this.profile,
      ytChannel: this.ytChannel, hasYtScope: this.hasYtScope,
    });
    if (this.profile || this.ytChannel) {
      this.remembered = { profile: this.profile, ytChannel: this.ytChannel };
      store.set(KEYS.account, this.remembered);
    }
    this.scheduleExpiry();
  },

  /** O Google emite tokens de 1 hora para apps web; avisa quando expira em vez de "sumir" o login. */
  scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (!this.token) return;
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
      toast('Informe o OAuth Client ID em Configurações para entrar com o Google.', 'error');
      if (state.view !== 'settings') location.hash = '#/settings';
      $('#cfg-client-id')?.focus();
      return;
    }
    if (location.protocol === 'file:') {
      toast('Abra o app por http:// ou https:// (ex.: um servidor local) para usar o login do Google.', 'error', 6000);
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
    const known = (this.profile || this.remembered) && (this.hasYtScope || !this.validToken());
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
    this.hasYtScope = String(resp.scope || '').split(/\s+/).includes(YT_SCOPE)
      || google.accounts.oauth2.hasGrantedAllScopes(resp, YT_SCOPE);
    await this.loadProfile();
    this.persist();
    renderAccount();
    if (this.hasYtScope) {
      toast(`Conectado como ${this.profile?.name || 'usuário Google'}.`, 'success');
    } else {
      toast('Você entrou, mas não autorizou o acesso ao YouTube. Clique em “Autorizar acesso ao YouTube” e marque a caixa do YouTube na tela do Google.', 'error', 9000);
    }
    onCredentialsChanged();
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

  clear(revoke = true) {
    const token = this.token;
    this.token = null;
    this.expiresAt = 0;
    this.profile = null;
    this.ytChannel = null;
    this.hasYtScope = false;
    clearTimeout(this.expiryTimer);
    try { localStorage.removeItem(KEYS.auth); } catch { /* ignora */ }
    if (revoke && token && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(token, () => {});
    }
    renderAccount();
  },

  signOut() {
    this.remembered = null;
    try { localStorage.removeItem(KEYS.account); } catch { /* ignora */ }
    this.clear(true);
    toast('Você saiu da conta Google.');
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

   Sem lives na página inicial: em vez da playlist de uploads
   completa (UU…), usamos as playlists automáticas de vídeos
   longos (UULF…) e, se os Shorts estiverem ligados, a de Shorts
   (UUSH…). As lives (UULV…) ficam no menu lateral.
   ========================================================= */
class FeedStream {
  constructor(channels) {
    const prefixes = state.hideShorts ? ['UULF'] : ['UULF', 'UUSH'];
    this.sources = channels.flatMap(c => prefixes.map(prefix => ({
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
      added.push(...picked.map(p => details.get(p.id)).filter(v => v && v.live === 'none'));
    }
    this.items.push(...added);
    return added;
  }
}

/** Um feed por filtro: "all" (todos os canais) ou o ID de um canal. */
const feeds = new Map();

function currentFeed() {
  const key = state.filter || 'all';
  if (!feeds.has(key)) {
    const list = key === 'all' ? homeChannels() : homeChannels().filter(c => c.id === key);
    feeds.set(key, new FeedStream(list));
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
    <a class="btn btn-ghost btn-sm" href="#/">Ver todos os canais</a>`;
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
      'Todos os vídeos daqui foram assistidos até o fim. Clique em “Assistidos ocultos”, ao lado do logo, para vê-los de novo.');
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
   do vídeo. Atualiza a cada 5 minutos, só com a aba visível.
   ========================================================= */
const LIVE_REFRESH_MS = 5 * 60 * 1000;
const Lives = { items: [], loading: false, checked: false, lastFetch: 0, error: null, gen: 0 };

async function refreshLives(force = false) {
  if (!state.channels.length || !hasCredentials()) {
    Object.assign(Lives, { items: [], checked: true, error: null });
    renderLives();
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

function progressPercent(id) {
  const p = progressStore[id];
  if (!p) return 0;
  return p.done ? 100 : Math.min(100, (p.t / p.d) * 100);
}

function resumeTime(id) {
  const p = progressStore[id];
  return p && !p.done ? Math.max(0, p.t - 3) : 0; // volta 3 s para retomar o contexto
}

function recordProgress(id, t, d, done = false) {
  if (!id || !d || !Number.isFinite(d)) return;
  const prev = progressStore[id];
  if (done || t >= d - PROGRESS_END_SECONDS || t / d >= 0.95) {
    progressStore[id] = { t: 0, d: Math.round(d), done: true, at: Date.now() };
  } else if (t >= PROGRESS_MIN_SECONDS) {
    progressStore[id] = { t: Math.floor(t), d: Math.round(d), at: Date.now() };
  } else if (prev && !prev.done) {
    delete progressStore[id]; // voltou para o início: esquece o ponto salvo
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
    ? 'Mostrando só os vídeos não assistidos e em progresso. Clique para mostrar todos.'
    : 'Ocultar os vídeos que você já assistiu até o fim';
  btn.innerHTML = `${on ? EYE_ICONS.on : EYE_ICONS.off}<span>${on ? 'Assistidos ocultos' : 'Ocultar assistidos'}</span>`;
}

function toggleHideWatched() {
  state.hideWatched = !state.hideWatched;
  store.set(KEYS.hideWatched, state.hideWatched);
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

function showResumeChip(id) {
  $('#resume-chip')?.remove();
  const start = resumeTime(id);
  if (!start) return;
  $('#watch-info').insertAdjacentHTML('afterbegin', `
    <div id="resume-chip" class="resume-chip">
      <span>Continuando de <strong>${fmtClock(start)}</strong></span>
      <button class="link-btn" type="button" data-action="restart">Começar do início</button>
    </div>`);
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
          start,
          origin: location.origin,
        },
        events: {
          onReady: e => { e.target.playVideo(); resolve(); },
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
   Página do vídeo
   ========================================================= */
let upNextCount = PAGE_SIZE;

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

function renderWatchInfo(v) {
  const ch = channelById(v.channelId);
  const stats = [
    v.views != null ? `<span>${esc(fmtViews(v.views))}</span>` : '',
    `<span title="${esc(new Date(v.publishedAt).toLocaleString('pt-BR'))}">${esc(dateFmt.format(v.publishedAt))}</span>`,
    v.likes != null ? `<span>👍 ${esc(compact.format(Number(v.likes)))}</span>` : '',
  ].join('');

  $('#watch-info').innerHTML = `
    <h1 class="watch-title">${esc(v.title)}</h1>
    <div class="watch-meta">
      <div class="watch-channel">
        <img class="avatar lg" src="${esc(ch?.thumb || '')}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <div>
          <strong>${esc(v.channelTitle)}</strong>
          <span class="muted">${esc(ch?.handle || '')}</span>
        </div>
      </div>
      <div class="watch-stats">${stats}</div>
    </div>
    ${v.description.trim() ? `
      <div class="description collapsed" id="description">
        <div class="description-text">${richText(v.description)}</div>
        <button class="link-btn" type="button" data-action="toggle-desc">Mostrar mais</button>
      </div>` : ''}`;

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
  upNextCount = PAGE_SIZE;
  Comments.req++; // cancela respostas de comentários do vídeo anterior
  $('#player-error').hidden = true;

  state.watchFeed = currentFeed();
  const known = state.watchFeed.items.find(v => v.id === id) || findLoadedVideo(id);
  if (known) renderWatchInfo(known);
  else $('#watch-info').innerHTML = watchInfoSkeleton();
  $('#upnext').innerHTML = miniSkeletons(6);
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
      // Link direto/recarregamento: confirma que o vídeo pertence a um canal configurado.
      try {
        video = (await fetchVideos([id])).get(id);
      } catch (e) {
        if (state.currentVideoId === id) showWatchBlocked(e.message);
        return;
      }
      if (state.currentVideoId !== id) return;
      if (!video) {
        showWatchBlocked('Este vídeo não pertence a nenhum dos canais adicionados nas Configurações, por isso não pode ser reproduzido aqui.');
        return;
      }
      renderWatchInfo(video);
    }
    state.currentVideo = video;
    markSeen(id);
    showResumeChip(id);
    playVideo(id);
    loadComments(id, true);
    renderUpNext(video);
  })();
}

/** Vídeos seguintes = os próximos do feed (mais antigos) depois do vídeo atual. */
function upNextSlice(video) {
  const feed = state.watchFeed || currentFeed();
  let start = feed.items.findIndex(v => v.id === video.id);
  if (start >= 0) start += 1;
  else {
    start = feed.items.findIndex(v => v.publishedAt < video.publishedAt);
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
  for (let guard = 0; !slice.ready && guard < 25; guard++) {
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
        ${premiumNote()}
      </div>`;
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
        <strong>Sessão expirada.</strong> Por segurança, o Google limita o login de apps web a 1 hora.
        ${state.config.apiKey
          ? 'Como você tem uma chave de API salva, o app continua funcionando normalmente — reconectar é opcional.'
          : 'Clique em “Reconectar” para continuar carregando vídeos.'}
      </p>`;
  } else if (Auth.hasYtScope) {
    const until = new Date(Auth.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    status = `<span class="tier">Conectado · acesso ao YouTube autorizado · sessão válida até ${until}</span>`;
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
      ${premiumNote()}
    </div>`;
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
  $('#cfg-api-key').value = state.config.apiKey;
  $('#cfg-client-id').value = state.config.clientId;
  $('#hide-shorts').checked = state.hideShorts;
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

function saveChannels() {
  store.set(KEYS.channels, state.channels);
  if (state.filter && !isHomeChannel(state.filter)) state.filter = null;
  renderChannelList();
  renderSidebar();
  resetFeed();
  Lives.items = Lives.items.filter(v => channelById(v.channelId));
  refreshLives(true);
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
  if (state.filter === id) state.filter = null;
  renderSidebar();
  resetFeed(); // as lives não mudam: a verificação de "Ao vivo" já inclui todos os canais
  toast(enabled
    ? `“${ch.title}” agora aparece só em “Ao vivo”, quando estiver transmitindo.`
    : `“${ch.title}” voltou para o Início e para a lista de canais.`, 'success');
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

function onConfigSubmit(e) {
  e.preventDefault();
  const apiKey = $('#cfg-api-key').value.trim();
  const clientId = $('#cfg-client-id').value.trim();
  const changed = apiKey !== state.config.apiKey || clientId !== state.config.clientId;
  state.config = { apiKey, clientId };
  store.set(KEYS.config, state.config);
  toast('Configurações salvas.', 'success');
  if (changed) onCredentialsChanged();
}

function onCredentialsChanged() {
  const feed = currentFeed();
  if (feed.error || !feed.items.length) resetFeed();
  if (Lives.error || !Lives.lastFetch) refreshLives(true);
  if (state.view === 'home') showHome();
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
  const channel = /^#\/c\/(UC[\w-]{22})$/.exec(hash);
  return { view: 'home', channel: channel?.[1] || null };
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

function applyView(view, id, channel) {
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
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  updateSidebarMode();

  if (view === 'home') {
    const filter = channel && isHomeChannel(channel) ? channel : null;
    const filterChanged = filter !== state.filter;
    state.filter = filter;
    showHome();
    window.scrollTo({ top: filterChanged ? 0 : state.homeScroll, behavior: 'instant' });
  } else if (view === 'watch') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    enterWatch(id);
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderSettings();
  }
  updateSidebarActive();
  updateToTop();
}

function route(animate = true) {
  const { view, id, channel } = parseRoute();
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
    applyView(view, id, channel);
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
      case 'replies': toggleReplies(actionEl); break;
      case 'retry-feed':
        currentFeed().error = null;
        updateFeedStatus();
        loadFeedPage();
        break;
      case 'restart':
        if (playerVideoId) delete progressStore[playerVideoId];
        store.set(KEYS.progress, progressStore);
        if (playerVideoId) updateProgressBars(playerVideoId);
        actionEl.closest('.resume-chip')?.remove();
        seekTo(0);
        break;
      case 'toggle-desc': {
        const box = $('#description');
        const collapsed = box.classList.toggle('collapsed');
        actionEl.textContent = collapsed ? 'Mostrar mais' : 'Mostrar menos';
        break;
      }
    }
  });

  $('#channel-form').addEventListener('submit', onChannelSubmit);
  $('#channel-list').addEventListener('change', e => {
    const input = e.target.closest('input[data-lives-only]');
    if (input) setLivesOnly(input.dataset.livesOnly, input.checked);
  });
  $('#hide-shorts').addEventListener('change', e => {
    state.hideShorts = e.target.checked;
    store.set(KEYS.hideShorts, state.hideShorts);
    resetFeed();
    toast(state.hideShorts ? 'Shorts ocultados.' : 'Shorts voltarão a aparecer.', 'success');
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
  $('#config-form').addEventListener('submit', onConfigSubmit);

  $('#comments-more').addEventListener('click', () => loadComments(state.currentVideoId));
  $('#upnext-more').addEventListener('click', () => {
    if (!state.currentVideo) return;
    upNextCount += PAGE_SIZE;
    renderUpNext(state.currentVideo);
  });

  const autoplay = $('#autoplay');
  autoplay.checked = state.autoplay;
  autoplay.addEventListener('change', () => {
    state.autoplay = autoplay.checked;
    store.set(KEYS.autoplay, state.autoplay);
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
  let playerWasFullscreen = false;
  const onFullscreenChange = () => {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    if (el?.closest?.('.player-wrap')) {
      playerWasFullscreen = true;
      return;
    }
    if (!el && playerWasFullscreen) {
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
  });
  // Lives: verifica a cada 5 minutos enquanto a aba estiver visível.
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
   Inicialização
   ========================================================= */
function init() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  Auth.restore();
  renderAccount();
  renderSidebar();
  renderLives();
  applyHideWatched();
  bindEvents();
  route(false);
  refreshLives(true);
}

init();
