/* =========================================================
   Canais — temas
   ---------------------------------------------------------
   Carregado no <head>, antes de tudo, para a página já abrir
   no tema certo (sem piscar). Na primeira vez segue o aparelho
   (claro ou escuro); depois que a pessoa escolhe um tema em
   Ajustes, ele fica guardado neste aparelho e o app sempre abre
   nele, até ela trocar.

   Temas: Escuro, Claro e três temas com tons Pantone (Verde,
   Azul e Vermelho), que misturam tons escuros e claros da mesma
   cor, com degradês e linhas artísticas bem suaves no fundo.
   ========================================================= */
(function () {
  'use strict';
  var KEY = 'meutube.theme';
  // nome -> [esquema base, cor da barra do navegador]
  var THEMES = {
    dark:  ['dark',  '#101820'], // PANTONE Black 6 C
    light: ['light', '#F0EEE9'], // PANTONE 11-4201 Cloud Dancer
    green: ['dark',  '#22372B'], // PANTONE 5605 C
    blue:  ['dark',  '#0C2340'], // PANTONE 289 C
    red:   ['dark',  '#3F2021']  // PANTONE 4975 C
  };
  var NAMES = { dark: 'Escuro', light: 'Claro', green: 'Verde', blue: 'Azul', red: 'Vermelho' };
  var PANTONE = { green: 1, blue: 1, red: 1 };
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try { var t = localStorage.getItem(KEY); return THEMES[t] ? t : null; } catch (e) { return null; }
  }
  function systemTheme() { return mq && mq.matches ? 'dark' : 'light'; }
  function resolve() { return saved() || systemTheme(); }

  function paintMeta(name) {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', THEMES[name][1]);
  }

  function apply(name) {
    if (!THEMES[name]) name = 'light';
    root.setAttribute('data-theme', name);
    root.setAttribute('data-scheme', THEMES[name][0]);
    if (PANTONE[name]) root.setAttribute('data-pantone', ''); else root.removeAttribute('data-pantone');
    paintMeta(name);
    if (document.body) mountArt(name);
    try { window.dispatchEvent(new CustomEvent('canais:theme', { detail: { theme: name } })); } catch (e) {}
  }

  /* Troca de tema escolhida pela pessoa: guarda e aplica com uma transição
     circular que nasce do botão tocado (quando o navegador permite). */
  function set(name, origin) {
    if (!THEMES[name]) return;
    try { localStorage.setItem(KEY, name); } catch (e) {}
    if (name === root.getAttribute('data-theme')) { apply(name); return; }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce || document.hidden) { apply(name); return; }
    var x = origin && origin.x != null ? origin.x : innerWidth / 2;
    var y = origin && origin.y != null ? origin.y : innerHeight / 2;
    var r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('theme-switching');
    var vt;
    try { vt = document.startViewTransition(function () { apply(name); }); } catch (e) { root.classList.remove('theme-switching'); apply(name); return; }
    vt.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 700, easing: 'cubic-bezier(.16, 1, .3, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(function () {});
    vt.finished.then(done, done);
    function done() { root.classList.remove('theme-switching'); }
  }

  /* =======================================================
     Linhas artísticas (só nos temas Pantone)
     Desenhos de traço fino, gerados aqui mesmo, sempre iguais
     para cada tema: Verde = ramos e folhas; Azul = ondas e
     correntes; Vermelho = flores e fitas.
     ======================================================= */
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function f(n) { return Math.round(n * 10) / 10; }
  function P(x, y) { return f(x) + ' ' + f(y); }
  // Curva suave passando por todos os pontos (Catmull-Rom -> Bézier)
  function smooth(pts, closed) {
    if (pts.length < 2) return '';
    var d = 'M' + P(pts[0][0], pts[0][1]);
    var n = pts.length;
    for (var i = 0; i < (closed ? n : n - 1); i++) {
      var p0 = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)];
      var p1 = pts[i];
      var p2 = pts[(i + 1) % n];
      var p3 = pts[closed ? (i + 2) % n : Math.min(i + 2, n - 1)];
      d += 'C' + P(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
        P(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6) + ' ' + P(p2[0], p2[1]);
    }
    return d + (closed ? 'Z' : '');
  }
  function cubicAt(a, b, c, d, t) {
    var u = 1 - t;
    return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
  }
  function cubicTan(a, b, c, d, t) {
    var u = 1 - t;
    var x = 3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]);
    var y = 3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]);
    var l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }
  function cubic(a, b, c, d) { return 'M' + P(a[0], a[1]) + 'C' + P(b[0], b[1]) + ' ' + P(c[0], c[1]) + ' ' + P(d[0], d[1]); }

  function Pen(seed) {
    this.r = rng(seed);
    this.out = [];
  }
  Pen.prototype.rand = function (a, b) { return a + (b - a) * this.r(); };
  Pen.prototype.path = function (d, w, o) {
    this.out.push('<path d="' + d + '" stroke-width="' + f(w || 1) + '"' + (o != null && o < 1 ? ' stroke-opacity="' + f(o) + '"' : '') + '/>');
  };
  Pen.prototype.circle = function (x, y, r, w, o) {
    this.out.push('<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(r) + '" stroke-width="' + f(w || 1) + '"' + (o != null && o < 1 ? ' stroke-opacity="' + f(o) + '"' : '') + '/>');
  };

  // Folha: duas curvas e a nervura central
  Pen.prototype.leaf = function (p, ang, L, W, w) {
    var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    var bend = this.rand(-.18, .18);
    var tip = [p[0] + dx * L + nx * L * bend, p[1] + dy * L + ny * L * bend];
    var a1 = [p[0] + dx * L * .3 + nx * W, p[1] + dy * L * .3 + ny * W];
    var a2 = [p[0] + dx * L * .78 + nx * W * .55 + nx * L * bend, p[1] + dy * L * .78 + ny * W * .55 + ny * L * bend];
    var b2 = [p[0] + dx * L * .78 - nx * W * .55 + nx * L * bend, p[1] + dy * L * .78 - ny * W * .55 + ny * L * bend];
    var b1 = [p[0] + dx * L * .3 - nx * W, p[1] + dy * L * .3 - ny * W];
    this.path('M' + P(p[0], p[1]) + 'C' + P(a1[0], a1[1]) + ' ' + P(a2[0], a2[1]) + ' ' + P(tip[0], tip[1]) +
      'C' + P(b2[0], b2[1]) + ' ' + P(b1[0], b1[1]) + ' ' + P(p[0], p[1]), w);
    var m = [p[0] + dx * L * .5 + nx * L * bend * .6, p[1] + dy * L * .5 + ny * L * bend * .6];
    this.path('M' + P(p[0], p[1]) + 'Q' + P(m[0], m[1]) + ' ' + P(p[0] + (tip[0] - p[0]) * .86, p[1] + (tip[1] - p[1]) * .86), (w || 1) * .7, .8);
  };

  // Ramo: caule curvo com folhas alternadas e, às vezes, botões na ponta
  Pen.prototype.branch = function (a, b, c, d, opt) {
    opt = opt || {};
    this.path(cubic(a, b, c, d), opt.w || 1.2);
    var count = opt.leaves || 7, size = opt.size || 34;
    for (var i = 1; i <= count; i++) {
      var t = i / (count + 1) * .92 + .06;
      var p = cubicAt(a, b, c, d, t), tg = cubicTan(a, b, c, d, t);
      var side = i % 2 ? 1 : -1;
      var ang = Math.atan2(tg[1], tg[0]) + side * this.rand(.55, .95);
      var L = size * (1 - t * .45) * this.rand(.8, 1.15);
      this.leaf(p, ang, L, L * this.rand(.26, .36), (opt.w || 1.2) * .8);
    }
    if (opt.buds) {
      var tg2 = cubicTan(a, b, c, d, 1), base = Math.atan2(tg2[1], tg2[0]);
      for (var k = 0; k < opt.buds; k++) {
        var ang2 = base + this.rand(-.9, .9), len = this.rand(10, 22);
        var e = [d[0] + Math.cos(ang2) * len, d[1] + Math.sin(ang2) * len];
        this.path('M' + P(d[0], d[1]) + 'Q' + P((d[0] + e[0]) / 2 + this.rand(-4, 4), (d[1] + e[1]) / 2 + this.rand(-4, 4)) + ' ' + P(e[0], e[1]), .7);
        this.circle(e[0], e[1], this.rand(1.6, 3), .7);
      }
    }
  };

  // Samambaia: haste com muitos folíolos que diminuem até a ponta
  Pen.prototype.fern = function (a, b, c, d, n, size) {
    this.path(cubic(a, b, c, d), .9);
    for (var i = 2; i < n; i++) {
      var t = i / n, p = cubicAt(a, b, c, d, t), tg = cubicTan(a, b, c, d, t), base = Math.atan2(tg[1], tg[0]);
      var L = size * (1 - t * .8);
      this.leaf(p, base + 1.05, L, L * .22, .6);
      this.leaf(p, base - 1.05, L, L * .22, .6);
    }
  };

  // Feixe de fios soltos, como cabelos ao vento (linhas que acompanham uma mesma direção)
  Pen.prototype.strands = function (a, b, c, d, n, spread) {
    for (var i = 0; i < n; i++) {
      var k = (i - (n - 1) / 2) * spread, j = this.rand(-1, 1) * spread * 1.6;
      var tg = [d[1] - a[1], a[0] - d[0]], l = Math.hypot(tg[0], tg[1]) || 1;
      var nx = tg[0] / l, ny = tg[1] / l;
      this.path(cubic(
        [a[0] + nx * k * .3, a[1] + ny * k * .3],
        [b[0] + nx * (k + j), b[1] + ny * (k + j)],
        [c[0] + nx * (k * 1.6 - j), c[1] + ny * (k * 1.6 - j)],
        [d[0] + nx * k * 2.2 + this.rand(-8, 8), d[1] + ny * k * 2.2 + this.rand(-8, 8)]
      ), this.rand(.5, 1.1), this.rand(.55, 1));
    }
  };

  // Ondas: linhas paralelas que se afastam aos poucos, como curvas de nível ou correnteza
  Pen.prototype.waves = function (pts, n, gap, wobble) {
    for (var i = 0; i < n; i++) {
      var off = i * gap, line = [];
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j], q = pts[Math.min(j + 1, pts.length - 1)], o = pts[Math.max(j - 1, 0)];
        var tx = q[0] - o[0], ty = q[1] - o[1], l = Math.hypot(tx, ty) || 1;
        var amp = off * (1 + Math.sin(j * 1.7 + i) * wobble);
        line.push([p[0] - ty / l * amp, p[1] + tx / l * amp]);
      }
      this.path(smooth(line), i % 3 === 0 ? 1.1 : .7, 1 - i / (n * 1.6));
    }
  };

  // Espiral: crista de onda que se enrola
  Pen.prototype.spiral = function (cx, cy, r, turns, dir, start) {
    var pts = [], steps = Math.round(turns * 18);
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, ang = start + dir * t * turns * Math.PI * 2, rr = r * (1 - t * .92) * (1 + Math.sin(i * .9) * .015);
      pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
    }
    this.path(smooth(pts), .9);
  };

  // Flor: camadas de pétalas com veios finos saindo do miolo
  Pen.prototype.flower = function (cx, cy, R, opt) {
    opt = opt || {};
    var layers = opt.layers || 3, rot = this.rand(0, Math.PI * 2);
    for (var l = 0; l < layers; l++) {
      var Rl = R * (1 - l * .27), n = (opt.petals || 6) - (l > 1 ? 1 : 0), off = rot + l * .45;
      for (var i = 0; i < n; i++) {
        var ang = off + i / n * Math.PI * 2 + this.rand(-.12, .12);
        var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
        var len = Rl * this.rand(.85, 1.08), wid = len * this.rand(.42, .55);
        var base = [cx + dx * R * .07, cy + dy * R * .07];
        var tip = [cx + dx * len, cy + dy * len];
        var notch = this.rand(.04, .1) * len;
        this.path('M' + P(base[0], base[1]) +
          'C' + P(base[0] + dx * len * .25 + nx * wid, base[1] + dy * len * .25 + ny * wid) + ' ' +
          P(tip[0] + nx * wid * .7 - dx * notch * 2, tip[1] + ny * wid * .7 - dy * notch * 2) + ' ' +
          P(tip[0] + nx * wid * .18, tip[1] + ny * wid * .18) +
          'Q' + P(tip[0] - dx * notch, tip[1] - dy * notch) + ' ' + P(tip[0] - nx * wid * .18, tip[1] - ny * wid * .18) +
          'C' + P(tip[0] - nx * wid * .7 - dx * notch * 2, tip[1] - ny * wid * .7 - dy * notch * 2) + ' ' +
          P(base[0] + dx * len * .25 - nx * wid, base[1] + dy * len * .25 - ny * wid) + ' ' + P(base[0], base[1]), l === 0 ? 1 : .85);
        if (l === 0 || this.r() < .5) {
          var veins = l === 0 ? 3 : 2;
          for (var v = 0; v < veins; v++) {
            var s = (v - (veins - 1) / 2) * .32;
            var e = [cx + dx * len * .8 + nx * wid * s, cy + dy * len * .8 + ny * wid * s];
            this.path('M' + P(base[0], base[1]) + 'Q' + P(cx + dx * len * .45 + nx * wid * s * .9, cy + dy * len * .45 + ny * wid * s * .9) + ' ' + P(e[0], e[1]), .5, .7);
          }
        }
      }
    }
    for (var k = 0; k < (opt.stamens || 7); k++) {
      var a2 = this.rand(0, Math.PI * 2), r2 = R * this.rand(.12, .22);
      this.path('M' + P(cx, cy) + 'L' + P(cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2), .6);
      this.circle(cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2, 1.4, .6);
    }
  };

  function svg(pen, w, h, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + pen.out.join('') + '</svg>';
  }

  /* Cada desenho é feito para um canto de 600×600 (ou para o menu lateral, 260×340).
     "corner": de onde os traços nascem. */
  var ART = {
    green: {
      corner: function (seed, corner) {
        var p = new Pen(seed), m = mirror(corner, 600, 600);
        p.branch(m([640, -30]), m([470, 20]), m([560, 200]), m([330, 250]), { leaves: 9, size: 46, buds: 3 });
        p.branch(m([620, 120]), m([500, 170]), m([600, 300]), m([450, 380]), { leaves: 6, size: 36, buds: 2 });
        p.fern(m([610, 20]), m([560, 90]), m([450, 10]), m([370, 100]), 16, 30);
        p.strands(m([600, 230]), m([470, 250]), m([560, 380]), m([380, 480]), 6, 5);
        p.strands(m([370, -10]), m([330, 70]), m([240, 10]), m([160, 40]), 4, 4);
        p.leaf(m([300, 280]), angle(corner, 2.4), 40, 13, .8);
        p.leaf(m([250, 120]), angle(corner, 2.9), 30, 9, .7);
        return svg(p, 600, 600, 'art art-' + corner);
      },
      side: function (seed) {
        var p = new Pen(seed);
        p.branch([30, 360], [80, 280], [-10, 220], [70, 140], { leaves: 8, size: 30, buds: 3 });
        p.branch([150, 360], [130, 300], [250, 280], [210, 200], { leaves: 5, size: 26, buds: 2 });
        p.fern([270, 330], [240, 290], [190, 260], [140, 250], 12, 20);
        p.strands([0, 300], [60, 260], [140, 320], [260, 290], 5, 4);
        return svg(p, 260, 340, 'art art-side');
      }
    },
    blue: {
      corner: function (seed, corner) {
        var p = new Pen(seed), m = mirror(corner, 600, 600);
        p.waves([m([620, 330]), m([520, 300]), m([470, 210]), m([380, 160]), m([300, 60]), m([280, -20])], 9, 11, .35);
        p.waves([m([620, 520]), m([540, 470]), m([470, 470]), m([420, 400]), m([330, 380])], 5, 9, .5);
        var c = m([430, 250]), c2 = m([520, 120]);
        p.spiral(c[0], c[1], 44, 2.2, corner === 'tr' || corner === 'bl' ? 1 : -1, 0);
        p.spiral(c2[0], c2[1], 24, 1.8, corner === 'tr' || corner === 'bl' ? -1 : 1, 2);
        p.strands(m([600, 40]), m([500, 80]), m([380, 0]), m([250, 30]), 5, 4);
        for (var i = 0; i < 9; i++) { var b = m([p.rand(300, 590), p.rand(260, 560)]); p.circle(b[0], b[1], p.rand(1.5, 5), .6, .8); }
        return svg(p, 600, 600, 'art art-' + corner);
      },
      side: function (seed) {
        var p = new Pen(seed);
        p.waves([[-10, 250], [60, 230], [120, 270], [190, 240], [270, 260]], 8, 10, .4);
        p.spiral(200, 180, 28, 2, 1, 0);
        p.waves([[-10, 150], [70, 170], [140, 130], [200, 150]], 4, 8, .5);
        for (var i = 0; i < 6; i++) p.circle(p.rand(20, 240), p.rand(60, 200), p.rand(1.5, 4), .6, .8);
        return svg(p, 260, 340, 'art art-side');
      }
    },
    red: {
      corner: function (seed, corner) {
        var p = new Pen(seed), m = mirror(corner, 600, 600);
        var f1 = m([500, 110]), f2 = m([330, 60]);
        p.flower(f1[0], f1[1], 92, { layers: 3, petals: 6 });
        p.flower(f2[0], f2[1], 40, { layers: 2, petals: 5, stamens: 5 });
        p.branch(m([480, 200]), m([460, 280]), m([400, 330]), m([320, 380]), { leaves: 5, size: 34 });
        p.strands(m([610, 260]), m([540, 300]), m([520, 420]), m([430, 560]), 6, 5);
        p.strands(m([250, -10]), m([220, 60]), m([150, 90]), m([60, 70]), 4, 4);
        p.leaf(m([380, 160]), angle(corner, 2.6), 36, 12, .8);
        return svg(p, 600, 600, 'art art-' + corner);
      },
      side: function (seed) {
        var p = new Pen(seed);
        p.flower(70, 250, 50, { layers: 3, petals: 6 });
        p.flower(200, 300, 26, { layers: 2, petals: 5, stamens: 4 });
        p.branch([90, 300], [130, 250], [170, 200], [230, 170], { leaves: 5, size: 22, buds: 2 });
        p.strands([0, 180], [60, 150], [150, 210], [270, 200], 4, 4);
        return svg(p, 260, 340, 'art art-side');
      }
    }
  };
  // Espelha um desenho feito para o canto superior direito para qualquer outro canto
  function mirror(corner, w, h) {
    var fx = corner === 'tl' || corner === 'bl', fy = corner === 'bl' || corner === 'br';
    return function (pt) { return [fx ? w - pt[0] : pt[0], fy ? h - pt[1] : pt[1]]; };
  }
  function angle(corner, a) {
    var fx = corner === 'tl' || corner === 'bl', fy = corner === 'bl' || corner === 'br';
    var x = Math.cos(a), y = Math.sin(a);
    return Math.atan2(fy ? -y : y, fx ? -x : x);
  }

  var SEEDS = { green: 11, blue: 23, red: 37 };
  var cache = {};
  function artFor(name) {
    if (cache[name]) return cache[name];
    var A = ART[name], s = SEEDS[name];
    cache[name] = {
      page: A.corner(s, 'tr') + A.corner(s + 1, 'bl') + A.corner(s + 2, 'br') + A.corner(s + 3, 'tl'),
      side: A.side(s + 4)
    };
    return cache[name];
  }

  /* Coloca as camadas de arte na página (fundo fixo e menu lateral). Nos temas
     Escuro e Claro elas são removidas: esses temas são lisos. */
  var mounted = null;
  function mountArt(name) {
    if (mounted === name) return;
    // Só nas páginas que usam o styles.css do app (a página de Novidades tem estilo próprio)
    if (!document.querySelector('link[rel="stylesheet"][href^="styles.css"]')) return;
    mounted = name;
    var layer = document.getElementById('theme-art');
    var side = document.getElementById('side-art');
    if (!PANTONE[name]) {
      if (layer) layer.remove();
      if (side) side.remove();
      return;
    }
    var art = artFor(name);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'theme-art';
      layer.className = 'theme-art';
      layer.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(layer, document.body.firstChild);
    }
    layer.innerHTML = art.page;
    var bar = document.getElementById('sidebar');
    if (bar) {
      if (!side) {
        side = document.createElement('div');
        side.id = 'side-art';
        side.className = 'side-art';
        side.setAttribute('aria-hidden', 'true');
        bar.appendChild(side);
      }
      side.innerHTML = art.side;
    }
  }

  apply(resolve());
  if (!document.body) document.addEventListener('DOMContentLoaded', function () { mounted = null; apply(root.getAttribute('data-theme')); });
  // Enquanto a pessoa não escolhe um tema, acompanha o aparelho.
  if (mq) {
    var follow = function () { if (!saved()) apply(systemTheme()); };
    if (mq.addEventListener) mq.addEventListener('change', follow); else if (mq.addListener) mq.addListener(follow);
  }
  // Outra aba trocou o tema: acompanha.
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(resolve()); });

  window.CanaisTheme = {
    get: function () { return root.getAttribute('data-theme'); },
    set: set,
    saved: saved,
    names: NAMES,
    isPantone: function (n) { return !!PANTONE[n || root.getAttribute('data-theme')]; }
  };
})();
