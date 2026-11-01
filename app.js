/* =========================================================
 * 航前检查单 - 主逻辑（Vanilla JS + localStorage）
 * ========================================================= */
'use strict';

const STORAGE_KEY = 'pilotChecklistData.v1';
const GOLD_CHECK_SVG = '<svg viewBox="0 0 24 24"><polyline points="4.5 12.5 10 18 19.5 7"/></svg>';

/* ---------- 默认数据 ---------- */
function defaultData() {
  const mk = (name, texts) => ({
    id: uid(),
    name,
    items: texts.map(t => ({ id: uid(), text: t, done: false }))
  });
  return {
    tabs: [
      mk('准备流程', [
        '网络准备', '标注', '联系机长和师兄', '云执照信息确认',
        '询问着装', '复习应知应会（32553）', '教员习惯',
        '看天气预报/重要通告', 'EFB更新充电', '定闹钟', '是否外站吹酒测/海关申报'
      ]),
      mk('航班当天', [
        '航班号', '天气，航路天气', '航行通告', '廊桥', '进退场方式',
        '前后序', '起飞时间，流控信息', '乘务组是否接飞',
        '任务书离线', '找自愿报告', '风险分析'
      ]),
      mk('国际运行', [
        '陆空通话', '带现金', '飞行箱检查', '海关申报',
        '入境申报（新加坡、雅加达、巴厘岛）', '确定时区', '填写本三字代码'
      ])
    ],
    activeTabId: null
  };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- 数据读写 ---------- */
let data;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      data = JSON.parse(raw);
      if (!data || !Array.isArray(data.tabs)) throw new Error('bad data');
    } else {
      data = defaultData();
      data.activeTabId = data.tabs[0].id;
      save();
    }
  } catch (e) {
    data = defaultData();
    data.activeTabId = data.tabs[0].id;
    save();
  }
  if (!data.tabs.some(t => t.id === data.activeTabId)) {
    data.activeTabId = data.tabs.length ? data.tabs[0].id : null;
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ---------- DOM 引用 ---------- */
const tabBar = document.getElementById('tabBar');
const pagesTrack = document.getElementById('pagesTrack');
const pagesViewport = document.getElementById('pagesViewport');

/* 标签栏排序模式（开启后标签可左右拖动排序） */
let sortingMode = false;

/* ---------- 渲染 ---------- */
function render() {
  renderTabs();
  renderPages();
  requestAnimationFrame(() => moveTrack(false));
}

function renderTabs() {
  tabBar.innerHTML = '';
  data.tabs.forEach(tab => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tab' + (tab.id === data.activeTabId ? ' active' : '');
    el.textContent = tab.name;
    el.dataset.id = tab.id;
    el.addEventListener('click', () => {
      if (sortingMode) return; // 排序模式下点击不切换
      if (data.activeTabId !== tab.id) {
        data.activeTabId = tab.id;
        save();
        render();
      }
    });
    // 长按 500ms -> 标签页管理（重命名/删除）
    attachLongPress(el, () => {
      if (sortingMode) return;
      openTabActionSheet(tab);
    });
    if (sortingMode) {
      el.classList.add('sortable');
      attachTabDrag(el);
    }
    tabBar.appendChild(el);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tab-add';
  add.textContent = '+';
  add.addEventListener('click', () => openTabSheet('add'));
  tabBar.appendChild(add);

  // 排序开关：点开后可拖动标签排序
  const sortBtn = document.createElement('button');
  sortBtn.type = 'button';
  sortBtn.className = 'tab-sort-toggle' + (sortingMode ? ' active' : '');
  sortBtn.textContent = sortingMode ? '完成' : '≡ 排序';
  sortBtn.addEventListener('click', () => {
    sortingMode = !sortingMode;
    renderTabs();
    if (sortingMode) tabBar.scrollLeft = 0; // 排序时回到起点，避免标签被裁切
    if (!sortingMode) save();
  });
  tabBar.appendChild(sortBtn);
  tabBar.classList.toggle('sorting', sortingMode);
}

function renderPages() {
  pagesTrack.innerHTML = '';
  pagesTrack.style.transition = 'none';
  pagesTrack.style.transform = 'translateX(0)';
  // 注意：不设置 track 总宽度。每个 page 的 flex-basis 即为视口宽度(100%)，
  // translateX(-index*100%) 恰好等于一页宽度，页面内容也严格按视口宽度排版。

  data.tabs.forEach((tab, idx) => {
    const page = document.createElement('section');
    page.className = 'page';
    page.dataset.index = idx;

    const doneCount = tab.items.filter(i => i.done).length;

    page.innerHTML = `
      <div class="page-head">
        <span class="page-progress"><b>${doneCount}</b> / ${tab.items.length} 已完成</span>
        <button type="button" class="btn btn-reset-page">重置本页</button>
      </div>
      <ul class="item-list"></ul>
    `;

    const list = page.querySelector('.item-list');

    if (tab.items.length === 0) {
      const tip = document.createElement('p');
      tip.className = 'empty-tip';
      tip.textContent = '暂无检查项，点击下方按钮添加';
      page.appendChild(tip);
    }

    tab.items.forEach(item => list.appendChild(buildItemRow(item, tab, list)));

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn add-item-btn' + (tab.items.length === 0 ? ' big' : '');
    addBtn.textContent = tab.items.length === 0 ? '＋ 添加第一个检查项' : '+ 添加检查项';
    addBtn.addEventListener('click', () => openItemSheet('add', tab.id));
    page.appendChild(addBtn);

    page.querySelector('.btn-reset-page').addEventListener('click', () => {
      if (tab.items.every(i => !i.done)) return;
      confirmDialog('重置本页', `将清除「${tab.name}」全部 ${doneCount} 个勾选，确定吗？`, () => {
        tab.items.forEach(i => i.done = false);
        save();
        render();
      });
    });

    pagesTrack.appendChild(page);
  });
}

function buildItemRow(item, tab, list) {
  const li = document.createElement('li');
  li.className = 'item-row' + (item.done ? ' done' : '');
  li.dataset.id = item.id;
  li.innerHTML = `
    <div class="item-actions">
      <button type="button" class="act-edit">编辑</button>
      <button type="button" class="act-del">删除</button>
    </div>
    <div class="item-main">
      <span class="item-grip" aria-label="拖动排序">≡</span>
      <span class="checkbox">${GOLD_CHECK_SVG}</span>
      <span class="item-text"></span>
    </div>
  `;
  li.querySelector('.item-text').textContent = item.text;

  // 勾选 / 取消勾选
  li.querySelector('.checkbox').addEventListener('click', (e) => {
    e.stopPropagation(); // 避免冒泡触发行的操作弹窗
    item.done = !item.done;
    li.classList.toggle('done', item.done);
    const cb = li.querySelector('.checkbox');
    cb.classList.remove('pop');
    void cb.offsetWidth; // 重启动画
    cb.classList.add('pop');
    updateProgress(li.closest('.page'));
    save();
  });

  // 点击文字 -> 操作弹窗（编辑/删除）
  li.querySelector('.item-main').addEventListener('click', (e) => {
    if (e.target.closest('.item-grip')) return; // 手柄点击不触发
    if (li.dataset.swiped === '1') { // 已滑动状态：先复位
      resetSwipe(li);
      e.stopPropagation();
      return;
    }
    openActionSheet(item);
  });

  // 左滑显示编辑/删除
  attachSwipe(li);
  // 长按手柄拖动排序
  attachItemDrag(li, list, tab);
  return li;
}

function updateProgress(page) {
  const tab = data.tabs.find(t => t.id === data.activeTabId);
  if (!tab || !page) return;
  const doneCount = tab.items.filter(i => i.done).length;
  page.querySelector('.page-progress').innerHTML =
    `<b>${doneCount}</b> / ${tab.items.length} 已完成`;
}

/* ---------- 横向滑动切换标签 ---------- */
let startX = 0, startY = 0, dragging = false, horizontal = null, deltaX = 0;
const activeIndex = () => data.tabs.findIndex(t => t.id === data.activeTabId);

function moveTrack(animate) {
  pagesTrack.style.transition = animate ? 'transform .25s ease-out' : 'none';
  pagesTrack.style.transform = `translateX(${-activeIndex() * 100}%)`;
}

pagesViewport.addEventListener('touchstart', (e) => {
  if (data.tabs.length < 2) return;
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
  dragging = true;
  horizontal = null;
  deltaX = 0;
}, { passive: true });

pagesViewport.addEventListener('touchmove', (e) => {
  if (!dragging) return;
  const dx = e.touches[0].clientX - startX;
  const dy = e.touches[0].clientY - startY;
  if (horizontal === null) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    horizontal = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (horizontal === 'x') pagesTrack.style.transition = 'none';
  }
  if (horizontal !== 'x') return;
  deltaX = dx;
  // 边界阻尼
  const idx = activeIndex();
  const damped = (idx === 0 && dx > 0) || (idx === data.tabs.length - 1 && dx < 0);
  pagesTrack.style.transform =
    `translateX(calc(${-idx * 100}% + ${damped ? dx / 3 : dx}px))`;
}, { passive: true });

pagesViewport.addEventListener('touchend', () => {
  if (!dragging) return;
  dragging = false;
  if (horizontal !== 'x') return;
  const idx = activeIndex();
  const threshold = 60;
  if (deltaX < -threshold && idx < data.tabs.length - 1) {
    data.activeTabId = data.tabs[idx + 1].id;
    save();
    renderTabs();
    moveTrack(true);
  } else if (deltaX > threshold && idx > 0) {
    data.activeTabId = data.tabs[idx - 1].id;
    save();
    renderTabs();
    moveTrack(true);
  } else {
    moveTrack(true);
  }
});

/* ---------- 检查项左滑操作 ---------- */
function attachSwipe(li) {
  const main = li.querySelector('.item-main');
  let sx = 0, sy = 0, sw = false, sh = null, moved = 0;
  const OPEN_X = -148;

  main.addEventListener('touchstart', (e) => {
    if (e.target.closest('.item-grip')) return; // 手柄不触发滑动
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    sw = true; sh = null; moved = 0;
    main.style.transition = 'none';
  }, { passive: true });

  main.addEventListener('touchmove', (e) => {
    if (!sw) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (sh === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      sh = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (sh !== 'x') return;
    moved = dx + (li.dataset.swiped === '1' ? OPEN_X : 0);
    moved = Math.min(0, Math.max(OPEN_X, moved));
    main.style.transform = `translateX(${moved}px)`;
  }, { passive: true });

  main.addEventListener('touchend', () => {
    if (!sw) return;
    sw = false;
    if (sh !== 'x') { main.style.transition = ''; return; }
    main.style.transition = 'transform .22s ease-out';
    if (moved < OPEN_X / 2) {
      li.dataset.swiped = '1';
      main.style.transform = `translateX(${OPEN_X}px)`;
    } else {
      resetSwipe(li);
    }
  });
}

function resetSwipe(li) {
  const main = li.querySelector('.item-main');
  main.style.transition = 'transform .22s ease-out';
  main.style.transform = 'translateX(0)';
  li.dataset.swiped = '0';
}

/* ---------- 检查项拖拽排序（竖向，手柄触发） ---------- */
function attachItemDrag(li, list, tab) {
  const grip = li.querySelector('.item-grip');
  let startY = 0, dragging = false;

  function onMove(e) {
    if (!dragging) return;
    li.style.transform = `translateY(${e.clientY - startY}px)`;
    const rect = li.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const sibs = [...list.children].filter(c => c !== li && c.classList.contains('item-row'));
    for (const s of sibs) {
      const r = s.getBoundingClientRect();
      const c = r.top + r.height / 2;
      const h = r.height + 1;
      if (center > c && li.nextElementSibling === s) {
        // 向下拖过下一个：插入到它之后
        list.insertBefore(li, s.nextElementSibling);
        startY += h;
      } else if (center < c && li.previousElementSibling === s) {
        // 向上拖过上一个：插入到它之前
        list.insertBefore(li, s);
        startY -= h;
      }
    }
    e.preventDefault();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    li.classList.remove('dragging');
    li.style.transform = '';
    const ids = [...list.querySelectorAll('.item-row')].map(x => x.dataset.id);
    tab.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    save();
  }

  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    resetSwipe(li);
    li.classList.add('dragging');
    li.style.transition = 'none';
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    e.preventDefault();
  });
}

