'use strict';

/* =========================================================
   Canais — Músicas
   =========================================================
   Artistas adicionados (só) pelo link da aba "Lançamentos" do
   YouTube: https://www.youtube.com/@banda/releases

   • Lançamentos e faixas: o MusicBrainz (base aberta de música)
     diz quais são os álbuns de estúdio ("Album") e ao vivo
     ("Album + Live"), a data e as faixas da EDIÇÃO ORIGINAL de cada
     um, na ordem dela. Coletâneas, EPs, singles etc. não entram.
   • Buscas no YouTube (limite diário do projeto): uma por álbum,
     pelo nome do álbum (que está na descrição de cada faixa); só se
     faltar faixa, mais uma pelos títulos. Se o limite do dia acabar
     no meio, guarda o que achou e continua sozinho depois que ele
     voltar (meia-noite no horário do Pacífico).
   • YouTube: cada faixa do MusicBrainz toca o vídeo correspondente
     do canal "Tema" (Topic) do artista. A versão de estúdio nunca é
     trocada por uma ao vivo ou remix. Faixa (ou álbum) que não está
     no YouTube aparece acinzentada, "Indisponível no YouTube".
   • Dados: cache do aparelho → Drive → internet. Depois de montado,
     o artista só é consultado de novo no botão "Atualizar" da
     página dele.
   • Página do artista: banner do canal, álbuns de estúdio no topo,
     em ordem de lançamento (capa, título e ano); depois EPs,
     singles, ao vivo e coletâneas. Tocar segue o álbum no "A seguir".
     As faixas não guardam progresso: sempre começam do início.

   Carregado antes do app.js: tudo aqui só roda depois que o app
   começa (usa store, api, esc, SF... do app.js).
   ========================================================= */
const MUSIC_KEY = 'meutube.music';         // [{ id (canal oficial), handle, name, thumb, mbid, topicId, at }]
const MUSIC_DATA_KEY = 'meutube.musicData'; // { [id]: { at, releases: [...], error } }
const MB_API = 'https://musicbrainz.org/ws/2/';
const CAA_RG = 'https://coverartarchive.org/release-group/';
const MUSIC_DATA_VERSION = 4;              // 4: só "Album" e "Album + Live"; buscas por álbum (1.36.0)
const MUSIC_MIN_TRACKS = 6;                // só lançamentos com mais de 5 faixas
const MUSIC_RETRY_MS = 30 * 6e4;           // depois de um erro, só tenta sozinho de novo em 30 min (a busca gasta cota)
const MUSIC_SECTIONS = [
  ['studio', 'Álbuns de estúdio'],
  ['ep', 'EPs'],
  ['single', 'Singles'],
  ['live', 'Ao vivo'],
  ['compilation', 'Coletâneas'],
  ['other', 'Outros lançamentos'],
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
  musicTrackSet = null;
  store.set(MUSIC_DATA_KEY, musicData);
}

/* ---------- Nuvem: a discografia organizada vai para o Google Drive ----------
   Um aparelho organiza (YouTube + MusicBrainz) e salva no Drive; os outros baixam de lá, sem
   consultar o YouTube nem o MusicBrainz de novo. O arquivo principal da sincronização guarda só
   a versão (rev) de cada artista; o arquivo das Músicas (meutube-music.json) só é baixado
   quando outro aparelho tem uma versão mais nova. */
/** Marca os dados de um artista como alterados aqui (vão para a nuvem na próxima sincronização). */
function touchMusicData(id) {
  const d = musicStore()[id];
  if (d) d.rev = Date.now();
  saveMusicData();
  if (typeof Sync !== 'undefined') Sync.schedule(SYNC_QUICK_MS);
}
/** Versões dos artistas deste aparelho que valem para a nuvem: { id: rev } */
function musicIndex() {
  const out = {};
  for (const a of musicArtists()) {
    const d = musicStore()[a.id];
    if (d?.v === MUSIC_DATA_VERSION && d.releases?.length) out[a.id] = d.rev || d.at || 1; // da 1.32.1 (sem rev): a data em que foi organizado
  }
  return out;
}
/** O que vai para o arquivo das Músicas no Drive (sem os erros deste aparelho). */
function musicCloudData() {
  const artists = {};
  for (const id of Object.keys(musicIndex())) {
    const { error, errAt, ...d } = musicStore()[id];
    artists[id] = d;
  }
  return { version: 1, artists };
}
/** Junta o que veio da nuvem: vale a versão mais nova de cada artista da lista. */
function mergeMusicData(remote) {
  let changed = false;
  for (const [id, r] of Object.entries(remote?.artists || {})) {
    if (!musicArtist(id) || r?.v !== MUSIC_DATA_VERSION || !r.releases?.length) continue;
    const l = musicStore()[id];
    if ((r.rev || r.at || 0) > (l?.v === MUSIC_DATA_VERSION && l.releases?.length ? l.rev || l.at || 1 : 0)) {
      musicStore()[id] = r;
      changed = true;
    }
  }
  if (changed) {
    saveMusicData();
    musicFeeds.clear();
    renderMusicEverywhere();
  }
  return changed;
}
const musicArtist = id => musicArtists().find(a => a.id === id) || null;
/** Artista das Músicas de um canal do YouTube (o oficial ou o "Tema"). */
const musicArtistOf = channelId => musicArtists().find(a => a.id === channelId || a.topicId === channelId) || null;

