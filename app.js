(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const bounded = (value, max, fallback) => /^\d{1,10}$/.test(value || '') ? Math.min(max, Number(value)) : fallback;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/\D/g, '');
  let seed = bounded(params.get('seed'), 4294967295, Number(today)) || 1;
  const target = bounded(params.get('beat'), 2700, null);
  let challengeActive = target !== null;
  let state = 'idle', lastResult = null, toastTimer, sound = false;
  let best = 0;
  try { best = Number(localStorage.getItem('shadow-lag-best')) || 0; } catch (_) {}
  const game = new window.ShadowGame($('game-canvas'), {
    onUpdate(data) {
      $('score').textContent = data.score;
      $('lives').textContent = '♥'.repeat(data.lives) + '♡'.repeat(3 - data.lives);
      $('lives').setAttribute('aria-label', `剩余 ${data.lives} 颗心`);
      $('progress').textContent = `${data.wave} / ${data.total}`;
    },
    onEnd(result) {
      lastResult = result;
      setState('ended');
      $('result').hidden = false;
      const clean = Math.round(result.score / 150);
      const titles = ['影子：你先冷静', '有点默契了', '时间差玩家', '影子都服了'];
      $('result-title').textContent = result.won ? '你和影子，合拍了！' : titles[Math.min(3, Math.floor(clean / 5))];
      $('result-score').textContent = result.score;
      let detail = `完美通过 ${clean} 道门 · 共 ${result.total} 道`;
      if (challengeActive) detail += result.score > target ? ` · 超过朋友 ${result.score - target} 分！` : result.score === target ? ' · 和朋友打平！' : ` · 再拿 ${target - result.score} 分追平朋友`;
      if (result.score > best) {
        best = result.score;
        try { localStorage.setItem('shadow-lag-best', String(best)); } catch (_) {}
        detail += ' · 个人新纪录';
      }
      $('result-detail').textContent = detail;
      $('challenge-url').value = challengeURL(result.score);
      $('pause-btn').disabled = true;
    }
  });
  function setState(next) {
    state = next;
    document.body.dataset.state = next;
    $('move-btn').textContent = next === 'paused' ? '继续 · 再次合拍' : '点一下，换边';
    $('pause-btn').textContent = next === 'paused' ? '继续' : '暂停';
    $('pause-btn').setAttribute('aria-label', next === 'paused' ? '继续游戏' : '暂停游戏');
  }
  function challengeURL(score) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('seed', seed);
    url.searchParams.set('beat', score);
    return url.href;
  }
  function showToast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400);
  }
  function start() {
    $('intro').hidden = true;
    $('result').hidden = true;
    $('pause-btn').disabled = false;
    setState('playing');
    game.start(seed);
  }
  function move() {
    if (state === 'paused') { game.resume(); setState('playing'); }
    else if (state === 'playing') game.action();
  }
  function togglePause() {
    if (state === 'playing') { game.pause(); setState('paused'); }
    else if (state === 'paused') { game.resume(); setState('playing'); }
  }
  $('start-btn').addEventListener('click', start);
  $('retry-btn').addEventListener('click', start);
  $('new-btn').addEventListener('click', () => {
    const random = new Uint32Array(1);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(random);
    else random[0] = Date.now() >>> 0;
    seed = random[0] || 1;
    challengeActive = false;
    $('challenge-banner').hidden = true;
    start();
  });
  $('game-canvas').addEventListener('pointerdown', event => { event.preventDefault(); move(); });
  $('move-btn').addEventListener('click', move);
  $('pause-btn').addEventListener('click', togglePause);
  $('sound-btn').addEventListener('click', () => {
    sound = !sound;
    game.setSound(sound);
    $('sound-btn').textContent = sound ? '声音开' : '声音关';
    $('sound-btn').setAttribute('aria-pressed', String(sound));
  });
  document.addEventListener('keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
      if (state === 'idle' || state === 'ended') start(); else move();
    } else if (event.code === 'Escape' || event.code === 'KeyP') togglePause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') { game.pause(); setState('paused'); }
  });
  async function copy() {
    const url = $('challenge-url').value;
    try {
      await navigator.clipboard.writeText(url);
      showToast('挑战链接已复制，发给朋友吧');
    } catch (_) {
      $('challenge-url').focus();
      $('challenge-url').select();
      try {
        if (document.execCommand('copy')) showToast('挑战链接已复制，发给朋友吧');
        else showToast('长按下方链接，选择复制');
      } catch (_) { showToast('长按下方链接，选择复制'); }
    }
  }
  $('copy-btn').addEventListener('click', copy);
  $('challenge-url').addEventListener('click', event => event.target.select());
  $('share-btn').addEventListener('click', async () => {
    if (navigator.share && lastResult) {
      try {
        await navigator.share({ title: '影子慢半拍', text: `我和慢半拍的影子拿了 ${lastResult.score} 分。一样的赛道，你能超过我吗？`, url: challengeURL(lastResult.score) });
      } catch (error) { if (error.name !== 'AbortError') await copy(); }
    } else await copy();
  });
  if (target !== null) {
    $('challenge-banner').hidden = false;
    $('challenge-banner').textContent = `朋友留下了 ${target} 分 · 同一赛道，等你超越`;
  }
  $('pause-btn').disabled = true;
  setState('idle');
})();
