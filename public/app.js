// Replaced with the commit sha at deploy time, the same way the service
// worker is stamped, so the running version can be checked in Settings.
const BUILD_ID = '__BUILD_ID__';

// Visible length of the budget gauge's arc: 270° of a circle with r=80.
const GAUGE_ARC = 2 * Math.PI * 80 * 0.75;

const state = {
  settings: null,
  incomeSources: [],
  properties: [],
  categories: [],
  sheets: [],
  activeSheetId: null,
  expenses: [],
  activeTab: 'overview',
  expenseFilter: 'all',
  editingIncomeSource: null,
  editingProperty: null,
  editingCategory: null,
  editingExpense: null
};

let sharePushTimer = null;

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMoney(amount) {
  const symbol = (state.settings && state.settings.currency) || 'AED';
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  const display = Math.abs(rounded % 1) < 0.005
    ? Math.round(rounded).toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${display}`;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
  const dark = theme === 'dark'
    || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#000000' : '#f4f5f7');
}

// ---- Income math ----

function sourceMonthly(source) {
  return source.frequency === 'yearly' ? source.amount / 12 : source.amount;
}

function propertyNetAnnual(property) {
  return (property.annualGrossIncome || 0) - (property.annualServiceCharges || 0);
}

function propertyMonthly(property) {
  if (property.vacant) return 0;
  return (propertyNetAnnual(property) * (property.sharePct / 100)) / 12;
}

function totalMonthlyIncome() {
  const sources = state.incomeSources.reduce((s, i) => s + sourceMonthly(i), 0);
  const properties = state.properties.reduce((s, p) => s + propertyMonthly(p), 0);
  return sources + properties;
}

function totalMonthlyBudgeted() {
  return state.categories.reduce((s, c) => s + (c.monthlyBudget || 0), 0);
}

function sheetExpenses(sheetId) {
  return state.expenses.filter(e => e.sheetId === sheetId);
}

function categorySpent(sheetId, categoryId) {
  return sheetExpenses(sheetId).filter(e => e.categoryId === categoryId).reduce((s, e) => s + e.amount, 0);
}

function categoryName(categoryId) {
  const c = state.categories.find(cat => cat.id === categoryId);
  return c ? c.name : 'Uncategorized';
}

// ---- Generic donut chart, shared by Overview and Expenses ----
// Draws each segment as a partial circle via stroke-dasharray/dashoffset,
// stacked end to end. An untouched track circle stands in for "nothing here
// yet" rather than a chart with nothing to show.
function buildPie(segments) {
  const r = 80, cx = 100, cy = 100, strokeWidth = 26;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total <= 0) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${strokeWidth}" />`;
  }
  let offset = 0;
  return segments.filter(s => s.value > 0).map(seg => {
    const len = (seg.value / total) * circumference;
    const dash = `${len.toFixed(1)} ${(circumference - len).toFixed(1)}`;
    const dashoffset = (-offset).toFixed(1);
    offset += len;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeWidth}" stroke-dasharray="${dash}" stroke-dashoffset="${dashoffset}" />`;
  }).join('');
}

function renderLegend(containerId, segments, total) {
  document.getElementById(containerId).innerHTML = segments.map(seg => {
    const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
    return `
      <div class="legend-row">
        <span class="legend-dot" style="background:${seg.color}"></span>
        <span class="legend-name">${escapeHtml(seg.label)}</span>
        <span class="legend-value">${pct}% · <strong>${formatMoney(seg.value)}</strong></span>
      </div>`;
  }).join('');
}

// ---- Render: Overview ----