/** Canais do YouTube que valem como "do app" por causa das Músicas (o oficial e o "Tema"). */
function musicChannelIds() {
  return musicArtists().flatMap(a => [a.id, a.topicId].filter(Boolean));
}

/** Faixa de algum artista das Músicas? (pode tocar no app; não guarda progresso) */
let musicTrackSet = null;
function isMusicTrack(id) {
  if (!musicTrackSet) {
    musicTrackSet = new Set();
    for (const d of Object.values(musicStore())) for (const r of d?.releases || []) for (const t of r.tracks || []) musicTrackSet.add(t);
  }
  return musicTrackSet.has(id);
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
    let res = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) { // ocupado ou falha de conexão: espera um pouco (2,5 s, depois 5 s) e tenta de novo
        await new Promise(r => setTimeout(r, 2500 * attempt));
        mbLast = Date.now();
      }
      try { res = await fetch(url); } catch { res = null; continue; }
      if (res.status !== 503) break;
    }
    if (!res) throw new Error('Sem conexão com o MusicBrainz. Tente “Atualizar” mais tarde.');
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

/** Título de faixa para comparar: sem acento, pontuação e "(Remastered 2015)", "(B-Side)", "- Mono"…
    Mas "(Live…)", "(Remix)", "(Demo)", "(Edit)" etc. continuam no nome: são outras gravações. */
