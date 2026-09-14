/**
 * autoplay.js — 超星学习通 / 珞珈在线 课程视频自动静音连播
 * v1.2.0
 *
 * ── v1.2.0 新增（2026-09-14）──────────────────────────────────────────────
 *  • 读章节目录里的「已完成」标记（span.icon_Completed），默认跳过已完成章节，
 *    直接从第一节「没看过」的章节开始 —— 不再每次从 1.1 重播浪费时间。
 *    需要连已完成的一起重播时用 --all。
 *  • 加进程锁 autoplay.lock：已在运行再启动会直接退出，避免多个实例同时
 *    操控同一个浏览器互相打架（v1.1 就吃过这个亏）。用 --force 可强制启动。
 *  • --list 增加 [已完成] / [已完成,跳过] 标注。
 *
 * ── v1.1.0 修复 ──────────────────────────────────────────────────────────
 * 原版会「装模作样」：日志里每节都报「无视频（测试/文档），跳过」，其实视频
 * 一直都在。根因有两个，都已修复：
 *
 *  ① 点错元素 —— 章节目录的 <li> 本身没有任何 onclick，真正的点击目标是里面
 *     的 <span class="posCatalog_name" onclick="getTeacherAjax(courseid,
 *     clazzid, knowledgeid)">。对 <li> 调 .click() 是空操作，于是视频永远
 *     不换节。现在改为精确点击 #cur<knowledgeid> 内的 [onclick] 元素，
 *     并校验章节是否变成 posCatalog_active。
 *
 *  ② 用 videoWidth===0 判定「无视频」—— 超星用的是 video.js 播放器，切到新
 *     一节时视频处于「封面 + 大播放按钮」状态（preload=none、readyState=0、
 *     videoWidth=0），必须点 .vjs-big-play-button 才会加载播放。原版把它当成
 *     「没有视频」，白白等 60 秒后跳过。现在改为：找到播放器帧 → 静音 →
 *     点大播放按钮 → play() → 用「currentTime 是否真的在推进」来确认播放成功。
 *
 *  ③ 额外健壮性：所有页面求值都带超时（避免某个 iframe 卡住整个脚本），
 *     并增加「进度停滞 >90s 自动重启播放」的自愈逻辑。
 * ────────────────────────────────────────────────────────────────────────
 *
 * 前置条件：
 *   1. 本机谷歌浏览器已以远程调试模式启动（launch_chrome.ps1 / .sh）。
 *   2. 你已登录智慧珞珈 / 珞珈在线（超星），并停留在目标课程的【学习】页面
 *      （mooc1.chaoxing.com/mycourse/studentstudy?...），左侧章节目录已展开。
 *   3. 依赖：npm install playwright-core（本目录已装）。
 *
 * 用法：
 *   node autoplay.js                  # 从第一节「未完成」的章节开始，完整连播（默认）
 *   node autoplay.js --list           # 只列出扫描到的章节及完成状态（不播放，排错用）
 *   node autoplay.js --start 2.5      # 从 2.5 这一节开始（含之后的未完成章节）
 *   node autoplay.js --all            # 不跳过已完成章节（从头重播）
 *   node autoplay.js --stop-at 98     # 每节播到 98% 才切下一节（默认 98，即「只剩最后 2%」）
 *   node autoplay.js --no-wait        # 每节只播几秒，快速验证用
 *   node autoplay.js --max-min 240    # 全局最多连播 240 分钟（默认 300）
 *   node autoplay.js --force          # 忽略进程锁强制启动
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ARGS = process.argv.slice(2);
const getArg = (name, def) => {
  const i = ARGS.indexOf(name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : def;
};
const START = getArg('--start', null);
const COURSE = getArg('--course', null);
const NO_WAIT = ARGS.includes('--no-wait');
const LIST_ONLY = ARGS.includes('--list');
const ALL = ARGS.includes('--all');
const FORCE = ARGS.includes('--force');
const MAX_MIN = parseInt(getArg('--max-min', '300'), 10);
// 每节播到多少百分比才切下一节。默认 98 =「只剩最后 2% 不播」。
// 平台记任务点的门槛是 90%，所以 98% 一定达标，且留 2% 余量（避免片尾自动弹窗/结束事件干扰）。
const STOP_AT = (() => {
  const v = parseFloat(getArg('--stop-at', '98'));
  return Number.isFinite(v) ? Math.min(100, Math.max(1, v)) : 98;
})();
const STOP_RATIO = STOP_AT / 100;
const LOG = path.join(__dirname, 'autoplay.log');
const LOCK = path.join(__dirname, 'autoplay.lock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
};

// ── 进程锁：防止多个实例同时操控同一个浏览器 ─────────────────────────────
function acquireLock() {
  // --list 是只读的（只扫描章节目录，不碰播放器），不该被锁挡住，
  // 否则「连播进行中想知道进度」这个最常见的排错场景反而用不了 --list。
  if (LIST_ONLY) return;
  if (!FORCE) {
    try {
      const old = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10);
      if (old && old !== process.pid) {
        let alive = false;
        try { process.kill(old, 0); alive = true; } catch (e) { alive = false; }
        if (alive) {
          console.error(`[lock] 已有 autoplay 实例在运行 (PID ${old})，本次退出。`);
          console.error('[lock] 确认那个进程已经不需要了：用任务管理器结束它，或加 --force 强制启动。');
          process.exit(1);
        }
      }
    } catch (e) { /* 锁文件不存在 = 没有实例 */ }
  }
  try { fs.writeFileSync(LOCK, String(process.pid)); } catch (e) {}
  const release = () => { try { fs.unlinkSync(LOCK); } catch (e) {} };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(0); });
  process.on('SIGTERM', () => { release(); process.exit(0); });
}

