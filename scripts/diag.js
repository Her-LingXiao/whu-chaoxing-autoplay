/**
 * diag.js — 一次性诊断脚本（排错用，不修改任何东西）
 *
 * 打印两样东西：
 *   1) 章节目录：每节的编号 / 标题 / nodeId / knowledgeId / 是否已完成 / 是否无视频
 *   2) 当前播放器状态：currentSrc / currentTime / duration / paused / muted / readyState
 *
 * 用法（先确保 Chrome 已开 9222 且停在课程学习页）：
 *   node diag.js
 *
 * 常见用途：
 *   - 脚本报「未找到可点击的章节元素」→ 看第 1 段，确认 div.posCatalog_select /
 *     span.posCatalog_name 是否还在（超星改版会变）。
 *   - 脚本报「本节无视频」但明明有视频 → 看第 2 段，确认是不是 video.js 的封面态、
 *     或播放器换成了别的实现。
 */

const { chromium } = require('playwright-core');

const withTimeout = (p, ms, fb) => new Promise((res) => {
  let s = false;
  const t = setTimeout(() => { if (!s) { s = true; res(fb); } }, ms);
  p.then((v) => { if (!s) { s = true; clearTimeout(t); res(v); } },
         () => { if (!s) { s = true; clearTimeout(t); res(fb); } });
});

const NO_VIDEO_TITLE = /(章节测验|章节测试|单元测验|单元测试|章节作业|课后作业|讨论|问卷调查)/;
const isChaoxing = (u) => /chaoxing|whu\.edu\.cn/.test(u || '');

(async () => {
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch (e) {
    console.log('FATAL: 连不上 Chrome 调试端口 9222。先运行 launch_chrome.ps1 / launch_chrome.sh。');
    process.exit(1);
  }
  const ctx = browser.contexts()[0];

  // ── 1) 章节目录 ────────────────────────────────────────────────────────
  let printed = false;
  for (const p of ctx.pages()) {
    for (const f of p.frames()) {
      if (!isChaoxing(f.url()) || printed) continue;
      const list = await withTimeout(f.evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const res = [];
        for (const d of Array.from(document.querySelectorAll('div.posCatalog_select'))) {
          const span = d.querySelector('span.posCatalog_name');
          if (!span) continue;
          const num = norm((span.querySelector('em.posCatalog_sbar') || {}).textContent || '');
          const title = norm(span.getAttribute('title') || span.textContent);
          const m = (span.getAttribute('onclick') || '').match(/getTeacherAjax\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
          res.push({
            text: norm(num + ' ' + title),
            id: d.id || '-',
            knowledgeId: m ? m[3] : '-',
            completed: !!d.querySelector('span.icon_Completed'),
          });
        }
        return res;
      }), 8000, null);
      if (list && list.length) {
        printed = true;
        const nDone = list.filter((x) => x.completed).length;
        console.log(`\n=== 章节目录（共 ${list.length} 节，${nDone} 节已完成）===`);
        list.forEach((c, i) => {
          const tag = c.completed ? '  [已完成]' : '';
          const noVid = NO_VIDEO_TITLE.test(c.text) ? '  [无视频?]' : '';
          console.log(`${String(i + 1).padStart(3)}. ${c.text}${tag}${noVid}\n     id=${c.id} knowledgeId=${c.knowledgeId}`);
        });
        // 紧凑汇总：一眼看清进度
        const num = (x) => (x.text.match(/^[\d.]+/) || ['?'])[0];
        console.log('\n--- 汇总 ---');
        console.log('已完成: ' + (list.filter((x) => x.completed).map(num).join(' ') || '(无)'));
        console.log('未完成: ' + list.filter((x) => !x.completed).map(num).join(' '));
        console.log('第一节未完成 = ' + (list.find((x) => !x.completed) || {}).text);
        console.log('⚠ 这些标记是「上一次点击章节时」从服务器拉取的快照，不是实时值；刚播完的章节可能还没变绿。');
      }
    }
  }
  if (!printed) console.log('\n⚠ 没找到章节目录：确认你停在课程的【学习】页，且左侧目录已展开。');

  // ── 2) 当前播放器状态 ──────────────────────────────────────────────────
  console.log('\n=== 当前播放器状态 ===');
  let found = false;
  for (const p of ctx.pages()) {
    for (const f of p.frames()) {
      if (!isChaoxing(f.url())) continue;
      // 注意：evaluate 的函数体在「浏览器页面上下文」里执行，不能引用 Node 侧的 f 等对象
      const r = await withTimeout(f.evaluate(() => {
        const vv = document.querySelector('video.vjs-tech') || document.querySelector('video');
        if (!vv) return null;
        return {
          src: (vv.currentSrc || vv.src || '').slice(-60) || '(空)',
          ct: +(vv.currentTime || 0).toFixed(1),
          d: Math.round(vv.duration || 0),
          pct: vv.duration ? Math.round((vv.currentTime / vv.duration) * 100) + '%' : '-',
          paused: !!vv.paused, muted: !!vv.muted, readyState: vv.readyState,
          bigPlayBtn: !!document.querySelector('.vjs-big-play-button'),
        };
      }), 8000, '__timeout__');
      if (r === '__timeout__') {
        // 播放器帧在忙着加载/解码时，求值可能超时——这不代表「没有视频」
        console.log('  (求值超时，未能读取：' + f.url().slice(0, 80) + ')');
        found = true;
        continue;
      }
      if (r) {
        found = true;
        console.log(JSON.stringify(Object.assign({ frame: f.url().slice(0, 90) }, r), null, 2));
        if (r.readyState === 0 && r.d === 0) {
          console.log('  ↑ 这是 video.js 的「封面态」：还没点大播放按钮，不代表本节没有视频。');
        }
      }
    }
  }
  if (!found) console.log('（当前没有加载中的视频元素）');

  process.exit(0);
})();
