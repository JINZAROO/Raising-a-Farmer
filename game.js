'use strict';
(() => {
  // ============================================================
  //  설정
  // ============================================================
  const SAVE_KEY = 'raising-a-farmer-v1';
  const MAX_PLOTS = 8;
  const BASE_PLOTS = 2;
  const BOOST_ADD = 120;          // 광고 1회당 2배 속도 시간(초)
  const BOOST_CAP = 600;          // 최대 누적 시간(초)
  const OFFLINE_CAP = 8 * 3600;   // 오프라인 보상 최대 8시간
  const AD_TEST_MODE = true;      // true: 가짜 광고(5초 카운트다운). 실제 광고 SDK 연동 시 showRewardedAd 교체

  const CROPS = [
    { name: '상추',      emoji: '🥬', time: 4,   value: 1,     xp: 1 },
    { name: '당근',      emoji: '🥕', time: 6,   value: 3,     xp: 2 },
    { name: '감자',      emoji: '🥔', time: 9,   value: 8,     xp: 5 },
    { name: '옥수수',    emoji: '🌽', time: 13,  value: 22,    xp: 12 },
    { name: '토마토',    emoji: '🍅', time: 18,  value: 60,    xp: 30 },
    { name: '가지',      emoji: '🍆', time: 25,  value: 170,   xp: 75 },
    { name: '호박',      emoji: '🎃', time: 35,  value: 480,   xp: 190 },
    { name: '수박',      emoji: '🍉', time: 50,  value: 1400,  xp: 480 },
    { name: '포도',      emoji: '🍇', time: 70,  value: 4000,  xp: 1200 },
    { name: '황금 사과', emoji: '🍎', time: 100, value: 12000, xp: 3000 },
  ];

  const STAGES = [
    { at: 0,  name: '새내기 농부' },
    { at: 3,  name: '밀짚모자 농부' },
    { at: 8,  name: '멜빵바지 일꾼' },
    { at: 15, name: '숙련 농부' },
    { at: 26, name: '전문 농사꾼' },
    { at: 42, name: '전설의 농부' },
  ];

  // ============================================================
  //  유틸
  // ============================================================
  const $ = (id) => document.getElementById(id);

  function fmt(n) {
    n = Math.floor(n);
    if (n < 10000) return n.toLocaleString('ko-KR');
    const units = ['', '만', '억', '조', '경', '해'];
    let i = 0, v = n;
    while (v >= 10000 && i < units.length - 1) { v /= 10000; i++; }
    const s = v >= 100 ? String(Math.floor(v)) : v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, '');
    return s + units[i];
  }
  const fmtRate = (n) => (n < 10 ? n.toFixed(2).replace(/\.?0+$/, '') : fmt(n));
  const fmtTime = (s) => { s = Math.ceil(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ============================================================
  //  상태 / 저장
  // ============================================================
  const defaultState = () => ({
    v: 1,
    coins: 0, xp: 0, level: 1,
    upg: { seed: 0, fert: 0, yield: 0, plots: 0, worker: 0, lucky: 0 },
    plots: new Array(MAX_PLOTS).fill(0),
    boost: 0,
    harvests: 0,
    sound: true,
    lastSeen: Date.now(),
  });

  function load() {
    const d = defaultState();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return d;
      const o = JSON.parse(raw);
      const s = Object.assign(d, o);
      s.upg = Object.assign(defaultState().upg, o.upg || {});
      const plots = Array.isArray(o.plots) ? o.plots.map((p) => Math.min(1, Math.max(0, +p || 0))) : [];
      while (plots.length < MAX_PLOTS) plots.push(0);
      s.plots = plots.slice(0, MAX_PLOTS);
      s.coins = +s.coins || 0; s.xp = +s.xp || 0; s.level = Math.max(1, +s.level || 1);
      s.boost = Math.max(0, +s.boost || 0);
      return s;
    } catch (e) { return d; }
  }

  let S = load();
  let lastSavedOk = true;
  function save() {
    S.lastSeen = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); lastSavedOk = true; }
    catch (e) { lastSavedOk = false; }
  }

  // ============================================================
  //  계산식
  // ============================================================
  const plotCount = () => BASE_PLOTS + S.upg.plots;
  const crop = () => CROPS[S.upg.seed];
  const fertMult = (l = S.upg.fert) => Math.pow(1.12, l);
  const yieldMult = (l = S.upg.yield) => Math.pow(1.25, l);
  const levelMult = () => 1 + 0.05 * (S.level - 1);
  const critChance = (l = S.upg.lucky) => Math.min(0.6, 0.03 * l);
  const workerInterval = (l = S.upg.worker) => (l <= 0 ? Infinity : Math.max(0.4, 6 / Math.pow(1.13, l - 1)));
  const growSpeed = () => fertMult() * (S.boost > 0 ? 2 : 1);
  const baseValue = () => crop().value * yieldMult() * levelMult();
  const xpNeed = (lv) => Math.round(20 * Math.pow(1.45, lv - 1));
  const upgradeSum = () => Object.values(S.upg).reduce((a, b) => a + b, 0);
  function stageIndex() {
    const sum = upgradeSum();
    let idx = 0;
    STAGES.forEach((st, i) => { if (sum >= st.at) idx = i; });
    return idx;
  }

  // 자동 수입 (일꾼 기준) 초당
  function autoIncome() {
    if (S.upg.worker <= 0) return 0;
    const perSecPlots = plotCount() * growSpeed() / crop().time;
    const rate = Math.min(1 / workerInterval(), perSecPlots);
    return rate * baseValue() * (1 + critChance() * 2);
  }

  // ============================================================
  //  업그레이드 정의
  // ============================================================
  const UPGS = [
    {
      id: 'seed', icon: '🌱', name: '씨앗 등급', max: CROPS.length - 1,
      cost: (l) => Math.round(15 * Math.pow(3.6, l)),
      desc: (l) => `${CROPS[l].emoji}${CROPS[l].name} → ${CROPS[l + 1].emoji}${CROPS[l + 1].name} (가치·경험치 ↑)`,
      maxDesc: () => `최고 작물 ${CROPS[CROPS.length - 1].emoji} 달성!`,
    },
    {
      id: 'fert', icon: '🧪', name: '비료', max: 60,
      cost: (l) => Math.round(20 * Math.pow(1.7, l)),
      desc: (l) => `성장 속도 ×${fertMult(l).toFixed(2)} → ×${fertMult(l + 1).toFixed(2)}`,
    },
    {
      id: 'yield', icon: '🧺', name: '수확량', max: 60,
      cost: (l) => Math.round(25 * Math.pow(1.85, l)),
      desc: (l) => `수확 코인 ×${yieldMult(l).toFixed(2)} → ×${yieldMult(l + 1).toFixed(2)}`,
    },
    {
      id: 'plots', icon: '🟫', name: '밭 확장', max: MAX_PLOTS - BASE_PLOTS,
      cost: (l) => Math.round(40 * Math.pow(3, l)),
      desc: (l) => `밭 ${BASE_PLOTS + l}칸 → ${BASE_PLOTS + l + 1}칸`,
      maxDesc: () => '밭을 모두 확장했어요!',
    },
    {
      id: 'worker', icon: '🧑‍🌾', name: '일꾼 고용', max: 40,
      cost: (l) => Math.round(60 * Math.pow(2.1, l)),
      desc: (l) => l === 0
        ? '다 자란 작물을 자동으로 수확 (6초마다)'
        : `자동 수확 ${workerInterval(l).toFixed(1)}초 → ${workerInterval(l + 1).toFixed(1)}초마다`,
    },
    {
      id: 'lucky', icon: '🍀', name: '행운의 손', max: 20,
      cost: (l) => Math.round(100 * Math.pow(2, l)),
      desc: (l) => `대박(3배) 확률 ${Math.round(critChance(l) * 100)}% → ${Math.round(critChance(l + 1) * 100)}%`,
    },
  ];

  // ============================================================
  //  캐릭터 (원본 스프라이트 + 진화 오버레이)
  // ============================================================
  const fCanvas = $('farmer');
  const fctx = fCanvas.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  const OX = 11, OY = 6; // 58x82 스프라이트를 80x92 캔버스 안에 배치
  const sprite = new Image();
  let spriteReady = false;
  sprite.onload = () => { spriteReady = true; drawFarmer(); };
  sprite.src = 'assets/farmer.png';

  const R = (x, y, w, h, c) => { fctx.fillStyle = c; fctx.fillRect(OX + x, OY + y, w, h); };
  function ell(cx, cy, rx, ry, c, maxY = Infinity) {
    for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry) && y <= maxY; y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const half = rx * Math.sqrt(1 - dy * dy);
      R(Math.round(cx - half), y, Math.max(1, Math.round(half * 2)), 1, c);
    }
  }

  function drawHat(st) {
    const gold = st >= 5;
    const main = gold ? '#ffd43b' : '#eac66a';
    const dark = gold ? '#a86f00' : '#8a5a1a';
    const line = gold ? '#fff08a' : '#c99a3a';
    const band = gold ? '#e03131' : st >= 4 ? '#2f9e5b' : '#c0392b';
    const brim = st >= 4 ? 34 : 31;
    ell(29, 14, 25, 15, dark, 18);
    ell(29, 19, brim + 1, 5.6, dark);
    ell(29, 14, 24, 14, main, 18);
    ell(29, 19, brim, 4.6, main);
    for (let x = 8; x < 52; x += 4) R(x, 4 + ((x / 4) % 2) * 2, 2, 1, line);
    for (let x = -2; x < 60; x += 5) R(x, 20 + ((x / 5) % 2), 3, 1, line);
    R(6, 12, 46, 4, band);
    R(6, 16, 46, 1, dark);
    if (gold) { R(27, 12, 4, 4, '#fff'); R(28, 10, 2, 2, '#fff'); R(28, 16, 2, 1, '#fff'); }
  }

  function drawFarmer() {
    fctx.clearRect(0, 0, fCanvas.width, fCanvas.height);
    if (!spriteReady) return;
    const st = stageIndex();
    fctx.drawImage(sprite, OX, OY);

    // 2단계~: 스카프 + 멜빵바지
    if (st >= 2) {
      const denim = st >= 5 ? '#243b7a' : '#2d5da8';
      const denimL = st >= 5 ? '#3a56a0' : '#4c86d6';
      const btn = st >= 5 ? '#ffd43b' : '#f4c430';
      R(27, 57, 18, 11, '#1b2540');
      R(28, 58, 16, 9, denim);
      R(30, 62, 6, 4, denimL);            // 주머니
      R(30, 62, 6, 1, '#1b2540');
      R(28, 55, 3, 4, denim); R(41, 55, 3, 4, denim); // 멜빵끈
      R(29, 58, 2, 2, btn); R(41, 58, 2, 2, btn);
      const sc = st >= 5 ? '#ffd43b' : '#d63a2f';
      R(27, 54, 18, 3, sc);
      R(32, 57, 8, 2, sc); R(34, 59, 4, 2, sc);
    }
    // 3단계~: 장갑 + 장화
    if (st >= 3) {
      const gl = st >= 5 ? '#f4c430' : '#6fbf4a';
      const gd = st >= 5 ? '#8a5a00' : '#1e5b2a';
      R(8, 57, 9, 7, gd); R(9, 58, 7, 5, gl);
      R(47, 57, 9, 7, gd); R(48, 58, 7, 5, gl);
      const bt = st >= 5 ? '#2b2b3a' : '#6b3f1d';
      R(23, 66, 9, 6, '#1a1210'); R(24, 67, 7, 4, bt);
      R(38, 66, 9, 6, '#1a1210'); R(39, 67, 7, 4, bt);
      if (st >= 5) { R(24, 70, 7, 1, '#ffd43b'); R(39, 70, 7, 1, '#ffd43b'); }
    }
    // 4단계~: 괭이
    if (st >= 4) {
      const pole = st >= 5 ? '#ffd43b' : '#8a5a2b';
      const poleD = st >= 5 ? '#a86f00' : '#4a2f14';
      const blade = st >= 5 ? '#fff08a' : '#c5ccd3';
      const bladeD = st >= 5 ? '#a86f00' : '#6b747c';
      R(56, 30, 4, 46, poleD); R(57, 30, 2, 46, pole);
      R(49, 26, 12, 6, bladeD); R(50, 27, 10, 4, blade);
      R(47, 28, 3, 6, bladeD); R(48, 29, 1, 4, blade);
    }
    // 1단계~: 모자 (가장 위)
    if (st >= 1) drawHat(st);
  }

  // ============================================================
  //  DOM / 렌더
  // ============================================================
  const elCoins = $('coins');
  const plotsEl = $('plots');
  const plotEls = [];
  const plotCache = [];

  function buildPlots() {
    for (let i = 0; i < MAX_PLOTS; i++) {
      const b = document.createElement('button');
      b.className = 'plot';
      b.innerHTML = '<span class="crop"></span><span class="bar"><i></i></span>';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); onPlotTap(i, e); });
      plotsEl.appendChild(b);
      plotEls.push(b);
      plotCache.push({});
    }
  }

  const upgEls = {};
  function buildUpgrades() {
    const box = $('upgrades');
    UPGS.forEach((u) => {
      const d = document.createElement('div');
      d.className = 'upg';
      d.innerHTML = `<div class="ico">${u.icon}</div>
        <div class="info"><div class="nm">${u.name}<em></em></div><div class="ds"></div></div>
        <button class="buy"></button>`;
      const btn = d.querySelector('.buy');
      btn.addEventListener('click', () => buyUpgrade(u.id));
      box.appendChild(d);
      upgEls[u.id] = { root: d, lv: d.querySelector('em'), ds: d.querySelector('.ds'), btn, key: '' };
    });
  }

  function renderUpgrades() {
    UPGS.forEach((u) => {
      const l = S.upg[u.id];
      const maxed = l >= u.max;
      const cost = maxed ? 0 : u.cost(l);
      const can = !maxed && S.coins >= cost;
      const key = `${l}|${can}|${maxed}`;
      const e = upgEls[u.id];
      if (e.key === key) return;
      e.key = key;
      e.lv.textContent = `Lv.${l}`;
      e.ds.textContent = maxed ? (u.maxDesc ? u.maxDesc() : '최대 레벨!') : u.desc(l);
      e.btn.disabled = maxed || !can;
      e.btn.classList.toggle('max', maxed);
      e.btn.innerHTML = maxed ? 'MAX' : `🪙 ${fmt(cost)}`;
    });
  }

  function renderPlots() {
    const n = plotCount();
    const c = crop();
    for (let i = 0; i < MAX_PLOTS; i++) {
      const el = plotEls[i], ch = plotCache[i];
      if (i >= n) {
        const cost = UPGS[3].cost(S.upg.plots);
        const isNext = i === n && S.upg.plots < UPGS[3].max;
        const key = `L|${isNext}|${isNext && S.coins >= cost}`;
        if (ch.key !== key) {
          ch.key = key;
          el.className = 'plot locked' + (isNext && S.coins >= cost ? ' affordable' : '');
          el.innerHTML = isNext
            ? `<span class="lock">🔒</span><span>🪙 ${fmt(cost)}</span>`
            : '<span class="lock">🔒</span>';
        }
        continue;
      }
      if (ch.key && ch.key[0] === 'L') { // 잠금 해제 → 원래 구조 복원
        el.className = 'plot';
        el.innerHTML = '<span class="crop"></span><span class="bar"><i></i></span>';
        ch.key = ''; ch.cropEl = null;
      }
      if (!ch.cropEl) { ch.cropEl = el.querySelector('.crop'); ch.bar = el.querySelector('.bar i'); }
      const p = S.plots[i];
      const ready = p >= 1;
      const phase = ready ? 3 : p < 0.25 ? 0 : p < 0.6 ? 1 : 2;
      const scale = ready ? 1 : phase === 0 ? 0.55 : 0.55 + 0.45 * ((p - 0.25) / 0.75);
      const key = `${S.upg.seed}|${phase}|${scale.toFixed(2)}|${ready}`;
      if (ch.key !== key) {
        ch.key = key;
        ch.cropEl.textContent = phase === 0 ? '🌱' : c.emoji;
        ch.cropEl.style.transform = `scale(${scale.toFixed(2)})`;
        el.classList.toggle('ready', ready);
      }
      const w = Math.round(p * 100);
      if (ch.w !== w) { ch.w = w; ch.bar.style.width = w + '%'; }
    }
  }

  let hudKey = '';
  function renderHud() {
    elCoins.textContent = fmt(S.coins);
    const need = xpNeed(S.level);
    const key = `${S.level}|${Math.floor(S.xp)}|${S.upg.worker}|${S.upg.seed}|${S.upg.fert}|${S.upg.yield}|${S.upg.lucky}|${S.upg.plots}|${S.boost > 0}`;
    $('xpFill').style.width = Math.min(100, (S.xp / need) * 100) + '%';
    if (key !== hudKey) {
      hudKey = key;
      $('lvText').textContent = `Lv.${S.level}`;
      const bonus = Math.round((levelMult() - 1) * 100);
      const ai = autoIncome();
      $('stats').textContent =
        `레벨 보너스 +${bonus}%` + (ai > 0 ? ` · 자동 수입 +${fmtRate(ai)}/초` : ' · 밭을 터치해 수확!');
    }
    const boost = $('boostBadge');
    if (S.boost > 0) {
      boost.classList.remove('hidden');
      $('boostTime').textContent = fmtTime(S.boost);
    } else boost.classList.add('hidden');
  }

  let stageKey = -1;
  function renderStage() {
    const st = stageIndex();
    if (st !== stageKey) {
      const evolved = stageKey !== -1 && st > stageKey;
      stageKey = st;
      drawFarmer();
      $('stageName').textContent = STAGES[st].name;
      $('farmerWrap').classList.toggle('legend', st >= 5);
      if (evolved) {
        const w = $('farmerWrap');
        w.classList.remove('evolve'); void w.offsetWidth; w.classList.add('evolve');
        toast(`🎉 진화! ${STAGES[st].name}`);
        beep(660, 0.12); setTimeout(() => beep(880, 0.12), 110); setTimeout(() => beep(1320, 0.2), 220);
      }
    }
    const next = STAGES[st + 1];
    $('stageNext').textContent = next ? `다음 진화까지 업그레이드 ${next.at - upgradeSum()}번` : '최종 진화 완료!';
  }

  // ============================================================
  //  효과음 / 토스트 / 플로팅
  // ============================================================
  let actx = null;
  function beep(freq, dur = 0.07, type = 'square', vol = 0.04) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* 소리 실패는 무시 */ }
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  function floatText(text, x, y, cls = '') {
    const d = document.createElement('div');
    d.className = 'float ' + cls;
    d.textContent = text;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    document.body.appendChild(d);
    d.addEventListener('animationend', () => d.remove());
  }

  // ============================================================
  //  게임 로직
  // ============================================================
  function addXp(amount) {
    S.xp += amount;
    let leveled = false;
    while (S.xp >= xpNeed(S.level)) { S.xp -= xpNeed(S.level); S.level++; leveled = true; }
    if (leveled) { toast(`⬆️ 레벨 업! Lv.${S.level} (수익 +${Math.round((levelMult() - 1) * 100)}%)`); beep(880, 0.15, 'triangle', 0.06); }
  }

  function harvest(i, auto, x, y) {
    if (S.plots[i] < 1) return false;
    S.plots[i] = 0;
    const c = crop();
    const crit = Math.random() < critChance();
    const mult = crit ? 3 : 1;
    const gain = Math.max(1, Math.round(baseValue() * mult));
    const xp = c.xp * mult;
    S.coins += gain;
    S.harvests++;
    addXp(xp);

    if (x == null) {
      const r = plotEls[i].getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 3;
    }
    floatText(`+${fmt(gain)}${crit ? ' 대박!' : ''}`, x, y, crit ? 'crit' : '');
    floatText(`+${fmt(xp)}XP`, x, y + 22, 'xp');
    plotEls[i].classList.remove('pop'); void plotEls[i].offsetWidth; plotEls[i].classList.add('pop');
    if (!auto) {
      const w = $('farmerWrap');
      w.classList.remove('hop'); void w.offsetWidth; w.classList.add('hop');
      if (navigator.vibrate) try { navigator.vibrate(crit ? [15, 30, 15] : 10); } catch (e) { /* noop */ }
    }
    beep(crit ? 990 : 520 + Math.random() * 120, crit ? 0.14 : 0.06, crit ? 'triangle' : 'square');
    elCoins.parentElement.classList.remove('bump'); void elCoins.offsetWidth; elCoins.parentElement.classList.add('bump');
    return true;
  }

  function onPlotTap(i, e) {
    if (i >= plotCount()) {
      if (i === plotCount()) buyUpgrade('plots');
      return;
    }
    if (S.plots[i] >= 1) harvest(i, false, e.clientX, e.clientY);
    else beep(200, 0.04, 'sine', 0.03);
  }

  function buyUpgrade(id) {
    const u = UPGS.find((x) => x.id === id);
    const l = S.upg[id];
    if (l >= u.max) return;
    const cost = u.cost(l);
    if (S.coins < cost) { toast('코인이 부족해요 🪙'); return; }
    S.coins -= cost;
    S.upg[id]++;
    if (id === 'seed') toast(`${crop().emoji} ${crop().name}(으)로 바뀌었어요!`);
    beep(700, 0.09, 'triangle', 0.06);
    Object.values(upgEls).forEach((e) => (e.key = ''));
    plotCache.forEach((c) => (c.key = ''));
    hudKey = '';
    save();
  }

  // 광고 (시뮬레이션). 실제 SDK 연동 시 이 함수만 교체하세요. true = 끝까지 시청.
  let adBusy = false;
  function showRewardedAd() {
    return new Promise((resolve) => {
      if (!AD_TEST_MODE) { resolve(true); return; }
      let left = 5;
      openModal(`<h2>📺 광고 재생 중</h2>
        <div class="ad-screen"><span>(테스트 광고)</span><b id="adLeft">${left}</b></div>
        <p>끝까지 보면 2배 성장 보너스!</p>`);
      const iv = setInterval(() => {
        left--;
        const el = $('adLeft');
        if (el) el.textContent = left;
        if (left <= 0) { clearInterval(iv); closeModal(); resolve(true); }
      }, 1000);
    });
  }

  async function watchAd() {
    if (adBusy) return;
    adBusy = true;
    try {
      const ok = await showRewardedAd();
      if (ok) {
        S.boost = Math.min(BOOST_CAP, S.boost + BOOST_ADD);
        toast(`⚡ 2배 속도! ${fmtTime(S.boost)} 남음`);
        beep(900, 0.15, 'triangle', 0.06);
        save();
      }
    } finally { adBusy = false; }
  }

  // ---------- 오프라인 보상 ----------
  function applyOffline(elapsed) {
    elapsed = Math.min(Math.max(0, elapsed), OFFLINE_CAP);
    if (elapsed < 5) return null;
    const boostUsed = Math.min(S.boost, elapsed);
    const effective = elapsed + boostUsed; // 2배 구간은 성장 시간이 2배로 누적
    S.boost -= boostUsed;
    const growTime = crop().time / fertMult();
    const n = plotCount();
    for (let i = 0; i < n; i++) S.plots[i] = Math.min(1, S.plots[i] + effective / growTime);
    let coins = 0, xp = 0;
    if (S.upg.worker > 0) {
      const byWorker = elapsed / workerInterval();
      const byGrowth = n * effective / growTime;
      const count = Math.floor(Math.min(byWorker, byGrowth) * 0.5); // 오프라인 효율 50%
      coins = Math.round(count * baseValue() * (1 + critChance() * 2));
      xp = count * crop().xp;
      S.coins += coins;
      addXp(xp);
    }
    return { elapsed, coins, xp };
  }

  // ---------- 모달 ----------
  function openModal(html) { $('modalBox').innerHTML = html; $('modal').classList.remove('hidden'); }
  function closeModal() { $('modal').classList.add('hidden'); }

  function showOffline(r) {
    if (!r || r.coins <= 0) return;
    const m = Math.floor(r.elapsed / 60);
    openModal(`<h2>🌾 다시 오셨네요!</h2>
      <p>${m >= 60 ? Math.floor(m / 60) + '시간 ' : ''}${m % 60}분 동안<br>일꾼이 열심히 일했어요.</p>
      <p style="font-size:22px;font-weight:900">+🪙 ${fmt(r.coins)}</p>
      <button class="wide" id="okBtn">받기</button>`);
    $('okBtn').onclick = closeModal;
  }

  function openMenu() {
    openModal(`<h2>⚙️ 메뉴</h2>
      <p>수확 ${fmt(S.harvests)}번 · ${STAGES[stageIndex()].name}</p>
      <button class="wide sub" id="mSound">${S.sound ? '🔊 소리 켜짐' : '🔇 소리 꺼짐'}</button>
      <button class="wide sub" id="mReset">🗑️ 처음부터 다시 시작</button>
      <button class="wide" id="mClose">닫기</button>`);
    $('mSound').onclick = () => { S.sound = !S.sound; updateSoundBtn(); save(); openMenu(); };
    $('mClose').onclick = closeModal;
    $('mReset').onclick = () => {
      openModal(`<h2>정말 초기화할까요?</h2><p>모든 진행 상황이 사라져요.</p>
        <div class="row"><button class="sub" id="rNo">취소</button><button class="danger" id="rYes">초기화</button></div>`);
      $('rNo').onclick = closeModal;
      $('rYes').onclick = () => {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
        S = defaultState(); stageKey = -1; hudKey = '';
        Object.values(upgEls).forEach((e) => (e.key = ''));
        plotCache.forEach((c) => (c.key = ''));
        closeModal(); save();
      };
    };
  }

  const updateSoundBtn = () => { $('btnSound').textContent = S.sound ? '🔊' : '🔇'; };

  // ============================================================
  //  메인 루프
  // ============================================================
  let last = performance.now(), saveT = 0, workerT = 0;

  function tick(dt) {
    const n = plotCount();
    const speed = growSpeed(), gt = crop().time;
    for (let i = 0; i < n; i++) if (S.plots[i] < 1) S.plots[i] = Math.min(1, S.plots[i] + (dt * speed) / gt);
    if (S.boost > 0) S.boost = Math.max(0, S.boost - dt);

    if (S.upg.worker > 0) {
      workerT += dt;
      const iv = workerInterval();
      if (workerT >= iv) {
        let idx = -1;
        for (let i = 0; i < n; i++) if (S.plots[i] >= 1) { idx = i; break; }
        if (idx >= 0) { workerT -= iv; harvest(idx, true); } else workerT = iv;
      }
    }
    saveT += dt;
    if (saveT >= 5) { saveT = 0; save(); }
  }

  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    tick(dt);
    renderPlots();
    renderHud();
    renderUpgrades();
    renderStage();
    requestAnimationFrame(frame);
  }

  // ============================================================
  //  시작
  // ============================================================
  buildPlots();
  buildUpgrades();
  updateSoundBtn();

  $('adBtn').addEventListener('click', watchAd);
  $('btnMenu').addEventListener('click', openMenu);
  $('btnSound').addEventListener('click', () => { S.sound = !S.sound; updateSoundBtn(); save(); if (S.sound) beep(600); });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !adBusy) closeModal(); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else {
      const r = applyOffline((Date.now() - S.lastSeen) / 1000);
      last = performance.now();
      save();
      showOffline(r);
    }
  });
  window.addEventListener('pagehide', save);

  const offline = applyOffline((Date.now() - S.lastSeen) / 1000);
  save();
  showOffline(offline);
  requestAnimationFrame(frame);

  // 테스트/디버그용 훅
  window.__farm = { get state() { return S; }, save, harvest, buyUpgrade, applyOffline };
})();