// 绝不 reject 的超时包装：超时/出错都返回 fallback
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(fallback); } }, ms);
    promise.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } }
    );
  });
}

// "2.5 xxx" -> 2.05（用于 --start 比较）
const chapterKey = (t) => {
  const m = (t || '').trim().match(/^(\d+)\.(\d+)/);
  return m ? parseInt(m[1], 10) + parseInt(m[2], 10) / 100 : null;
};

// 明确无视频的章节标题（按标题预跳过，省去 30s 探测）
const NO_VIDEO_TITLE = /(章节测验|章节测试|单元测验|单元测试|章节作业|课后作业|讨论|问卷调查)/;

const isChaoxing = (u) => /chaoxing|whu\.edu\.cn/.test(u || '');

// ── 章节扫描（含「已完成」标记）──────────────────────────────────────────
async function scanChapters(ctx) {
  const out = [];
  for (const p of ctx.pages()) {
    for (const f of p.frames()) {
      if (!isChaoxing(f.url())) continue;
      const list = await withTimeout(f.evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const res = [];
        // 首选：超星标准章节目录
        for (const d of Array.from(document.querySelectorAll('div.posCatalog_select'))) {
          const span = d.querySelector('span.posCatalog_name');
          if (!span) continue;
          const num = norm((span.querySelector('em.posCatalog_sbar') || {}).textContent || '');
          const title = norm(span.getAttribute('title') || span.textContent);
          const onclick = span.getAttribute('onclick') || '';
          const m = onclick.match(/getTeacherAjax\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
          // 「已完成」标记：<span class="icon_Completed prevTips"><span class="prevHoverTips">已完成</span></span>
          const doneIcon = d.querySelector('span.icon_Completed');
          res.push({
            text: norm(num + ' ' + title), title, onclick, nodeId: d.id || '',
            knowledgeId: m ? m[3] : '',
            completed: !!doneIcon || /已完成/.test(d.textContent || ''),
          });
        }
        if (res.length) return res;
        // 兜底：通用 li（兼容其它超星版本）
        for (const li of Array.from(document.querySelectorAll('li, div.chapter_item'))) {
          const text = norm(li.innerText || li.textContent);
          if (!/^\d+\.\d+\s/.test(text) || text.length >= 90) continue;
          const c = li.querySelector('[onclick]') || li.querySelector('span.posCatalog_name');
          const onclick = c ? (c.getAttribute('onclick') || '') : '';
          const m = onclick.match(/getTeacherAjax\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
          const holder = c && c.closest ? c.closest('[id]') : null;
          res.push({
            text, title: text.replace(/^\d+\.\d+\s*/, ''), onclick,
            nodeId: holder ? holder.id : '', knowledgeId: m ? m[3] : '',
            completed: !!li.querySelector('span.icon_Completed'),
          });
        }
        return res;
      }), 8000, null);
      if (list && list.length) {
        for (const it of list) out.push(Object.assign({ frame: f }, it));
      }
    }
  }
  const seen = new Set();
  return out.filter((it) => (seen.has(it.text) ? false : seen.add(it.text)));
}