/* ---------- 标签页拖拽排序（横向，排序模式触发） ---------- */
function attachTabDrag(el) {
  let startX = 0, dragging = false;
  const gap = 6;

  function onMove(e) {
    if (!dragging) return;
    el.style.transform = `translateX(${e.clientX - startX}px)`;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const sibs = [...tabBar.querySelectorAll('.tab.sortable')].filter(s => s !== el);
    for (const s of sibs) {
      const r = s.getBoundingClientRect();
      const c = r.left + r.width / 2;
      const w = el.offsetWidth + gap;
      if (center > c && el.nextElementSibling === s) {
        // 向右拖过下一个：插入到它之后
        tabBar.insertBefore(el, s.nextElementSibling);
        startX += w;
      } else if (center < c && el.previousElementSibling === s) {
        // 向左拖过上一个：插入到它之前
        tabBar.insertBefore(el, s);
        startX -= w;
      }
    }
    e.preventDefault();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    el.classList.remove('dragging');
    el.style.transform = '';
    const ids = [...tabBar.querySelectorAll('.tab')].map(t => t.dataset.id);
    data.tabs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    save();
  }

  el.addEventListener('pointerdown', (e) => {
    if (!sortingMode) return;
    dragging = true;
    startX = e.clientX;
    el.classList.add('dragging');
    el.style.transition = 'none';
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    e.preventDefault();
  });
}

