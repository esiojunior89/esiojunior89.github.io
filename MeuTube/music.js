'use strict';

/* =========================================================
   Canais — Músicas
   =========================================================
   Artistas adicionados (só) pelo link da aba "Lançamentos" do
   YouTube: https://www.youtube.com/@banda/releases

   • Faixas: as mesmas da aba "Lançamentos" — vêm do canal "Tema"
     (Topic) do artista no YouTube, pela API do YouTube.
   • Organização: o MusicBrainz (base aberta de música, sem chave)
     diz o que é álbum de estúdio, EP, single, ao vivo ou coletânea,
     a data de lançamento, a capa e a ordem das faixas.
   • Página do artista: álbuns de estúdio no topo, em ordem de
     lançamento (capa, título e ano); depois EPs, singles, ao vivo,
     coletâneas e outros. Página do álbum: as faixas na ordem
     oficial; tocar segue o álbum no "A seguir".

   Carregado antes do app.js: tudo aqui só roda depois que o app
   começa (usa store, api, esc, SF... do app.js).
   ========================================================= */
const MUSIC_KEY = 'meutube.music';         // [{ id (canal oficial), handle, name, thumb, mbid, topicId, at }]
const MUSIC_DATA_KEY = 'meutube.musicData'; // { [id]: { at, releases: [...], error } }
const MB_API = 'https://musicbrainz.org/ws/2/';
const CAA_RG = 'https://coverartarchive.org/release-group/';
const MUSIC_MAX_AGE = 7 * 864e5;           // confere novidades uma vez por semana
const MUSIC_DATA_VERSION = 2;              // 2: faixas pela busca do canal "Tema" (1.32.1)
const MUSIC_RETRY_MS = 30 * 6e4;           // depois de um erro, só tenta sozinho de novo em 30 min (a busca gasta cota)
const MUSIC_SEARCH_MAX_PAGES = 20;         // teto da busca completa: 20 × 50 faixas (2.000 unidades de cota)
const MUSIC_SECTIONS = [
  ['studio', 'Álbuns de estúdio'],
  ['ep', 'EPs'],
  ['single', 'Singles'],
  ['live', 'Ao vivo'],
  ['compilation', 'Coletâneas'],
  ['other', 'Outros lançamentos e participações'],
];
const MUSIC_TYPE_LABEL = { studio: 'Álbum de estúdio', ep: 'EP', single: 'Single', live: 'Ao vivo', compilation: 'Coletânea', other: 'Lançamento' };

let musicList = null;
let musicData = null;
const musicBusy = new Map();      // artista -> promessa da atualização em andamento
const musicVideos = new Map();    // vídeo -> dados completos (para o player e o "A seguir")
let musicRoute = { artist: null, album: null };

function musicArtists() {
  if (!musicList) musicList = store.get(MUSIC_KEY, []);
  return musicList;
}
function musicStore() {
  if (!musicData) musicData = store.get(MUSIC_DATA_KEY, {});
  return musicData;
}
function saveMusicList({ sync = true } = {}) {
  store.set(MUSIC_KEY, musicList);
  if (sync) Sync.touch('music');
}
function saveMusicData() {
  store.set(MUSIC_DATA_KEY, musicData);
}
const musicArtist = id => musicArtists().find(a => a.id === id) || null;
/** Artista das Músicas de um canal do YouTube (o oficial ou o "Tema"). */
const musicArtistOf = channelId => musicArtists().find(a => a.id === channelId || a.topicId === channelId) || null;

/** Canais do YouTube que valem como "do app" por causa das Músicas (o oficial e o "Tema"). */
function musicChannelIds() {
  return musicArtists().flatMap(a => [a.id, a.topicId].filter(Boolean));
}

/** Faixa de algum artista das Músicas? (pode tocar no app) */
function isMusicTrack(id) {
  for (const d of Object.values(musicStore())) {
    if (d?.releases?.some(r => r.tracks.includes(id))) return true;
  }
  return false;
}

