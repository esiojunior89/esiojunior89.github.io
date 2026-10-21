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
};

/* =========================================================
   Estado
   ========================================================= */
const state = {
  config: { ...DEFAULT_CONFIG, ...store.get(KEYS.config, {}) },
  channels: store.get(KEYS.channels, []), // [{ id, title, handle, thumb, uploads }]
  autoplay: store.get(KEYS.autoplay, true),
  view: null,
  currentVideoId: null,
  currentVideo: null,
  homeScroll: 0,
};

const channelById = id => state.channels.find(c => c.id === id);
const allowedChannels = () => new Set(state.channels.map(c => c.id));
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
    console.error('[YouTube API]', endpoint, res.status, reason, data?.error || data);
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
    views: v.statistics?.viewCount,
    likes: v.statistics?.likeCount,
    comments: v.statistics?.commentCount,
    live: s.liveBroadcastContent || 'none',
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
      part: 'snippet,contentDetails,statistics',
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
  client: null,
  clientIdInUse: null,

  restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEYS.auth) || 'null');
      if (saved && saved.expiresAt > Date.now() + 60_000) Object.assign(this, saved);
    } catch { /* ignora */ }
  },

  persist() {
    try {
      sessionStorage.setItem(KEYS.auth, JSON.stringify({
        token: this.token, expiresAt: this.expiresAt, profile: this.profile,
        ytChannel: this.ytChannel, hasYtScope: this.hasYtScope,
      }));
    } catch { /* ignora */ }
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
    // Sem o escopo do YouTube, força a tela de consentimento para o usuário marcá-lo.
    this.client.requestAccessToken({ prompt: this.profile && this.hasYtScope ? '' : 'consent' });
  },

  async onToken(resp) {
    if (resp.error) {
      toast('Login cancelado ou não autorizado.', 'error');
      return;
    }
    this.token = resp.access_token;
    this.expiresAt = Date.now() + Number(resp.expires_in || 3600) * 1000;
    // O Google permite desmarcar permissões individualmente na tela de consentimento.
    this.hasYtScope = google.accounts.oauth2.hasGrantedAllScopes(resp, YT_SCOPE);
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
    this.ytChannel = null;
    if (!this.hasYtScope) return;
    try {
      const data = await api('channels', { part: 'snippet', mine: true });
      const c = data.items?.[0];
      this.ytChannel = c ? {
        id: c.id,
        title: c.snippet.title,
        thumb: c.snippet.thumbnails?.default?.url,
      } : null;
    } catch {
      this.ytChannel = null;
    }
  },

  clear(revoke = true) {
    const token = this.token;
    this.token = null;
    this.expiresAt = 0;
    this.profile = null;
    this.ytChannel = null;
    this.hasYtScope = false;
    try { sessionStorage.removeItem(KEYS.auth); } catch { /* ignora */ }
    if (revoke && token && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(token, () => {});
    }
    renderAccount();
  },

  signOut() {
    this.clear(true);
    toast('Você saiu da conta Google.');
    onCredentialsChanged();
  },
};

/* =========================================================
   Feed: mescla os uploads de todos os canais por data
   =========================================================
   Cada canal tem uma playlist de uploads (UU…) já ordenada do
   mais novo para o mais antigo. Mantemos um buffer por canal e
   fazemos uma mescla (k-way merge) sempre pegando o vídeo mais
   recente entre os topos dos buffers. Assim a ordem global por
   data é sempre correta, página após página.
   ========================================================= */
