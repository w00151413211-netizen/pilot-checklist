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

/* ---------- 过夜装具：独立的两级数据结构 ----------
 * 与主标签页 data.tabs 完全分离，形如：
 * [ { id, name: '飞行', items: [{ id, text, done }] }, ... ]
 * 单独挂在 data.gear 上，随 save() 一并写入 localStorage。
 */
function defaultGear() {
  const mk = (name, texts) => ({
    id: uid(),
    name,
    items: texts.map(t => ({ id: uid(), text: t, done: false }))
  });
  return [
    mk('飞行', [
      '帽子', '领带', '肩章', '衬衣', '打底', '皮带',
      '裤子', '黑袜', '皮鞋', '外套', '大衣', '羽绒服'
    ]),
    mk('常服', ['秋衣', '秋裤', '外套', '裤子', '常鞋', '拖鞋'])
  ];
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
  if (!data.fuel || typeof data.fuel !== 'object') data.fuel = { date: '', dep: '', arr: '', total: '' };
  // 旧版本数据没有 gear 字段时，补写默认分组（不会覆盖用户已保存/删空的数据）
  if (!Array.isArray(data.gear)) { data.gear = defaultGear(); save(); }
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
  } else if (ctx.type === 'gear-group') {
    openGearSheet('edit-group', ctx.gid);
  } else if (ctx.type === 'gear-item') {
    openGearSheet('edit-item', ctx.gid, ctx.itemId);
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
  } else if (ctx.type === 'gear-group') {
    const g = data.gear.find(x => x.id === ctx.gid);
    if (!g) return;
    confirmDialog('删除分类', `确定删除分类「${g.name}」及其全部装具吗？`, () => {
      data.gear = data.gear.filter(x => x.id !== ctx.gid);
      save();
      renderGear();
    });
  } else if (ctx.type === 'gear-item') {
    const g = data.gear.find(x => x.id === ctx.gid);
    const it = g && g.items.find(x => x.id === ctx.itemId);
    if (!it) return;
    confirmDialog('删除装具', `确定删除「${it.text}」吗？`, () => {
      g.items = g.items.filter(x => x.id !== ctx.itemId);
      save();
      renderGear();
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

/* ---------- 全部重置（同时清空油单 + 过夜装具勾选） ---------- */
document.getElementById('btnResetAll').addEventListener('click', () => {
  const total = data.tabs.reduce((s, t) => s + t.items.filter(i => i.done).length, 0);
  const gearDone = gearDoneCount();
  const hasFuel = fuelHasData();
  if (total === 0 && gearDone === 0 && !hasFuel) return;
  const parts = [];
  if (total > 0) parts.push(`所有标签页共 ${total} 个勾选`);
  if (gearDone > 0) parts.push(`过夜装具 ${gearDone} 个勾选`);
  if (hasFuel) parts.push('油单填写内容');
  confirmDialog('全部重置', `将清除${parts.join('、')}，确定吗？`, () => {
    data.tabs.forEach(t => t.items.forEach(i => i.done = false));
    clearFuel();
    clearGearChecks();
    save();
    render();
  });
});

/* ---------- 油单 ---------- */
const fuelOverlay = document.getElementById('fuelOverlay');
const fuelDate = document.getElementById('fuelDate');
const fuelDep = document.getElementById('fuelDep');
const fuelArr = document.getElementById('fuelArr');
const fuelTotal = document.getElementById('fuelTotal');
const fuelMid = document.getElementById('fuelMid');
const fuelDateWarn = document.getElementById('fuelDateWarn');
const FUEL_RESERVE = 7.6;

function fuelHasData() {
  const f = data.fuel;
  return !!(f.date || f.dep || f.arr || f.total);
}

function openFuel() { fuelOverlay.hidden = false; }
function closeFuel() { fuelOverlay.hidden = true; }

function renderFuel() {
  const f = data.fuel;
  fuelDate.value = f.date;
  fuelDep.value = f.dep;
  fuelArr.value = f.arr;
  fuelTotal.value = f.total;
  updateFuelMid();
  updateFuelDateWarn();
}

/* 中间油量 = 总油量 - 7.6；小于 0 显示 0；输入为空则显示空 */
function updateFuelMid() {
  const raw = fuelTotal.value.trim();
  if (raw === '') { fuelMid.textContent = ''; return; }
  const v = parseFloat(raw);
  if (isNaN(v)) { fuelMid.textContent = ''; return; }
  const mid = Math.max(0, v - FUEL_RESERVE);
  fuelMid.textContent = mid.toFixed(1);
}

/* 解析用户填写的日期，支持：YYYYMMDD、YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD、MMDD（默认当年） */
function parseFuelDate(s) {
  const str = (s || '').trim();
  if (!str) return null;
  const d8 = str.replace(/\D/g, '');
  if (/^\d{8}$/.test(d8)) return new Date(+d8.slice(0, 4), +d8.slice(4, 6) - 1, +d8.slice(6, 8));
  if (/^\d{3,4}$/.test(d8)) { // MMDD / MDD：默认当前年
    const now = new Date();
    return new Date(now.getFullYear(), +d8.slice(0, -2) - 1, +d8.slice(-2));
  }
  return null;
}

/* 当前系统日期 > 填写日期 => 已过期 */
function updateFuelDateWarn() {
  const d = parseFuelDate(fuelDate.value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expired = d && d < today;
  fuelDateWarn.hidden = !expired;
}

function onFuelInput() {
  data.fuel = { date: fuelDate.value, dep: fuelDep.value, arr: fuelArr.value, total: fuelTotal.value };
  save();
  updateFuelMid();
  updateFuelDateWarn();
}

[fuelDate, fuelDep, fuelArr, fuelTotal].forEach(el => el.addEventListener('input', onFuelInput));

function clearFuel() {
  data.fuel = { date: '', dep: '', arr: '', total: '' };
  save();
  renderFuel();
}

document.getElementById('btnFuel').addEventListener('click', openFuel);
document.getElementById('fuelBack').addEventListener('click', closeFuel);
document.getElementById('fuelReset').addEventListener('click', () => {
  if (!fuelHasData()) return;
  confirmDialog('重置油单', '将清空油单全部填写内容，确定吗？', clearFuel);
});

/* =========================================================
 * 过夜装具（独立模块：分组 Group + 装具 Item 两级）
 * ========================================================= */
const gearOverlay = document.getElementById('gearOverlay');
const gearGroupsBox = document.getElementById('gearGroups');
const gearProgress = document.getElementById('gearProgress');
const gearSheetMask = document.getElementById('gearSheetMask');
const gearInput = document.getElementById('gearInput');
const gearSheetTitle = document.getElementById('gearSheetTitle');
let gearSheetCtx = null; // { mode:'add-group'|'edit-group'|'add-item'|'edit-item', gid, itemId }

function openGear() {
  renderGear();
  gearOverlay.hidden = false;
}
function closeGear() { gearOverlay.hidden = true; }

function gearDoneCount() {
  return data.gear.reduce((s, g) => s + g.items.filter(i => i.done).length, 0);
}
function gearTotalCount() {
  return data.gear.reduce((s, g) => s + g.items.length, 0);
}
function updateGearProgress() {
  gearProgress.innerHTML = `<b>${gearDoneCount()}</b> / ${gearTotalCount()} 已完成`;
}

/* 只清空勾选（保留分类与装具），供页内重置 / 全局全部重置复用 */
function clearGearChecks() {
  data.gear.forEach(g => g.items.forEach(i => i.done = false));
  save();
  renderGear();
}

/* ---------- 渲染：分组白卡片 + 装具（复用主页面勾选样式） ---------- */
function renderGear() {
  gearGroupsBox.innerHTML = '';
  updateGearProgress();

  if (data.gear.length === 0) {
    const tip = document.createElement('p');
    tip.className = 'gear-empty';
    tip.textContent = '暂无分类，点击下方按钮添加';
    gearGroupsBox.appendChild(tip);
    return;
  }

  data.gear.forEach(g => {
    const sec = document.createElement('section');
    sec.className = 'gear-group';
    sec.dataset.gid = g.id;

    // 分类大标题 + 右侧「⋯」管理图标
    const head = document.createElement('div');
    head.className = 'gear-group-head';
    const title = document.createElement('h3');
    title.className = 'gear-group-title';
    title.textContent = g.name;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'gear-group-more';
    more.textContent = '⋯';
    more.setAttribute('aria-label', '管理分类');
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      openGearActionSheet('gear-group', g.id);
    });
    head.appendChild(title);
    head.appendChild(more);
    // 长按分类标题同样可唤起管理
    attachLongPress(title, () => openGearActionSheet('gear-group', g.id));
    sec.appendChild(head);

    // 装具勾选列表
    const ul = document.createElement('ul');
    ul.className = 'gear-list item-list';
    g.items.forEach(it => ul.appendChild(buildGearItem(it, g)));
    sec.appendChild(ul);

    // 该分类下添加装具
    const addItem = document.createElement('button');
    addItem.type = 'button';
    addItem.className = 'gear-add-item';
    addItem.textContent = '＋ 添加装具';
    addItem.addEventListener('click', () => openGearSheet('add-item', g.id));
    sec.appendChild(addItem);

    gearGroupsBox.appendChild(sec);
  });
}

function buildGearItem(it, g) {
  const li = document.createElement('li');
  li.className = 'item-row gear-item' + (it.done ? ' done' : '');
  li.dataset.id = it.id;
  li.innerHTML = `
    <div class="item-main">
      <span class="checkbox">${GOLD_CHECK_SVG}</span>
      <span class="item-text"></span>
      <button type="button" class="gear-item-more" aria-label="编辑装具">⋯</button>
    </div>
  `;
  li.querySelector('.item-text').textContent = it.text;

  // 勾选 / 取消：与主页面完全一致的动画 + 变灰删除线
  li.querySelector('.checkbox').addEventListener('click', (e) => {
    e.stopPropagation(); // 不冒泡触发管理菜单
    it.done = !it.done;
    li.classList.toggle('done', it.done);
    const cb = li.querySelector('.checkbox');
    cb.classList.remove('pop');
    void cb.offsetWidth; // 重启动画
    cb.classList.add('pop');
    updateGearProgress();
    save();
  });

  // 点击文字 或 右侧「⋯」图标 -> 编辑/删除菜单
  const openMenu = () => openGearActionSheet('gear-item', g.id, it.id);
  li.querySelector('.item-main').addEventListener('click', openMenu);
  li.querySelector('.gear-item-more').addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu();
  });

  return li;
}