/* ---------- MusicBrainz: uma consulta por segundo (regra deles) ---------- */
let mbChain = Promise.resolve();
let mbLast = 0;
function mb(path, params = {}) {
  const run = async () => {
    const wait = mbLast + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    mbLast = Date.now();
    const url = new URL(path, MB_API);
    for (const [k, v] of Object.entries({ ...params, fmt: 'json' })) url.searchParams.set(k, v);
    let res;
    try { res = await fetch(url); } catch { throw new Error('Sem conexão com o MusicBrainz.'); }
    if (res.status === 503) { // ocupado: espera um pouco e tenta de novo, uma vez
      await new Promise(r => setTimeout(r, 2500));
      mbLast = Date.now();
      res = await fetch(url);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`O MusicBrainz não respondeu (${res.status}).`);
    return res.json();
  };
  const p = mbChain.then(run, run);
  mbChain = p.catch(() => {});
  return p;
}

/* ---------- Nomes: comparar sem acento, maiúscula, pontuação nem "(Remastered…)" ---------- */
function musicNorm(s) {
  return String(s || '')
    .toLocaleLowerCase('en')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[([{][^)\]}]*(remaster|deluxe|edition|edicao|version|expanded|anniversary|bonus|reissue|mono|stereo|live|ao vivo|single|ep\b)[^)\]}]*[)\]}]/g, ' ')
    .replace(/\s-\s(single|ep)$/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Lê a descrição automática de uma faixa ("Provided to YouTube by…"): álbum e data de lançamento. */
function parseTrackDescription(desc) {
  const text = String(desc || '');
  if (!/provided to youtube by/i.test(text) && !/auto-generated by youtube/i.test(text)) return null;
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const songIdx = blocks.findIndex(b => b.includes(' · '));
  const album = songIdx >= 0 ? blocks[songIdx + 1] || '' : '';
  const released = /Released on:\s*(\d{4}-\d{2}-\d{2})/i.exec(text)?.[1] || '';
  const year = released.slice(0, 4) || /℗\s*(\d{4})/.exec(text)?.[1] || '';
  return { album: /^℗|^released on/i.test(album) ? '' : album, released, year };
}

/** Seção de um lançamento pelo tipo do MusicBrainz (álbum de estúdio, EP, single, ao vivo, coletânea). */
function sectionOf(primary, secondary = []) {
  const sec = secondary.map(s => s.toLowerCase());
  if (sec.includes('live')) return 'live';
  if (sec.includes('compilation')) return 'compilation';
  if (primary === 'Album' && !sec.length) return 'studio';
  if (primary === 'EP') return 'ep';
  if (primary === 'Single') return 'single';
  return 'other';
}
/** Sem cadastro no MusicBrainz: deduz pelo nome e pelo tamanho. */
function guessSection(title, count) {
  const t = musicNorm(title);
  if (/\b(live|ao vivo|en vivo)\b/.test(t)) return 'live';
  if (/\b(greatest hits|best of|the very best|hits|anthology|collection|essential)\b/.test(t)) return 'compilation';
  if (count <= 3) return 'single';
  if (count <= 6) return 'ep';
  return 'other';
}

/** Faixa avulsa numa coletânea de vários artistas (ex.: "90s All Over Again"): sem cadastro no MusicBrainz
    do artista, até 3 faixas e o nome do disco não é o de nenhuma delas (um single leva o nome da música). */
function guestAppearance(album, tracks) {
  const a = musicNorm(album);
  if (!a || tracks.length > 3) return false;
  return !tracks.some(t => { const n = musicNorm(t.title); return n === a || n.startsWith(a + ' ') || a.startsWith(n + ' '); });
}

/* ---------- Adicionar um artista ---------- */
const RELEASES_URL = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/@([\w.\-]+)\/releases\/?(?:[?#].*)?$/i;

async function addMusicArtist(url) {
  const m = RELEASES_URL.exec(String(url).trim());
  if (!m) throw new Error('Use o link da aba “Lançamentos” do artista: https://www.youtube.com/@banda/releases');
  const handle = '@' + m[1];
  const item = (await api('channels', { part: 'snippet', forHandle: handle })).items?.[0];
  if (!item) throw new Error(`Não achei o canal ${handle} no YouTube.`);
  if (musicArtist(item.id)) throw new Error(`${item.snippet.title} já está nas Músicas.`);
  const name = item.snippet.title;
  const thumb = item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '';

  // Artista no MusicBrainz: pelo link do canal no cadastro dele; senão, pelo nome (só se for exato).
  let mbid = null;
  for (const resource of [`https://www.youtube.com/channel/${item.id}`, `https://www.youtube.com/${handle}`]) {
    const hit = await mb('url', { resource, inc: 'artist-rels' });
    mbid = hit?.relations?.find(r => r.artist)?.artist?.id || null;
    if (mbid) break;
  }
  if (!mbid) {
    const found = await mb('artist', { query: `artist:"${name.replace(/"/g, '')}"`, limit: 5 });
    const exact = found?.artists?.find(a => a.score >= 95 && musicNorm(a.name) === musicNorm(name));
    mbid = exact?.id || null;
  }
  if (!mbid) throw new Error(`Não achei ${name} no MusicBrainz, a base usada para organizar os lançamentos.`);

  // Canal "Tema" (onde ficam as faixas da aba Lançamentos): pelo link "YouTube Music" do cadastro.
  const artist = await mb(`artist/${mbid}`, { inc: 'url-rels' });
  let topicId = null;
  for (const r of artist?.relations || []) {
    const u = r.url?.resource || '';
    const ch = /music\.youtube\.com\/channel\/(UC[\w-]{22})/.exec(u)?.[1];
    if (ch && ch !== item.id) { topicId = ch; break; }
  }
  if (!topicId) {
    // Sem o link no cadastro: procura "Artista - Topic" no YouTube (100 unidades de cota, uma vez).
    const s = await api('search', { part: 'snippet', type: 'channel', q: `${name} - Topic`, maxResults: 5 });
    topicId = s.items?.find(x => musicNorm(x.snippet?.title) === musicNorm(`${name} topic`))?.snippet?.channelId
      || s.items?.find(x => musicNorm(x.snippet?.title).startsWith(musicNorm(name)) && /topic|tema/i.test(x.snippet?.title))?.snippet?.channelId
      || null;
  }
  if (!topicId) throw new Error(`Não achei as faixas de ${name} (o canal “${name} - Tema” do YouTube).`);

  const record = { id: item.id, handle, name, thumb, mbid, topicId, at: Date.now() };
  musicArtists().push(record);
  saveMusicList();
  renderMusicEverywhere();
  refreshMusicArtist(record).catch(() => {});
  return record;
}

function removeMusicArtist(id) {
  musicList = musicArtists().filter(a => a.id !== id);
  delete musicStore()[id];
  saveMusicList();
  saveMusicData();
  renderMusicEverywhere();
}

/* ---------- Atualizar um artista: faixas (YouTube) + organização (MusicBrainz) ---------- */
function refreshMusicArtist(a, { force = false } = {}) {
  const d = musicStore()[a.id];
  if (!force && (musicFresh(d) || (d?.errAt && Date.now() - d.errAt < MUSIC_RETRY_MS))) return Promise.resolve(d);
  if (musicBusy.has(a.id)) return musicBusy.get(a.id);
  const job = (async () => {
    try {
      // Atualização automática: só as faixas novas desde a última vez. "Atualizar" (force): a lista inteira.
      const prev = d?.v === MUSIC_DATA_VERSION && Array.isArray(d.raw) && d.raw.length ? d : null;
      const since = !force && prev ? prev.at - 2 * 864e5 : 0;
      const [groups, fresh] = await Promise.all([fetchReleaseGroups(a.mbid), fetchTopicTracks(a.topicId, { since })]);
      const byId = new Map((since ? prev.raw : []).map(t => [t.id, t]));
      for (const t of fresh) byId.set(t.id, t);
      const raw = [...byId.values()].sort((x, y) => (x.pub < y.pub ? 1 : x.pub > y.pub ? -1 : 0)); // mais nova primeiro
      if (!raw.length) throw new Error(`O YouTube não devolveu nenhuma faixa de ${a.name} (canal “${a.name} - Tema”). Tente “Atualizar” mais tarde.`);
      const releases = buildReleases(groups, raw, d?.releases || []);
      musicStore()[a.id] = { v: MUSIC_DATA_VERSION, at: Date.now(), releases, raw };
    } catch (e) {
      const cur = musicStore()[a.id] || {};
      musicStore()[a.id] = { ...cur, ...(cur.v !== MUSIC_DATA_VERSION && { releases: undefined, raw: undefined }), error: e.message || String(e), errAt: Date.now(), at: cur.at || 0 };
    } finally {
      musicBusy.delete(a.id);
      saveMusicData();
      renderMusicEverywhere();
    }
    return musicStore()[a.id];
  })();
  musicBusy.set(a.id, job);
  renderMusicEverywhere();
  return job;
}

async function fetchReleaseGroups(mbid) {
  const all = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await mb('release-group', { artist: mbid, limit: 100, offset });
    const list = page?.['release-groups'] || [];
    all.push(...list);
    if (all.length >= (page?.['release-group-count'] || 0) || !list.length) break;
  }
  return all.map(g => ({ id: g.id, title: g.title, primary: g['primary-type'] || '', secondary: g['secondary-types'] || [], date: g['first-release-date'] || '' }));
}

/** Dados guardados ainda valem? (versão atual, com faixas e de menos de 7 dias) */
function musicFresh(d) {
  return Boolean(d?.v === MUSIC_DATA_VERSION && d.releases?.length && Date.now() - (d.at || 0) < MUSIC_MAX_AGE);
}

/** Faixas do canal "Tema" (as da aba Lançamentos).
    O YouTube não deixa ler a lista de envios desses canais (responde 404 e "0 vídeos"), então as faixas vêm
    da busca restrita ao canal (100 unidades de cota por página de 50) e os detalhes de cada uma (álbum e data
    na descrição automática) de videos.list (1 unidade por 50). A busca para em ~500 resultados: passando
    disso, continua a partir da data da faixa mais antiga já vista. since: só as publicadas depois dessa data. */
async function fetchTopicTracks(topicId, { since = 0 } = {}) {
  const ids = new Map(); // vídeo -> data de publicação
  let before = null;
  let pages = 0;
  while (pages < MUSIC_SEARCH_MAX_PAGES) {
    let pageToken;
    let got = 0;
    let oldest = null;
    do {
      const data = await api('search', {
        part: 'snippet', channelId: topicId, type: 'video', order: 'date', maxResults: 50,
        fields: 'nextPageToken,items(id/videoId,snippet/publishedAt)',
        ...(since && { publishedAfter: new Date(since).toISOString() }),
        ...(before && { publishedBefore: before }),
        ...(pageToken && { pageToken }),
      });
      pages++;
      for (const it of data.items || []) {
        const id = it.id?.videoId;
        const pub = it.snippet?.publishedAt || '';
        if (!id) continue;
        got++;
        if (!ids.has(id)) ids.set(id, pub);
        if (pub && (!oldest || pub < oldest)) oldest = pub;
      }
      pageToken = data.nextPageToken;
    } while (pageToken && pages < MUSIC_SEARCH_MAX_PAGES);
    // Bateu no limite da busca (~500)? Continua do ponto mais antigo; senão, terminou.
    if (got < 450 || !oldest || oldest === before) break;
    before = oldest;
  }
  const list = [...ids.keys()];
  const out = [];
  for (let i = 0; i < list.length; i += 50) {
    const data = await api('videos', {
      part: 'snippet', id: list.slice(i, i + 50).join(','), maxResults: 50,
      fields: 'items(id,snippet(title,description,publishedAt,channelId,thumbnails/medium/url,thumbnails/high/url))',
    });
    for (const v of data.items || []) {
      const sn = v.snippet || {};
      if (sn.channelId && sn.channelId !== topicId) continue;
      const info = parseTrackDescription(sn.description);
      out.push({ id: v.id, title: sn.title || '', album: info?.album || '', released: info?.released || '', year: info?.year || '',
        thumb: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || '', pub: sn.publishedAt || ids.get(v.id) || '' });
    }
  }
  return out;
}

/** Junta as faixas do YouTube por álbum e casa cada álbum com o lançamento do MusicBrainz. */
function buildReleases(groups, tracks, old = []) {
  const byNorm = new Map();
  for (const g of groups) {
    const k = musicNorm(g.title);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(g);
  }
  const albums = new Map(); // nome do álbum -> faixas
  for (const t of tracks) {
    const k = musicNorm(t.album) || '\u0000sem-album';
    if (!albums.has(k)) albums.set(k, { name: t.album, tracks: [] });
    albums.get(k).tracks.push(t);
  }
  const releases = new Map();
  for (const [k, al] of albums) {
    const year = al.tracks.map(t => t.year).find(Boolean) || '';
    const released = al.tracks.map(t => t.released).filter(Boolean).sort()[0] || '';
    const cands = k === '\u0000sem-album' ? [] : byNorm.get(k) || [];
    const rank = g => (year && g.date.startsWith(year) ? 0 : 1) * 10 + (sectionOf(g.primary, g.secondary) === 'studio' ? 0 : 1) * 2 + (g.date ? 0 : 1);
    const g = [...cands].sort((x, y) => rank(x) - rank(y) || (x.date < y.date ? -1 : 1))[0];
    const key = g ? g.id : 'y-' + (k === '\u0000sem-album' ? 'outros' : k.replace(/\s+/g, '-').slice(0, 60));
    const prev = releases.get(key);
    // A mesma obra em duas edições (original e remasterizada): junta, sem repetir a mesma música.
    const list = prev ? prev.items : [];
    const titles = new Set(list.map(t => musicNorm(t.title)));
    for (const t of al.tracks.slice().reverse()) { // a lista de envios vem da mais nova para a mais antiga
      if (titles.has(musicNorm(t.title))) continue;
      titles.add(musicNorm(t.title));
      list.push(t);
    }
    const oldR = old.find(r => r.key === key);
    releases.set(key, {
      key,
      rg: g?.id || null,
      title: g?.title || al.name || 'Outras faixas',
      section: g ? sectionOf(g.primary, g.secondary) : guestAppearance(al.name, list) ? 'other' : guessSection(al.name, list.length),
      date: g?.date || released || (year ? `${year}` : ''),
      cover: g ? `${CAA_RG}${g.id}/front-250` : '',
      thumb: list[0]?.thumb || '',
      items: list,
      order: oldR?.order && oldR.order.every(id => list.some(t => t.id === id)) && oldR.order.length === list.length ? oldR.order : null,
    });
  }
  return [...releases.values()].map(r => ({
    key: r.key, rg: r.rg, title: r.title, section: r.section, date: r.date, cover: r.cover, thumb: r.thumb,
    tracks: r.items.map(t => t.id),
    titles: Object.fromEntries(r.items.map(t => [t.id, t.title])),
    order: r.order,
  }));
}

/** Ordem oficial das faixas (MusicBrainz), buscada quando o álbum é aberto pela primeira vez. */
async function ensureAlbumOrder(artistId, rel) {
  if (rel.order || !rel.rg) return rel.order || rel.tracks;
  const data = await mb('release', { 'release-group': rel.rg, inc: 'recordings', status: 'official', limit: 25 });
  const ytTitles = rel.tracks.map(id => ({ id, n: musicNorm(rel.titles?.[id]) }));
  let best = null;
  for (const r of data?.releases || []) {
    const list = (r.media || []).flatMap(m => m.tracks || []).map(t => musicNorm(t.title));
    const hits = ytTitles.filter(t => list.includes(t.n)).length;
    const score = hits * 1000 - Math.abs(list.length - ytTitles.length) * 10 - (r.date ? 0 : 1);
    if (!best || score > best.score) best = { score, list };
  }
  let order = rel.tracks;
  if (best) {
    const pos = t => { const i = best.list.indexOf(t.n); return i < 0 ? 1e6 : i; };
    order = ytTitles.map((t, i) => ({ ...t, i })).sort((a, b) => pos(a) - pos(b) || a.i - b.i).map(t => t.id);
  }
  rel.order = order;
  saveMusicData();
  return order;
}

/** Dados completos das faixas (título, duração, capa) para a lista e o player. */
async function ensureMusicVideos(ids) {
  const missing = ids.filter(id => !musicVideos.has(id));
  if (missing.length) {
    const got = await fetchVideos(missing);
    for (const [id, v] of got) musicVideos.set(id, v);
  }
  return ids.map(id => musicVideos.get(id)).filter(Boolean);
}

/* ---------- "A seguir" e reprodução automática dentro do álbum ---------- */
const musicFeeds = new Map();
function musicFeed(artistId, key) {
  const k = `${artistId}/${key}`;
  if (musicFeeds.has(k)) return musicFeeds.get(k);
  const feed = {
    music: true,
    items: [],
    exhausted: false,
    gen: 0,
    async loadMore() {
      const rel = musicStore()[artistId]?.releases?.find(r => r.key === key);
      if (!rel) { this.exhausted = true; return; }
      const order = await ensureAlbumOrder(artistId, rel).catch(() => rel.tracks);
      this.items = await ensureMusicVideos(order);
      this.exhausted = true;
    },
  };
  musicFeeds.set(k, feed);
  return feed;
}
const musicTrackHref = (id, artistId, key) => `#/watch/${id}/m/${artistId}/${key}`;

/* ---------- Telas ---------- */
function musicCoverHTML(rel, cls = 'mu-cover') {
  const src = rel.cover || rel.thumb;
  return `<span class="${cls}">${src ? `<img src="${esc(src)}" ${rel.cover && rel.thumb ? `data-fallback="${esc(rel.thumb)}" ` : ''}alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : SF('music')}</span>`;
}
const musicYear = rel => (rel.date || '').slice(0, 4);

function musicStatusText(a) {
  const d = musicStore()[a.id];
  if (musicBusy.has(a.id)) return 'Organizando os lançamentos…';
  if (d?.error && !d.releases?.length) return d.error;
  if (!d?.releases) return 'Ainda não organizado';
  const n = s => d.releases.filter(r => r.section === s).length;
  const tracks = d.releases.reduce((s, r) => s + r.tracks.length, 0);
  const parts = [n('studio') && `${n('studio')} ${n('studio') === 1 ? 'álbum' : 'álbuns'}`, n('ep') && `${n('ep')} EP${n('ep') === 1 ? '' : 's'}`, n('single') && `${n('single')} single${n('single') === 1 ? '' : 's'}`].filter(Boolean);
  return `${parts.join(' · ') || 'Lançamentos'} · ${intFmt.format(tracks)} ${tracks === 1 ? 'faixa' : 'faixas'}`;
}

/** Menu lateral: artistas das Músicas. */
function renderMusicSidebar() {
  const box = $('#side-music');
  if (!box) return;
  const list = [...musicArtists()].sort((a, b) => byName(a.name, b.name));
  box.innerHTML = list.length
    ? list.map(a => `
        <a class="side-item" href="#/music/${esc(a.id)}" data-music="${esc(a.id)}" title="${esc(a.name)}">
          <img class="side-avatar" src="${esc(a.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
          <span class="side-label">${esc(a.name)}</span>
        </a>`).join('')
    : `<a class="side-item" href="#/settings/musicas" title="Adicionar artistas">
         <span class="side-icon">${SF('music')}</span>
         <span class="side-label">Adicionar artistas</span>
       </a>`;
  updateMusicSidebarActive();
}
function updateMusicSidebarActive() {
  $$('#side-music [data-music]').forEach(el => el.classList.toggle('active', state.view === 'music' && el.dataset.music === musicRoute.artist));
}

/** Ajustes › Músicas: lista dos artistas. */
function renderMusicSettings() {
  const ul = $('#music-list');
  if (!ul) return;
  const list = musicArtists();
  $('#music-count').textContent = list.length ? `· ${list.length}` : '';
  const row = $('#music-count-row');
  if (row) row.textContent = list.length || '';
  ul.innerHTML = list.length ? list.map(a => `
    <li class="channel-item music-item" data-id="${esc(a.id)}">
      <img src="${esc(a.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken>
      <div class="ci-text">
        <strong>${esc(a.name)}</strong>
        <span class="${musicStore()[a.id]?.error && !musicStore()[a.id]?.releases?.length ? 'error' : ''}">${esc(musicStatusText(a))}</span>
      </div>
      <button class="ci-remove ci-refresh" type="button" data-action="refresh-music" data-id="${esc(a.id)}" aria-label="Atualizar ${esc(a.name)}" title="Atualizar agora"${musicBusy.has(a.id) ? ' disabled' : ''}>${SF('sync')}</button>
      <button class="ci-remove" type="button" data-action="remove-music" data-id="${esc(a.id)}" aria-label="Remover ${esc(a.name)}" title="Remover">${SF('minus-c')}</button>
    </li>`).join('') : '<li class="channel-empty">Nenhum artista adicionado ainda.</li>';
}

/** Página do artista (seções) ou do álbum (faixas). */
function renderMusicView() {
  const box = $('#music-page');
  if (!box) return;
  const a = musicArtist(musicRoute.artist);
  if (!a) {
    box.innerHTML = `<div class="empty-state">${SF('music')}<p>Artista não encontrado. <a href="#/settings/musicas">Adicionar artistas</a></p></div>`;
    document.title = 'Músicas · Canais';
    return;
  }
  const d = musicStore()[a.id];
  refreshMusicArtist(a).catch(() => {}); // só busca se os dados venceram (e não logo depois de um erro)
  if (musicRoute.album) return renderMusicAlbum(box, a, d);
  document.title = `${a.name} · Músicas · Canais`;
  const head = `
    <header class="mu-head">
      <img class="mu-avatar" src="${esc(a.thumb || '')}" alt="" referrerpolicy="no-referrer" data-hide-broken>
      <div class="mu-head-text"><span class="eyebrow">Músicas</span><h1 class="t-large">${esc(a.name)}</h1><p class="mu-sub">${esc(musicStatusText(a))}</p></div>
    </header>`;
  if (!d?.releases?.length) {
    box.innerHTML = head + (musicBusy.has(a.id) || !d?.error
      ? `<div class="mu-grid">${Array.from({ length: 6 }, () => '<div class="mu-card" aria-hidden="true"><span class="mu-cover skeleton"></span><span class="skeleton sk-line w80"></span><span class="skeleton sk-line w40"></span></div>').join('')}</div>`
      : `<p class="error">${esc(d.error)}</p>`);
    return;
  }
  const sections = MUSIC_SECTIONS.map(([s, label]) => {
    const rels = d.releases.filter(r => r.section === s).sort((x, y) => (x.date || '9') < (y.date || '9') ? -1 : (x.date || '9') > (y.date || '9') ? 1 : byName(x.title, y.title));
    if (!rels.length) return '';
    return `
      <section class="mu-section" data-section="${s}">
        <h2 class="mu-section-title">${label} <span>${rels.length}</span></h2>
        <div class="mu-grid">${rels.map((r, i) => `
          <a class="mu-card" href="#/music/${esc(a.id)}/${esc(r.key)}" style="--i:${Math.min(i, 12)}">
            ${musicCoverHTML(r)}
            <strong class="mu-title" title="${esc(r.title)}">${esc(r.title)}</strong>
            <span class="mu-year">${esc(musicYear(r) || '—')}</span>
          </a>`).join('')}</div>
      </section>`;
  }).join('');
  box.innerHTML = head + (sections || '<p class="muted">Nenhum lançamento encontrado.</p>');
}

function renderMusicAlbum(box, a, d) {
  const rel = d?.releases?.find(r => r.key === musicRoute.album);
  if (!rel) {
    box.innerHTML = `<a class="back-link mu-back" href="#/music/${esc(a.id)}">${SF('chev-l')}${esc(a.name)}</a>` + (d?.releases ? '<p class="muted">Lançamento não encontrado.</p>' : '<p class="muted">Carregando…</p>');
    return;
  }
  document.title = `${rel.title} · ${a.name} · Canais`;
  const ids = rel.order || rel.tracks;
  const rowHTML = (id, i, v) => `
    <a class="mu-track" href="${musicTrackHref(id, a.id, rel.key)}" data-vid="${esc(id)}">
      <span class="mu-num">${i + 1}</span>
      <span class="mu-play">${SF('yt-play')}</span>
      <span class="mu-track-title">${esc(v?.title || rel.titles?.[id] || '…')}</span>
      <span class="mu-dur">${v?.duration ? esc(v.duration) : ''}</span>
    </a>`;
  const vids = ids.map(id => musicVideos.get(id));
  const total = vids.reduce((s, v) => s + (v?.durationSec || 0), 0);
  const meta = [MUSIC_TYPE_LABEL[rel.section], musicYear(rel), `${ids.length} ${ids.length === 1 ? 'música' : 'músicas'}`, total ? fmtHours(total) : ''].filter(Boolean).join(' · ');
  box.innerHTML = `
    <a class="back-link mu-back" href="#/music/${esc(a.id)}">${SF('chev-l')}${esc(a.name)}</a>
    <header class="mu-album-head">
      ${musicCoverHTML(rel, 'mu-cover mu-cover-lg')}
      <div class="mu-album-text">
        <span class="eyebrow">${esc(MUSIC_TYPE_LABEL[rel.section])}</span>
        <h1 class="t-large">${esc(rel.title)}</h1>
        <p class="mu-sub"><a href="#/music/${esc(a.id)}">${esc(a.name)}</a> · ${esc(meta.replace(`${MUSIC_TYPE_LABEL[rel.section]} · `, ''))}</p>
        ${ids.length ? `<a class="btn btn-tint mu-play-all" href="${musicTrackHref(ids[0], a.id, rel.key)}">${SF('yt-play')}Tocar</a>` : ''}
      </div>
    </header>
    <div class="mu-tracks" id="mu-tracks">${ids.map((id, i) => rowHTML(id, i, musicVideos.get(id))).join('')}</div>`;
  // Ordem oficial (MusicBrainz) e duração das faixas (YouTube): busca uma vez e redesenha.
  const key = rel.key;
  (async () => {
    const order = await ensureAlbumOrder(a.id, rel).catch(() => ids);
    await ensureMusicVideos(order).catch(() => {});
    if (state.view === 'music' && musicRoute.album === key && (order !== ids || order.some(id => !vids[ids.indexOf(id)]))) renderMusicView();
  })();
}

/** Página "Canais" (celular): os artistas das Músicas embaixo dos canais. */
function renderMusicOnChannelsPage() {
  const box = $('#channels-music');
  if (!box) return;
  const list = [...musicArtists()].sort((a, b) => byName(a.name, b.name));
  box.innerHTML = `
    <h2 class="mu-section-title">Músicas <a class="side-add" href="#/settings/musicas" title="Adicionar artista" aria-label="Adicionar artista">${SF('plus')}</a></h2>
    ${list.length ? `<div class="mu-artists">${list.map(a => `
      <a class="mu-artist" href="#/music/${esc(a.id)}"><img src="${esc(a.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken><span>${esc(a.name)}</span></a>`).join('')}</div>`
      : '<p class="muted">Adicione artistas nos Ajustes › Músicas, pelo link da aba “Lançamentos”.</p>'}`;
}

function renderMusicEverywhere() {
  renderMusicSidebar();
  renderMusicSettings();
  if (state.view === 'music') renderMusicView();
  if (state.view === 'channels') renderMusicOnChannelsPage();
}

/** Liga o formulário e os botões dos Ajustes › Músicas. */
function setupMusic() {
  const form = $('#music-form');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#music-input');
    const btn = form.querySelector('button[type="submit"]');
    const value = input.value.trim();
    if (!value) return;
    btn.disabled = true;
    btn.textContent = 'Adicionando…';
    try {
      const a = await addMusicArtist(value);
      input.value = '';
      toast(`${a.name} adicionado às Músicas. Organizando os lançamentos…`, 'success');
    } catch (err) {
      toast(err.message || String(err), 'error', 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Adicionar';
    }
  });
  document.addEventListener('click', e => {
    const rm = e.target.closest('[data-action="remove-music"]');
    if (rm) {
      const a = musicArtist(rm.dataset.id);
      if (a && confirm(`Remover ${a.name} das Músicas?`)) removeMusicArtist(a.id);
      return;
    }
    const rf = e.target.closest('[data-action="refresh-music"]');
    if (rf) {
      const a = musicArtist(rf.dataset.id);
      if (a) refreshMusicArtist(a, { force: true });
    }
  });
  renderMusicEverywhere();
}