const Feed = {
  gen: 0,
  sources: [],
  items: [],
  seen: new Set(),
  loading: null,
  exhausted: true,
  error: null,

  reset() {
    this.gen++;
    this.sources = state.channels.map(c => ({
      channelId: c.id,
      playlistId: c.uploads || `UU${c.id.slice(2)}`,
      buffer: [],
      token: null,
      done: false,
    }));
    this.items = [];
    this.seen = new Set();
    this.loading = null;
    this.exhausted = this.sources.length === 0;
    this.error = null;
  },

  async fill(src, gen) {
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
        if (e.status === 404) { src.done = true; return; }
        throw e;
      }
      if (gen !== this.gen) return;
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
  },

  loadMore(count = PAGE_SIZE) {
    if (this.loading) return this.loading;
    if (this.exhausted) return Promise.resolve([]);
    const gen = this.gen;
    this.loading = this._load(count, gen).finally(() => {
      if (gen === this.gen) this.loading = null;
    });
    return this.loading;
  },

  async _load(count, gen) {
    const added = [];
    // Repete até completar a página: vídeos descartados pelo filtro de canal são repostos.
    while (added.length < count && !this.exhausted) {
      const picked = [];
      while (picked.length < count - added.length) {
        await Promise.all(this.sources.map(s => this.fill(s, gen)));
        if (gen !== this.gen) return [];

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
      if (gen !== this.gen) return [];
      added.push(...picked.map(p => details.get(p.id)).filter(Boolean));
    }
    this.items.push(...added);
    return added;
  },
};

/* =========================================================
   Início (grade de vídeos com rolagem infinita)
   ========================================================= */
let renderedCount = 0;
let homeBusy = false;

function thumbBadge(v) {
  if (v.live === 'live') return '<span class="badge badge-live">AO VIVO</span>';
  if (v.live === 'upcoming') return '<span class="badge badge-upcoming">EM BREVE</span>';
  return v.duration ? `<span class="badge">${v.duration}</span>` : '';
}

function metaLine(v) {
  return [fmtViews(v.views), timeAgo(v.publishedAt)].filter(Boolean).join(' • ');
}

