// The read-only page behind a share link. Deliberately dumb: it renders
// exactly the pre-computed snapshot the owner's app pushes (see
// queueSharePush in app.js) and does no budget math of its own, so it can
// never drift from what the owner actually sees. No login, no install -
// just the two things in the URL.

const GAUGE_ARC = 2 * Math.PI * 80 * 0.75;
const REFRESH_MS = 20000;

const params = new URLSearchParams(window.location.search);
const serverUrl = (params.get('s') || '').trim().replace(/\/+$/, '');
const code = (params.get('c') || '').trim();

let currency = 'AED';
let currentFilter = 'all';
let latestExpenses = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatMoney(amount) {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  const display = Math.abs(rounded % 1) < 0.005
    ? Math.round(rounded).toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${display}`;
}

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

function timeAgo(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function renderExpenseList() {
  const filtered = currentFilter === 'all'
    ? latestExpenses
    : latestExpenses.filter(e => (e.categoryId || '__uncat') === currentFilter);
  document.getElementById('viewer-expenses').innerHTML = filtered.length
    ? filtered.map(e => `
      <div class="entry-row">
        <div class="entry-info">
          <div class="entry-name">${escapeHtml(e.categoryName || 'Uncategorized')}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
          <div class="entry-sub">${escapeHtml(e.date || '')}</div>
        </div>
        <span class="entry-amount">${formatMoney(e.amount)}</span>
      </div>`).join('')
    : `<div class="empty-hint">No expenses in this filter.</div>`;
}

function render(payload) {
  const snapshot = payload.snapshot || {};
  currency = snapshot.currency || 'AED';
  latestExpenses = snapshot.expenses || [];

  document.getElementById('viewer-status').classList.add('hidden');
  document.getElementById('viewer-content').classList.remove('hidden');

  document.getElementById('viewer-sheet-name').textContent = snapshot.sheetName ? `Budget — ${snapshot.sheetName}` : 'Budget';
  document.getElementById('viewer-updated').textContent = `Updated ${timeAgo(payload.updatedAt)}`;

  document.getElementById('viewer-monthly-income').textContent = formatMoney(snapshot.monthlyIncome);
  document.getElementById('viewer-yearly-income').textContent = formatMoney(snapshot.yearlyIncome);

  const budgeted = snapshot.totalBudgeted || 0;
  const spent = snapshot.totalSpent || 0;
  const remaining = budgeted - spent;
  document.getElementById('viewer-budgeted-total').textContent = formatMoney(budgeted);
  document.getElementById('viewer-spent-total').textContent = formatMoney(spent);
  document.getElementById('viewer-remaining').textContent = formatMoney(remaining);
  document.getElementById('viewer-remaining').classList.toggle('negative', remaining < 0);
  const pct = budgeted > 0 ? Math.min(1, spent / budgeted) : 0;
  const gauge = document.getElementById('viewer-gauge-fill');
  gauge.setAttribute('stroke-dasharray', `${(pct * GAUGE_ARC).toFixed(1)} 503`);
  gauge.classList.toggle('over', remaining < 0);

  const categories = snapshot.categories || [];
  document.getElementById('viewer-categories').innerHTML = categories.length
    ? categories.map(c => {
      const catPct = c.budget > 0 ? Math.min(100, Math.round((c.spent / c.budget) * 100)) : (c.spent > 0 ? 100 : 0);
      const over = c.budget > 0 && c.spent > c.budget;
      return `
        <div class="item-card">
          <div class="item-card-head"><h3>${escapeHtml(c.name)}</h3></div>
          <div class="progress-track"><div class="progress-fill${over ? ' over' : ''}" style="width:${catPct}%"></div></div>
          <div class="progress-caption">
            <span${over ? ' class="over-text"' : ''}>${formatMoney(c.spent)} spent</span>
            <span>of ${formatMoney(c.budget)}</span>
          </div>
        </div>`;
    }).join('')
    : `<div class="empty-hint">No budget categories yet.</div>`;

  const breakdown = snapshot.incomeBreakdown || [];
  document.getElementById('viewer-income-breakdown').innerHTML = breakdown.length
    ? breakdown.map(b => `
      <div class="entry-row">
        <div class="entry-info"><div class="entry-name">${escapeHtml(b.name)}</div></div>
        <span class="entry-amount">${formatMoney(b.monthly)} / mo</span>
      </div>`).join('')
    : `<div class="empty-hint">No income sources added yet.</div>`;

  const byCategory = new Map();
  latestExpenses.forEach(e => {
    const key = e.categoryId || '__uncat';
    byCategory.set(key, (byCategory.get(key) || 0) + e.amount);
  });
  const categoryLookup = new Map(categories.map(c => [c.id, c]));
  const segments = [...byCategory.entries()].map(([key, value]) => ({
    label: key === '__uncat' ? 'Uncategorized' : (categoryLookup.get(key)?.name || 'Category'),
    value,
    color: key === '__uncat' ? 'var(--track)' : (categoryLookup.get(key)?.color || '#35d07f')
  }));
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  document.getElementById('viewer-pie').innerHTML = buildPie(segments);
  document.getElementById('viewer-pie-total').textContent = formatMoney(total);
  document.getElementById('viewer-pie-empty').classList.toggle('hidden', total > 0);
  renderLegend('viewer-legend', segments, total);

  const chips = [{ id: 'all', name: 'All' }, ...categories, { id: '__uncat', name: 'Uncategorized' }];
  document.getElementById('viewer-filter').innerHTML = chips.map(c =>
    `<button type="button" class="chip${currentFilter === c.id ? ' active' : ''}" data-filter="${c.id}">${escapeHtml(c.name)}</button>`
  ).join('');
  renderExpenseList();
}

function showError(message) {
  document.getElementById('viewer-content').classList.add('hidden');
  const el = document.getElementById('viewer-status');
  el.classList.remove('hidden');
  el.textContent = message;
}

async function load() {
  try {
    const res = await fetch(`${serverUrl}/api/view/${encodeURIComponent(code)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Server said ${res.status}`);
    }
    render(await res.json());
  } catch (err) {
    showError(err.message || 'Could not load this budget. Ask them to check the link is still active.');
  }
}

document.getElementById('viewer-filter').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  currentFilter = chip.dataset.filter;
  renderExpenseList();
  document.querySelectorAll('#viewer-filter .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === currentFilter));
});

if (!serverUrl || !code) {
  showError('This link is missing its server address or code.');
} else {
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
}