function renderOverview() {
  const monthlyIncome = totalMonthlyIncome();
  const yearlyIncome = monthlyIncome * 12;
  const budgeted = totalMonthlyBudgeted();
  const sheet = state.sheets.find(s => s.id === state.activeSheetId);
  const spent = sheetExpenses(state.activeSheetId).reduce((s, e) => s + e.amount, 0);
  const remaining = budgeted - spent;

  document.getElementById('overview-monthly-income').textContent = formatMoney(monthlyIncome);
  document.getElementById('overview-yearly-income').textContent = formatMoney(yearlyIncome);
  document.getElementById('overview-income-total').textContent = formatMoney(monthlyIncome);
  document.getElementById('overview-budgeted-total').textContent = formatMoney(budgeted);
  document.getElementById('overview-spent-total').textContent = formatMoney(spent);
  document.getElementById('overview-month-label').textContent = sheet ? sheet.name : '';
  document.getElementById('overview-remaining').textContent = formatMoney(remaining);
  document.getElementById('overview-remaining').classList.toggle('negative', remaining < 0);

  const pct = budgeted > 0 ? Math.min(1, spent / budgeted) : 0;
  const gauge = document.getElementById('overview-gauge-fill');
  gauge.setAttribute('stroke-dasharray', `${(pct * GAUGE_ARC).toFixed(1)} 503`);
  gauge.classList.toggle('over', remaining < 0);

  const container = document.getElementById('overview-categories');
  if (!state.categories.length) {
    container.innerHTML = `<div class="empty-hint">No budget categories yet — add some in the Budgets tab.</div>`;
  } else {
    container.innerHTML = state.categories.map(c => {
      const catSpent = categorySpent(state.activeSheetId, c.id);
      const budget = c.monthlyBudget || 0;
      const catPct = budget > 0 ? Math.min(100, Math.round((catSpent / budget) * 100)) : (catSpent > 0 ? 100 : 0);
      const over = budget > 0 && catSpent > budget;
      return `
        <div class="item-card">
          <div class="item-card-head"><h3>${escapeHtml(c.name)}</h3></div>
          <div class="progress-track"><div class="progress-fill${over ? ' over' : ''}" style="width:${catPct}%"></div></div>
          <div class="progress-caption">
            <span${over ? ' class="over-text"' : ''}>${formatMoney(catSpent)} spent</span>
            <span>of ${formatMoney(budget)}</span>
          </div>
        </div>`;
    }).join('');
  }
}

// ---- Render: Income ----

function renderIncome() {
  const sourcesList = document.getElementById('income-sources-list');
  sourcesList.innerHTML = state.incomeSources.length
    ? state.incomeSources.map(s => `
      <div class="item-card" data-income-id="${s.id}">
        <div class="item-card-head">
          <button type="button" class="entry-info edit-income-btn" data-id="${s.id}">
            <h3>${escapeHtml(s.name)}</h3>
            <div class="item-card-sub">${s.frequency === 'yearly' ? 'Per year' : 'Per month'}</div>
          </button>
        </div>
        <div class="item-card-value">${formatMoney(sourceMonthly(s))} <span class="item-card-sub" style="display:inline">/ month</span></div>
      </div>`).join('')
    : `<div class="empty-hint">No other income added yet.</div>`;

  const propertiesList = document.getElementById('properties-list');
  propertiesList.innerHTML = state.properties.length
    ? state.properties.map(p => `
      <div class="item-card" data-property-id="${p.id}">
        <div class="item-card-head">
          <button type="button" class="entry-info edit-property-btn" data-id="${p.id}">
            <h3>${escapeHtml(p.name)}${p.vacant ? '<span class="tag vacant">Vacant</span>' : ''}${p.sharePct < 100 ? `<span class="tag share">${p.sharePct}% share</span>` : ''}</h3>
            <div class="item-card-sub">${formatMoney(p.annualGrossIncome)} gross &minus; ${formatMoney(p.annualServiceCharges)} service charges = ${formatMoney(propertyNetAnnual(p))} net / year</div>
          </button>
        </div>
        <div class="item-card-value${p.vacant ? ' muted' : ''}">${formatMoney(propertyMonthly(p))} <span class="item-card-sub" style="display:inline">/ month${p.vacant ? ' (vacant)' : ''}</span></div>
      </div>`).join('')
    : `<div class="empty-hint">No apartments added yet.</div>`;
}

// ---- Render: Budgets ----

function renderBudgets() {
  const income = totalMonthlyIncome();
  const budgeted = totalMonthlyBudgeted();
  const unallocated = income - budgeted;
  const hint = document.getElementById('budgets-remaining-hint');
  hint.textContent = unallocated >= 0
    ? `${formatMoney(unallocated)} unassigned`
    : `${formatMoney(-unallocated)} over income`;
  hint.style.color = unallocated < 0 ? 'var(--danger)' : '';

  const container = document.getElementById('budgets-list');
  container.innerHTML = state.categories.length
    ? state.categories.map(c => {
      const spent = categorySpent(state.activeSheetId, c.id);
      const budget = c.monthlyBudget || 0;
      const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : (spent > 0 ? 100 : 0);
      const over = budget > 0 && spent > budget;
      return `
        <div class="item-card" data-category-id="${c.id}">
          <div class="item-card-head">
            <button type="button" class="entry-info edit-category-btn" data-id="${c.id}">
              <h3>${escapeHtml(c.name)}</h3>
              <div class="item-card-sub">${formatMoney(budget)} / month budget</div>
            </button>
          </div>
          <div class="progress-track"><div class="progress-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>
          <div class="progress-caption">
            <span${over ? ' class="over-text"' : ''}>${formatMoney(spent)} spent this month</span>
            <span>${pct}%</span>
          </div>
        </div>`;
    }).join('')
    : `<div class="empty-hint">No categories yet.</div>`;
}

