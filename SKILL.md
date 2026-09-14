---
name: chaoxing-autoplay
description: "Auto-play (muted) course videos on 超星学习通 / 珞珈在线 / 智慧珞珈 via the real Chrome browser over CDP. Skips chapters already marked 已完成 and resumes from the first unwatched one. Useful for WHU students who need to finish 毛概 / 电路 / any chaoxing course videos hands-free."
description_zh: "通过本机谷歌浏览器（CDP 远程控制）自动静音连播超星学习通 / 珞珈在线 / 智慧珞珈 的课程视频，自动跳过已完成章节"
description_en: "Muted auto-play of chaoxing/luojia course videos by driving the real Chrome browser over CDP; skips completed chapters"
version: 1.3.0
homepage: https://whu.edu.cn
metadata: {"clawdbot": {"emoji": "📺", "requires": {"bins": ["node", "google-chrome"], "npm": ["playwright-core"]}, "install": [{"id": "npm", "kind": "npm", "pkg": "playwright-core", "label": "Install playwright-core (npm i playwright-core)"}]}}
display_name: "chaoxing-autoplay"
display_name_en: "chaoxing-autoplay"
visibility: "public"
---

# chaoxing-autoplay — 课程视频自动静音连播

通过 **CDP 远程控制你本机真实的谷歌浏览器**，自动打开超星学习通 / 珞珈在线 / 智慧珞珈 的课程，逐节点击视频、静音、播放，等每节播到 ≥90%（平台记任务点的门槛）再切下一节；**默认跳过平台已标记「已完成」的章节**，直接从你还没看过的那一节开始。

---

## 适用范围与限制（重要）

**能用**：超星系平台上「左侧章节目录 + 视频任务点」结构的课程 —— 毛概、电路、大学英语等绝大多数网课。目录结构有两级兜底（`div.posCatalog_select` → 通用 `li`），可兼容超星的不同版式。

**需要人工补**：

- **章节测验 / 测试 / 作业** → 脚本按标题直接跳过，**不会自动答题**，需要你自己做；
- **文档 / PPT 阅读**类任务点 → 脚本只处理 `<video>`，不会刷阅读时长；
- **音频 / 直播** → 不适用；
- **带人脸识别 / 验证码抽查**的课程 → 中途会中断，需要你在场。

**不适用**：智慧树、中国大学 MOOC、学堂在线等非超星平台（DOM 完全不同）。

## 工作原理

- 不是模拟点击坐标，而是用 Chrome DevTools Protocol（CDP）真实驱动你**已登录**的浏览器，登录态 / Cookie 都保留。
- 平台要求单节**观看时长 ≥ 90%** 才记任务点，且完成前不能拖进度条 —— 所以脚本是「等它播完」而不是快进。
- **登录绕不过去**：武大统一身份认证 / 超星账号的密码、短信码、APP 扫码只有你本人有。脚本只负责「登录之后」的自动播放。

## 前置条件

1. 已安装 Node.js 与谷歌浏览器（Chrome / Chromium）。
2. 在本 skill 的 `scripts/` 目录安装依赖：
   ```bash
   cd <skill>/scripts && npm install playwright-core
   ```
3. 让 Chrome 以调试模式启动（复用你的用户配置，保留登录）：
   - Windows：`powershell -ExecutionPolicy Bypass -File <skill>/scripts/launch_chrome.ps1`
   - macOS/Linux：`bash <skill>/scripts/launch_chrome.sh`
   > 脚本会先关掉当前 Chrome 再带调试端口重启（登录信息仍在，只是关掉已开的标签页）。若 9222 端口已开着则**直接复用，不会重启**。

## 完整流程

