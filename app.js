(function () {
  'use strict';

  var API = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  var SIM = /[?&]simulation=1/.test(window.location.search);   // ?simulation=1 : vérifie tout, n'écrit rien
  var K = { key: 'stats.key', init: 'stats.init', session: 'stats.session', queue: 'stats.queue', recent: 'stats.recent', hint: 'stats.hint', space: 'stats.space', cal: 'stats.cal', staff: 'stats.staff', sov: 'stats.sov', scal: 'stats.scal' };
  var OTHER = '__autre__';   // valeur de l'option « Autre parcours »
  var TYPES = { 1: 'Compétition', 2: 'Tour annoncé', 3: 'Entraînement (non compté)' };
  var state = { data: null, session: null, armed: false, flushing: false, calFilter: 'all', spaceView: 'match', spaceData: null };

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
    ['loading', 'key', 'login', 'staff-login', 'staff', 'app'].forEach(function (s) { $('screen-' + s).hidden = s !== screen; });
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
        drop(K.key); drop(K.init); drop(K.session); drop(K.staff); drop(K.sov); drop(K.scal);
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

    var st = load(K.staff, null);
    if (state.session) { enterApp(); refreshMe(); }
    else if (st && st.me && st.me.actions && data.staff && data.staff.indexOf(st.name) >= 0) { state.staff = st; enterStaff(); }
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
    $('to-staff').hidden = !(state.data.staff && state.data.staff.length);
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
        drop(K.staff); drop(K.sov); drop(K.scal); state.staff = null;   // une seule session à la fois sur l'appareil
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
    state.spaceData = d;
    var body = $('space-body');
    body.textContent = '';
    var seg = el('div', 'seg');
    [['match', 'Mes compétitions'], ['training', 'Entraînement']].forEach(function (o) {
      var b = el('button', null, o[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.spaceView === o[0]));
      b.addEventListener('click', function () { state.spaceView = o[0]; renderSpace(state.spaceData); });
      seg.appendChild(b);
    });
    body.appendChild(seg);
    if (state.spaceView === 'training') { renderTraining(body, d); return; }
    if (d.team) body.appendChild(teamCard(d.team, d.season));
    body.appendChild(averagesCard(d.seasons || [], d.last3));
    if (d.mental) body.appendChild(mentalCard(d.mental));

    appendCharts(body, d.charts || {});

    var c4 = card('Mes derniers tours', 'Touche un tour pour voir ses statistiques.');
    c4.appendChild(roundsList(d.recent || []));
    c4.appendChild(el('p', 'hint small', 'Lecture seule. Pour corriger un tour, préviens le capitaine.'));
    body.appendChild(c4);
  }

  /** Vue « Entraînement » de Mon espace : moyennes des tours de type 3 (non comptés dans les moyennes de match), mental d'entraînement, derniers entraînements. */
  function renderTraining(body, d) {
    var t = d.training;
    if (!t) {
      var none = card('Entraînement');
      none.appendChild(el('p', 'empty', 'Les statistiques d’entraînement ne sont pas encore disponibles. Réessaie dans un instant.'));
      body.appendChild(none);
      return;
    }
    var c = card('Mes stats à l’entraînement', 'Tous les tours saisis en type « Entraînement ». Ils ne comptent pas dans tes moyennes de compétition ni dans la sélection.');
    if (!t.n) {
      c.appendChild(el('p', 'empty', 'Aucun tour d’entraînement saisi pour le moment. Dans l’onglet Saisir, choisis « Entraînement ».'));
    } else {
      var dl = el('dl', 'kv');
      [['Tours', String(t.n)], ['Fairways', pct(t.fairways)], ['Greens en régul.', pct(t.greens)], ['Putts par tour', num(t.putts, 1)],
       ['Chip-putts réussis', pct(t.chip)], ['TRP', num(t.trp, 2)], ['Conv. green', num(t.conv, 2)],
       ['Écart au SSS', (t.ecart === null || t.ecart === undefined) ? '–' : signed(t.ecart)]].forEach(function (r) {
        dl.appendChild(el('dt', null, r[0]));
        dl.appendChild(el('dd', null, r[1]));
      });
      c.appendChild(dl);
      c.appendChild(el('p', 'hint small', 'Moyennes sur tous tes tours d’entraînement saisis. TRP = putts réels ÷ putts attendus (sous 1,00 : bon putting).'));
    }
    body.appendChild(c);
    if (d.mental && d.mental.training && d.mental.training.n) body.appendChild(mentalCard({ training: d.mental.training }));
    var c2 = card('Mes derniers entraînements', 'Touche un tour pour voir ses statistiques.');
    c2.appendChild(roundsList(t.recent || [], 'Aucun entraînement enregistré pour le moment.'));
    body.appendChild(c2);
  }

  function appendCharts(body, ch) {
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

  function averagesCard(seasons, last3) {
    var c = card('Mes moyennes', 'Compétitions et tours annoncés (les entraînements ne comptent pas).');
    var cur = seasons[1] || {}, prev = seasons[0] || {};
    var t = el('table', 'stats');
    var head = el('tr');
    head.appendChild(el('th', null, ''));
    head.appendChild(el('th', null, prev.label || ''));
    head.appendChild(el('th', 'cur', cur.label || ''));
    if (last3) head.appendChild(el('th', null, '3 dernières cartes'));
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
      if (last3) tr.appendChild(el('td', null, r[1](last3)));
      t.appendChild(tr);
    });
    c.appendChild(t);
    c.appendChild(el('p', 'hint small', 'TRP = putts réels ÷ putts attendus (sous 1,00 : bon putting). Conv. green = greens en régul. ÷ (fairways touchés + par 3) : au-dessus de 1,00, tu touches des greens même sans fairway.'));
    return c;
  }

  /** Reporting mental : moyenne par critère (dès 2 évaluations), critère à travailler en premier, historique. */
  function mentalCard(m) {
    var c = card('Mental', 'Tes auto-évaluations, notées de 1 (mauvais) à 4 (très bon). Elles sont confidentielles.');
    var kinds = [['match', 'Après une compétition'], ['training', 'Après un entraînement']];
    var any = false;
    kinds.forEach(function (k) {
      var d = m[k[0]];
      if (!d || !d.n) return;
      any = true;
      var sec = el('div', 'mental-sec');
      sec.appendChild(el('h3', null, k[1] + ' · ' + d.n + ' évaluation' + (d.n > 1 ? 's' : '')));
      if (d.avg) {
        var items = MENTAL[k[0]].items;
        var weak = {};
        (d.weakest || []).forEach(function (n) { weak[n] = true; });
        d.avg.forEach(function (a, i) {
          var row = el('div', 'mrow' + (weak[items[i][0]] ? ' weak' : ''));
          row.appendChild(el('div', 'ml', items[i][0]));
          var track = el('div', 'mtrack');
          var fill = el('div', 'mfill');
          fill.style.width = Math.max(0, Math.min(100, a / 4 * 100)) + '%';
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el('div', 'mv', num(a, 2)));
          sec.appendChild(row);
        });
        var line = 'Total moyen : ' + num(d.total, 1) + '/' + mentalMax(k[0]) + (k[0] === 'match' ? ' (alerte sous ' + MENTAL_ALERT + ')' : '');
        sec.appendChild(el('p', 'hint small', line));
        if (d.weakest && d.weakest.length) {
          var w = el('p', 'focus');
          w.appendChild(el('b', null, 'À travailler en premier : '));
          w.appendChild(document.createTextNode(d.weakest.join(', ')));
          sec.appendChild(w);
        }
      } else {
        sec.appendChild(el('p', 'hint small', 'Les moyennes apparaissent dès 2 évaluations.'));
      }
      var ul = el('ul', 'rounds');
      (d.history || []).forEach(function (h) {
        var li = el('li');
        var left = el('div');
        left.appendChild(el('div', 't', h.name));
        left.appendChild(el('div', 's', String(h.date || '').split('-').reverse().join('/') + (h.work && h.work.length ? ' · à travailler : ' + h.work.join(', ') : '')));
        var right = el('div', 'r', h.total + '/' + mentalMax(k[0]));
        if (h.zone) right.appendChild(el('small', null, h.zone));
        li.appendChild(left); li.appendChild(right);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      c.appendChild(sec);
    });
    if (!any) c.appendChild(el('p', 'empty', 'Pas encore d’auto-évaluation. Elle se remplit à chaque saisie d’un tour, dans l’onglet Saisir.'));
    return c;
  }

  var ROUND_TYPES = { 1: 'Compétition', 2: 'Tour annoncé', 3: 'Entraînement' };

  /** « 9/14 » -> « 9/14 (64 %) » ; vide -> tiret. */
  function ratioShow(s) {
    var m = /^(\d+)\/(\d+)$/.exec(String(s === undefined || s === null ? '' : s));
    if (!m) return s ? String(s) : '–';
    return m[1] + '/' + m[2] + (Number(m[2]) ? ' (' + Math.round(Number(m[1]) / Number(m[2]) * 100) + ' %)' : '');
  }

  /** Détail d'un tour : tout ce que l'API renvoie pour la ligne de la fiche (texte inséré par textContent). */
  function roundDetail(t) {
    var box = el('div', 'rdetail');
    var dl = el('dl', 'kv');
    var rows = [['Type', ROUND_TYPES[Number(t.type)] || '–'], ['Parcours', t.course || '–'], ['Score au par', signedInt(t.score)], ['Écart au SSS', t.ecart || '–']];
    if (t.fairways !== undefined) {
      rows.push(['Fairways', ratioShow(t.fairways)], ['Greens en régul.', ratioShow(t.greens)], ['Putts', t.putts || '–'],
        ['Chip-putts réussis', ratioShow(t.chip)], ['TRP', t.trp || '–'], ['Conv. green', t.conv || '–']);
    } else if (t.trp) {
      rows.push(['TRP', t.trp]);
    }
    rows.forEach(function (r) { dl.appendChild(el('dt', null, r[0])); dl.appendChild(el('dd', null, String(r[1]))); });
    box.appendChild(dl);
    if (t.comment) box.appendChild(el('p', 'hint small', 'Commentaire : ' + t.comment));
    if (t.fairways === undefined) box.appendChild(el('p', 'hint small', 'Le détail complet du tour n’est pas encore disponible.'));
    return box;
  }

  function roundsList(list, emptyText) {
    var ul = el('ul', 'rounds');
    if (!list || !list.length) { ul.appendChild(el('li', null, emptyText || 'Aucun tour enregistré pour le moment.')); return ul; }
    list.forEach(function (t) {
      var li = el('li', 'tap');
      var btn = el('button', 'rbtn');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      var left = el('div');
      left.appendChild(el('div', 't', t.name));
      left.appendChild(el('div', 's', (t.date || 'Saison 2026') + ' · ' + t.course));
      var right = el('div', 'r', signedInt(t.score));
      right.appendChild(el('small', null, 'SSS ' + (t.ecart || '-') + (t.trp ? ' · TRP ' + t.trp : '')));
      btn.appendChild(left); btn.appendChild(right);
      var detail = null;
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        if (open) { detail.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
        if (!detail) { detail = roundDetail(t); li.appendChild(detail); }
        detail.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      });
      li.appendChild(btn);
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

  function renderCal(d, targetId) {
    var body = $(targetId || 'cal-body');
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
      b.addEventListener('click', function () { state.calFilter = o[0]; renderCal(d, targetId); });
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

  /* ---------- Mental : auto-évaluation (5 critères notés de 1 à 4) ---------- */

  var MENTAL_ALERT = 12;   // après un match (4 critères, total sur 16) : total inférieur à 12 = alerte ; aucun seuil pour l'entraînement
  var MENTAL = {
    match: {
      sub: 'après une compétition',
      items: [
        ['Évaluation de ma préparation', 'Échauffement, routine, matériel, repas et eau, état d’esprit au départ : étais-je prêt à bien débuter ? 4 = prêt et en confiance dès le trou 1. 1 = parti à froid ou dans le flou.'],
        ['Bien (mal) jouer', 'Ma qualité de jeu quand je ne suis pas à mon meilleur niveau. 4 = même sans mes meilleurs coups, j’ai trouvé comment scorer (jeu simplifié, bonnes décisions, erreurs limitées). 1 = j’ai subi mon mauvais jeu et il s’est aggravé.'],
        ['Ne pas lâcher', 'Ma constance du trou 1 au trou 18. 4 = même concentration et même routine jusqu’au bout, jamais abattu après un mauvais trou. 1 = relâché ou résigné après une erreur, fin de tour bâclée.'],
        ['Dominer mes peurs', 'Ai-je réussi les coups importants (drive étroit, putt important à 1,20 m, coup décisif) ? 4 = je les ai réussis en attaquant malgré la pression. 1 = je les ai évités, subis ou ratés en me crispant.']
      ]
    },
    training: {
      sub: 'après un entraînement',
      items: [
        ['Me préparer à me concentrer', 'Sac, nourriture, mise en condition.'],
        ['Traiter l’entraînement comme un match', 'Très concentré et engagé, je pousse mes limites quand c’est dur.'],
        ['Régler mon problème de caractère', 'Nervosité ou découragement devant l’effort.'],
        ['Être en relation avec mon coach', 'J’apporte des idées, je prends des initiatives, j’écoute bien.'],
        ['Tenir sur la longueur', 'Je tiens la durée de la séance et mon engagement dans le temps.']
      ]
    }
  };
  var mentalNotes = { match: [0, 0, 0, 0], training: [0, 0, 0, 0, 0] };
  function mentalMax(kind) { return MENTAL[kind].items.length * 4; }   // match : 16, entraînement : 20

  /** Type 3 (entraînement) = grille entraînement ; types 1 et 2 = grille match. Même règle que le serveur. */
  function mentalKind(type) { return Number(type) === 3 ? 'training' : 'match'; }

  /** Type du tour saisi : 3 en mode « Tour d'entraînement », sinon la valeur du sélecteur (1 compétition, 2 tour annoncé). */
  function roundType() { return state.mode === 'training' ? 3 : Number($('type').value); }

  /** Total /20, zone (match seulement), critère(s) à travailler = note la plus basse, ex aequo compris. */
  function mentalScore(type, notes) {
    var kind = mentalKind(type);
    var total = notes.reduce(function (a, b) { return a + b; }, 0);
    var min = Math.min.apply(null, notes);
    var allEqual = notes.every(function (n) { return n === notes[0]; });
    var work = allEqual ? [] : MENTAL[kind].items.filter(function (it, i) { return notes[i] === min; }).map(function (it) { return it[0]; });
    var zone = kind === 'match' ? (total < MENTAL_ALERT ? 'Alerte' : 'Zone solide') : '';
    return { kind: kind, total: total, max: mentalMax(kind), zone: zone, work: work };
  }

  function mentalText(s) {
    var t = 'Total ' + s.total + '/' + (s.max || mentalMax(s.kind)) + (s.zone ? ' · ' + s.zone.toLowerCase() : '');
    if (s.work.length) t += ' · à travailler en premier : ' + s.work.join(', ');
    else t += ' · notes identiques, aucun critère ne ressort';
    return t;
  }

  function renderMental() {
    var kind = mentalKind(roundType());
    var notes = mentalNotes[kind];
    $('mental-sub').textContent = MENTAL[kind].sub;
    var list = $('mental-list');
    list.textContent = '';
    MENTAL[kind].items.forEach(function (it, i) {
      var box = document.createElement('div');
      box.className = 'crit';
      var t = document.createElement('div');
      t.className = 'crit-t';
      t.textContent = (i + 1) + '. ' + it[0];
      var d = document.createElement('div');
      d.className = 'hint';
      d.textContent = it[1];
      var g = document.createElement('div');
      g.className = 'rate';
      g.setAttribute('role', 'radiogroup');
      g.setAttribute('aria-label', it[0]);
      [1, 2, 3, 4].forEach(function (n) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(n);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(notes[i] === n));
        b.addEventListener('click', function () {
          notes[i] = n;
          Array.prototype.forEach.call(g.children, function (c, k) { c.setAttribute('aria-checked', String(k + 1 === n)); });
          disarm(); hideMsg('msg');
          updateMentalLive();
        });
        g.appendChild(b);
      });
      box.appendChild(t); box.appendChild(d); box.appendChild(g);
      list.appendChild(box);
    });
    updateMentalLive();
  }

  function updateMentalLive() {
    var notes = mentalNotes[mentalKind(roundType())];
    var done = notes.every(function (n) { return n > 0; });
    $('mental-live').textContent = done
      ? mentalText(mentalScore(roundType(), notes))
      : notes.filter(function (n) { return n > 0; }).length + '/' + notes.length + ' critères notés';
  }

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
      date: val('date'), type: roundType(), name: val('name'), course: val('course'),
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
    var mn = mentalNotes[mentalKind(p.type)];
    if (!mn.every(function (v) { return v >= 1 && v <= 4; })) throw new Error('Mental : note les ' + mn.length + ' critères de 1 à 4.');
    p.mental = mn.slice();
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
    if (p.mental) rows.push(['Mental', mentalText(mentalScore(p.type, p.mental))]);
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
    mentalNotes = { match: [0, 0, 0, 0], training: [0, 0, 0, 0, 0] };
    renderMental();
    updateLive();
  }

  FIELDS.forEach(function (id) {
    $(id).addEventListener('input', function () { disarm(); hideMsg('msg'); updateLive(); });
    $(id).addEventListener('change', function () { disarm(); updateLive(); });
  });
  $('type').addEventListener('change', renderMental);

  /** Bascule Compétition / Tour d'entraînement dans Saisir : le tour d'entraînement est de type 3 (grille mentale d'entraînement). */
  state.mode = 'match';
  function setMode(mode) {
    state.mode = mode;
    $('mode-match').setAttribute('aria-pressed', String(mode === 'match'));
    $('mode-training').setAttribute('aria-pressed', String(mode === 'training'));
    $('type-box').hidden = mode === 'training';
    $('mode-hint').hidden = mode !== 'training';
    $('name-hint').textContent = mode === 'training' ? 'ex. Practice putting, 9 trous' : 'ex. Championnat du club T1';
    disarm(); hideMsg('msg');
    renderMental();
  }
  $('mode-match').addEventListener('click', function () { setMode('match'); });
  $('mode-training').addEventListener('click', function () { setMode('training'); });
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
        if (res.mental) txt += ' Mental : ' + mentalText(res.mental) + '.';
        if (!SIM && res.mental && res.mentalSaved === false) txt += ' Les notes mentales n’ont pas pu être enregistrées : préviens le capitaine.';
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

  /* ---------- Encadrement (staff) ---------- */
  // Interface réservée au staff : le contrôle des droits est fait par l'API (code individuel + rôle) à chaque requête.
  // Ici, l'interface n'affiche que ce que l'API accepte de renvoyer. Tout texte venu de l'API passe par textContent.

  var staffTab = 'sum';
  state.staff = null; state.ov = null; state.sel = null; state.detail = {}; state.mentalAll = null;

  function frDate(iso) { return iso ? String(iso).split('-').reverse().join('/') : ''; }
  function can(action) { return !!(state.staff && state.staff.me && state.staff.me.actions.indexOf(action) >= 0); }

  function postStaff(action, extra) {
    return post(Object.assign({ action: action, staff: state.staff.name, pin: state.staff.pin }, extra || {}));
  }

  function staffClear() {
    drop(K.staff); drop(K.sov); drop(K.scal);
    state.staff = null; state.ov = null; state.detail = {}; state.sel = null; state.mentalAll = null;
  }

  function staffFail(err, msgId) {
    if (err.code === 'AUTH' || err.code === 'LOCKED') { staffClear(); enterStaffLogin(err.message); return; }
    setMsg(msgId, err.message, 'err');
  }

  function enterStaffLogin(msg) {
    fill($('slogin-name'), state.data.staff || [], 'Choisis ton nom');
    $('slogin-pin').value = '';
    if (msg) setMsg('slogin-msg', msg, 'err'); else hideMsg('slogin-msg');
    show('staff-login');
  }
  $('to-staff').addEventListener('click', function () { enterStaffLogin(); });
  $('back-player').addEventListener('click', function () { enterLogin(); });

  $('slogin-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    hideMsg('slogin-msg');
    var name = $('slogin-name').value;
    var pin = $('slogin-pin').value.trim();
    if (!name) return setMsg('slogin-msg', 'Choisis ton nom.', 'err');
    if (!pin) return setMsg('slogin-msg', 'Saisis ton code.', 'err');
    $('slogin-btn').disabled = true;
    $('slogin-btn').textContent = 'Connexion…';
    try {
      var res = await post({ action: 'staff_login', staff: name, pin: pin });
      if (res.ok) {
        state.staff = { name: name, pin: pin, me: res.me };
        save(K.staff, state.staff);
        drop(K.session); drop(K.recent); drop(K.space); drop(K.cal); drop(K.sov); drop(K.scal);   // une seule session à la fois sur l'appareil
        state.session = null; state.ov = null; state.detail = {}; state.sel = null; state.mentalAll = null;
        enterStaff();
      } else {
        setMsg('slogin-msg', res.error ? res.error.message : 'Connexion refusée.', 'err');
      }
    } catch (e) {
      setMsg('slogin-msg', 'Pas de réseau. La connexion demande internet la première fois.', 'err');
    } finally {
      $('slogin-btn').disabled = false;
      $('slogin-btn').textContent = 'Se connecter';
    }
  });

  function staffLogout() { staffClear(); enterLogin(); }
  $('staff-logout').addEventListener('click', staffLogout);

  function enterStaff() {
    $('staff-who').textContent = state.staff.name;
    $('staff-role').textContent = state.staff.me.label;
    $('tab-s-mental').hidden = !can('mental');
    var cov = load(K.sov, null);
    state.ov = cov && cov.team && cov.players && cov.period ? cov : null;   // copie locale abîmée ou ancienne : ignorée
    state.sel = null;
    hideMsg('s-msg');
    selectStaffTab('sum');
    show('staff');
    refreshOverview();
  }

  var STAFF_TABS = ['sum', 'players', 'rank', 'cal', 'mental'];
  STAFF_TABS.forEach(function (t) { $('tab-s-' + t).addEventListener('click', function () { selectStaffTab(t); }); });

  function selectStaffTab(name) {
    if (name === 'mental' && !can('mental')) name = 'sum';
    staffTab = name;
    hideMsg('s-msg');
    STAFF_TABS.forEach(function (t) {
      $('view-s-' + t).hidden = t !== name;
      $('tab-s-' + t).setAttribute('aria-selected', String(t === name));
    });
    if (name === 'cal') loadStaffCal();
    else if (name === 'mental') loadMental();
    else { renderStaffCurrent(); if (!state.ov) refreshOverview(); }
  }

  function renderStaffCurrent() {
    if (!state.ov) return;
    if (staffTab === 'sum') renderSummary(state.ov);
    else if (staffTab === 'players') renderPlayers();
    else if (staffTab === 'rank') renderRanking(state.ov);
  }

  async function refreshOverview() {
    if (!state.staff) return;
    if (!state.ov) setMsg('s-msg', 'Chargement… la première ouverture peut prendre quelques secondes.', 'ok');
    try {
      var res = await postStaff('staff_overview');
      if (!state.staff) return;
      if (res.ok) {
        state.ov = res; save(K.sov, res);
        if (staffTab === 'sum' || staffTab === 'players' || staffTab === 'rank') hideMsg('s-msg');
        renderStaffCurrent();
      } else staffFail(res.error || { code: 'SERVER', message: 'Erreur inconnue.' }, 's-msg');
    } catch (e) {
      if (state.ov) setMsg('s-msg', 'Hors ligne : données de la dernière connexion.', 'ok');
      else setMsg('s-msg', 'Pas de réseau. La vue s’affichera dès que le réseau revient.', 'err');
    }
  }

  /* -- petits éléments communs -- */

  function kv(dl, k, v) {
    dl.appendChild(el('dt', null, k));
    dl.appendChild(el('dd', null, v === '' || v === null || v === undefined ? '–' : String(v)));
  }

  /** Style d'un badge de catégorie (le texte vient de l'API, jamais le style). */
  function catClass(cat) {
    if (!cat) return 'badge off';
    if (cat === 'Complet') return 'badge strong';
    if (cat === 'Métronome') return 'badge ok';
    if (cat === 'Régulier') return 'badge off';
    if (cat === 'Pas au niveau') return 'badge wait';
    if (/^Faible/.test(cat)) return 'badge wait';
    return 'badge ok';
  }

  function catBadges(p) {
    var box = el('div', 'role-line');
    box.appendChild(el('span', catClass(p.category), p.category || 'Pas de catégorie'));
    if (p.info) box.appendChild(el('span', 'badge off', p.info));
    if (p.category && p.faibles && p.faibles.length && (p.category === 'Complet' || p.category === 'Métronome')) {
      box.appendChild(el('span', 'badge wait', 'faible en ' + p.faibles.map(function (k) { return p.axes[k].label.toLowerCase(); }).join(' et ')));
    }
    return box;
  }

  function freshText(f) {
    if (f.status === 'aucun') return 'Aucun tour';
    if (f.status === 'sans-date') return 'Aucun tour daté';
    return 'Dernier tour le ' + frDate(f.lastDate) + ' (il y a ' + f.days + ' jour' + (f.days > 1 ? 's' : '') + ')';
  }

  function trendNode(trend) {
    if (trend === null || trend === undefined) return null;
    var up = trend < 0;                  // écart au SSS plus bas = progression
    var s = el('span', 'trend ' + (trend === 0 ? 'flat' : (up ? 'up' : 'down')), (trend === 0 ? '=' : (up ? '▲ ' : '▼ ')) + signed(trend));
    return s;
  }

  /* -- Synthèse -- */

  function renderSummary(ov) {
    var body = $('s-sum-body');
    body.textContent = '';
    var t = ov.team;
    var n = t.nPlayers;

    var c1 = card('Sélection ' + ov.season, (ov.period && ov.period.label) || '');
    var dl = el('dl', 'kv');
    kv(dl, 'Joueurs', n);
    kv(dl, 'Sélectionnables', t.nSelectable + ' / ' + n);
    ['Titulaire', 'Équipier', 'Remplaçant', 'Prétendant', 'Sans rôle'].forEach(function (r) { if (t.roles[r]) kv(dl, r, t.roles[r]); });
    c1.appendChild(dl);
    c1.appendChild(el('p', 'hint small', 'Rôles et critères lus dans l’onglet « Equipe 2027 » du fichier. Un joueur sans rôle manque souvent de tours datés dans sa fiche.'));
    body.appendChild(c1);

    var c2 = card('Fraîcheur des données', 'Tours datés depuis le ' + frDate(ov.period.start) + ' (règle de sélection) et statistiques complètes.');
    var dl2 = el('dl', 'kv');
    kv(dl2, 'À relancer', t.nRelaunch + ' / ' + n);
    kv(dl2, 'Profils établis', t.nProfiled + ' / ' + n + (t.nProvisional ? ' (dont ' + t.nProvisional + ' provisoires)' : ''));
    c2.appendChild(dl2);
    var late = ov.players.filter(function (p) { return p.fresh.status !== 'ok'; });
    if (late.length) {
      var ul = el('ul', 'rounds');
      late.forEach(function (p) {
        var li = el('li');
        li.appendChild(el('div', 't', p.name));
        li.appendChild(el('div', 'r', freshText(p.fresh)));
        ul.appendChild(li);
      });
      c2.appendChild(ul);
    } else c2.appendChild(el('p', 'empty', 'Tous les joueurs ont saisi récemment.'));
    body.appendChild(c2);

    var c3 = card('Profil de jeu de l’équipe', 'Forts et faibles par rapport à la moyenne de l’équipe (écart d’au moins 0,5 écart-type).');
    var tb = el('table', 'stats');
    var head = el('tr');
    ['Axe', 'Forts', 'Faibles', 'Moyenne'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    tb.appendChild(head);
    t.axes.forEach(function (a) {
      var tr = el('tr');
      tr.appendChild(el('th', null, a.label));
      tr.appendChild(el('td', null, a.known >= 4 ? String(a.forts) : '–'));
      tr.appendChild(el('td', null, a.known >= 4 ? String(a.faibles) : '–'));
      tr.appendChild(el('td', null, a.ref ? (a.key === 'put' ? num(a.ref.mu, 2) : pct(a.ref.mu)) : 'peu d’informations'));
      tb.appendChild(tr);
    });
    c3.appendChild(tb);
    var fw = el('p', 'focus');
    if (t.weakAxes && t.weakAxes.length) {
      fw.appendChild(el('b', null, 'Point faible collectif : '));
      fw.appendChild(document.createTextNode(t.weakAxes.join(', ')));
    } else fw.appendChild(document.createTextNode('Aucun point faible collectif net pour le moment.'));
    c3.appendChild(fw);
    var cats = Object.keys(t.categories).sort(function (a, b) { return t.categories[b] - t.categories[a] || a.localeCompare(b, 'fr'); });
    var catBox = el('div', 'role-line');
    cats.forEach(function (k) { catBox.appendChild(el('span', catClass(k === 'Peu d’informations' ? null : k), k + ' · ' + t.categories[k])); });
    c3.appendChild(catBox);
    c3.appendChild(el('p', 'hint small', 'Profil calculé sur les 12 derniers tours avec statistiques complètes. Provisoire en dessous de 8 tours, non classé en dessous de 4.'));
    body.appendChild(c3);

    var c4 = card('Mental : critère le plus faible de l’équipe', 'Moyenne des joueurs ayant au moins 2 évaluations, affichée à partir de 5 joueurs. Aucune note individuelle.');
    var any = false;
    [['match', 'Après une compétition'], ['training', 'Après un entraînement']].forEach(function (k) {
      var m = ov.mental && ov.mental[k[0]];
      if (!m) return;
      any = true;
      var row = el('p', 'focus');
      row.appendChild(el('b', null, k[1] + ' : '));
      if (m.enough) {
        row.appendChild(document.createTextNode((m.weakest.length ? m.weakest.join(', ') : 'aucun critère ne ressort') + ' (' + m.players + ' joueurs)'));
      } else {
        row.appendChild(document.createTextNode('peu d’informations (' + m.players + ' joueur' + (m.players > 1 ? 's' : '') + ', 5 minimum)'));
      }
      c4.appendChild(row);
    });
    if (!any) c4.appendChild(el('p', 'empty', 'Pas encore d’évaluation mentale.'));
    body.appendChild(c4);
  }

  /* -- Joueurs : liste puis fiche -- */

  function renderPlayers() {
    if (state.sel) { renderDetail(state.sel); return; }
    var body = $('s-players-body');
    body.textContent = '';
    var ov = state.ov;
    var list = el('div', 'plist');
    ov.players.forEach(function (p) {
      var b = el('button', 'pitem');
      b.type = 'button';
      var top = el('div', 'ptop');
      top.appendChild(el('span', 'pname', p.name));
      if (p.selection && p.selection.role) top.appendChild(el('span', 'badge role', p.selection.role));
      b.appendChild(top);
      b.appendChild(catBadges(p.profile));
      var line = el('div', 'pline');
      var f = p.form;
      line.appendChild(document.createTextNode(f.avg5 === null ? 'Forme : pas assez de tours de compétition' : 'Forme : ' + signed(f.avg5) + ' au SSS (' + f.n5 + ' derniers tours) '));
      var tr = trendNode(f.trend);
      if (tr) line.appendChild(tr);
      b.appendChild(line);
      b.appendChild(el('div', 'pline muted', freshText(p.fresh)));
      b.addEventListener('click', function () { openPlayer(p.name); });
      list.appendChild(b);
    });
    body.appendChild(list);
  }

  async function openPlayer(name) {
    state.sel = name;
    renderDetail(name);
    if (state.detail[name]) return;
    try {
      var res = await postStaff('staff_player', { target: name });
      if (!state.staff) return;
      if (res.ok) { state.detail[name] = res; hideMsg('s-msg'); if (state.sel === name) renderDetail(name); }
      else staffFail(res.error || { code: 'SERVER', message: 'Erreur inconnue.' }, 's-msg');
    } catch (e) {
      setMsg('s-msg', 'Pas de réseau. La fiche s’affichera dès que le réseau revient.', 'err');
    }
  }

  function levelBadge(a) {
    if (a.level === 'fort') return el('span', 'badge ok', 'Fort');
    if (a.level === 'faible') return el('span', 'badge wait', 'Faible');
    if (a.level === 'moyen') return el('span', 'badge off', 'Moyen');
    return el('span', 'badge off', a.note || '–');
  }

  function renderDetail(name) {
    var body = $('s-players-body');
    body.textContent = '';
    var back = el('button', 'secondary', '← Tous les joueurs');
    back.type = 'button';
    back.addEventListener('click', function () { state.sel = null; hideMsg('s-msg'); renderPlayers(); });
    body.appendChild(back);

    var d = state.detail[name];
    var p = (state.ov && state.ov.players.filter(function (x) { return x.name === name; })[0]) || (d && d.detail) || null;
    var head = card(name);
    if (p && p.selection && p.selection.role) {
      var rl = el('div', 'role-line');
      rl.appendChild(el('span', 'badge role', p.selection.role));
      if (p.selection.selectable) rl.appendChild(el('span', 'badge ' + (p.selection.selectable === 'Oui' ? 'ok' : 'wait'), 'Sélectionnable : ' + p.selection.selectable));
      head.appendChild(rl);
      var dl0 = el('dl', 'kv');
      kv(dl0, 'Moyenne contre le SSS', p.selection.avg);
      kv(dl0, 'Tours retenus', p.selection.retained);
      kv(dl0, 'Tours de compétition', p.selection.comp);
      head.appendChild(dl0);
      if (p.selection.missing && p.selection.selectable !== 'Oui') head.appendChild(el('p', 'hint small', p.selection.missing));
    }
    body.appendChild(head);

    if (p) {
      var pc = card('Profil de jeu', 'Comparé à la moyenne de l’équipe. Valeur = moyenne sur les ' + p.profile.n + ' derniers tours avec statistiques' + (p.profile.nChip ? ' (chip-putts : ' + p.profile.nChip + ' tours)' : '') + '.');
      pc.appendChild(catBadges(p.profile));
      var tb = el('table', 'stats');
      var hr = el('tr');
      ['Axe', 'Valeur', 'Écart équipe', 'Niveau'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      tb.appendChild(hr);
      ['dep', 'app', 'put', 'chip'].forEach(function (k) {
        var a = p.profile.axes[k];
        var tr = el('tr');
        tr.appendChild(el('th', null, a.label));
        tr.appendChild(el('td', null, a.value === null ? '–' : (k === 'put' ? num(a.value, 2) : pct(a.value))));
        tr.appendChild(el('td', null, a.z === null ? '–' : signed(a.z)));
        var td = el('td');
        td.appendChild(levelBadge(a));
        tr.appendChild(td);
        tb.appendChild(tr);
      });
      pc.appendChild(tb);
      pc.appendChild(el('p', 'hint small', 'Écart équipe en écarts-types : positif = meilleur que l’équipe (pour le putting, un TRP plus bas est meilleur). Fort à +0,5 et plus, faible à −0,5 et moins.'));
      body.appendChild(pc);

      var fc = card('Données', freshText(p.fresh));
      var dl1 = el('dl', 'kv');
      kv(dl1, 'Tours dans la fiche', p.fresh.nRounds);
      kv(dl1, 'Tours datés depuis le ' + frDate(state.ov ? state.ov.period.start : ''), p.fresh.datedSince);
      kv(dl1, 'Dont avec stats complètes', p.fresh.statsSince);
      kv(dl1, 'Couverture des stats (12 derniers tours)', p.fresh.coverage === null ? '–' : p.fresh.coverage + ' %');
      fc.appendChild(dl1);
      body.appendChild(fc);
    }

    if (!d) { body.appendChild(el('p', 'empty', 'Chargement de la fiche…')); return; }
    var sp = d.space || {};
    body.appendChild(averagesCard(sp.seasons || [], sp.last3));
    appendCharts(body, sp.charts || {});
    var rc = card('Derniers tours');
    rc.appendChild(roundsList(sp.recent || []));
    body.appendChild(rc);
  }

  /* -- Classement -- */

  function renderRanking(ov) {
    var body = $('s-rank-body');
    body.textContent = '';
    var c = card('Forme', 'Moyenne de l’écart au SSS sur les 5 derniers tours de compétition (3 minimum). Plus bas = mieux. ▲ = progression contre les 5 tours précédents.');
    var ranked = ov.players.filter(function (p) { return p.rank !== null; }).sort(function (a, b) { return a.rank - b.rank; });
    if (ranked.length) {
      var tb = el('table', 'stats rank');
      var hr = el('tr');
      ['#', 'Joueur', 'Forme', 'Évol.'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      tb.appendChild(hr);
      ranked.forEach(function (p) {
        var tr = el('tr');
        tr.appendChild(el('td', null, String(p.rank)));
        var tn = el('td', 'nm');
        tn.appendChild(el('div', null, p.name));
        if (p.selection && p.selection.role) tn.appendChild(el('small', null, p.selection.role));
        tr.appendChild(tn);
        tr.appendChild(el('td', 'cur', signed(p.form.avg5)));
        var te = el('td');
        var tr2 = trendNode(p.form.trend);
        te.appendChild(tr2 || document.createTextNode('–'));
        tr.appendChild(te);
        tb.appendChild(tr);
      });
      c.appendChild(tb);
    } else c.appendChild(el('p', 'empty', 'Pas encore assez de tours de compétition.'));
    body.appendChild(c);

    var rest = ov.players.filter(function (p) { return p.rank === null; });
    if (rest.length) {
      var c2 = card('Pas assez de tours de compétition', 'Moins de 3 tours de compétition avec écart au SSS : pas de classement.');
      var ul = el('ul', 'rounds');
      rest.forEach(function (p) {
        var li = el('li');
        li.appendChild(el('div', 't', p.name));
        li.appendChild(el('div', 'r', p.form.nComp + ' tour' + (p.form.nComp > 1 ? 's' : '')));
        ul.appendChild(li);
      });
      c2.appendChild(ul);
      body.appendChild(c2);
    }
  }

  /* -- Calendrier -- */

  async function loadStaffCal() {
    if (!state.staff) return;
    var cached = load(K.scal, null);
    if (cached && !Array.isArray(cached.events) && !cached.missing) cached = null;
    if (cached) { renderCal(cached, 's-cal-body'); hideMsg('s-msg'); }
    else { $('s-cal-body').textContent = ''; setMsg('s-msg', 'Chargement…', 'ok'); }
    try {
      var res = await postStaff('staff_calendar');
      if (!state.staff) return;
      if (res.ok) { save(K.scal, res); if (staffTab === 'cal') { hideMsg('s-msg'); renderCal(res, 's-cal-body'); } }
      else staffFail(res.error || { code: 'SERVER', message: 'Erreur inconnue.' }, 's-msg');
    } catch (e) {
      if (cached) setMsg('s-msg', 'Hors ligne : calendrier de la dernière connexion.', 'ok');
      else setMsg('s-msg', 'Pas de réseau. Le calendrier s’affichera dès que le réseau revient.', 'err');
    }
  }

  /* -- Mental individuel (capitaine seulement ; jamais gardé sur l'appareil) -- */

  async function loadMental() {
    if (!state.staff || !can('mental')) return;
    if (state.mentalAll) renderMentalAll(state.mentalAll);
    else { $('s-mental-body').textContent = ''; setMsg('s-msg', 'Chargement…', 'ok'); }
    try {
      var res = await postStaff('staff_mental');
      if (!state.staff) return;
      if (res.ok) { state.mentalAll = res; if (staffTab === 'mental') { hideMsg('s-msg'); renderMentalAll(res); } }
      else staffFail(res.error || { code: 'SERVER', message: 'Erreur inconnue.' }, 's-msg');
    } catch (e) {
      if (state.mentalAll) setMsg('s-msg', 'Hors ligne : données de la dernière ouverture.', 'ok');
      else setMsg('s-msg', 'Pas de réseau. Cette vue demande internet.', 'err');
    }
  }

  function renderMentalAll(res) {
    var body = $('s-mental-body');
    body.textContent = '';
    var intro = card('Mental individuel', 'Visible par toi seul. Ces données restent en mémoire le temps de la consultation et ne sont pas gardées sur l’appareil.');
    body.appendChild(intro);
    res.players.forEach(function (p) {
      var det = el('details', 'card mdet');
      var sum = el('summary');
      sum.appendChild(el('span', 'pname', p.name));
      var tot = p.match.n + p.training.n;
      sum.appendChild(el('span', 'hint', tot ? tot + ' évaluation' + (tot > 1 ? 's' : '') : 'aucune'));
      det.appendChild(sum);
      [['match', 'Après une compétition'], ['training', 'Après un entraînement']].forEach(function (k) {
        var m = p[k[0]];
        if (!m || !m.n) return;
        var sec = el('div', 'mental-sec');
        sec.appendChild(el('h3', null, k[1] + ' · ' + m.n + ' évaluation' + (m.n > 1 ? 's' : '')));
        if (m.last) sec.appendChild(el('p', 'hint small', 'Dernière : ' + frDate(m.last.date) + ' · ' + m.last.name + ' · ' + m.last.total + '/' + mentalMax(k[0]) + (m.last.zone ? ' · ' + m.last.zone : '')));
        if (m.avg) {
          sec.appendChild(el('p', 'hint small', 'Total moyen : ' + num(m.total, 1) + '/' + mentalMax(k[0])));
          if (m.weakest.length) {
            var w = el('p', 'focus');
            w.appendChild(el('b', null, 'À travailler en premier : '));
            w.appendChild(document.createTextNode(m.weakest.join(', ')));
            sec.appendChild(w);
          }
        } else sec.appendChild(el('p', 'hint small', 'Les moyennes apparaissent dès 2 évaluations.'));
        var ul = el('ul', 'rounds');
        (m.history || []).forEach(function (h) {
          var li = el('li');
          var left = el('div');
          left.appendChild(el('div', 't', h.name));
          left.appendChild(el('div', 's', frDate(h.date) + (h.work && h.work.length ? ' · à travailler : ' + h.work.join(', ') : '')));
          var right = el('div', 'r', h.total + '/' + mentalMax(k[0]));
          if (h.zone) right.appendChild(el('small', null, h.zone));
          li.appendChild(left); li.appendChild(right);
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        det.appendChild(sec);
      });
      body.appendChild(det);
    });
  }

  /* ---------- Lancement ---------- */

  renderMental();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* sans cache hors ligne */ }); });
  }
  boot();
})();