function tileHTML(v, i) {
  const ch = channelById(v.channelId);
  return `
    <a class="tile" href="#/watch/${v.id}" data-vid="${v.id}" style="--i:${i}">
      <div class="thumb">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" decoding="async">
        ${thumbBadge(v)}
      </div>
      <div class="tile-info">
        <img class="avatar" src="${esc(ch?.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <div>
          <h3 class="tile-title" title="${esc(v.title)}">${esc(v.title)}</h3>
          <p class="tile-channel">${esc(v.channelTitle)}</p>
          <p class="tile-meta">${esc(metaLine(v))}</p>
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
    box.innerHTML = Array.from({ length: 8 }, skeletonTileHTML).join('');
  }
  box.hidden = !show;
}

function syncGrid() {
  const fresh = Feed.items.slice(renderedCount);
  if (!fresh.length) return;
  $('#feed').insertAdjacentHTML('beforeend', fresh.map((v, i) => tileHTML(v, i)).join(''));
  renderedCount = Feed.items.length;
}

function resetFeed() {
  Feed.reset();
  $('#feed').innerHTML = '';
  renderedCount = 0;
  homeBusy = false;
  setSkeletons(false);
  $('#feed-status').innerHTML = '';
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
  if (!hasCredentials()) {
    status.innerHTML = emptyState('key', 'Falta configurar o acesso',
      'Entre com sua conta Google ou informe uma chave da YouTube Data API para carregar os vídeos.',
      '<a class="btn btn-primary" href="#/settings">Ir para Configurações</a>');
    return false;
  }
  return true;
}

function updateFeedStatus() {
  const status = $('#feed-status');
  if (Feed.error) {
    status.innerHTML = emptyState('error', 'Não foi possível carregar os vídeos', esc(Feed.error.message),
      '<button class="btn btn-ghost" type="button" data-action="retry-feed">Tentar novamente</button>');
  } else if (Feed.exhausted && !Feed.items.length) {
    status.innerHTML = emptyState('channels', 'Nenhum vídeo encontrado', 'Os canais adicionados ainda não têm vídeos públicos.');
  } else if (Feed.exhausted) {
    status.innerHTML = '<p>Você chegou ao fim. Esses são todos os vídeos dos seus canais.</p>';
  } else {
    status.innerHTML = '';
  }
}

async function loadFeedPage() {
  if (state.view !== 'home' || homeBusy || Feed.error) return;
  if (!checkHomePrereqs()) return;
  if (Feed.exhausted && !Feed.loading) {
    syncGrid();
    updateFeedStatus();
    return;
  }

  homeBusy = true;
  const gen = Feed.gen;
  $('#feed-status').innerHTML = '';
  setSkeletons(true);
  try {
    await Feed.loadMore();
  } catch (e) {
    if (gen === Feed.gen) Feed.error = e;
  }
  if (gen !== Feed.gen) return;
  homeBusy = false;
  setSkeletons(false);
  syncGrid();
  updateFeedStatus();
  // Se a tela ainda não foi preenchida, carrega mais um bloco.
  requestAnimationFrame(checkSentinel);
}

function checkSentinel() {
  if (state.view !== 'home' || Feed.error || Feed.exhausted) return;
  const rect = $('#feed-sentinel').getBoundingClientRect();
  if (rect.top < innerHeight + 300) loadFeedPage();
}

function showHome() {
  document.title = 'MeuTube';
  if (!checkHomePrereqs()) {
    $('#feed').innerHTML = '';
    renderedCount = 0;
    setSkeletons(false);
    return;
  }
  syncGrid();
  updateFeedStatus();
  if (!Feed.exhausted) requestAnimationFrame(checkSentinel);
}

/* =========================================================
   Player do YouTube (IFrame API)
   ========================================================= */
let ytApiPromise = null;
let player = null;
let playerReady = null;

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

  if (!player) {
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
  if (state.currentVideoId === id && state.view === 'watch') player.loadVideoById(id);
}

function onPlayerStateChange(e) {
  if (e.data !== window.YT.PlayerState.ENDED || !state.autoplay || state.view !== 'watch') return;
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
  state.currentVideoId = id;
  state.currentVideo = null;
  upNextCount = PAGE_SIZE;
  Comments.req++; // cancela respostas de comentários do vídeo anterior
  $('#player-error').hidden = true;

  const known = Feed.items.find(v => v.id === id);
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
    playVideo(id);
    loadComments(id, true);
    renderUpNext(video);
  })();
}

/** Vídeos seguintes = os próximos do feed (mais antigos) depois do vídeo atual. */
function upNextSlice(video) {
  let start = Feed.items.findIndex(v => v.id === video.id);
  if (start >= 0) start += 1;
  else {
    start = Feed.items.findIndex(v => v.publishedAt < video.publishedAt);
    if (start < 0) return { list: [], ready: Feed.exhausted, hasMore: !Feed.exhausted };
  }
  const list = Feed.items.slice(start, start + upNextCount);
  const hasMore = Feed.items.length > start + upNextCount || !Feed.exhausted;
  return { list, ready: list.length >= upNextCount || Feed.exhausted, hasMore };
}

function nextVideoAfter(video) {
  if (!video) return null;
  return upNextSlice(video).list[0] || null;
}

function miniHTML(v, i) {
  return `
    <a class="mini" href="#/watch/${v.id}" data-vid="${v.id}" style="--i:${i}">
      <div class="thumb">
        <img src="${esc(v.thumbSmall)}" alt="" loading="lazy" decoding="async">
        ${thumbBadge(v)}
      </div>
      <div>
        <h3 class="mini-title" title="${esc(v.title)}">${esc(v.title)}</h3>
        <p class="mini-meta">${esc(v.channelTitle)}</p>
        <p class="mini-meta">${esc(metaLine(v))}</p>
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
      await Feed.loadMore();
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
      para aplicativos de terceiros — não existe API para isso. Este app não exibe nenhum anúncio próprio; os
      anúncios dentro dos vídeos são controlados pelo player oficial do YouTube. Se a sua conta tem
      <strong>YouTube Premium</strong> e você está conectado ao youtube.com neste navegador, os vídeos tocam sem anúncios.
    </p>`;
}

function renderAccount() {
  const header = $('#account');
  const panel = $('#account-panel');

  if (Auth.validToken()) {
    const p = Auth.profile;
    const name = p?.name || Auth.ytChannel?.title || 'Conta Google';
    const pic = p?.picture || Auth.ytChannel?.thumb || '';
    header.innerHTML = `
      <a class="account-chip" href="#/settings" title="${esc(name)}">
        <img src="${esc(pic)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <span>${esc(p?.given_name || name)}</span>
      </a>`;
    panel.innerHTML = `
      <div class="account-panel">
        <div class="account-card">
          <img class="avatar lg" src="${esc(pic)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
          <div>
            <strong>${esc(name)}</strong>
            ${p?.email ? `<span>${esc(p.email)}</span>` : ''}
            ${Auth.ytChannel ? `<span>Canal no YouTube: ${esc(Auth.ytChannel.title)}</span>` : ''}
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-action="signout">Sair</button>
        </div>
        ${Auth.hasYtScope
          ? '<span class="tier">Conta Google conectada · sem anúncios do app</span>'
          : `<p class="note note-warn">
              <strong>Falta autorizar o acesso ao YouTube.</strong> Na tela do Google, marque a caixa
              “Ver sua conta do YouTube”, senão o app não consegue listar vídeos e canais com a sua conta.
            </p>
            <div><button class="btn btn-primary btn-sm" type="button" data-action="signin">Autorizar acesso ao YouTube</button></div>`}
        ${premiumNote()}
      </div>`;
  } else {
    header.innerHTML = `
      <button class="btn btn-google btn-sm" type="button" data-action="signin">${ICONS.google}<span>Entrar</span></button>`;
    panel.innerHTML = `
      <div class="account-panel">
        <p class="muted" style="margin:0">Entre com sua conta Google para usar o app com a sua conta do YouTube.</p>
        <div><button class="btn btn-google" type="button" data-action="signin">${ICONS.google}Entrar com o Google</button></div>
        ${premiumNote()}
      </div>`;
  }
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
      <button class="btn-icon" type="button" data-action="remove-channel" data-id="${esc(c.id)}" aria-label="Remover ${esc(c.title)}" title="Remover">${ICONS.remove}</button>
    </li>`).join('');
}