// ── 点击章节（关键修复 ①）──────────────────────────────────────────────
async function clickChapter(ctx, ch) {
  let lastErr = '';
  for (const p of ctx.pages()) {
    for (const f of p.frames()) {
      if (!isChaoxing(f.url())) continue;
      // frame.evaluate 只接受「一个」参数，这里把三个字段打包成对象
      const r = await withTimeout(f.evaluate(({ nodeId, title, text }) => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        let target = null;
        const holder = nodeId ? document.getElementById(nodeId) : null;
        if (holder) target = holder.getAttribute('onclick') ? holder : holder.querySelector('[onclick]');
        if (!target) {
          for (const li of Array.from(document.querySelectorAll('li, div.chapter_item'))) {
            const t = norm(li.innerText || li.textContent);
            if (t === text || (title && t.includes(title))) { target = li.querySelector('[onclick]') || li; break; }
          }
        }
        if (!target) return 'no-target';
        target.click();
        return 'clicked';
      }, { nodeId: ch.nodeId, title: ch.title, text: ch.text }), 8000, 'timeout');
      if (r === 'clicked') return { frame: f, err: '' };
      if (r !== 'no-target') lastErr = String(r).slice(0, 80);
      else lastErr = 'no-target in ' + f.url().slice(0, 60);
    }
  }
  return { frame: null, err: lastErr };
}

// 等该节变为激活态（posCatalog_active），确认换节生效
async function waitActive(ctx, ch, ms) {
  if (!ch.nodeId) return true;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const p of ctx.pages()) {
      for (const f of p.frames()) {
        if (!isChaoxing(f.url())) continue;
        const ok = await withTimeout(f.evaluate((id) => {
          const el = document.getElementById(id);
          return !!el && /\bposCatalog_active\b/.test(el.className);
        }, ch.nodeId), 4000, false);
        if (ok) return true;
      }
    }
    await sleep(1000);
  }
  return false;
}

// ── 播放器发现 ────────────────────────────────────────────────────────────
async function findPlayerVideo(ctx) {
  for (const p of ctx.pages()) {
    for (const f of p.frames()) {
      if (!isChaoxing(f.url())) continue;
      const r = await withTimeout(f.evaluate(() => {
        const vv = document.querySelector('video.vjs-tech') || document.querySelector('video');
        if (!vv) return null;
        return {
          src: vv.currentSrc || vv.src || '',
          ct: vv.currentTime || 0, d: vv.duration || 0,
          paused: !!vv.paused, ended: !!vv.ended,
          vw: vv.videoWidth || 0, muted: !!vv.muted,
        };
      }), 4000, null);
      if (r) return Object.assign({ frame: f }, r);
    }
  }
  return null;
}