function trackNorm(s) {
  const IGN = '(?:\\d{4}\\s*)?(?:digital(?:ly)?\\s*)?remaster(?:ed)?(?:\\s*\\d{4})?(?:\\s*version)?|mono|stereo|album version|b-side|bonus track|explicit|clean';
  return String(s || '')
    .toLocaleLowerCase('en')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(new RegExp(`\\s*[([](?:${IGN})[)\\]]`, 'g'), ' ')
    .replace(new RegExp(`\\s+-\\s+(?:${IGN})\\s*$`, 'g'), ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
/** Versão diferente da de estúdio (ao vivo, remix, demo, acústica…)? */
const ALT_VERSION = /\b(live|ao vivo|en vivo|remix|mix|demo|acoustic|acustic|instrumental|edit|version|versao|rehearsal|session|karaoke)\b/;
/** Sem a marca de ao vivo ("epic live at brixton" -> "epic"): num álbum ao vivo, a versão ao vivo é a certa. */
const liveStrip = k => k.replace(/\s+(live|ao vivo|en vivo)\b.*$/, '').trim();

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

/* ---------- Adicionar um artista ---------- */
const RELEASES_URL = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/@([\w.\-]+)\/releases\/?(?:[?#].*)?$/i;

async function addMusicArtist(url) {
  const m = RELEASES_URL.exec(String(url).trim());
  if (!m) throw new Error('Use o link da aba “Lançamentos” do artista: https://www.youtube.com/@banda/releases');
  const handle = '@' + m[1];
  const item = (await api('channels', { part: 'snippet,brandingSettings', forHandle: handle })).items?.[0];
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

  const banner = item.brandingSettings?.image?.bannerExternalUrl || '';
  const record = { id: item.id, handle, name, thumb, banner, mbid, topicId, at: Date.now() };
  musicArtists().push(record);
  saveMusicList();
  renderMusicEverywhere();
  refreshMusicArtist(record).catch(() => {});
  return record;
}

function removeMusicArtist(id) {
  musicList = musicArtists().filter(a => a.id !== id);
  delete musicStore()[id];
  removeCovers(id);
  saveMusicList();
  saveMusicData();
  renderMusicEverywhere();
}

/* ---------- Montar um artista: lançamentos (MusicBrainz) + vídeos das faixas (YouTube) ----------
   Ordem: cache deste aparelho → Drive → internet. Depois de montado, só o botão "Atualizar"
   (force) consulta de novo — e só busca no YouTube os álbuns novos. */
const isQuotaError = e => ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(e?.reason);
/** Esperando o limite diário de buscas voltar (montagem incompleta)? */
const musicWaitingQuota = d => Boolean(d?.v === MUSIC_DATA_VERSION && d.pendingUntil && Date.now() < d.pendingUntil);

function refreshMusicArtist(a, { force = false } = {}) {
  const d = musicStore()[a.id];
  if (!force && (musicFresh(d) || musicWaitingQuota(d) || (d?.errAt && Date.now() - d.errAt < MUSIC_RETRY_MS))) return Promise.resolve(d);
  if (musicBusy.has(a.id)) return musicBusy.get(a.id);
  const job = (async () => {
    try {
      // Outro aparelho pode já ter montado: confere o Drive antes de consultar o YouTube e o MusicBrainz.
      if (!force && typeof Sync !== 'undefined' && Sync.enabled()) {
        await Sync.run().catch(() => {});
        const now = musicStore()[a.id];
        if (musicFresh(now) || musicWaitingQuota(now)) return now;
      }
      const cur = musicStore()[a.id];
      const same = cur?.v === MUSIC_DATA_VERSION;
      // Da 1.35 (v3): o que já foi buscado lá não é buscado de novo.
      const searched = new Set(same ? cur.searched || [] : cur?.v === 3 ? (cur.releases || []).map(r => r.key) : []);
      const aq = new Set(same ? cur.aq || [] : searched); // álbuns cuja busca pelo nome já foi feita
      const byId = new Map((Array.isArray(cur?.raw) ? cur.raw : []).map(t => [t.id, t]));
      const editions = await fetchEditions(a.mbid);
      const originals = originalEditions(editions)
        .sort((x, y) => (sectionOf(x.rg.primary, x.rg.secondary) === 'studio' ? 0 : 1) - (sectionOf(y.rg.primary, y.rg.secondary) === 'studio' ? 0 : 1) || (x.rg.date < y.rg.date ? -1 : 1));
      let quota = null;
      for (const e of originals) {
        if (searched.has(e.rg.id)) continue;
        try {
          if (!aq.has(e.rg.id)) {
            for (const t of await searchTopic(a.topicId, `"${e.rg.title.replace(/["|]/g, ' ').trim()}"`, byId)) byId.set(t.id, t);
            aq.add(e.rg.id);
          }
          const missing = buildReleases([e], [...byId.values()]).missing[0];
          for (const q of missing ? orQueries(missing.titles).slice(0, 2) : []) {
            for (const t of await searchTopic(a.topicId, q, byId)) byId.set(t.id, t);
          }
          searched.add(e.rg.id);
        } catch (err) {
          if (!isQuotaError(err)) throw err;
          quota = err; // acabou o limite do dia: guarda o que achou e continua depois que ele voltar
          break;
        }
      }
      const raw = [...byId.values()].sort((x, y) => (x.pub < y.pub ? 1 : x.pub > y.pub ? -1 : 0)); // mais nova primeiro
      const built = buildReleases(editions, raw, searched);
      if (!built.releases.length) throw new Error(`O MusicBrainz não tem álbuns de estúdio ou ao vivo de ${a.name} com mais de 5 faixas.`);
      musicStore()[a.id] = {
        v: MUSIC_DATA_VERSION, at: Date.now(), rev: Date.now(), releases: built.releases, raw, searched: [...searched], aq: [...aq],
        ...(quota && { pendingUntil: quotaResetAt(), quotaMsg: quota.message }),
      };
      if (typeof Sync !== 'undefined') Sync.schedule(SYNC_QUICK_MS); // salva no Drive para os outros aparelhos
      ensureCovers(a.id).catch(() => {});
    } catch (e) {
      const cur = musicStore()[a.id] || {};
      musicStore()[a.id] = { ...cur, ...(cur.v !== MUSIC_DATA_VERSION && { releases: undefined }), error: e.message || String(e), errAt: Date.now(), at: cur.at || 0 };
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

async function fetchEditions(mbid) {
  const out = [];
  for (let offset = 0, total = Infinity; offset < total && offset < 3000;) {
    const page = await mb('release', { artist: mbid, inc: 'recordings release-groups', limit: 100, offset });
    const list = page?.releases || [];
    total = page?.['release-count'] ?? 0;
    for (const r of list) {
      const g = r['release-group'] || {};
      out.push({
        id: r.id, date: r.date || '', status: r.status || '',
        rg: { id: g.id, title: g.title || r.title, primary: g['primary-type'] || '', secondary: g['secondary-types'] || [], date: g['first-release-date'] || '' },
        tracks: (r.media || []).flatMap(m => m.tracks || []).map(t => ({ title: t.title || t.recording?.title || '', ms: t.length || t.recording?.length || 0 })),
      });
    }
    if (!list.length) break;
    offset += list.length;
  }
  return out;
}

/** Só "Album" (estúdio) e "Album + Live" do MusicBrainz. */
const musicWanted = rg => rg.primary === 'Album' && (!rg.secondary.length || (rg.secondary.length === 1 && rg.secondary[0] === 'Live'));
/** Edição original de cada lançamento: a primeira oficial (data completa antes de "só o ano");
    na mesma data, a com mais faixas. Só álbuns de estúdio e ao vivo com mais de 5 faixas. */
function originalEditions(editions) {
  const groups = new Map();
  for (const e of editions) {
    if (!e.rg.id || !musicWanted(e.rg)) continue;
    if (!groups.has(e.rg.id)) groups.set(e.rg.id, []);
    groups.get(e.rg.id).push(e);
  }
  const dateKey = d => (d ? (d + '-99-99').slice(0, 10) : '9999');
  const out = [];
  for (const list of groups.values()) {
    const official = list.filter(e => e.status === 'Official');
    const pick = (official.length ? official : list).filter(e => e.tracks.length)
      .sort((x, y) => (dateKey(x.date) < dateKey(y.date) ? -1 : dateKey(x.date) > dateKey(y.date) ? 1 : y.tracks.length - x.tracks.length))[0];
    if (pick && pick.tracks.length >= MUSIC_MIN_TRACKS) out.push(pick);
  }
  return out;
}

/** Monta os lançamentos: faixas da edição original (MusicBrainz), cada uma com o vídeo do YouTube.
    searched: álbuns já buscados no YouTube (os outros ficam "aguardando"). Também devolve as faixas que faltaram. */
function buildReleases(editions, raw, searched = null) {
  const byTitle = new Map(); // título da faixa -> vídeos do canal "Tema"
  const byLive = new Map();  // título sem "(Live…)" -> versões ao vivo (para os álbuns ao vivo)
  for (const t of raw) {
    const k = trackNorm(t.title);
    if (!k) continue;
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(t);
    const base = liveStrip(k);
    if (base !== k) {
      if (!byLive.has(base)) byLive.set(base, []);
      byLive.get(base).push(t);
    }
  }
  const releases = [];
  const missing = [];
  for (const e of originalEditions(editions)) {
    const album = musicNorm(e.rg.title);
    const live = sectionOf(e.rg.primary, e.rg.secondary) === 'live';
    const used = new Set();
    const items = e.tracks.map(tr => {
      const k = trackNorm(tr.title);
      const alt = ALT_VERSION.test(k);
      // Álbum ao vivo: a faixa "Epic" do MusicBrainz é a "Epic (Live…)" do YouTube. Nos outros, nunca troca
      // a de estúdio por uma versão ao vivo, remix etc.
      const pool = live ? [...(byLive.get(k) || []), ...(byTitle.get(k) || [])] : byTitle.get(k) || [];
      const cands = pool.filter(t => !used.has(t.id) && (alt || live || !ALT_VERSION.test(trackNorm(t.title))));
      // prefere o vídeo do mesmo álbum (o nome exato antes das edições "Deluxe"/"Remastered"); no ao vivo, a versão ao vivo
      const rank = t => (t.album === e.rg.title ? 0 : musicNorm(t.album) === album ? 1 : 2) * 2 + (live && !/\blive\b/.test(trackNorm(t.title)) ? 1 : 0);
      const v = cands.sort((x, y) => rank(x) - rank(y) || (x.pub < y.pub ? -1 : 1))[0] || null;
      if (v) used.add(v.id);
      return { t: tr.title, id: v?.id || null, ms: tr.ms || 0, thumb: v?.thumb || '' };
    });
    const ok = items.filter(it => it.id);
    if (ok.length < items.length) missing.push({ rg: e.rg.id, titles: items.filter(it => !it.id).map(it => it.t) });
    releases.push({
      key: e.rg.id, rg: e.rg.id, title: e.rg.title,
      ...(searched && !searched.has(e.rg.id) && { pending: true }), // ainda não buscado no YouTube (limite do dia)
      section: sectionOf(e.rg.primary, e.rg.secondary),
      date: e.rg.date || e.date || '',
      cover: `${CAA_RG}${e.rg.id}/front-250`,
      thumb: ok[0]?.thumb || '',
      items: items.map(({ thumb, ...it }) => it),
      tracks: ok.map(it => it.id),
      titles: Object.fromEntries(ok.map(it => [it.id, it.t])),
    });
  }
  return { releases, missing };
}

/** Títulos agrupados em buscas ("A"|"B"|…), até ~180 caracteres cada. */
function orQueries(titles) {
  const out = [];
  let cur = [];
  for (const t of titles) {
    const q = `"${t.replace(/["|]/g, ' ').trim()}"`;
    if (cur.length && [...cur, q].join('|').length > 180) { out.push(cur.join('|')); cur = []; }
    cur.push(q);
  }
  if (cur.length) out.push(cur.join('|'));
  return out;
}
/** Uma busca no canal "Tema" (100 unidades do limite diário) + os detalhes das faixas novas (1 unidade por 50). */
async function searchTopic(topicId, q, known) {
  const data = await api('search', { part: 'snippet', channelId: topicId, type: 'video', q, maxResults: 50, fields: 'items(id/videoId,snippet/publishedAt)' });
  const ids = new Map();
  for (const it of data.items || []) if (it.id?.videoId && !known.has(it.id.videoId)) ids.set(it.id.videoId, it.snippet?.publishedAt || '');
  return ids.size ? fetchTrackDetails([...ids.keys()], topicId, ids) : [];
}

/** Dados guardados valem? (versão atual, montado por inteiro). Não vencem: só o "Atualizar" consulta de novo. */
function musicFresh(d) {
  return Boolean(d?.v === MUSIC_DATA_VERSION && d.releases?.length && !d.pendingUntil);
}

/** Título, álbum e data (descrição automática) de cada faixa: videos.list, 1 unidade por 50. */
async function fetchTrackDetails(list, topicId, pubs = new Map()) {
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
        thumb: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || '', pub: sn.publishedAt || pubs.get(v.id) || '' });
    }
  }
  return out;
}

/** Ordem das faixas: já vem da edição original do MusicBrainz. */
async function ensureAlbumOrder(artistId, rel) {
  return rel.order || rel.tracks;
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

/* ---------- Capas: baixadas uma vez, guardadas no aparelho e no Drive ----------
   O primeiro aparelho baixa cada capa (Cover Art Archive do MusicBrainz ou, sem ela, a imagem da faixa
   no YouTube, cortada no quadrado, sem as faixas pretas), reduz para 240 px e guarda no aparelho
   (IndexedDB). Depois envia para o Drive, um arquivo por artista (meutube-covers-<id>.json). Os outros
   aparelhos baixam esse arquivo; a capa aparece na hora, sem esperar a internet. */
const COVER_PX = 240;
const COVERS_META_KEY = 'meutube.musicCovers'; // { artista: versão das capas deste aparelho }
const musicCovers = new Map(); // `${artista}/${lançamento}` -> imagem (data:) ou '' (não deu para baixar)
let coversMeta = null;
let coverDB = null;
const coversMetaGet = () => (coversMeta ||= store.get(COVERS_META_KEY, {}));
const coverKey = (artistId, rel) => `${artistId}/${rel.key}`;

function openCoverDB() {
  if (!coverDB) {
    coverDB = new Promise(resolve => {
      try {
        const req = indexedDB.open('canais-music', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('covers');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return coverDB;
}
async function coverTx(mode, fn) {
  const db = await openCoverDB();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction('covers', mode);
      const out = fn(tx.objectStore('covers'));
      tx.oncomplete = () => resolve(out?.result ?? null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}
/** Carrega as capas guardadas neste aparelho (uma vez, ao abrir o app). */
const coversLoaded = (async () => {
  const db = await openCoverDB();
  if (!db) return;
  await new Promise(resolve => {
    try {
      const req = db.transaction('covers').objectStore('covers').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        musicCovers.set(c.key, c.value);
        c.continue();
      };
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
  // O app (app.js) pode ainda não ter terminado de carregar: espera a página ficar pronta.
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  if (musicCovers.size) renderMusicEverywhere();
})();
function saveCovers(entries) {
  for (const [k, v] of entries) musicCovers.set(k, v);
  return coverTx('readwrite', os => { for (const [k, v] of entries) os.put(v, k); });
}
/** Baixa uma imagem e devolve o quadrado de 240 px (data:image/jpeg). wide: banner (até 1280 px de largura). */
async function shrinkCover(url, { wide = false } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  if (wide) {
    const w = Math.min(1280, bmp.width);
    c.width = w;
    c.height = Math.round(bmp.height * (w / bmp.width));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  } else {
    const side = Math.min(bmp.width, bmp.height);
    c.width = c.height = Math.min(COVER_PX, side);
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height);
  }
  bmp.close?.();
  return c.toDataURL('image/jpeg', wide ? 0.8 : 0.82);
}
/** Banner do canal no formato largo (como no topo da página do canal no YouTube). */
const musicBannerUrl = a => (a?.banner && /^https:\/\//.test(a.banner) ? `${a.banner}=w1280-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj` : '');
const BANNER_KEY = '__banner';
const coversBusy = new Map();
/** Capas que faltam de um artista: primeiro confere o Drive; só baixa da internet o que não estiver lá. */
function ensureCovers(artistId) {
  if (coversBusy.has(artistId)) return coversBusy.get(artistId);
  const job = (async () => {
    await coversLoaded;
    const d = musicStore()[artistId];
    const a = musicArtist(artistId);
    const bannerRel = musicBannerUrl(a) ? { key: BANNER_KEY, wide: true, cover: musicBannerUrl(a) } : null;
    const missing = () => [...(d?.releases || []), ...(bannerRel ? [bannerRel] : [])].filter(r => !musicCovers.has(coverKey(artistId, r)));
    if (!missing().length) return;
    if (typeof Sync !== 'undefined' && Sync.enabled()) await Sync.run().catch(() => {}); // outro aparelho já baixou?
    const list = missing();
    if (!list.length || !musicArtist(artistId)) return;
    const queue = [...list];
    const got = [];
    const worker = async () => {
      for (let rel; (rel = queue.shift());) {
        let img = '';
        for (const src of [rel.cover, rel.thumb].filter(Boolean)) {
          try { img = await shrinkCover(src, { wide: rel.wide }); break; } catch { /* sem capa no MusicBrainz: tenta a do YouTube */ }
        }
        const k = coverKey(artistId, rel);
        got.push([k, img]);
        musicCovers.set(k, img);
        if (img) $$(`img[data-cover="${CSS.escape(k)}"]`).forEach(el => { el.src = img; el.removeAttribute('data-fallback'); el.removeAttribute('data-src'); });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    showPendingCovers();
    await saveCovers(got.filter(([, img]) => img)); // falha (sem internet etc.) não fica guardada: tenta de novo na próxima vez que abrir o app
    if (got.some(([, img]) => img)) {
      coversMetaGet()[artistId] = Date.now();
      store.set(COVERS_META_KEY, coversMeta);
      if (typeof Sync !== 'undefined') Sync.schedule(SYNC_QUICK_MS); // envia para o Drive
    }
  })().finally(() => { coversBusy.delete(artistId); showPendingCovers(); });
  coversBusy.set(artistId, job);
  return job;
}
/** Capas que ficaram esperando: a guardada, se houver; senão, direto da internet. */
function showPendingCovers() {
  $$('img[data-cover][data-src]').forEach(el => {
    const img = musicCovers.get(el.dataset.cover);
    el.src = img || el.dataset.src;
    if (img) el.removeAttribute('data-fallback');
    el.removeAttribute('data-src');
  });
}
/** Versões das capas por artista (vão no arquivo principal da sincronização). */
function coversIndex() {
  const out = {};
  for (const a of musicArtists()) if (coversMetaGet()[a.id]) out[a.id] = coversMetaGet()[a.id];
  return out;
}
/** Capas de um artista para o Drive: { lançamento: imagem }. */
function coversOf(artistId) {
  const out = {};
  for (const rel of [...(musicStore()[artistId]?.releases || []), { key: BANNER_KEY }]) {
    const img = musicCovers.get(coverKey(artistId, rel));
    if (img) out[rel.key] = img;
  }
  return out;
}
/** Capas vindas do Drive. */
async function applyCovers(artistId, rev, covers) {
  const entries = Object.entries(covers || {}).filter(([, img]) => typeof img === 'string' && img.startsWith('data:image/')).map(([k, img]) => [`${artistId}/${k}`, img]);
  await saveCovers(entries);
  coversMetaGet()[artistId] = rev;
  store.set(COVERS_META_KEY, coversMeta);
  for (const [k, img] of entries) $$(`img[data-cover="${CSS.escape(k)}"]`).forEach(el => { el.src = img; el.removeAttribute('data-fallback'); el.removeAttribute('data-src'); });
}
function removeCovers(artistId) {
  const keys = [...musicCovers.keys()].filter(k => k.startsWith(artistId + '/'));
  keys.forEach(k => musicCovers.delete(k));
  coverTx('readwrite', os => { keys.forEach(k => os.delete(k)); });
  delete coversMetaGet()[artistId];
  store.set(COVERS_META_KEY, coversMeta);
}

/* ---------- Telas ---------- */
function musicCoverHTML(rel, cls = 'mu-cover', artistId = musicRoute.artist) {
  const k = coverKey(artistId, rel);
  const saved = musicCovers.get(k);
  if (saved) return `<span class="${cls}"><img src="${saved}" alt="" decoding="async" data-cover="${esc(k)}"></span>`;
  const src = rel.cover || rel.thumb;
  if (!src) return `<span class="${cls}">${SF('music')}</span>`;
  // Ainda não guardada: a capa entra quando vier do Drive ou terminar de baixar (ensureCovers).
  // Se não der para guardar (ex.: sem IndexedDB), mostra direto da internet.
  const net = `${esc(src)}" ${rel.cover && rel.thumb ? `data-fallback="${esc(rel.thumb)}" ` : ''}`;
  return `<span class="${cls}"><img ${musicCovers.has(k) || !coversBusy.has(artistId) ? `src="${net}` : `data-src="${net}`}alt="" decoding="async" referrerpolicy="no-referrer" data-cover="${esc(k)}"></span>`;
}
const musicYear = rel => (rel.date || '').slice(0, 4);
const hhmm = t => (t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const offText = rel => (rel.pending ? 'Aguardando o YouTube' : 'Indisponível no YouTube');

function musicStatusText(a) {
  const d = musicStore()[a.id];
  if (musicBusy.has(a.id)) return 'Organizando os lançamentos…';
  if (d?.error && !d.releases?.length) return d.error;
  if (!d?.releases) return 'Ainda não organizado';
  const n = s => d.releases.filter(r => r.section === s).length;
  const tracks = d.releases.reduce((s, r) => s + r.tracks.length, 0); // só as que estão no YouTube
  const waiting = d.releases.filter(r => r.pending).length;
  const parts = [n('studio') && `${n('studio')} ${n('studio') === 1 ? 'álbum' : 'álbuns'}`, n('ep') && `${n('ep')} EP${n('ep') === 1 ? '' : 's'}`, n('single') && `${n('single')} single${n('single') === 1 ? '' : 's'}`].filter(Boolean);
  const wait = waiting ? ` · ${waiting} ${waiting === 1 ? 'álbum aguardando' : 'álbuns aguardando'} o YouTube: o limite diário de buscas acabou; continua sozinho depois das ${hhmm(d.pendingUntil)}` : '';
  return `${parts.join(' · ') || 'Lançamentos'} · ${intFmt.format(tracks)} ${tracks === 1 ? 'faixa' : 'faixas'}${wait}`;
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
      <button class="ci-remove" type="button" data-action="remove-music" data-id="${esc(a.id)}" aria-label="Remover ${esc(a.name)}" title="Remover">${SF('minus-c')}</button>
    </li>`).join('') : '<li class="channel-empty">Nenhum artista adicionado ainda.</li>';
}

/** Página do artista (seções) ou do álbum (faixas). */
function renderMusicView() {
  const box = $('#music-page');
  if (!box) return;
  if (!musicRoute.artist) { renderMusicArtists(box); return; }
  const a = musicArtist(musicRoute.artist);
  if (!a) {
    box.innerHTML = `<div class="empty-state">${SF('music')}<p>Artista não encontrado. <a href="#/settings/musicas">Adicionar artistas</a></p></div>`;
    document.title = 'Músicas · Canais';
    return;
  }
  if (a.banner === undefined) ensureMusicBanner(a); // artistas adicionados antes da 1.35.0
  const d = musicStore()[a.id];
  refreshMusicArtist(a).catch(() => {}); // só busca se os dados venceram (e não logo depois de um erro)
  ensureCovers(a.id).catch(() => {}); // capas e banner: aparelho → Drive → internet
  if (musicRoute.album) { renderMusicAlbum(box, a, d); return; }
  document.title = `${a.name} · Músicas · Canais`;
  const bannerSaved = musicCovers.get(coverKey(a.id, { key: BANNER_KEY }));
  const bannerSrc = bannerSaved; // sem cópia guardada: espera o Drive (ensureCovers) e só então a internet
  const busy = musicBusy.has(a.id);
  const head = `
    ${musicBannerUrl(a) ? `<div class="cb-banner mu-banner">${bannerSrc ? `<img src="${esc(bannerSrc)}" alt="" referrerpolicy="no-referrer" data-hide-broken data-cover="${esc(coverKey(a.id, { key: BANNER_KEY }))}">`
      : `<img data-src="${esc(musicBannerUrl(a))}" alt="" referrerpolicy="no-referrer" data-hide-broken data-cover="${esc(coverKey(a.id, { key: BANNER_KEY }))}">`}</div>` : ''}
    <header class="mu-head">
      <img class="mu-avatar" src="${esc(a.thumb || '')}" alt="" referrerpolicy="no-referrer" data-hide-broken>
      <div class="mu-head-text"><span class="eyebrow">Músicas</span><h1 class="t-large">${esc(a.name)}</h1><p class="mu-sub">${esc(musicStatusText(a))}</p></div>
      <button class="btn btn-fill mu-refresh" type="button" data-action="refresh-music" data-id="${esc(a.id)}" title="Buscar lançamentos novos"${busy ? ' disabled' : ''}>${SF('sync')}${busy ? 'Atualizando…' : 'Atualizar'}</button>
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
          <a class="mu-card${r.tracks.length ? '' : ' is-off'}" href="#/music/${esc(a.id)}/${esc(r.key)}" style="--i:${Math.min(i, 12)}">
            ${musicCoverHTML(r)}
            <strong class="mu-title" title="${esc(r.title)}">${esc(r.title)}</strong>
            <span class="mu-year">${esc(musicYear(r) || '—')}${r.tracks.length ? '' : ` · ${offText(r)}`}</span>
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
  const ids = rel.tracks;
  const items = rel.items || ids.map(id => ({ t: rel.titles?.[id], id, ms: 0 }));
  const mmss = ms => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '');
  const rowHTML = (it, i) => {
    const v = it.id ? musicVideos.get(it.id) : null;
    if (!it.id) return `
    <div class="mu-track is-off" title="${rel.pending ? 'Ainda não buscada: o limite diário de buscas do YouTube acabou' : 'Esta faixa não está no YouTube'}">
      <span class="mu-num">${i + 1}</span>
      <span class="mu-track-title">${esc(it.t || '')}</span>
      <span class="mu-views">${offText(rel)}</span>
      <span class="mu-dur">${esc(mmss(it.ms))}</span>
    </div>`;
    return `
    <a class="mu-track" href="${musicTrackHref(it.id, a.id, rel.key)}" data-vid="${esc(it.id)}">
      <span class="mu-num">${i + 1}</span>
      <span class="mu-play">${SF('yt-play')}</span>
      <span class="mu-track-title">${esc(it.t || v?.title || '…')}</span>
      <span class="mu-views">${v?.views != null ? esc(fmtViews(v.views)) : ''}</span>
      <span class="mu-dur">${v?.duration ? esc(v.duration) : esc(mmss(it.ms))}</span>
    </a>`;
  };
  const vids = ids.map(id => musicVideos.get(id));
  const total = items.reduce((s, it) => s + ((it.id && musicVideos.get(it.id)?.durationSec) || Math.round((it.ms || 0) / 1000)), 0);
  const off = items.length - ids.length;
  const meta = [MUSIC_TYPE_LABEL[rel.section], musicYear(rel), `${items.length} ${items.length === 1 ? 'música' : 'músicas'}`, total ? fmtHours(total) : '', off ? (rel.pending ? `aguardando o YouTube (continua depois das ${hhmm(d?.pendingUntil)})` : ids.length ? `${off} ${off === 1 ? 'indisponível' : 'indisponíveis'} no YouTube` : 'indisponível no YouTube') : ''].filter(Boolean).join(' · ');
  box.innerHTML = `
    <a class="back-link mu-back" href="#/music/${esc(a.id)}">${SF('chev-l')}${esc(a.name)}</a>
    <header class="mu-album-head">
      ${musicCoverHTML(rel, 'mu-cover mu-cover-lg')}
      <div class="mu-album-text">
        <span class="eyebrow">${esc(MUSIC_TYPE_LABEL[rel.section])}${ids.length ? '' : ` · ${offText(rel)}`}</span>
        <h1 class="t-large">${esc(rel.title)}</h1>
        <p class="mu-sub"><a href="#/music/${esc(a.id)}">${esc(a.name)}</a> · ${esc(meta.replace(`${MUSIC_TYPE_LABEL[rel.section]} · `, ''))}</p>
        ${ids.length ? `<a class="btn btn-tint mu-play-all" href="${musicTrackHref(ids[0], a.id, rel.key)}">${SF('yt-play')}Tocar</a>` : ''}
      </div>
    </header>
    <div class="mu-tracks" id="mu-tracks">${items.map(rowHTML).join('')}</div>`;
  // Duração e visualizações (YouTube): busca e redesenha.
  const key = rel.key;
  const here = () => state.view === 'music' && musicRoute.artist === a.id && musicRoute.album === key;
  ensureMusicVideos(ids).then(() => { if (here() && ids.some((id, i) => !vids[i] && musicVideos.has(id))) renderMusicView(); }).catch(() => {});
}

/** Página "Músicas" (aba do celular, #/music): os artistas. */
function renderMusicArtists(box) {
  document.title = 'Músicas · Canais';
  const list = [...musicArtists()].sort((a, b) => byName(a.name, b.name));
  box.innerHTML = `
    <header class="mu-list-head"><h1 class="t-large">Músicas</h1>
      <a class="btn btn-tint" href="#/settings/musicas">${SF('plus')}Adicionar artista</a></header>
    ${list.length ? `<div class="mu-artists">${list.map(a => `
      <a class="mu-artist" href="#/music/${esc(a.id)}"><img src="${esc(a.thumb || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" data-hide-broken><span>${esc(a.name)}</span></a>`).join('')}</div>`
      : '<p class="muted">Adicione artistas pelo link da aba “Lançamentos” do YouTube (https://www.youtube.com/@banda/releases).</p>'}`;
}
/** Os artistas saíram da página Canais (agora têm a aba Músicas). */
function renderMusicOnChannelsPage() {
  const box = $('#channels-music');
  if (box) box.innerHTML = '';
}
/** Banner dos artistas adicionados antes da 1.35.0: uma consulta (1 unidade), depois fica salvo. */
const bannerAsked = new Set();
function ensureMusicBanner(a) {
  if (bannerAsked.has(a.id)) return;
  bannerAsked.add(a.id);
  api('channels', { part: 'brandingSettings', id: a.id }).then(r => {
    const rec = musicArtist(a.id);
    if (!rec) return;
    rec.banner = r.items?.[0]?.brandingSettings?.image?.bannerExternalUrl || '';
    saveMusicList();
    if (rec.banner) ensureCovers(a.id).finally(() => { if (state.view === 'music') renderMusicView(); });
  }).catch(() => {});
}

function renderMusicEverywhere() {
  renderMusicSidebar();
  renderMusicSettings();
  if (state.view === 'music') renderMusicView();
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