/* 复用主页面的 iOS 风格操作弹窗（编辑 / 删除） */
function openGearActionSheet(type, gid, itemId) {
  if (type === 'gear-group') {
    const g = data.gear.find(x => x.id === gid);
    actionCtx = { type, gid };
    actionTargetText.textContent = `分类：${g ? g.name : ''}`;
  } else {
    const g = data.gear.find(x => x.id === gid);
    const it = g && g.items.find(x => x.id === itemId);
    actionCtx = { type, gid, itemId };
    actionTargetText.textContent = it ? it.text : '';
  }
  showMask(actionMask);
}

/* ---------- 输入抽屉：分类 / 装具 的添加与编辑 ---------- */
function openGearSheet(mode, gid, itemId) {
  gearSheetCtx = { mode, gid, itemId };
  const titles = {
    'add-group': '添加分类', 'edit-group': '编辑分类名称',
    'add-item': '添加装具', 'edit-item': '编辑装具'
  };
  gearSheetTitle.textContent = titles[mode];
  gearInput.value = '';
  if (mode === 'edit-group') {
    const g = data.gear.find(x => x.id === gid);
    gearInput.value = g ? g.name : '';
  } else if (mode === 'edit-item') {
    const g = data.gear.find(x => x.id === gid);
    const it = g && g.items.find(x => x.id === itemId);
    gearInput.value = it ? it.text : '';
  }
  showMask(gearSheetMask);
  setTimeout(() => gearInput.focus(), 250);
}