function renderSettings() {
  document.title = 'Configurações · MeuTube';
  $('#cfg-api-key').value = state.config.apiKey;
  $('#cfg-client-id').value = state.config.clientId;
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
  renderChannelList();
  resetFeed();
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
  if (Feed.error || !Feed.items.length) resetFeed();
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
  return { view: 'home' };
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

function applyView(view, id) {
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

  if (view === 'home') {
    showHome();
    window.scrollTo({ top: state.homeScroll, behavior: 'instant' });
  } else if (view === 'watch') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    enterWatch(id);
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderSettings();
  }
  updateToTop();
}

function route(animate = true) {
  const { view, id } = parseRoute();
  const prevView = state.view;
  const prevVideo = state.currentVideoId;
  const canAnimate = animate && !reducedMotion.matches;

  // Estado "antes": a miniatura clicada vira o player (ou o player volta para o tile).
  clearHeroNames();
  if (view === 'watch' && pendingHero?.isConnected && inViewport(pendingHero)) setHero(pendingHero);
  else if (prevView === 'watch' && view === 'home') setHero($('.player-wrap'));
  pendingHero = null;

  const update = () => {
    clearHeroNames();
    applyView(view, id);
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
      return;
    }

    const navHome = e.target.closest('a[data-nav="home"]');
    if (navHome && state.view === 'home') {
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
        Feed.error = null;
        updateFeedStatus();
        loadFeedPage();
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
  }, { rootMargin: '0px 0px 300px 0px' }).observe($('#feed-sentinel'));

  // Comentários carregam sozinhos ao chegar no fim da lista.
  new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting) && state.view === 'watch' && !$('#comments-more').hidden) {
      loadComments(state.currentVideoId);
    }
  }, { rootMargin: '0px 0px 200px 0px' }).observe($('#comments-more'));

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
  Feed.reset();
  renderAccount();
  bindEvents();
  route(false);
}

init();