// ---- Render: Expenses ----

function renderExpenses() {
  const sheet = state.sheets.find(s => s.id === state.activeSheetId);
  document.getElementById('month-label').textContent = sheet ? sheet.name : '';

  const all = sheetExpenses(state.activeSheetId);
  const total = all.reduce((s, e) => s + e.amount, 0);

  const byCategory = new Map();
  all.forEach(e => {
    const key = e.categoryId || '__uncat';
    byCategory.set(key, (byCategory.get(key) || 0) + e.amount);
  });
  const segments = [...byCategory.entries()].map(([key, value]) => ({
    label: key === '__uncat' ? 'Uncategorized' : categoryName(key),
    value,
    color: key === '__uncat' ? 'var(--track)' : categoryColor(state.categories, key)
  }));

  document.getElementById('expenses-pie').innerHTML = buildPie(segments);
  document.getElementById('expenses-pie-total').textContent = formatMoney(total);
  document.getElementById('expenses-pie-empty').classList.toggle('hidden', total > 0);
  renderLegend('expenses-legend', segments, total);

  const filterRow = document.getElementById('expenses-filter');
  const chips = [{ id: 'all', name: 'All' }, ...state.categories, { id: '__uncat', name: 'Uncategorized' }];
  filterRow.innerHTML = chips.map(c => `<button type="button" class="chip${state.expenseFilter === c.id ? ' active' : ''}" data-filter="${c.id}">${escapeHtml(c.name)}</button>`).join('');

  const filtered = state.expenseFilter === 'all'
    ? all
    : all.filter(e => (e.categoryId || '__uncat') === state.expenseFilter);

  const list = document.getElementById('expenses-list');
  list.innerHTML = filtered.length
    ? filtered.map(e => `
      <div class="entry-row">
        <button type="button" class="entry-info edit-expense-btn" data-id="${e.id}">
          <div class="entry-name">${escapeHtml(categoryName(e.categoryId))}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
          <div class="entry-sub">${e.date}</div>
        </button>
        <span class="entry-amount">${formatMoney(e.amount)}</span>
      </div>`).join('')
    : `<div class="empty-hint">No expenses in this filter.</div>`;
}

// ---- Render: Share ----