// 静音 + 点大播放按钮 + play()（关键修复 ②）
async function startPlayback(frame) {
  return withTimeout(frame.evaluate(() => {
    const vv = document.querySelector('video.vjs-tech') || document.querySelector('video');
    if (!vv) return { ok: false, why: 'no-video' };
    try { vv.muted = true; vv.volume = 0; } catch (e) {}
    let btn = 'none';
    const b = document.querySelector('.vjs-big-play-button');
    if (b && getComputedStyle(b).display !== 'none') { try { b.click(); btn = 'clicked'; } catch (e) {} }
    try { const pr = vv.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {}
    return { ok: true, btn, muted: vv.muted, paused: !!vv.paused, vw: vv.videoWidth, d: Math.round(vv.duration || 0), ct: Math.round(vv.currentTime || 0) };
  }), 8000, { ok: false, why: 'timeout' });
}

// 确认「真的在推进」：连续两次采样 currentTime 增大
async function confirmAdvancing(ctx, src, ms) {
  const t0 = Date.now();
  let lastCt = -1;
  while (Date.now() - t0 < ms) {
    await sleep(2000);
    const pv = await findPlayerVideo(ctx);
    if (!pv) continue;
    if (src && pv.src && pv.src !== src) { src = pv.src; lastCt = -1; continue; }
    if (lastCt >= 0 && pv.ct > lastCt + 0.4) return true;
    lastCt = Math.max(lastCt, pv.ct);
    if (pv.paused) await startPlayback(pv.frame);
  }
  return false;
}

// 打开本节并开始播放；返回 {frame, src} 或 null（本节无视频）
async function openAndPlay(ctx, prevSrc, budgetMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const pv = await findPlayerVideo(ctx);
    // 只认「新出现的那一节」：src 与上一节不同（首次运行 prevSrc 为空则直接认）
    if (pv && (!prevSrc || (pv.src && pv.src !== prevSrc))) {
      const r = await startPlayback(pv.frame);
      log('    播放器: ' + JSON.stringify(r));
      if (await confirmAdvancing(ctx, pv.src, 20000)) return { frame: pv.frame, src: pv.src };
    }
    await sleep(2500);
  }
  return null;
}

// 等本节播到 ≥ STOP_AT%（默认 98%，即只剩最后 2%）/ 播放结束
async function waitWatched(ctx, src, capMs) {
  const t0 = Date.now();
  let maxRatio = 0, lastCt = -1, lastAdvance = Date.now();
  while (Date.now() - t0 < capMs) {
    const pv = await findPlayerVideo(ctx);
    if (pv) {
      if (src && pv.src && pv.src !== src) { src = pv.src; lastCt = -1; }
      if (pv.d > 0) maxRatio = Math.max(maxRatio, pv.ct / pv.d);
      if (pv.ct > lastCt + 0.4) { lastCt = pv.ct; lastAdvance = Date.now(); }
      if (pv.d > 0 && pv.ct / pv.d >= STOP_RATIO) return 'reached-' + STOP_AT + '%';
      if (pv.ended) return 'ended';
      if (pv.paused) { await startPlayback(pv.frame); lastAdvance = Date.now(); }
      else if (Date.now() - lastAdvance > 90000) {
        log('    ⚠ 进度停滞 >90s，重新触发播放');
        await startPlayback(pv.frame);
        lastAdvance = Date.now();
      }
    }
    await sleep(5000);
  }
  return 'cap-reached(maxRatio=' + maxRatio.toFixed(2) + ')';
}