1. **启动调试模式 Chrome**（见上）。首屏可留空，或加 `https://zhlj.whu.edu.cn` 直接进智慧珞珈。
2. **手动登录**：在打开的 Chrome 窗口里登录智慧珞珈 / 珞珈在线（学号+密码，或 APP 扫码）。这一步必须你来做。
3. **进入课程学习页**：
   - 珞珈在线入口：`https://aicenter.whu.edu.cn`（或从智慧珞珈点进「珞珈在线」）。
   - 个人空间 → 课程 → 点开目标课（如「毛泽东思想和中国特色社会主义理论体系概论」）→ 「开始学习」。
   - 若弹出「在线学习诚信承诺书」，勾选「我已完整知晓并自愿遵守」再点「开始学习」。
   - 左侧章节目录展开后，**点开任意一节视频**（让播放器加载出来），保持这个页面不要关。
4. **自动连播**：在 `scripts/` 目录运行：
   ```bash
   node autoplay.js                 # 默认：跳过已完成，从第一节没看过的开始连播
   node autoplay.js --start 3.2     # 从指定小节开始（之后的未完成章节继续）
   node autoplay.js --all           # 不跳过已完成章节，从头全部重播
   node autoplay.js --stop-at 98    # 每节播到 98% 再切下一节（默认 98，即「只剩最后 2%」）
   node autoplay.js --list          # 只列出章节目录 + 完成状态，不播放（排错首选）
   node autoplay.js --no-wait       # 不等待播完，每节只播几秒（快速验证用）
   node autoplay.js --max-min 240   # 全局最多连播 240 分钟就停（默认 300）
   node autoplay.js --force         # 忽略进程锁强制启动（确认没有别的实例在跑）
   node diag.js                     # 诊断：打印章节目录 + 当前播放器状态
   ```
   - 进度实时写入 `autoplay.log`。
   - **每节播到 98% 才切下一节**（`--stop-at` 可调）：实测**播到 90% 平台不一定记「已完成」**，所以默认留最后 2% 不播，确保稳稳达标。
   - **默认跳过已完成章节**：读目录里的 `span.icon_Completed`（悬停显示「已完成」）标记，不再每次从 1.1 重播。
   - 章节列表在多层 iframe 里（`studentcourse` / `studentstudy`），脚本会自动发现，无需你关心。
   - 遇到「章节测试 / 文档」等无视频项会自动跳过（**测验要你自己做**）。
   - **单实例保护**：运行时会写 `autoplay.lock`，已有实例在跑时再启动会直接退出，避免多个进程同时操控同一个浏览器互相打架。

## 在 Codex / 任意终端使用

本 skill 的核心 `scripts/autoplay.js` 是**纯 Node 脚本**，不依赖 WorkBuddy：
1. 复制 `scripts/` 整个目录到任意机器；
2. `npm install playwright-core`；
3. 按上面的「前置条件 3 + 流程 1~3」准备好调试模式 Chrome 与已登录的课程学习页；
4. `node autoplay.js` 即可。
详见同目录 `README.md`。

## 关键实现细节（v1.1.0 / v1.2.0 踩坑记录，改前必读）

### v1.3.0：切节阈值

原来是写死的 `0.9`（90%）。实测发现**播到 90% 平台不一定会记「已完成」**——3.1 / 3.3 / 3.4 / 3.5 都在 90% 处被切走，重新扫描章节目录时仍然没有 `icon_Completed` 标记，而播到接近片尾的 2.5 却立刻变「已完成」。

所以阈值改为可配置的参数 `--stop-at`，**默认 98%**（即「只剩最后 2% 不播」）：既稳定达标，又留 2% 余量避开片尾的结束事件/弹窗。

另外一个同类误判：**播放器 iframe 重载慢时，首次 30s 内等不到新 `src` 会被判成「本节无视频」而整节跳过**（实测 3.2 实际有 548 秒视频却被跳过）。现在会重新点击本节再等 45s，仍等不到才判无视频。

### v1.2.0：怎么判断「这节看没看过」

