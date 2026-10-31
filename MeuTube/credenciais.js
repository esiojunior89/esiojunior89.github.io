'use strict';
/* =========================================================
   Credenciais do Canais (página protegida) — o código da página
   =========================================================
   Fica num arquivo separado (e não dentro do credenciais.html)
   por causa da política de segurança da página, que não deixa
   rodar código escrito dentro do HTML.
   ========================================================= */

// Não funciona dentro de outro site (moldura/iframe): evita "clickjacking".
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  throw new Error('Esta página não pode ser aberta dentro de outro site.');
}

const KEYS = { config: 'meutube.config', sync: 'meutube.sync', authSession: 'meutube.authSession' };
// "Impressão digital" de usuário + senha (PBKDF2-SHA256). Para trocar a senha, gere um novo valor.
const ACCESS = {
  salt: '8c2e4b2bd369213f07640a0381938f59',
  iterations: 310000,
  hash: '9941ce23427d44bbf2d6ead693e6b1f01a8d4d54de8e0269c5aaf9c88dc910cf',
};
const $ = sel => document.querySelector(sel);
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento indisponível */ }
  },
};
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16));

async function checkAccess(user, pass) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${user}\n${pass}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(ACCESS.salt), iterations: ACCESS.iterations }, key, 256);
  return hex(bits) === ACCESS.hash;
}

/* ---------- Entrada (pedida sempre; nada é guardado) ---------- */
let failures = 0;
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const user = $('#login-user').value.trim();
  const pass = $('#login-pass').value;
  const btn = $('#login-btn');
  const error = $('#login-error');
  btn.disabled = true;
  btn.textContent = 'Verificando…';
  error.hidden = true;
  const ok = await checkAccess(user, pass).catch(() => false);
  $('#login-pass').value = '';
  if (ok) {
    $('#login-user').value = '';
    // O cartão de login se transforma no painel (transição suave, quando o navegador permite).
    const swap = () => {
      $('#cred-login').hidden = true;
      $('#cred-panel').hidden = false;
      fillForm();
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $('#cred-panel').style.animation = 'none';
      document.startViewTransition(swap);
    } else {
      swap();
    }
    return;
  }
  // Errou: espera um pouco mais a cada tentativa.
  failures++;
  const wait = Math.min(30, failures * 2);
  error.textContent = `Usuário ou senha incorretos. Tente de novo em ${wait} s.`;
  error.hidden = false;
  // O cartão "balança", como uma senha errada no iPhone.
  const card = $('#cred-login');
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
  btn.textContent = 'Continuar';
  setTimeout(() => { btn.disabled = false; $('#login-pass').focus(); }, wait * 1000);
});

// Bloquear, voltar com o botão do navegador ou reabrir a aba: pede usuário e senha de novo.
$('#lock-btn').addEventListener('click', () => location.reload());
addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

/* ---------- Credenciais ---------- */
function currentConfig() {
  return { ...DEFAULT_CONFIG, ...store.get(KEYS.config, {}) };
}

function fillForm() {
  const c = currentConfig();
  $('#cfg-api-key').value = c.apiKey || '';
  $('#cfg-client-id').value = c.clientId || '';
  $('#cfg-login-server').value = c.loginServer || '';
  $('#cfg-api-key').focus();
}

$('#config-form').addEventListener('submit', e => {
  e.preventDefault();
  const msg = $('#save-msg');
  const apiKey = $('#cfg-api-key').value.trim();
  const clientId = $('#cfg-client-id').value.trim();
  const loginServer = $('#cfg-login-server').value.trim().replace(/\/+$/, '');
  if (loginServer && !/^https:\/\/[^\s/]+$/.test(loginServer)) {
    msg.textContent = 'O servidor de login deve ser um endereço https://, como https://meutube-login.seunome.workers.dev';
    msg.className = 'error';
    return;
  }
  const before = currentConfig();
  // Chave de API alterada: marca a alteração para a sincronização levá-la aos outros aparelhos.
  // (Antes de salvar a configuração: o app aberto em outra aba reage ao salvamento e já lê esta marca.)
  if (apiKey !== before.apiKey) {
    const sync = store.get(KEYS.sync, {});
    store.set(KEYS.sync, { ...sync, at: { ...(sync.at || {}), apiKey: Date.now() } });
  }
  // Servidor de login trocado: a renovação automática era do servidor antigo.
  if (loginServer !== (before.loginServer || '')) {
    try { localStorage.removeItem(KEYS.authSession); } catch { /* ignora */ }
  }
  store.set(KEYS.config, { ...store.get(KEYS.config, {}), apiKey, clientId, loginServer });
  msg.textContent = 'Credenciais salvas. O Canais já está usando os novos valores.';
  msg.className = 'muted';
});

$('#login-user').focus();