function timeAgo(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

async function renderShare() {
  const cfg = await db.getShare();
  const setup = document.getElementById('share-setup');
  const board = document.getElementById('share-board');
  if (!cfg) {
    setup.classList.remove('hidden');
    board.classList.add('hidden');
    return;
  }
  setup.classList.add('hidden');
  board.classList.remove('hidden');
  document.getElementById('share-enabled-toggle').checked = !!cfg.enabled;
  const link = `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}viewer.html?s=${encodeURIComponent(cfg.serverUrl)}&c=${encodeURIComponent(cfg.code)}`;
  document.getElementById('share-link-value').textContent = link;
  const stateEl = document.getElementById('share-sync-state');
  if (!cfg.enabled) {
    stateEl.textContent = 'Live sharing is off — the link will show stale data.';
    stateEl.classList.add('warn');
  } else if (cfg.lastError) {
    stateEl.textContent = `Could not sync: ${cfg.lastError}`;
    stateEl.classList.add('warn');
  } else {
    stateEl.textContent = `Last synced ${timeAgo(cfg.lastPushedAt)}`;
    stateEl.classList.remove('warn');
  }
}

// ---- Dispatch ----

function render() {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${state.activeTab}`));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.activeTab));

  renderOverview();
  if (state.activeTab === 'income') renderIncome();
  if (state.activeTab === 'budgets') renderBudgets();
  if (state.activeTab === 'expenses') renderExpenses();
  if (state.activeTab === 'share') renderShare();

  const catSelect = document.getElementById('expense-category-select');
  catSelect.innerHTML = `<option value="">Uncategorized</option>` +
    state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  queueSharePush();
}

// ---- Live share snapshot ----
// Debounced so a burst of edits (typing an amount, say) sends one push, not
// one per keystroke - sharing is best-effort and must never slow down
// editing. Builds the same fully-computed shape the public viewer renders,
// so the viewer needs no budget logic of its own, only display code.
function queueSharePush() {
  clearTimeout(sharePushTimer);
  sharePushTimer = setTimeout(async () => {
    if (!(await share.isEnabled())) return;
    const sheet = state.sheets.find(s => s.id === state.activeSheetId);
    const budgeted = totalMonthlyBudgeted();
    const expenses = sheetExpenses(state.activeSheetId);
    const spent = expenses.reduce((s, e) => s + e.amount, 0);

    const categories = state.categories.map(c => ({
      id: c.id,
      name: c.name,
      budget: c.monthlyBudget || 0,
      spent: categorySpent(state.activeSheetId, c.id),
      color: categoryColor(state.categories, c.id)
    }));

    const incomeBreakdown = [
      ...state.incomeSources.map(s => ({ name: s.name, monthly: sourceMonthly(s) })),
      ...state.properties.map(p => ({ name: p.name, monthly: propertyMonthly(p) }))
    ];

    const snapshot = {
      currency: state.settings.currency || 'AED',
      monthlyIncome: totalMonthlyIncome(),
      yearlyIncome: totalMonthlyIncome() * 12,
      incomeBreakdown,
      totalBudgeted: budgeted,
      sheetName: sheet ? sheet.name : '',
      totalSpent: spent,
      categories,
      expenses: expenses
        .slice()
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 200)
        .map(e => ({ id: e.id, categoryId: e.categoryId, categoryName: categoryName(e.categoryId), amount: e.amount, note: e.note, date: e.date }))
    };
    await share.pushSnapshot(snapshot);
    if (state.activeTab === 'share') renderShare();
  }, 800);
}

// ---- Modals ----

function syncBodyScrollLock() {
  document.body.classList.toggle('modal-open', !!document.querySelector('.modal:not(.hidden)'));
}

function syncViewportHeight() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${Math.round(height)}px`);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewportHeight);
  window.visualViewport.addEventListener('scroll', syncViewportHeight);
}
window.addEventListener('resize', syncViewportHeight);
syncViewportHeight();

function openModal(id) {
  const modal = document.getElementById(id);
  const alreadyOpen = document.querySelectorAll('.modal:not(.hidden)').length;
  modal.style.zIndex = String(20 + alreadyOpen);
  modal.classList.remove('hidden');
  syncBodyScrollLock();
}
function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('hidden');
  modal.style.zIndex = '';
  syncBodyScrollLock();
}

function openIncomeSourceModal(source) {
  state.editingIncomeSource = source ? source.id : null;
  document.getElementById('income-source-title').textContent = source ? 'Edit income' : 'Add income';
  const form = document.getElementById('income-source-form');
  form.reset();
  if (source) {
    form.name.value = source.name;
    form.amount.value = source.amount;
    form.frequency.value = source.frequency;
  }
  document.getElementById('income-source-delete').classList.toggle('hidden', !source);
  openModal('income-source-modal');
}

function openPropertyModal(property) {
  state.editingProperty = property ? property.id : null;
  document.getElementById('property-title').textContent = property ? 'Edit apartment' : 'Add apartment';
  const form = document.getElementById('property-form');
  form.reset();
  if (property) {
    form.name.value = property.name;
    form.annualGrossIncome.value = property.annualGrossIncome;
    form.annualServiceCharges.value = property.annualServiceCharges;
    form.sharePct.value = property.sharePct;
    form.vacant.checked = property.vacant;
  } else {
    form.sharePct.value = 100;
  }
  document.getElementById('property-delete').classList.toggle('hidden', !property);
  updatePropertyNetPreview();
  openModal('property-modal');
}

function updatePropertyNetPreview() {
  const form = document.getElementById('property-form');
  const net = (Number(form.annualGrossIncome.value) || 0) - (Number(form.annualServiceCharges.value) || 0);
  document.getElementById('property-net-preview').textContent = `${formatMoney(net)} / year net`;
}