(async () => {
  acquireLock();
  try { fs.writeFileSync(LOG, ''); } catch (e) {}
  log('=== autoplay start (v1.3.0) ===');
  log(`start=${START || '(first-unfinished)'} course=${COURSE || '(current page)'} noWait=${NO_WAIT} list=${LIST_ONLY} skipCompleted=${!ALL} stopAt=${STOP_AT}% maxMin=${MAX_MIN}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch (e) {
    log('FATAL: 连不上 Chrome 调试端口 9222。请先运行 launch_chrome.ps1 / launch_chrome.sh。');
    process.exit(1);
  }
  const ctx = browser.contexts()[0];
  const startKey = START ? chapterKey(START + ' ') : null;
  const done = new Set();
  const globalStart = Date.now();
  let skipNoteLogged = false;

  while (true) {
    if ((Date.now() - globalStart) / 60000 >= MAX_MIN) {
      log('全局时长上限到达，停止。重新运行可继续（已处理章节不会重复）。');
      break;
    }

    let chapters = [];
    for (let attempt = 0; attempt < 6 && chapters.length === 0; attempt++) {
      chapters = await scanChapters(ctx);
      if (chapters.length === 0) {
        log('未扫描到章节，3s 后重试 (' + (attempt + 1) + '/6)…');
        await sleep(3000);
      }
    }
    if (!chapters.length) {
      log('未扫描到任何章节：确认你停留在课程【学习】页且左侧目录已展开。停止。');
      break;
    }

    if (LIST_ONLY) {
      const nDone = chapters.filter((c) => c.completed).length;
      log(`共扫描到 ${chapters.length} 节（其中 ${nDone} 节已完成）：`);
      chapters.forEach((c, i) => {
        const noVid = NO_VIDEO_TITLE.test(c.text) ? '  [无视频?]' : '';
        const mark = c.completed ? '  [已完成]' : '';
        log(`  ${String(i + 1).padStart(2)}. ${c.text}  (nodeId=${c.nodeId || '-'}, knowledgeId=${c.knowledgeId || '-'})${mark}${noVid}`);
      });
      break;
    }

    const next = chapters.find((c) =>
      !done.has(c.text) &&
      (!startKey || (chapterKey(c.text) || 0) >= startKey - 0.001) &&
      (ALL || !c.completed)
    );

    if (!skipNoteLogged && !ALL) {
      const nDone = chapters.filter((c) => c.completed).length;
      if (nDone) log(`（已跳过 ${nDone} 节标记为「已完成」的章节，从第一节未完成的开始）`);
      skipNoteLogged = true;
    }

    if (!next) {
      log(ALL ? '没有更多未处理章节了，连播完成 🎉' : '未完成的章节都处理完了，连播完成 🎉（已完成章节默认跳过，如需重播加 --all）');
      break;
    }

    log(`→ 章节: ${next.text}`);
    done.add(next.text);

    if (NO_VIDEO_TITLE.test(next.text)) {
      log('  ⚠ 标题判定为测验/作业类，无视频，跳过。');
      continue;
    }

    const prev = await findPlayerVideo(ctx);
    const prevSrc = prev ? prev.src : '';

    const clicked = await clickChapter(ctx, next);
    if (!clicked.frame) {
      log('  ⚠ 未找到可点击的章节元素，跳过。' + (clicked.err ? ' [' + clicked.err + ']' : ''));
      continue;
    }
    const active = await waitActive(ctx, next, 8000);
    if (!active && next.nodeId) log('  · 未观测到激活态（可能点击未生效，继续尝试播放）');

    let pv = await openAndPlay(ctx, prevSrc, 30000);
    if (!pv) {
      // 有些节因为播放器 iframe 重载慢，首次在 30s 内等不到「新 src」，
      // 会被误判成「本节无视频」而整节跳过（实测 3.2 就中过招）。
      // 兜底：重新点一次本节，再给 45s。
      log('  · 首次未等到新视频，重新点击本节再试…');
      await clickChapter(ctx, next);
      pv = await openAndPlay(ctx, prevSrc, 45000);
    }
    if (!pv) {
      log('  ⚠ 本节无视频（测验/文档），跳过。');
      continue;
    }

    if (NO_WAIT) {
      await sleep(8000);
      log('  (no-wait) 已确认播放，切下一节。');
    } else {
      const res = await waitWatched(ctx, pv.src, 40 * 60 * 1000);
      log('  本节结果: ' + res);
    }
  }

  log('=== autoplay end ===');
  process.exit(0);
})().catch((e) => {
  log('FATAL: ' + (e && e.stack ? e.stack : e));
  try { fs.unlinkSync(LOCK); } catch (e2) {}
  process.exit(1);
});