/* ---------- 长按 ---------- */
function attachLongPress(el, cb) {
  let timer = null, moved = false;
  el.addEventListener('touchstart', () => {
    moved = false;
    timer = setTimeout(() => { if (!moved) cb(); }, 500);
  }, { passive: true });
  const clear = () => { clearTimeout(timer); };
  el.addEventListener('touchmove', () => { moved = true; clear(); }, { passive: true });
  el.addEventListener('touchend', clear);
  el.addEventListener('touchcancel', clear);
}

/* ---------- 底部抽屉通用 ---------- */
function showMask(mask) { mask.classList.add('show'); }
function hideMask(mask) { mask.classList.remove('show'); }

/* 检查项抽屉 */
const itemSheetMask = document.getElementById('itemSheetMask');
const itemInput = document.getElementById('itemInput');
const itemSheetTitle = document.getElementById('itemSheetTitle');
let itemSheetCtx = null; // { mode:'add'|'edit', tabId, itemId }

function openItemSheet(mode, tabId, itemId) {
  itemSheetCtx = { mode, tabId, itemId };
  itemSheetTitle.textContent = mode === 'add' ? '添加检查项' : '编辑检查项';
  const tab = data.tabs.find(t => t.id === tabId);
  itemInput.value = mode === 'edit'
    ? (tab.items.find(i => i.id === itemId) || {}).text || ''
    : '';
  showMask(itemSheetMask);
  setTimeout(() => itemInput.focus(), 250);
}