function openCategoryModal(category) {
  state.editingCategory = category ? category.id : null;
  document.getElementById('category-title').textContent = category ? 'Edit category' : 'Add category';
  const form = document.getElementById('category-form');
  form.reset();
  if (category) {
    form.name.value = category.name;
    form.monthlyBudget.value = category.monthlyBudget;
  }
  document.getElementById('category-delete').classList.toggle('hidden', !category);
  openModal('category-modal');
}

function openExpenseModal(expense) {
  state.editingExpense = expense ? expense.id : null;
  document.getElementById('expense-title').textContent = expense ? 'Edit expense' : 'Add expense';
  const form = document.getElementById('expense-form');
  form.reset();
  if (expense) {
    form.amount.value = expense.amount;
    form.date.value = expense.date;
    form.categoryId.value = expense.categoryId || '';
    form.note.value = expense.note || '';
  } else {
    form.date.value = todayStr();
  }
  document.getElementById('expense-delete').classList.toggle('hidden', !expense);
  openModal('expense-modal');
}

// ---- Data refresh ----

async function refreshAll() {
  state.settings = await db.getSettings();
  state.incomeSources = await db.getIncomeSources();
  state.properties = await db.getProperties();
  state.categories = await db.getCategories();
  state.sheets = await db.getSheets();
  state.activeSheetId = await db.getActiveSheetId();
  state.expenses = (await db.getAll()).expenses;
  render();
}

// ---- Events ----

