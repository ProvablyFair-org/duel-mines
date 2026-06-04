// Capture methodology, published for provenance/review.
// Reference record, not a runnable tool.
// Dataset in `data/`, hash-verified by the suite.

if (window._mineskill) window._mineskill();

(function () {
  'use strict';

  var INSTANCE = Date.now();
  window._mineskill = function () { INSTANCE = -1; };

  // ── Phase config ──────────────────────────────────────────────────────────
  var PHASES = [
    { key: 'A', name: '24x200 balanced', total: 4800, amount: '0.01', minesFn: null },
    { key: 'B', name: 'mines=24 deep',   total: 1000, amount: '0.01', minesFn: function () { return 24; } },
    { key: 'C', name: 'mines=12 $10',    total: 200,  amount: '10',   minesFn: function () { return 12; } },
    { key: 'D', name: 'custom seed',     total: 500,  amount: '0.01', minesFn: function () { return Math.floor(Math.random() * 24) + 1; } },
  ];

  var BETS_PER_EPOCH = 50;
  var BET_DELAY = 500;
  var MAX_ERRORS = 8;
  var DB_NAME = 'mines_capture_v5';

  // ── IndexedDB ─────────────────────────────────────────────────────────────
  var db = null;

  function openDB() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('bets')) d.createObjectStore('bets', { autoIncrement: true });
        if (!d.objectStoreNames.contains('seeds')) d.createObjectStore('seeds', { autoIncrement: true });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function dbPut(store, value, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readwrite');
      var req = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).add(value);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGetAll(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGet(store, key) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbClear(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readwrite').objectStore(store).clear();
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbCount(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readonly').objectStore(store).count();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var meta = {};
  var paused = false;
  var betCount = 0;
  var seedCount = 0;
  var balancedQueue = [];

  function freshMeta() {
    return {
      phaseIdx: 0, phaseBets: 0, epochBets: 0, phaseStarted: false,
      token: null, tokenAt: 0, errors: 0, running: false,
      lastNextHash: null, createdAt: new Date().toISOString(),
      lastTxId: null,
      activeServerSeedHashed: null, activeClientSeed: null,
      phaseBetCounts: { A: 0, B: 0, C: 0, D: 0 },
      balancedQueue: null,
    };
  }

  function saveMeta() { return dbPut('meta', meta, 'state'); }

  function ensureBalancedQueue() {
    if (meta.balancedQueue && meta.balancedQueue.length === 4800) {
      balancedQueue = meta.balancedQueue;
    } else {
      var q = [];
      for (var m = 1; m <= 24; m++) for (var i = 0; i < 200; i++) q.push(m);
      for (var j = q.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = q[j]; q[j] = q[k]; q[k] = t; }
      balancedQueue = q;
      meta.balancedQueue = q;
    }
  }

  // ── Logging ───────────────────────────────────────────────────────────────
  function log(msg) { console.log('%c[mines] ' + msg, 'color:#33ccff'); updatePanel(); }
  function warn(msg) { console.warn('%c[mines] ' + msg, 'color:#ffb74d'); updatePanel(); }
  function good(msg) { console.log('%c[mines] ' + msg, 'color:#81c784'); updatePanel(); }

  // ── Visual Panel ──────────────────────────────────────────────────────────
  function buildPanel() {
    var old = document.getElementById('cap-panel');
    if (old) old.remove();

    var d = document.createElement('div');
    d.id = 'cap-panel';
    Object.assign(d.style, {
      position:'fixed', bottom:'16px', right:'16px', zIndex:'99999',
      background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:'8px',
      padding:'12px 16px', fontFamily:'monospace', fontSize:'11px',
      color:'#b8cfe0', minWidth:'280px', boxShadow:'0 4px 24px rgba(0,0,0,.7)',
      cursor:'move', userSelect:'none',
    });

    var dragging = false, ox = 0, oy = 0;
    d.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; ox = e.clientX - d.offsetLeft; oy = e.clientY - d.offsetTop;
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      d.style.left = (e.clientX - ox) + 'px'; d.style.top = (e.clientY - oy) + 'px';
      d.style.right = 'auto'; d.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { dragging = false; });

    var title = document.createElement('div');
    title.textContent = 'MINES CAPTURE';
    Object.assign(title.style, { color:'#f0883e', fontWeight:'700', fontSize:'13px' });
    d.appendChild(title);

    var st = document.createElement('div');
    st.id = 'cap-status';
    Object.assign(st.style, { margin:'6px 0', color:'#4d6880', fontSize:'10px' });
    d.appendChild(st);

    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var row = document.createElement('div');
      Object.assign(row.style, { display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' });

      var lbl = document.createElement('span');
      lbl.textContent = ph.key;
      Object.assign(lbl.style, { width:'14px', color:'#4d6880', fontWeight:'700' });

      var barOuter = document.createElement('div');
      Object.assign(barOuter.style, { flex:'1', height:'8px', background:'#161e28', borderRadius:'4px', overflow:'hidden' });
      var fill = document.createElement('div');
      fill.id = 'cap-bar-' + ph.key;
      Object.assign(fill.style, { height:'100%', width:'0%', background:'#2dff82', borderRadius:'4px', transition:'width .3s' });
      barOuter.appendChild(fill);

      var ct = document.createElement('span');
      ct.id = 'cap-ct-' + ph.key;
      ct.textContent = '0/' + ph.total;
      Object.assign(ct.style, { width:'70px', textAlign:'right', fontSize:'9px', color:'#4d6880' });

      row.appendChild(lbl); row.appendChild(barOuter); row.appendChild(ct);
      d.appendChild(row);
    }

    var seedLine = document.createElement('div');
    seedLine.id = 'cap-seeds';
    Object.assign(seedLine.style, { margin:'6px 0 4px', fontSize:'10px', color:'#4d6880' });
    d.appendChild(seedLine);

    var btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display:'flex', gap:'4px', marginTop:'8px' });

    function mkBtn(text, color, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        flex:'1', padding:'5px 0', background:'#161e28', border:'1px solid #1e2d3d',
        color: color, borderRadius:'3px', cursor:'pointer', fontFamily:'monospace',
        fontSize:'10px', fontWeight:'700',
      });
      b.addEventListener('click', fn);
      return b;
    }

    btnRow.appendChild(mkBtn('GO', '#2dff82', function () { pub.go(); }));
    btnRow.appendChild(mkBtn('PAUSE', '#ffcc44', function () { pub.pause(); }));
    btnRow.appendChild(mkBtn('SAVE', '#33ccff', function () { pub.save(); }));
    d.appendChild(btnRow);

    document.body.appendChild(d);
  }

  function updatePanel() {
    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var n = meta.phaseBetCounts ? (meta.phaseBetCounts[ph.key] || 0) : 0;
      var bar = document.getElementById('cap-bar-' + ph.key);
      var ct = document.getElementById('cap-ct-' + ph.key);
      if (bar) {
        bar.style.width = Math.min(100, n / ph.total * 100) + '%';
        bar.style.background = n >= ph.total ? '#33ccff' : '#2dff82';
      }
      if (ct) ct.textContent = n + '/' + ph.total;
    }
    var st = document.getElementById('cap-status');
    if (st) {
      var state = paused ? 'paused' : (meta.running ? 'running' : 'idle');
      var errStr = meta.errors > 0 ? '  err:' + meta.errors : '';
      st.textContent = state + '  |  bets: ' + betCount + '  |  seeds: ' + seedCount + errStr;
      st.style.color = meta.running && !paused ? '#2dff82' : '#4d6880';
    }
    var sl = document.getElementById('cap-seeds');
    if (sl) sl.textContent = 'seeds: ' + seedCount + '  |  epoch: ' + (meta.epochBets || 0) + '/' + BETS_PER_EPOCH;
  }

  // ── API ───────────────────────────────────────────────────────────────────
  var HEADERS = {
    'content-type': 'application/json', 'accept': 'application/json, text/plain, */*',
    'x-duel-device-identifier': localStorage.getItem('security:uuid') || '',
    'x-env-class': localStorage.getItem('env_class') || 'blue',
  };

  function api(method, path, body) {
    var opts = { method: method, credentials: 'include', headers: HEADERS };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || j.success === false) {
          var errDetail = JSON.stringify(j).slice(0, 400);
          throw new Error((j.message || errDetail).slice(0, 200));
        }
        return j.data || j;
      });
    });
  }

  function refreshToken() {
    return api('POST', '/api/v2/user/security/token', {
      uuid: localStorage.getItem('security:uuid'), code: '0000', type: 'standard',
    }).then(function (r) { meta.token = r.token || r; meta.tokenAt = Date.now(); return meta.token; });
  }

  function ensureToken() {
    return (Date.now() - meta.tokenAt > 300000) ? refreshToken() : Promise.resolve(meta.token);
  }

  function getActiveSeed() { return api('GET', '/api/v2/client-seed'); }

  function generateClientSeed() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var s = ''; for (var i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function rotateSeed(customSeed) {
    var clientSeed = customSeed || generateClientSeed();
    return ensureToken().then(function (token) {
      log('rotate: clientSeed=' + clientSeed.slice(0, 8) + '...');
      function tryRotate(attempt) {
        return api('POST', '/api/v2/client-seed/rotate', { client_seed: clientSeed, security_token: token }).catch(function (e) {
          if (/complete.*round|rotating/i.test(e.message) && attempt < 4) {
            return new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); }).then(function () { return tryRotate(attempt + 1); });
          }
          throw e;
        });
      }
      return tryRotate(0);
    });
  }

  function getTransaction(txId) { return api('GET', '/api/v2/user/transactions/' + txId); }

  // ── Clear any stuck active round (loop until confirmed clear) ──────────
  function ensureClear(token) {
    function attempt(n) {
      if (n >= 5) return Promise.resolve();
      return api('GET', '/api/v2/mines/active').then(function (data) {
        if (!data.round) return;
        var rid = data.round.id;
        log('clearing stuck round ' + rid);
        return api('POST', '/api/v2/mines/cashout', { round_id: rid, security_token: token })
          .then(function () { return wait(300); })
          .catch(function () {
            return api('POST', '/api/v2/mines/reveal', { position: 0, round_id: rid, security_token: token })
              .then(function (rev) {
                if (rev.round.status !== 2 && !rev.round.mines_positions) {
                  return api('POST', '/api/v2/mines/cashout', { round_id: rid, security_token: token }).catch(function () {});
                }
              })
              .catch(function () {});
          })
          .then(function () { return wait(500); })
          .then(function () { return attempt(n + 1); });
      }).catch(function () {});
    }
    return attempt(0);
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ── 3-step mines game with retry: start → reveal(0) → cashout ────────────
  function playOneGame(minesCount, amount) {
    return ensureToken().then(function (token) {
      function tryGame(attempt) {
        return ensureClear(token).then(function () {
          return api('POST', '/api/v2/mines/start', {
            mines_count: minesCount, amount: String(amount), currency: 105, security_token: token,
          });
        }).then(function (startData) {
          var roundId = startData.round.id;
          return api('POST', '/api/v2/mines/reveal', {
            position: 0, round_id: roundId, security_token: token,
          }).then(function (revealData) {
            var r = revealData.round;
            if (r.status === 2 || r.mines_positions || r.transaction_id) return r;
            return api('POST', '/api/v2/mines/cashout', {
              round_id: roundId, security_token: token,
            }).then(function (cashoutData) {
              return cashoutData.round;
            }).catch(function () { return r; });
          });
        }).catch(function (e) {
          if (attempt < 2) return wait(500).then(function () { return tryGame(attempt + 1); });
          throw e;
        });
      }
      return tryGame(0);
    });
  }

  // ── Seed rotation (dice-proven pattern) ───────────────────────────────────
  function doRotation(phase, customSeed) {
    return Promise.resolve().then(function () {
      if (!meta.lastNextHash) {
        return getActiveSeed().then(function (s) {
          meta.lastNextHash = s.next_server_seed_hash;
          log('initial next_hash: ' + meta.lastNextHash.slice(0, 24) + '...');
        });
      }
    }).then(function () {
      return rotateSeed(customSeed);
    }).then(function (rot) {
      var entry = {
        at: new Date().toISOString(), context: 'rotate-phase-' + phase, phase: phase,
        seed: { clientSeed: rot.client_seed, serverSeedHashed: rot.server_seed_hashed,
                nextServerSeedHash: rot.next_server_seed_hash, serverSeed: null },
        nonce: 0,
      };
      var promoted = rot.server_seed_hashed === meta.lastNextHash;
      entry.nextSeedPromotion = {
        previousNextHash: meta.lastNextHash, newActiveHash: rot.server_seed_hashed,
        newNextHash: rot.next_server_seed_hash, match: promoted,
      };
      if (promoted) good('promoted: ' + meta.lastNextHash.slice(0, 16) + ' -> ' + rot.server_seed_hashed.slice(0, 16));
      else warn('MISMATCH!');
      meta.lastNextHash = rot.next_server_seed_hash;
      meta.activeServerSeedHashed = rot.server_seed_hashed;
      meta.activeClientSeed = rot.client_seed;

      if (meta.lastTxId) {
        return getTransaction(meta.lastTxId).then(function (tx) {
          var txData = tx.data || tx;
          entry.seed.serverSeed = txData.server_seed || null;
          entry.revealedFrom = { transactionId: meta.lastTxId };
          good('revealed: ' + (entry.seed.serverSeed || 'PENDING').slice(0, 16) + '...');
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        }).catch(function () {
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        });
      }
      return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
    });
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  function runLoop() {
    if (INSTANCE === -1 || paused) { log('paused'); meta.running = false; saveMeta(); updatePanel(); return; }
    var phaseIdx = meta.phaseIdx;
    if (phaseIdx >= PHASES.length) {
      good('ALL PHASES COMPLETE — ' + betCount + ' bets, ' + seedCount + ' seeds. Run mines.save()');
      meta.running = false; saveMeta(); updatePanel();
      return;
    }
    var cfg = PHASES[phaseIdx];

    // Phase start: rotate seed (every phase)
    if (!meta.phaseStarted) {
      meta.phaseStarted = true; saveMeta();
      log('Phase ' + cfg.key + ': ' + cfg.name + ' — ' + cfg.total + ' @ $' + cfg.amount);
      if (cfg.key === 'A') ensureBalancedQueue();
      var cs = cfg.key === 'D' ? 'pfaudit' + Date.now().toString(36) : null;
      doRotation(cfg.key, cs).then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); }).catch(function (e) {
        warn('rotation failed: ' + e.message); meta.errors++;
        if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
        saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
      });
      return;
    }

    // Phase end: rotate to reveal last epoch, advance
    if (meta.phaseBets >= cfg.total) {
      doRotation(cfg.key, null).then(function () {
        good('Phase ' + cfg.key + ' done');
        meta.phaseIdx++; meta.phaseBets = 0; meta.epochBets = 0; meta.phaseStarted = false; saveMeta();
        updatePanel(); setTimeout(runLoop, BET_DELAY);
      }).catch(function (e) { warn('end rotation failed: ' + e.message); setTimeout(runLoop, 3000); });
      return;
    }

    // Epoch boundary: rotate every 50 bets
    if (meta.epochBets >= BETS_PER_EPOCH) {
      var ds = cfg.key === 'D' ? 'pfaudit' + Date.now().toString(36) : null;
      doRotation(cfg.key, ds).then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); }).catch(function (e) {
        warn('epoch rotation: ' + e.message); meta.errors++;
        if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
        saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
      });
      return;
    }

    // Pick mine count
    var minesCount;
    if (cfg.key === 'A') {
      minesCount = balancedQueue[meta.phaseBets] || (Math.floor(Math.random() * 24) + 1);
    } else {
      minesCount = cfg.minesFn();
    }

    // Play one game (start → reveal → cashout), then fetch nonce
    playOneGame(minesCount, cfg.amount).then(function (r) {
      return getActiveSeed().then(function (seedState) {
        var actualNonce = seedState.nonce != null ? seedState.nonce - 1 : meta.epochBets;
        if (actualNonce < 0) actualNonce = 0;

        var outcome = (r.is_win === true) ? 'win' : 'loss';
        var rec = {
          at: new Date().toISOString(), phase: cfg.key,
          request: { mines_count: minesCount, amount: cfg.amount },
          response: {
            round_id: r.id,
            outcome: outcome,
            mines_count: r.mines_count,
            revealed_positions: r.revealed_positions || [],
            mines_positions: r.mines_positions || [],
            multiplier: r.multiplier,
            no_house_edge_multiplier: r.no_house_edge_multiplier || null,
            amount_won: r.amount_won,
            amount_currency: r.amount_currency,
            transaction_id: r.transaction_id,
            effective_edge: r.effective_edge,
          },
          seed: {
            serverSeedHashed: meta.activeServerSeedHashed,
            clientSeed: meta.activeClientSeed,
            nonce: actualNonce,
          },
        };
        meta.lastTxId = r.transaction_id;
        meta.phaseBets++;
        meta.epochBets = seedState.nonce != null ? seedState.nonce : (meta.epochBets + 1);
        meta.errors = 0;
        if (!meta.phaseBetCounts) meta.phaseBetCounts = { A: 0, B: 0, C: 0, D: 0 };
        meta.phaseBetCounts[cfg.key]++;
        betCount++;
        return dbPut('bets', rec).then(function () { return saveMeta(); }).then(function () {
          if (betCount % 100 === 0) log('Phase ' + cfg.key + ': ' + meta.phaseBets + '/' + cfg.total + ' | total: ' + betCount + ' | mines=' + minesCount + ' ' + outcome);
          updatePanel();
        });
      });
    }).then(function () {
      setTimeout(runLoop, BET_DELAY);
    }).catch(function (e) {
      warn('bet failed: ' + e.message); meta.errors++;
      if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
      saveMeta(); updatePanel(); setTimeout(runLoop, 2000);
    });
  }

  });

console.log('[mines] reference record loaded — see data/ for the captured dataset');