document.getElementById('itemSheetOk').addEventListener('click', submitItemSheet);
itemInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitItemSheet(); });

function submitItemSheet() {
  const text = itemInput.value.trim();
  if (!text || !itemSheetCtx) { hideMask(itemSheetMask); return; }
  const tab = data.tabs.find(t => t.id === itemSheetCtx.tabId);
  if (itemSheetCtx.mode === 'add') {
    tab.items.push({ id: uid(), text, done: false });
  } else {
    const it = tab.items.find(i => i.id === itemSheetCtx.itemId);
    if (it) it.text = text;
  }
  save();
  render();
  hideMask(itemSheetMask);
}

document.getElementById('itemSheetCancel').addEventListener('click', () => hideMask(itemSheetMask));

/* 标签页抽屉 */
const tabSheetMask = document.getElementById('tabSheetMask');
const tabInput = document.getElementById('tabInput');
const tabSheetTitle = document.getElementById('tabSheetTitle');
let tabSheetCtx = null; // { mode:'add'|'rename', tabId }

function openTabSheet(mode, tabId) {
  tabSheetCtx = { mode, tabId };
  tabSheetTitle.textContent = mode === 'add' ? '新增标签页' : '重命名标签页';
  if (mode === 'rename') {
    const tab = data.tabs.find(t => t.id === tabId);
    tabInput.value = tab ? tab.name : '';
  } else {
    tabInput.value = '';
  }
  showMask(tabSheetMask);
  setTimeout(() => tabInput.focus(), 250);
}