function wireEvents() {
  document.querySelectorAll('.tabbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      render();
    });
  });

  // Income tab
  document.getElementById('add-income-source-btn').addEventListener('click', () => openIncomeSourceModal(null));
  document.getElementById('income-sources-list').addEventListener('click', e => {
    const btn = e.target.closest('.edit-income-btn');
    if (btn) openIncomeSourceModal(state.incomeSources.find(s => s.id === btn.dataset.id));
  });
  document.getElementById('income-source-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = { name: f.get('name'), amount: f.get('amount'), frequency: f.get('frequency') };
    if (state.editingIncomeSource) await db.updateIncomeSource(state.editingIncomeSource, payload);
    else await db.addIncomeSource(payload);
    closeModal('income-source-modal');
    await refreshAll();
  });
  document.getElementById('income-source-delete').addEventListener('click', async () => {
    if (state.editingIncomeSource && confirm('Delete this income source?')) {
      await db.deleteIncomeSource(state.editingIncomeSource);
      closeModal('income-source-modal');
      await refreshAll();
    }
  });

  document.getElementById('add-property-btn').addEventListener('click', () => openPropertyModal(null));
  document.getElementById('properties-list').addEventListener('click', e => {
    const btn = e.target.closest('.edit-property-btn');
    if (btn) openPropertyModal(state.properties.find(p => p.id === btn.dataset.id));
  });
  document.getElementById('property-form').addEventListener('input', e => {
    if (e.target.name === 'annualGrossIncome' || e.target.name === 'annualServiceCharges') updatePropertyNetPreview();
  });
  document.getElementById('property-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      name: f.get('name'),
      annualGrossIncome: f.get('annualGrossIncome'),
      annualServiceCharges: f.get('annualServiceCharges'),
      sharePct: f.get('sharePct'),
      vacant: f.get('vacant') === 'on'
    };
    if (state.editingProperty) await db.updateProperty(state.editingProperty, payload);
    else await db.addProperty(payload);
    closeModal('property-modal');
    await refreshAll();
  });
  document.getElementById('property-delete').addEventListener('click', async () => {
    if (state.editingProperty && confirm('Delete this apartment?')) {
      await db.deleteProperty(state.editingProperty);
      closeModal('property-modal');
      await refreshAll();
    }
  });

  // Budgets tab
  document.getElementById('add-category-btn').addEventListener('click', () => openCategoryModal(null));
  document.getElementById('budgets-list').addEventListener('click', e => {
    const btn = e.target.closest('.edit-category-btn');
    if (btn) openCategoryModal(state.categories.find(c => c.id === btn.dataset.id));
  });
  document.getElementById('category-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = { name: f.get('name'), monthlyBudget: f.get('monthlyBudget') };
    if (state.editingCategory) await db.updateCategory(state.editingCategory, payload);
    else await db.addCategory(payload);
    closeModal('category-modal');
    await refreshAll();
  });
  document.getElementById('category-delete').addEventListener('click', async () => {
    if (state.editingCategory && confirm('Delete this category? Its expenses will become uncategorized.')) {
      await db.deleteCategory(state.editingCategory);
      closeModal('category-modal');
      await refreshAll();
    }
  });

  // Month navigation - shared by Overview and Expenses, since both read the
  // same active sheet. Either pair of arrows moves both tabs together.
  const shiftMonth = async delta => {
    await db.shiftActiveSheet(delta);
    state.expenseFilter = 'all';
    await refreshAll();
  };
  document.getElementById('overview-month-prev-btn').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('overview-month-next-btn').addEventListener('click', () => shiftMonth(1));
  document.getElementById('month-prev-btn').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('month-next-btn').addEventListener('click', () => shiftMonth(1));

  // Expenses tab
  document.getElementById('expenses-filter').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.expenseFilter = chip.dataset.filter;
    renderExpenses();
  });
  document.getElementById('add-expense-btn').addEventListener('click', () => openExpenseModal(null));
  document.getElementById('expenses-list').addEventListener('click', e => {
    const btn = e.target.closest('.edit-expense-btn');
    if (btn) openExpenseModal(state.expenses.find(x => x.id === btn.dataset.id));
  });
  document.getElementById('expense-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = { categoryId: f.get('categoryId') || null, amount: f.get('amount'), note: f.get('note'), date: f.get('date') };
    if (state.editingExpense) await db.updateExpense(state.editingExpense, payload);
    else await db.addExpense(payload);
    closeModal('expense-modal');
    await refreshAll();
  });
  document.getElementById('expense-delete').addEventListener('click', async () => {
    if (state.editingExpense && confirm('Delete this expense?')) {
      await db.deleteExpense(state.editingExpense);
      closeModal('expense-modal');
      await refreshAll();
    }
  });

  // Share tab
  document.getElementById('share-enable-btn').addEventListener('click', async () => {
    const serverUrl = document.getElementById('share-server').value.trim();
    const status = document.getElementById('share-setup-status');
    if (!serverUrl) { status.textContent = 'Enter the share server address first.'; return; }
    status.textContent = 'Connecting…';
    try {
      await share.probe(serverUrl);
      await share.enable({ serverUrl, label: 'Budget Tracker' });
      status.textContent = '';
      await renderShare();
      queueSharePush();
    } catch (err) {
      status.textContent = err.message || 'Could not enable sharing.';
    }
  });
  document.getElementById('share-enabled-toggle').addEventListener('change', async e => {
    await share.setEnabled(e.target.checked);
    if (e.target.checked) queueSharePush();
    await renderShare();
  });
  document.getElementById('share-copy-btn').addEventListener('click', async () => {
    const text = document.getElementById('share-link-value').textContent;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('share-copy-btn');
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch {
      alert('Could not copy automatically — select and copy the link manually.');
    }
  });
  document.getElementById('share-disable-btn').addEventListener('click', async () => {
    if (confirm('Turn off sharing? The link will stop working.')) {
      await share.disable();
      await renderShare();
    }
  });

  // Generic modal close
  document.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.closeModal));
  });

  // Settings & backup
  document.getElementById('data-btn').addEventListener('click', () => {
    document.getElementById('settings-form').currency.value = state.settings.currency;
    document.getElementById('settings-form').theme.value = state.settings.theme;
    const stamped = BUILD_ID !== '__BUILD' + '_ID__';
    document.getElementById('build-stamp').textContent = stamped
      ? `Version ${BUILD_ID.slice(0, 7)}`
      : 'Version: running locally';
    openModal('settings-modal');
  });
  document.getElementById('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.settings = await db.saveSettings({ currency: f.get('currency') || 'AED', theme: f.get('theme') });
    applyTheme(state.settings.theme);
    closeModal('settings-modal');
    render();
  });
  document.getElementById('export-btn').addEventListener('click', async () => {
    const data = await db.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-tracker-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('import-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await db.importData(JSON.parse(text));
      alert(`Restored ${result.categories} categories, ${result.sheets} sheets, ${result.expenses} expenses.`);
      closeModal('settings-modal');
      await refreshAll();
    } catch (err) {
      alert(err.message || 'Could not read that backup file.');
    } finally {
      e.target.value = '';
    }
  });
}

(async function init() {
  applyTheme((await db.getSettings()).theme || 'dark');
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme(state.settings.theme || 'dark');
  });
  wireEvents();
  await refreshAll();
})();
