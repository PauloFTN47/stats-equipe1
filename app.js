(function () {
  'use strict';

  var API = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  var SIM = /[?&]simulation=1/.test(window.location.search);   // ?simulation=1 : vérifie tout, n'écrit rien
  var K = { key: 'stats.key', init: 'stats.init', session: 'stats.session', queue: 'stats.queue', recent: 'stats.recent', hint: 'stats.hint', space: 'stats.space', cal: 'stats.cal' };
  var OTHER = '__autre__';   // valeur de l'option « Autre parcours »
  var TYPES = { 1: 'Compétition', 2: 'Tour annoncé', 3: 'Entraînement (non compté)' };
  var state = { data: null, session: null, armed: false, flushing: false, calFilter: 'all' };

  function $(id) { return document.getElementById(id); }
  function load(k, fallback) { try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  function drop(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  /* ---------- Clé du lien ---------- */

  // Le lien envoyé par le capitaine finit par #k=XXXXXXXX. La clé reste sur l'appareil et part avec chaque requête.
  function getKey() {
    var m = /[#?&]k=([A-Za-z0-9_-]{4,64})/.exec(window.location.hash + window.location.search);
    if (m) { save(K.key, m[1]); return m[1]; }
    return load(K.key, '');
  }

  /* ---------- Réseau ---------- */

  class NetError extends Error {}

  async function request(url, options) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 25000);
    try {
      var res = await fetch(url, Object.assign({ signal: ctrl.signal }, options || {}));
      return await res.json();
    } catch (e) {
      throw new NetError((e && e.message) || 'réseau indisponible');
    } finally {
      clearTimeout(timer);
    }
  }

  async function post(body) {
    var res = await request(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: getKey() }, body)) });
    if (res && res.error && res.error.code === 'KEY') drop(K.key);        // clé refusée : elle sera redemandée au prochain démarrage
    return res;
  }

  /* ---------- Affichage ---------- */

  function show(screen) {
    ['loading', 'key', 'login', 'app'].forEach(function (s) { $('screen-' + s).hidden = s !== screen; });
  }

  function setMsg(id, text, kind) {
    var m = $(id);
    m.textContent = text;
    m.className = 'msg ' + kind;
    m.hidden = false;
  }
  function hideMsg(id) { $(id).hidden = true; }

  function fill(sel, items, placeholder) {
    sel.innerHTML = '';
    var o = document.createElement('option');
    o.value = ''; o.textContent = placeholder;
    sel.appendChild(o);
    items.forEach(function (v) {
      var op = document.createElement('option');
      var isObj = v && typeof v === 'object';
      op.value = isObj ? v.value : v; op.textContent = isObj ? v.label : v;
      sel.appendChild(op);
    });
  }

  function signed(x) {
    var r = Math.round(x * 10) / 10;
    var s = Math.abs(r).toFixed(1).replace('.', ',');
    return r > 0 ? '+' + s : (r < 0 ? '-' + s : s);
  }
  function signedPar(n) { return n > 0 ? '+' + n : String(n); }   // écart au par : toujours un entier
  function signedInt(s) {
    var n = parseFloat(String(s).replace(',', '.'));
    return isNaN(n) ? String(s) : (n > 0 ? '+' + n : String(n));
  }

  // « Casteljaloux · Noirs » et « Casteljaloux (Championnat du club) · Blancs » : mêmes clubs, repères et SSS différents
  function courseLabel(c) { return c.name + (c.tees ? ' · ' + c.tees : '') + (c.prov ? ' · SSS provisoire' : ''); }

  function courseByName(n) {
    return (state.data.courses || []).filter(function (c) { return c.name === n; })[0];
  }

  /* ---------- Démarrage ---------- */

  async function boot() {
    show('loading');
    $('retry').hidden = true;
    $('loading-text').textContent = 'Chargement…';

    if (!API || API.indexOf('COLLER_ICI') === 0) {
      $('loading-text').textContent = 'Configuration manquante : l’adresse de l’API n’est pas renseignée dans config.js.';
      return;
    }

    var key = getKey();
    if (!key) { enterKey(''); return; }

    var data = null;
    try {
      var res = await request(API + '?action=init&key=' + encodeURIComponent(key));
      if (res && res.ok) { data = res; save(K.init, res); }
      else if (res && res.error && res.error.code === 'KEY') {
        drop(K.key); drop(K.init); drop(K.session);
        enterKey('Clé refusée. Rouvre le lien reçu du capitaine ou ressaisis la clé.');
        return;
      }
    } catch (e) { /* hors ligne : on retombe sur la dernière copie */ }
    if (!data) data = load(K.init, null);
    if (!data) {
      $('loading-text').textContent = 'Impossible de charger les données. Vérifie ta connexion.';
      $('retry').hidden = false;
      return;
    }
    state.data = data;
    state.session = load(K.session, null);
    if (state.session && data.players.indexOf(state.session.player) < 0) state.session = null;

    if (state.session) { enterApp(); refreshMe(); }
    else enterLogin();
  }

  function enterKey(msg) {
    $('key-input').value = '';
    if (msg) setMsg('key-msg', msg, 'err'); else hideMsg('key-msg');
    show('key');
  }

  $('key-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = $('key-input').value.trim();
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(v)) return setMsg('key-msg', 'Clé invalide : lettres et chiffres uniquement.', 'err');
    save(K.key, v);
    boot();
  });

  function enterLogin() {
    fill($('login-player'), state.data.players, 'Choisis ton nom');
    $('login-pin').value = '';
    hideMsg('login-msg');
    show('login');
  }

  function enterApp() {
    fill($('course'), (state.data.courses || []).map(function (c) { return { value: c.name, label: courseLabel(c) }; }), 'Choisis le parcours');
    var other = document.createElement('option');
    other.value = OTHER; other.textContent = 'Autre parcours (pas dans la liste)…';
    $('course').appendChild(other);
    $('date').value = state.data.today;
    $('date').max = state.data.today;
    $('who').textContent = state.session.player;
    $('sim').hidden = !SIM;
    updateLive();
    updatePending();
    showIosHint();
    selectTab('form');
    show('app');
    flushQueue();
  }

  async function refreshMe() {
    try {
      var res = await post({ action: 'me', player: state.session.player, pin: state.session.pin });
      if (res.ok) { save(K.recent, res.recent); }
      else if (res.error && res.error.code === 'AUTH') { logout(); }
    } catch (e) { /* hors ligne */ }
  }

  /* ---------- Connexion ---------- */

  $('login-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    hideMsg('login-msg');
    var player = $('login-player').value;
    var pin = $('login-pin').value.trim();
    if (!player) return setMsg('login-msg', 'Choisis ton nom.', 'err');
    if (!pin) return setMsg('login-msg', 'Saisis ton code personnel.', 'err');
    $('login-btn').disabled = true;
    $('login-btn').textContent = 'Connexion…';
    try {
      var res = await post({ action: 'me', player: player, pin: pin });
      if (res.ok) {
        state.session = { player: player, pin: pin };
        save(K.session, state.session);
        save(K.recent, res.recent);
        drop(K.space); drop(K.cal);
        enterApp();
      } else {
        setMsg('login-msg', res.error ? res.error.message : 'Connexion refusée.', 'err');
      }
    } catch (e) {
      setMsg('login-msg', 'Pas de réseau. La connexion demande internet la première fois.', 'err');
    } finally {
      $('login-btn').disabled = false;
      $('login-btn').textContent = 'Se connecter';
    }
  });

  function logout() {
    drop(K.session);
    drop(K.recent); drop(K.space); drop(K.cal);
    state.session = null;
    enterLogin();
  }
  $('logout').addEventListener('click', logout);
  $('retry').addEventListener('click', boot);

  /* ---------- Onglets ---------- */

  var TABS = ['form', 'space', 'cal'];

  function selectTab(name) {
    TABS.forEach(function (t) {
      $('view-' + t).hidden = t !== name;
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
    });
    if (name === 'space') loadSpace();
    if (name === 'cal') loadCal();
  }
  TABS.forEach(function (t) { $('tab-' + t).addEventListener('click', function () { selectTab(t); }); });

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function num(x, d) { return (x === null || x === undefined || !isFinite(x)) ? '–' : x.toFixed(d).replace('.', ','); }
  function pct(x) { return (x === null || x === undefined || !isFinite(x)) ? '–' : Math.round(x * 100) + ' %'; }

  /* ---------- Mon espace ---------- */

  async function loadSpace() {
    if (!state.session) return;
    var cached = load(K.space, null);
    if (cached) { renderSpace(cached); hideMsg('space-msg'); }
    else { $('space-body').textContent = ''; setMsg('space-msg', 'Chargement…', 'ok'); }
    try {
      var res = await post({ action: 'space', player: state.session.player, pin: state.session.pin });
      if (!state.session) return;
      if (res.ok) { save(K.space, res); save(K.recent, res.recent); hideMsg('space-msg'); renderSpace(res); }
      else handleServerError(res.error || { code: 'SERVER', message: 'Erreur inconnue.' }, 'space-msg');
    } catch (e) {
      if (cached) setMsg('space-msg', 'Hors ligne : données de la dernière connexion.', 'ok');
      else setMsg('space-msg', 'Pas de réseau. Ton espace s’affichera dès que le réseau revient.', 'err');
    }
  }

  function card(title, hint) {
    var c = el('section', 'card');
    if (title) c.appendChild(el('h2', null, title));
    if (hint) c.appendChild(el('p', 'hint small', hint));
    return c;
  }

  function renderSpace(d) {
    var body = $('space-body');
    body.textContent = '';
    if (d.team) body.appendChild(teamCard(d.team, d.season));
    body.appendChild(averagesCard(d.seasons || []));

    var ch = d.charts || {};
    var c1 = card('Écart au SSS en compétition', 'Coups au-dessus du SSS : plus bas = mieux. Les lignes pointillées sont les plafonds de moyenne par rôle.');
    if (ch.ecart && ch.ecart.length) {
      var caps = ch.ecart[ch.ecart.length - 1].caps || [];
      var refs = [];
      ['Titulaire', 'Équipier', 'Remplaçant'].forEach(function (n, i) { if (caps[i] !== null && caps[i] !== undefined) refs.push({ v: caps[i], label: n }); });
      c1.appendChild(lineChart({
        points: ch.ecart, refs: refs, minSpan: 4, digits: 1, signed: true,
        names: ['Tour', 'Moyenne glissante'], aria: 'Écart au SSS par tour de compétition'
      }));
    } else c1.appendChild(el('p', 'empty', 'Pas encore de tour de compétition cette saison.'));
    body.appendChild(c1);

    var c2 = card('Putting : TRP par tour', 'Sous 1,00 = tu putts mieux qu’attendu.');
    if (ch.trp && ch.trp.length) {
      c2.appendChild(lineChart({
        points: ch.trp, refs: [{ v: 1, label: 'Repère 1,00' }], minSpan: 0.4, digits: 2, signed: false,
        names: ['Tour', 'Moyenne glissante'], aria: 'TRP par tour'
      }));
    } else c2.appendChild(el('p', 'empty', 'Pas encore de tour avec statistiques de putting.'));
    body.appendChild(c2);

    var c3 = card('Profil de jeu', 'Saison précédente et saison en cours : fairways, greens en régulation, chip-putts réussis.');
    if (ch.profile && ch.profile.length) c3.appendChild(barChart(ch.profile));
    else c3.appendChild(el('p', 'empty', 'Pas encore de statistiques de profil.'));
    body.appendChild(c3);

    var c4 = card('Mes derniers tours');
    c4.appendChild(roundsList(d.recent || []));
    c4.appendChild(el('p', 'hint small', 'Lecture seule. Pour corriger un tour, préviens le capitaine.'));
    body.appendChild(c4);
  }

  function teamCard(t, season) {
    var c = card('Sélection ' + season, t.period || '');
    var top = el('div', 'role-line');
    top.appendChild(el('span', 'badge role', t.role || '–'));
    if (t.selectable) top.appendChild(el('span', 'badge ' + (t.selectable === 'Oui' ? 'ok' : 'wait'), 'Sélectionnable : ' + t.selectable));
    c.appendChild(top);
    var dl = el('dl', 'kv');
    [['Moyenne contre le SSS', t.avg], ['Tours retenus', t.retained], ['Tours de compétition', t.comp]].forEach(function (r) {
      dl.appendChild(el('dt', null, r[0]));
      dl.appendChild(el('dd', null, r[1] === '' || r[1] === undefined ? '–' : r[1]));
    });
    c.appendChild(dl);
    if (t.missing && t.selectable !== 'Oui') c.appendChild(el('p', 'hint small', t.missing));
    return c;
  }

  function averagesCard(seasons) {
    var c = card('Mes moyennes', 'Compétitions et tours annoncés (les entraînements ne comptent pas).');
    var cur = seasons[1] || {}, prev = seasons[0] || {};
    var t = el('table', 'stats');
    var head = el('tr');
    head.appendChild(el('th', null, ''));
    head.appendChild(el('th', null, prev.label || ''));
    head.appendChild(el('th', 'cur', cur.label || ''));
    t.appendChild(head);
    var rows = [
      ['Tours', function (s) { return s.n === undefined ? '–' : String(s.n); }],
      ['Fairways', function (s) { return pct(s.fairways); }],
      ['Greens en régul.', function (s) { return pct(s.greens); }],
      ['Putts par tour', function (s) { return num(s.putts, 1); }],
      ['Chip-putts réussis', function (s) { return pct(s.chip); }],
      ['TRP', function (s) { return num(s.trp, 2); }],
      ['Conv. green', function (s) { return num(s.conv, 2); }],
      ['Écart au SSS (compét.)', function (s) { return (s.ecart === null || s.ecart === undefined) ? '–' : signed(s.ecart); }]
    ];
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('th', null, r[0]));
      tr.appendChild(el('td', null, r[1](prev)));
      tr.appendChild(el('td', 'cur', r[1](cur)));
      t.appendChild(tr);
    });
    c.appendChild(t);
    c.appendChild(el('p', 'hint small', 'TRP = putts réels ÷ putts attendus (sous 1,00 : bon putting). Conv. green = greens en régul. ÷ (fairways touchés + par 3) : au-dessus de 1,00, tu touches des greens même sans fairway.'));
    return c;
  }

  function roundsList(list) {
    var ul = el('ul', 'rounds');
    if (!list || !list.length) { ul.appendChild(el('li', null, 'Aucun tour enregistré pour le moment.')); return ul; }
    list.forEach(function (t) {
      var li = el('li');
      var left = el('div');
      left.appendChild(el('div', 't', t.name));
      left.appendChild(el('div', 's', (t.date || 'Saison 2026') + ' · ' + t.course));
      var right = el('div', 'r', signedInt(t.score));
      right.appendChild(el('small', null, 'SSS ' + (t.ecart || '-') + (t.trp ? ' · TRP ' + t.trp : '')));
      li.appendChild(left); li.appendChild(right);
      ul.appendChild(li);
    });
    return ul;
  }

  /* ---------- Graphiques (SVG, sans bibliothèque) ---------- */

  function niceStep(span, count) {
    var rough = span / count;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var n = rough / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function legend(items) {
    var l = el('div', 'legend');
    items.forEach(function (it) {
      var s = el('span', 'lg');
      s.appendChild(el('i', it.cls));
      s.appendChild(document.createTextNode(it.label));
      l.appendChild(s);
    });
    return l;
  }

  // o : { points:[{label, v, avg}], refs:[{v, label}], minSpan, digits, signed, names:[série 1, série 2], aria }
  function lineChart(o) {
    var W = 320, H = 200, L = 40, R = 12, T = 12, B = 26;
    var pts = o.points, n = pts.length;
    var vals = [];
    pts.forEach(function (p) { vals.push(p.v); if (p.avg !== null && p.avg !== undefined) vals.push(p.avg); });
    (o.refs || []).forEach(function (r) { vals.push(r.v); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < o.minSpan) { var mid = (hi + lo) / 2; lo = mid - o.minSpan / 2; hi = mid + o.minSpan / 2; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var step = niceStep(hi - lo, 4);
    var i0 = Math.floor(lo / step), i1 = Math.ceil(hi / step);
    var t0 = i0 * step, t1 = i1 * step;
    var X = function (i) { return n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1); };
    var Y = function (v) { return T + (t1 - v) / (t1 - t0) * (H - T - B); };
    var fmtV = function (v) { var s = num(v, o.digits); return o.signed && v > 0 ? '+' + s : s; };

    var box = el('div', 'chart');
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria });
    for (var k = i0; k <= i1; k++) {
      var tv = k * step, y = Y(tv);
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, 'class': 'grid' }));
      var lab = svgEl('text', { x: L - 5, y: y + 3, 'text-anchor': 'end', 'class': 'ax' });
      lab.textContent = fmtV(Math.round(tv * 1000) / 1000);
      svg.appendChild(lab);
    }
    (o.refs || []).forEach(function (r) {
      var y = Y(r.v);
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, 'class': 'ref' }));
      var t = svgEl('text', { x: W - R - 2, y: y - 3, 'text-anchor': 'end', 'class': 'ax ref-lab' });
      t.textContent = r.label;
      svg.appendChild(t);
    });
    var xl = function (i) { var m = /· (.+)$/.exec(pts[i].label); return m ? m[1] : 'T' + (i + 1); };
    var xi = n <= 1 ? [0] : n <= 4 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
    xi.forEach(function (i) {
      var t = svgEl('text', { x: X(i), y: H - 8, 'text-anchor': i === 0 && n > 1 ? 'start' : (i === n - 1 && n > 1 ? 'end' : 'middle'), 'class': 'ax' });
      t.textContent = xl(i);
      svg.appendChild(t);
    });
    var path = function (key) {
      var d = '';
      pts.forEach(function (p, i) { if (p[key] !== null && p[key] !== undefined) d += (d ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p[key]).toFixed(1); });
      return d;
    };
    if (n > 1) {
      svg.appendChild(svgEl('path', { d: path('avg'), 'class': 'ln ln-2' }));
      svg.appendChild(svgEl('path', { d: path('v'), 'class': 'ln ln-1' }));
    }
    var dots = [];
    var cap = el('div', 'cap');
    var select = function (i) {
      dots.forEach(function (c, j) { c.setAttribute('r', j === i ? 5.5 : 3.5); c.setAttribute('class', 'pt' + (j === i ? ' sel' : '')); });
      var p = pts[i];
      cap.textContent = p.label + ' : ' + fmtV(p.v) + (p.avg !== null && p.avg !== undefined ? ' · moyenne glissante ' + fmtV(p.avg) : '');
    };
    pts.forEach(function (p, i) {
      var dot = svgEl('circle', { cx: X(i), cy: Y(p.v), r: 3.5, 'class': 'pt' });
      dots.push(dot);
      svg.appendChild(dot);
    });
    pts.forEach(function (p, i) {
      var hit = svgEl('circle', { cx: X(i), cy: Y(p.v), r: 14, 'class': 'hit' });
      hit.addEventListener('click', function () { select(i); });
      svg.appendChild(hit);
    });
    box.appendChild(svg);
    box.appendChild(legend([{ cls: 'lg-1', label: o.names[0] }, { cls: 'lg-2', label: o.names[1] }]));
    box.appendChild(cap);
    select(n - 1);
    return box;
  }

  // seasons : [{label, fairways, greens, chip}] (précédente puis en cours)
  function barChart(seasons) {
    var W = 320, H = 200, L = 40, R = 12, T = 18, B = 26;
    var groups = [['Fairways', 'fairways'], ['Greens en régul.', 'greens'], ['Chip-putts', 'chip']];
    var box = el('div', 'chart');
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Profil de jeu par saison' });
    var Y = function (v) { return T + (1 - v) * (H - T - B); };
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var y = Y(v);
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, 'class': 'grid' }));
      var t = svgEl('text', { x: L - 5, y: y + 3, 'text-anchor': 'end', 'class': 'ax' });
      t.textContent = Math.round(v * 100) + '%';
      svg.appendChild(t);
    });
    var gw = (W - L - R) / groups.length;
    var bw = Math.min(34, gw / (seasons.length + 1));
    groups.forEach(function (g, gi) {
      var cx = L + gw * gi + gw / 2;
      var lab = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'class': 'ax' });
      lab.textContent = g[0];
      svg.appendChild(lab);
      seasons.forEach(function (s, si) {
        var v = s[g[1]];
        if (v === null || v === undefined) return;
        var x = cx - (seasons.length * bw) / 2 + si * bw + 2;
        var y = Y(Math.max(0, Math.min(1, v)));
        svg.appendChild(svgEl('rect', { x: x, y: y, width: bw - 4, height: Math.max(0, Y(0) - y), rx: 3, 'class': 'bar bar-' + si }));
        var t = svgEl('text', { x: x + (bw - 4) / 2, y: y - 4, 'text-anchor': 'middle', 'class': 'ax val' });
        t.textContent = Math.round(v * 100) + '%';
        svg.appendChild(t);
      });
    });
    box.appendChild(svg);
    box.appendChild(legend(seasons.map(function (s, si) { return { cls: 'lg-bar-' + si, label: s.label }; })));
    return box;
  }

  /* ---------- Calendrier (onglet « Planning 2027 » du Sheets, lecture seule) ---------- */

  async function loadCal() {
    if (!state.session) return;
    var cached = load(K.cal, null);
    if (cached) { renderCal(cached); hideMsg('cal-msg'); }
    else { $('cal-body').textContent = ''; setMsg('cal-msg', 'Chargement…', 'ok'); }
    try {
      var res = await post({ action: 'calendar', player: state.session.player, pin: state.session.pin });
      if (!state.session) return;
      if (res.ok) { save(K.cal, res); hideMsg('cal-msg'); renderCal(res); }
      else handleServerError(res.error || { code: 'SERVER', message: 'Erreur inconnue.' }, 'cal-msg');
    } catch (e) {
      if (cached) setMsg('cal-msg', 'Hors ligne : calendrier de la dernière connexion.', 'ok');
      else setMsg('cal-msg', 'Pas de réseau. Le calendrier s’affichera dès que le réseau revient.', 'err');
    }
  }

  function parseIso(iso) { var p = iso.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12); }

  function dayText(iso, today) {
    var opts = { weekday: 'short', day: 'numeric', month: 'short' };
    if (iso.slice(0, 4) !== String(today).slice(0, 4)) opts.year = 'numeric';
    return parseIso(iso).toLocaleDateString('fr-FR', opts);
  }

  function daysUntil(iso, today) { return Math.round((parseIso(iso) - parseIso(today)) / 86400000); }

  function untilText(e, today) {
    var d = daysUntil(e.date, today);
    if (d <= 0 && (e.end || e.date) >= today) return 'En cours';
    if (d === 1) return 'Demain';
    return 'Dans ' + d + ' jours';
  }

  function whenBlock(e) {
    var when = el('div', 'when');
    when.appendChild(el('b', null, String(Number(e.date.split('-')[2]))));
    when.appendChild(el('span', null, parseIso(e.date).toLocaleDateString('fr-FR', { month: 'short' })));
    return when;
  }

  // Date validée : carte verte, bandeau « VALIDÉ », lieu en gros. Date non validée : carte pâle en pointillés.
  function eventNode(e, today) {
    var valid = e.status === 'Validé';
    var li = el('li', 'event ' + (valid ? 'valid' : 'tbc'));
    li.appendChild(whenBlock(e));
    var what = el('div', 'what');
    var top = el('div', 'top');
    top.appendChild(el('span', 'badge ' + (valid ? 'strong' : 'wait'), valid ? '✓ VALIDÉ' : 'À CONFIRMER'));
    what.appendChild(top);
    what.appendChild(el('div', 't', e.title));
    what.appendChild(el('div', 's', dayText(e.date, today) + (e.end ? ' → ' + dayText(e.end, today) : '')));
    if (e.place) what.appendChild(el('div', 'pl', 'Lieu : ' + e.place));
    else what.appendChild(el('div', 'pl none', valid ? 'Lieu à communiquer' : 'Lieu et date à confirmer'));
    if (e.info) what.appendChild(el('div', 'inf', e.info));
    li.appendChild(what);
    return li;
  }

  function heroNode(e, today) {
    var h = el('section', 'hero');
    h.appendChild(el('div', 'k', 'Prochaine date validée · ' + untilText(e, today)));
    h.appendChild(el('div', 'ht', e.title));
    h.appendChild(el('div', 'hd', dayText(e.date, today) + (e.end ? ' → ' + dayText(e.end, today) : '')));
    h.appendChild(el('div', 'hp', e.place ? 'Lieu : ' + e.place : 'Lieu à communiquer'));
    if (e.info) h.appendChild(el('div', 'hi', e.info));
    return h;
  }

  function renderCal(d) {
    var body = $('cal-body');
    body.textContent = '';
    var today = d.today || state.data.today;
    var events = d.events || [];
    if (d.missing) { body.appendChild(card('Calendrier', 'Le calendrier n’est pas encore disponible. Préviens le capitaine.')); return; }

    var next = events.filter(function (e) { return (e.end || e.date) >= today; });
    var past = events.filter(function (e) { return (e.end || e.date) < today; }).reverse().slice(0, 20);
    var nValid = next.filter(function (e) { return e.status === 'Validé'; }).length;

    var firstValid = next.filter(function (e) { return e.status === 'Validé'; })[0];
    if (firstValid) body.appendChild(heroNode(firstValid, today));

    var filter = state.calFilter || 'all';
    var seg = el('div', 'seg');
    [['all', 'Tout (' + next.length + ')'], ['valid', 'Validées (' + nValid + ')']].forEach(function (o) {
      var b = el('button', null, o[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(filter === o[0]));
      b.addEventListener('click', function () { state.calFilter = o[0]; renderCal(d); });
      seg.appendChild(b);
    });
    body.appendChild(seg);

    var shown = filter === 'valid' ? next.filter(function (e) { return e.status === 'Validé'; }) : next;
    var c = card('À venir', 'Les dates validées sont en vert. Les autres ne sont pas encore confirmées : ne bloque rien pour elles.');
    if (shown.length) {
      var ul = el('ul', 'events');
      shown.forEach(function (e) { ul.appendChild(eventNode(e, today)); });
      c.appendChild(ul);
    } else c.appendChild(el('p', 'empty', filter === 'valid' ? 'Aucune date validée pour le moment.' : 'Aucune date au calendrier pour le moment.'));
    body.appendChild(c);

    if (past.length) {
      var det = el('details', 'card past');
      det.appendChild(el('summary', null, 'Passés (' + past.length + ')'));
      var ul2 = el('ul', 'events');
      past.forEach(function (e) { ul2.appendChild(eventNode(e, today)); });
      det.appendChild(ul2);
      body.appendChild(det);
    }
  }

  /* ---------- Formulaire ---------- */

  var FIELDS = ['date', 'type', 'name', 'course', 'course-other', 'par', 'strokes', 'fairways', 'greens', 'putts', 'chipMade', 'chipTried', 'comment'];

  function val(id) { return $(id).value.trim(); }

  function intField(id, min, max, label, required) {
    var v = val(id);
    if (v === '') { if (required) throw new Error(label + ' : valeur obligatoire.'); return ''; }
    var n = Number(v);
    if (!isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw new Error(label + ' : entier attendu entre ' + min + ' et ' + max + '.');
    return n;
  }

  function collect() {
    if (!val('date')) throw new Error('Choisis la date du tour.');
    if (!val('name')) throw new Error('Saisis le nom du tour.');
    if (!val('course')) throw new Error('Choisis le parcours.');
    var isOther = val('course') === OTHER;
    if (isOther && !val('course-other')) throw new Error('Parcours hors liste : indique le nom du parcours.');
    var p = {
      date: val('date'), type: Number(val('type')), name: val('name'), course: val('course'),
      strokes: intField('strokes', 50, 130, 'Score brut', true),
      fairways: intField('fairways', 0, 14, 'Fairways', false),
      greens: intField('greens', 0, 18, 'Greens', false),
      putts: intField('putts', 15, 60, 'Putts', false),
      chipMade: intField('chipMade', 0, 30, 'Chip-putts réussis', false),
      chipTried: intField('chipTried', 1, 30, 'Chip-putts tentés', false),
      comment: val('comment')
    };
    if (isOther) {
      p.courseOther = val('course-other');
      p.par = intField('par', 60, 80, 'Par du parcours', true);
    }
    var n = [p.fairways, p.greens, p.putts].filter(function (v) { return v !== ''; }).length;
    if (n !== 0 && n !== 3) throw new Error('Fairways, greens et putts vont ensemble : renseigne les trois ou aucun.');
    if ((p.chipMade === '') !== (p.chipTried === '')) throw new Error('Chip-putts : renseigne les réussis et les tentés, ou aucun des deux.');
    if (p.chipMade !== '' && p.chipMade > p.chipTried) throw new Error('Chip-putts : les réussis ne peuvent pas dépasser les tentés.');
    return p;
  }

  function updateLive() {
    var isOther = $('course').value === OTHER;
    $('other-box').hidden = !isOther;
    if (isOther) {
      var par = Number($('par').value);
      if (!$('strokes').value || !isFinite(par)) { $('live').textContent = 'Parcours hors liste : indique son nom et son par. Le SSS sera ajouté plus tard.'; return; }
      $('live').textContent = 'Au par : ' + signedPar(Number($('strokes').value) - par) + '  ·  Écart au SSS : calculé quand le capitaine aura ajouté le parcours.';
      return;
    }
    var c = courseByName($('course').value);
    if (!c) { $('live').textContent = 'Choisis le parcours et saisis ton score.'; return; }
    var sss = String(c.sss).replace('.', ',') + (c.prov ? ' provisoire' : '');
    if (!$('strokes').value) { $('live').textContent = c.name + (c.tees ? ' (' + c.tees + ')' : '') + ' : par ' + c.par + ', SSS ' + sss + '.'; return; }
    var s = Number($('strokes').value);
    $('live').textContent = 'Au par : ' + signedPar(s - c.par) + '  ·  Écart au SSS (' + sss + ') : ' + signed(s - c.sss);
  }

  function recapNode(p) {
    var other = p.course === OTHER;
    var c = other ? null : courseByName(p.course);
    var rows = [
      ['Joueur', state.session.player],
      ['Tour', p.name + ' · ' + p.date.split('-').reverse().join('/') + ' · ' + TYPES[p.type]],
      ['Parcours', other ? p.courseOther + ' (hors liste, par ' + p.par + ')' : p.course],
      ['Score', other
        ? p.strokes + ' coups (' + signedPar(p.strokes - p.par) + ' au par, écart au SSS calculé plus tard)'
        : p.strokes + ' coups (' + signedPar(p.strokes - c.par) + ' au par, ' + signed(p.strokes - c.sss) + ' au SSS)']
    ];
    if (p.fairways !== '') rows.push(['Stats', 'Fairways ' + p.fairways + '/14 · Greens ' + p.greens + '/18 · Putts ' + p.putts]);
    if (p.chipTried !== '') rows.push(['Chip-putts', p.chipMade + '/' + p.chipTried]);
    if (p.comment) rows.push(['Commentaire', p.comment]);
    var dl = document.createElement('dl');
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    return dl;
  }

  function disarm() {
    state.armed = false;
    $('recap').hidden = true;
    $('edit').hidden = true;
    $('btn').textContent = 'Vérifier et envoyer';
  }

  function clearForm() {
    ['name', 'course-other', 'strokes', 'fairways', 'greens', 'putts', 'chipMade', 'chipTried', 'comment'].forEach(function (id) { $(id).value = ''; });
    updateLive();
  }

  FIELDS.forEach(function (id) {
    $(id).addEventListener('input', function () { disarm(); hideMsg('msg'); updateLive(); });
    $(id).addEventListener('change', function () { disarm(); updateLive(); });
  });
  $('edit').addEventListener('click', disarm);

  $('form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    hideMsg('msg');
    var p;
    try { p = collect(); } catch (e) { disarm(); setMsg('msg', e.message, 'err'); return; }

    if (!state.armed) {
      var box = $('recap');
      box.innerHTML = '';
      box.appendChild(recapNode(p));
      box.hidden = false;
      $('edit').hidden = false;
      $('btn').textContent = 'Confirmer l’envoi';
      state.armed = true;
      return;
    }

    $('btn').disabled = true;
    $('btn').textContent = 'Envoi…';
    var body = Object.assign({ action: 'submit', player: state.session.player, pin: state.session.pin }, p);
    if (SIM) body.dry = true;
    try {
      var res = await post(body);
      if (res.ok) {
        if (!SIM) { save(K.recent, res.recent); drop(K.space); }
        var ec = res.ecart ? res.ecart : 'calculé plus tard (parcours à ajouter)';
        var txt = SIM
          ? 'Simulation réussie, rien n’a été écrit. Écart au SSS : ' + ec + (res.trp ? ' · TRP : ' + res.trp : '') + ' · ligne prévue : ' + res.row + '.'
          : 'Enregistré. Écart au SSS : ' + ec + (res.trp ? ' · TRP : ' + res.trp : '') + (res.conv ? ' · Conv. green : ' + res.conv : '') + '.';
        if (!SIM && res.remaining <= 5) txt += ' Il te reste ' + res.remaining + ' ligne(s) dans ta fiche : préviens le capitaine.';
        setMsg('msg', txt, 'ok');
        clearForm();
      } else {
        handleServerError(res.error || { code: 'SERVER', message: 'Erreur inconnue.' }, 'msg');
      }
    } catch (e) {
      if (SIM) {
        setMsg('msg', 'Pas de réseau : la simulation demande internet.', 'err');
      } else {
        enqueue(p);
        setMsg('msg', 'Pas de réseau. Ton tour est gardé sur ce téléphone et partira tout seul au retour du réseau.', 'ok');
        clearForm();
      }
    } finally {
      $('btn').disabled = false;
      disarm();
    }
  });

  function handleServerError(err, msgId) {
    if (err.code === 'AUTH') {
      setMsg(msgId, err.message + ' Reconnecte-toi.', 'err');
      logout();
      setMsg('login-msg', err.message, 'err');
      return;
    }
    setMsg(msgId, err.message, 'err');
  }

  /* ---------- File d'attente hors ligne ---------- */

  function enqueue(p) {
    var q = load(K.queue, []);
    q.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), player: state.session.player, pin: state.session.pin, round: p });
    save(K.queue, q);
    updatePending();
  }

  function updatePending() {
    var q = load(K.queue, []);
    $('pending').hidden = q.length === 0;
    $('pending-text').textContent = q.length + ' tour(s) en attente d’envoi';
  }

  async function flushQueue() {
    if (state.flushing) return;
    state.flushing = true;
    var notes = [];
    try {
      var q = load(K.queue, []);
      while (q.length) {
        var item = q[0];
        var body = Object.assign({ action: 'submit', player: item.player, pin: item.pin }, item.round);
        var res;
        try { res = await post(body); } catch (e) { break; }               // toujours hors ligne : on réessaiera
        if (res.ok) {
          notes.push('Envoyé : ' + item.round.name + '.');
          save(K.recent, res.recent);
        } else if (res.error && res.error.code === 'DUPLICATE') {
          notes.push('Déjà enregistré : ' + item.round.name + '.');
        } else if (res.error && (res.error.code === 'AUTH' || res.error.code === 'LOCKED' || res.error.code === 'KEY')) {
          notes.push('Envoi bloqué : ' + res.error.message);
          break;                                                            // on garde la file, on réessaiera après reconnexion
        } else {
          notes.push('Refusé : ' + item.round.name + ' (' + (res.error ? res.error.message : 'erreur') + ').');
        }
        q.shift();
        save(K.queue, q);
      }
    } finally {
      state.flushing = false;
      updatePending();
    }
    if (notes.length && state.session) {
      drop(K.space);
      setMsg('msg', notes.join(' '), notes.some(function (n) { return /^(Refusé|Envoi bloqué)/.test(n); }) ? 'err' : 'ok');
    }
  }

  $('pending-btn').addEventListener('click', flushQueue);
  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.session) flushQueue(); });

  /* ---------- Installation iPhone ---------- */

  function showIosHint() {
    var ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    var standalone = window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    $('ios-hint').hidden = !(ios && !standalone && !load(K.hint, false));
  }
  $('ios-hint-close').addEventListener('click', function () { save(K.hint, true); $('ios-hint').hidden = true; });

  /* ---------- Lancement ---------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* sans cache hors ligne */ }); });
  }
  boot();
})();