function submitTabSheet() {
  const name = tabInput.value.trim();
  if (!name || !tabSheetCtx) { hideMask(tabSheetMask); return; }
  if (tabSheetCtx.mode === 'add') {
    const t = { id: uid(), name, items: [] };
    data.tabs.push(t);
    data.activeTabId = t.id;
  } else {
    const tab = data.tabs.find(t => t.id === tabSheetCtx.tabId);
    if (tab) tab.name = name;
  }
  save();
  render();
  hideMask(tabSheetMask);
}

document.getElementById('tabSheetOk').addEventListener('click', submitTabSheet);
tabInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitTabSheet(); });
document.getElementById('tabSheetCancel').addEventListener('click', () => hideMask(tabSheetMask));

/* 长按标签 -> 管理动作（重命名/删除） */
const actionTargetText = document.getElementById('actionTargetText');
let actionCtx = null;

// 检查项操作弹窗
const actionMask = document.getElementById('actionMask');
function openActionSheet(item) {
  actionCtx = { type: 'item', item };
  actionTargetText.textContent = item.text;
  showMask(actionMask);
}
// 标签页操作弹窗：长按标签触发
function openTabActionSheet(tab) {
  actionCtx = { type: 'tab', tab };
  actionTargetText.textContent = `标签页：${tab.name}`;
  showMask(actionMask);
}

// 修改「编辑」按钮逻辑，同时支持 item 与 tab
document.getElementById('actionEdit').addEventListener('click', () => {
  const ctx = actionCtx; hideMask(actionMask);
  if (!ctx) return;
  if (ctx.type === 'item') {
    const tab = data.tabs.find(t => t.items.some(i => i.id === ctx.item.id));
    if (tab) openItemSheet('edit', tab.id, ctx.item.id);
  } else if (ctx.type === 'tab') {
    openTabSheet('rename', ctx.tab.id);
  }
});
document.getElementById('actionDelete').addEventListener('click', () => {
  const ctx = actionCtx; hideMask(actionMask);
  if (!ctx) return;
  if (ctx.type === 'item') {
    confirmDialog('删除检查项', `确定删除「${ctx.item.text}」吗？`, () => {
      const tab = data.tabs.find(t => t.items.some(i => i.id === ctx.item.id));
      if (tab) tab.items = tab.items.filter(i => i.id !== ctx.item.id);
      save();
      render();
    });
  } else if (ctx.type === 'tab') {
    if (data.tabs.length <= 1) {
      confirmDialog('无法删除', '至少需要保留一个标签页。', null);
      document.getElementById('confirmOk').textContent = '好的';
      return;
    }
    confirmDialog('删除标签页', `确定删除标签页「${ctx.tab.name}」及其全部检查项吗？`, () => {
      data.tabs = data.tabs.filter(t => t.id !== ctx.tab.id);
      if (!data.tabs.some(t => t.id === data.activeTabId)) {
        data.activeTabId = data.tabs.length ? data.tabs[0].id : null;
      }
      save();
      render();
    });
  }
});
document.getElementById('actionCancel').addEventListener('click', () => hideMask(actionMask));

/* 确认弹窗 */
const confirmMask = document.getElementById('confirmMask');
let confirmCb = null;
function confirmDialog(title, text, cb) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmText').textContent = text;
  document.getElementById('confirmOk').textContent = cb ? '确定' : '好的';
  confirmCb = cb;
  showMask(confirmMask);
}
document.getElementById('confirmOk').addEventListener('click', () => {
  hideMask(confirmMask);
  if (confirmCb) confirmCb();
  confirmCb = null;
});
document.getElementById('confirmCancel').addEventListener('click', () => {
  hideMask(confirmMask); confirmCb = null;
});

/* 点击遮罩关闭 */
[itemSheetMask, tabSheetMask, actionMask].forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) hideMask(m); });
});

/* ---------- 全部重置 ---------- */
document.getElementById('btnResetAll').addEventListener('click', () => {
  const total = data.tabs.reduce((s, t) => s + t.items.filter(i => i.done).length, 0);
  if (total === 0) return;
  confirmDialog('全部重置', `将清除所有标签页共 ${total} 个勾选，确定吗？`, () => {
    data.tabs.forEach(t => t.items.forEach(i => i.done = false));
    save();
    render();
  });
});

/* ---------- 启动 ---------- */
load();
render();

/* 注册 Service Worker（离线缓存，需 HTTPS 或 localhost） */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