目录里每节的结构是：
```html
<div class="posCatalog_select" id="cur<knowledgeid>">
  <span class="posCatalog_name" onclick="getTeacherAjax(...)">…</span>
  <span class="icon_Completed prevTips"><span class="prevHoverTips">已完成<i></i></span></span>
</div>
```
- **有 `span.icon_Completed`（或 div 文本含「已完成」）= 这节已达标**，默认跳过。
- 没有该标记、只有 `span.jobUnfinishCount`（未完成任务点数）= 没看完，需要播。
- ⚠️ 不要用「断点续播位置」判断看过与否：完成过的节重新进入时 `currentTime` 可能从很低的数字重新开始（实测已完成的 1.2 重新进去只有 57s / 总长 529s），位置不可靠；**`icon_Completed` 才是平台自己的权威标记**。

### v1.1.0：两个曾让脚本「装模作样」的坑

日志里每节都报「无视频，跳过」，但视频其实一直都在：

1. **章节点必须点内层 `span`，不能点 `<li>`**
   目录结构是 `<li><div class="posCatalog_select" id="cur<knowledgeid>"><span class="posCatalog_name" onclick="getTeacherAjax(courseid,clazzid,knowledgeid)">…</span></div></li>`。
   事件挂在 `span` 上，`<li>` 本身没有任何 onclick —— 对 `<li>` 调 `.click()` 是**空操作**，视频永远不会换节。
   正确做法：定位 `#cur<knowledgeid>` 内的 `[onclick]` 元素再 `click()`。

2. **超星播放器是 video.js，没点大播放按钮就不会加载**
   切到新一节时，`<video class="vjs-tech">` 处于封面态：`preload=none`、`readyState=0`、`videoWidth=0`，必须点 `.vjs-big-play-button` 才加载播放。
   所以**绝不能用 `videoWidth === 0` 判定「本节无视频」**——那是封面态，不是没视频。
   判据应改为「`currentTime` 是否真的在推进」。
   另外超星有断点续播，换节后 `currentTime` 可能直接是上次位置（如 480s），配合 `duration` 算比例即可。

3. **`frame.evaluate` 只能传一个参数**：多字段要打包成对象，否则第三个参数会被当成 options 抛错（且被 `catch{}` 静默吞掉，表现同样是「找不到元素」）。
   另外：**evaluate 的函数体在「浏览器页面上下文」里执行，不能引用 Node 侧的变量**（例如在里面写 `f.url()` 会抛 `ReferenceError`，若外面套了超时包装就会被误报成「求值超时/没有视频」）。需要 frame 信息就在 Node 侧拼装。
4. 所有页面求值都包了超时，避免某个 iframe 卡住整个脚本。
5. 卡顿自愈：暂停立即重触发播放；进度停滞 >90s 也会重触发。

## 排错

- `connectOverCDP` 报错 / 找不到 9222：说明 Chrome 没开调试端口，重跑 `launch_chrome` 脚本。
- 提示「已有 autoplay 实例在运行 (PID x)」：真的有别的实例在跑（可能是上次没退干净的），先结束它；确认不需要了就加 `--force`。
- **先跑 `node diag.js` 或 `node autoplay.js --list`**：能列出章节说明扫描正常（会显示每节的 `nodeId` / `knowledgeId` / 是否已完成），`diag.js` 还会打印当前播放器的 `currentSrc` / `currentTime` / `paused`。
- 章节没被发现：确认你停留在课程的【学习】页面且左侧章节目录已展开。
- 日志出现「未找到可点击的章节元素 [no-target…]」：目录 DOM 结构变了，检查 `div.posCatalog_select` / `span.posCatalog_name` 是否还在，必要时更新 `scanChapters` / `clickChapter`。
- 日志出现「本节无视频（测验/文档），跳过」但该节明明有视频：多半是播放器变了（非 video.js）或未出现新的 `src`，用 `diag.js` 对比 `video.currentSrc` / `.vjs-big-play-button`。
- 某节一直暂停：脚本会每 5s 重触发；仍不行手动点一下播放键，下一节会自动继续。
- 想中途停止：结束 `node autoplay.js` 进程即可（会自动删掉 `autoplay.lock`）；重新运行会读「已完成」标记，直接从没看过的节继续，不会重复。
