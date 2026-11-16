(function () {
  'use strict';

  var API = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  var SIM = /[?&]simulation=1/.test(window.location.search);   // ?simulation=1 : vérifie tout, n'écrit rien
  var K = { init: 'stats.init', session: 'stats.session', queue: 'stats.queue', recent: 'stats.recent', hint: 'stats.hint' };
  var TYPES = { 1: 'Compétition', 2: 'Tour annoncé', 3: 'Entraînement (non compté)' };
  var state = { data: null, session: null, armed: false, flushing: false };

  function $(id) { return document.getElementById(id); }
  function load(k, fallback) { try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  function drop(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

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

  function post(body) {
    return request(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  }

  /* ---------- Affichage ---------- */

  function show(screen) {
    ['loading', 'login', 'app'].forEach(function (s) { $('screen-' + s).hidden = s !== screen; });
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
      op.value = v; op.textContent = v;
      sel.appendChild(op);
    });
  }

  function signed(x) {
    var r = Math.round(x * 10) / 10;
    var s = Math.abs(r).toFixed(1).replace('.', ',');
    return r > 0 ? '+' + s : (r < 0 ? '-' + s : s);
  }
  function signedInt(s) {
    var n = parseFloat(String(s).replace(',', '.'));
    return isNaN(n) ? String(s) : (n > 0 ? '+' + n : String(n));
  }

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

    var data = null;
    try {
      var res = await request(API + '?action=init');
      if (res && res.ok) { data = res; save(K.init, res); }
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

  function enterLogin() {
    fill($('login-player'), state.data.players, 'Choisis ton nom');
    $('login-pin').value = '';
    hideMsg('login-msg');
    show('login');
  }

  function enterApp() {
    fill($('course'), (state.data.courses || []).map(function (c) { return c.name; }), 'Choisis le parcours');
    $('date').value = state.data.today;
    $('date').max = state.data.today;
    $('who').textContent = state.session.player;
    $('sim').hidden = !SIM;
    renderRecent(load(K.recent, []));
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
      if (res.ok) { save(K.recent, res.recent); renderRecent(res.recent); }
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
    drop(K.recent);
    state.session = null;
    enterLogin();
  }
  $('logout').addEventListener('click', logout);
  $('retry').addEventListener('click', boot);

  /* ---------- Onglets ---------- */

  function selectTab(name) {
    $('view-form').hidden = name !== 'form';
    $('view-recent').hidden = name !== 'recent';
    $('tab-form').setAttribute('aria-selected', String(name === 'form'));
    $('tab-recent').setAttribute('aria-selected', String(name === 'recent'));
  }
  $('tab-form').addEventListener('click', function () { selectTab('form'); });
  $('tab-recent').addEventListener('click', function () { selectTab('recent'); });

  function renderRecent(list) {
    var ul = $('recent-list');
    ul.innerHTML = '';
    if (!list || !list.length) {
      var li0 = document.createElement('li');
      li0.textContent = 'Aucun tour enregistré pour le moment.';
      ul.appendChild(li0);
      return;
    }
    list.forEach(function (t) {
      var li = document.createElement('li');
      var left = document.createElement('div');
      var title = document.createElement('div'); title.className = 't'; title.textContent = t.name;
      var sub = document.createElement('div'); sub.className = 's';
      sub.textContent = (t.date || 'Saison 2026') + ' · ' + t.course;
      left.appendChild(title); left.appendChild(sub);
      var right = document.createElement('div'); right.className = 'r';
      right.textContent = signedInt(t.score);
      var small = document.createElement('small');
      small.textContent = 'SSS ' + (t.ecart || '-') + (t.trp ? ' · TRP ' + t.trp : '');
      right.appendChild(small);
      li.appendChild(left); li.appendChild(right);
      ul.appendChild(li);
    });
  }

  /* ---------- Formulaire ---------- */

  var FIELDS = ['date', 'type', 'name', 'course', 'strokes', 'fairways', 'greens', 'putts', 'chipMade', 'chipTried', 'comment'];

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
    var n = [p.fairways, p.greens, p.putts].filter(function (v) { return v !== ''; }).length;
    if (n !== 0 && n !== 3) throw new Error('Fairways, greens et putts vont ensemble : renseigne les trois ou aucun.');
    if ((p.chipMade === '') !== (p.chipTried === '')) throw new Error('Chip-putts : renseigne les réussis et les tentés, ou aucun des deux.');
    if (p.chipMade !== '' && p.chipMade > p.chipTried) throw new Error('Chip-putts : les réussis ne peuvent pas dépasser les tentés.');
    return p;
  }

  function updateLive() {
    var c = courseByName($('course').value);
    if (!c) { $('live').textContent = 'Choisis le parcours et saisis ton score.'; return; }
    var sss = String(c.sss).replace('.', ',');
    if (!$('strokes').value) { $('live').textContent = c.name + ' : par ' + c.par + ', SSS ' + sss + '.'; return; }
    var s = Number($('strokes').value);
    $('live').textContent = 'Au par : ' + signed(s - c.par) + '  ·  Écart au SSS (' + sss + ') : ' + signed(s - c.sss);
  }

  function recapNode(p) {
    var c = courseByName(p.course);
    var rows = [
      ['Joueur', state.session.player],
      ['Tour', p.name + ' · ' + p.date.split('-').reverse().join('/') + ' · ' + TYPES[p.type]],
      ['Parcours', p.course],
      ['Score', p.strokes + ' coups (' + signed(p.strokes - c.par) + ' au par, ' + signed(p.strokes - c.sss) + ' au SSS)']
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
    ['name', 'strokes', 'fairways', 'greens', 'putts', 'chipMade', 'chipTried', 'comment'].forEach(function (id) { $(id).value = ''; });
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
        if (!SIM) { save(K.recent, res.recent); renderRecent(res.recent); }
        var txt = SIM
          ? 'Simulation réussie, rien n’a été écrit. Écart au SSS : ' + res.ecart + (res.trp ? ' · TRP : ' + res.trp : '') + ' · ligne prévue : ' + res.row + '.'
          : 'Enregistré. Écart au SSS : ' + res.ecart + (res.trp ? ' · TRP : ' + res.trp : '') + (res.conv ? ' · Conv. green : ' + res.conv : '') + '.';
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
        } else if (res.error && (res.error.code === 'AUTH' || res.error.code === 'LOCKED')) {
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
      renderRecent(load(K.recent, []));
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