function submitGearSheet() {
  const text = gearInput.value.trim();
  hideMask(gearSheetMask);
  if (!text || !gearSheetCtx) return;
  const { mode, gid, itemId } = gearSheetCtx;
  const g = data.gear.find(x => x.id === gid);
  if (mode === 'add-group') {
    data.gear.push({ id: uid(), name: text, items: [] });
  } else if (mode === 'edit-group' && g) {
    g.name = text;
  } else if (mode === 'add-item' && g) {
    g.items.push({ id: uid(), text, done: false });
  } else if (mode === 'edit-item' && g) {
    const it = g.items.find(x => x.id === itemId);
    if (it) it.text = text;
  }
  save();
  renderGear();
}

document.getElementById('gearSheetOk').addEventListener('click', submitGearSheet);
gearInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGearSheet(); });
document.getElementById('gearSheetCancel').addEventListener('click', () => hideMask(gearSheetMask));
gearSheetMask.addEventListener('click', (e) => { if (e.target === gearSheetMask) hideMask(gearSheetMask); });

/* ---------- 入口 / 返回 / 添加分类 / 重置本页 ---------- */
document.getElementById('btnGear').addEventListener('click', openGear);
document.getElementById('gearBack').addEventListener('click', closeGear);
document.getElementById('gearAddGroup').addEventListener('click', () => openGearSheet('add-group'));
document.getElementById('gearReset').addEventListener('click', () => {
  const n = gearDoneCount();
  if (n === 0) return;
  confirmDialog('重置本页', `将清除过夜装具全部 ${n} 个勾选，确定吗？`, clearGearChecks);
});

/* ---------- 启动 ---------- */
load();
render();
renderFuel();
renderGear();

/* 注册 Service Worker（离线缓存，需 HTTPS 或 localhost） */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
