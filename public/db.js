const DB_KEY = 'budgetTrackerDb';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const DEFAULT_CATEGORIES = [
  'Groceries', 'Rent/Mortgage', 'Utilities', 'Transport', 'Dining Out',
  'Entertainment', 'Health', 'Savings', 'Other'
];

// Seeds store.investmentCategories, which is user-extensible from there (see
// db.addInvestmentCategory) - this is only the starting point. "Real Estate"
// is treated specially by the app (it's the one category that can link to an
// apartment from Income), so it's always present and never removable.
const DEFAULT_INVESTMENT_CATEGORIES = [
  'Real Estate', 'Stocks & Funds', 'Business', 'Gold & Precious Metals',
  'Vehicles', 'Crypto', 'Other'
];

// A handful of distinct hues, reused in the same order everywhere a category
// needs a color (budgets list, expenses pie, the shared viewer) so a category
// never changes color between screens.
const CATEGORY_PALETTE = [
  '#35d07f', '#7d93ff', '#ffad42', '#ff70ad', '#5fd4d6',
  '#c792ff', '#ff8a5c', '#8fd14f', '#ffd166', '#6ec6ff'
];

function categoryColor(categories, categoryId) {
  const idx = categories.findIndex(c => c.id === categoryId);
  return CATEGORY_PALETTE[(idx < 0 ? 0 : idx) % CATEGORY_PALETTE.length];
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Expense sheets are real calendar months, keyed "YYYY-MM" so they sort and
// compare as plain strings. This is what lets a category's "monthly budget"
// actually mean something: the sheet you're looking at IS the month.
function currentMonthKey() {
  return todayStr().slice(0, 7);
}

function monthKeyFromDate(dateStr) {
  return (dateStr || todayStr()).slice(0, 7);
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function shiftMonthKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ensureSheet(store, key) {
  let sheet = store.sheets.find(s => s.id === key);
  if (!sheet) {
    sheet = { id: key, name: monthLabel(key), createdAt: Date.now() };
    store.sheets.push(sheet);
    store.sheets.sort((a, b) => a.id.localeCompare(b.id));
  }
  return sheet;
}

function seedStore() {
  const key = currentMonthKey();
  return {
    settings: { theme: 'dark', currency: 'AED', onboarded: false },
    incomeSources: [],
    properties: [],
    categories: DEFAULT_CATEGORIES.map(name => ({ id: uid(), name, monthlyBudget: 0 })),
    sheets: [{ id: key, name: monthLabel(key), createdAt: Date.now() }],
    activeSheetId: key,
    expenses: [],
    investments: [],
    investmentCategories: [...DEFAULT_INVESTMENT_CATEGORIES],
    cashAccounts: [],
    receivables: [],
    payables: [],
    share: null, // { serverUrl, code, token, enabled }
    calendarMonths: true
  };
}

// One-time migration from the original manually-named/created sheets to
// real calendar months: every expense moves to the sheet matching its own
// date, so history lands where it actually belongs rather than wherever it
// happened to be entered. Idempotent - re-running it after it's already run
// is a no-op, so it's safe to call unconditionally on every load.
function migrateToCalendarMonths(store) {
  if (store.calendarMonths) {
    ensureSheet(store, currentMonthKey());
    if (!store.sheets.some(s => s.id === store.activeSheetId)) store.activeSheetId = currentMonthKey();
    return;
  }
  store.sheets = [];
  store.expenses.forEach(e => {
    const key = monthKeyFromDate(e.date);
    ensureSheet(store, key);
    e.sheetId = key;
  });
  ensureSheet(store, currentMonthKey());
  store.activeSheetId = currentMonthKey();
  store.calendarMonths = true;
}

// One-time migration from a single "net income" figure to separate gross
// rent and service charges, so the app can do that subtraction instead of
// asking you to do it yourself before typing it in. A property saved under
// the old shape has no annualGrossIncome yet; its old net figure becomes the
// gross figure with zero service charges, which keeps its computed net
// income identical until you go back in and split the two apart for real.
function migratePropertyIncomeFields(store) {
  store.properties.forEach(p => {
    if (p.annualGrossIncome === undefined) {
      p.annualGrossIncome = p.annualNetIncome || 0;
      p.annualServiceCharges = 0;
      delete p.annualNetIncome;
    }
  });
}

function loadDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.settings) parsed.settings = { theme: 'dark', currency: 'AED', onboarded: false };
      if (!parsed.incomeSources) parsed.incomeSources = [];
      if (!parsed.properties) parsed.properties = [];
      if (!parsed.categories) parsed.categories = [];
      if (!parsed.sheets) parsed.sheets = [];
      if (!parsed.expenses) parsed.expenses = [];
      if (!parsed.investments) parsed.investments = [];
      if (!parsed.investmentCategories) parsed.investmentCategories = [...DEFAULT_INVESTMENT_CATEGORIES];
      if (!parsed.investmentCategories.includes('Real Estate')) parsed.investmentCategories.unshift('Real Estate');
      if (!parsed.cashAccounts) parsed.cashAccounts = [];
      if (!parsed.receivables) parsed.receivables = [];
      if (!parsed.payables) parsed.payables = [];
      if (parsed.share === undefined) parsed.share = null;
      migrateToCalendarMonths(parsed);
      migratePropertyIncomeFields(parsed);
      return parsed;
    } catch {
      // fall through and reseed a fresh db below
    }
  }
  const seeded = seedStore();
  saveDb(seeded);
  return seeded;
}

function saveDb(store) {
  localStorage.setItem(DB_KEY, JSON.stringify(store));
}

const db = {
  async getSettings() {
    return loadDb().settings;
  },

  async saveSettings(patch) {
    const store = loadDb();
    store.settings = { ...store.settings, ...patch };
    saveDb(store);
    return store.settings;
  },

  async getAll() {
    return loadDb();
  },

  // ---- Income sources (salary, side income, etc.) ----

  async getIncomeSources() {
    return loadDb().incomeSources;
  },

  async addIncomeSource({ name, amount, frequency }) {
    const store = loadDb();
    const source = { id: uid(), name: (name || '').trim() || 'Income', amount: Number(amount) || 0, frequency: frequency === 'yearly' ? 'yearly' : 'monthly' };
    store.incomeSources.push(source);
    saveDb(store);
    return source;
  },

  async updateIncomeSource(id, { name, amount, frequency }) {
    const store = loadDb();
    const source = store.incomeSources.find(s => s.id === id);
    if (!source) return null;
    source.name = (name || '').trim() || 'Income';
    source.amount = Number(amount) || 0;
    source.frequency = frequency === 'yearly' ? 'yearly' : 'monthly';
    saveDb(store);
    return source;
  },

  async deleteIncomeSource(id) {
    const store = loadDb();
    store.incomeSources = store.incomeSources.filter(s => s.id !== id);
    saveDb(store);
  },

  // ---- Properties (apartments) ----

  async getProperties() {
    return loadDb().properties;
  },

  async addProperty({ name, annualGrossIncome, annualServiceCharges, sharePct, vacant }) {
    const store = loadDb();
    const property = {
      id: uid(),
      name: (name || '').trim() || 'Apartment',
      annualGrossIncome: Number(annualGrossIncome) || 0,
      annualServiceCharges: Number(annualServiceCharges) || 0,
      sharePct: Math.max(0, Math.min(100, Number(sharePct) || 100)),
      vacant: !!vacant
    };
    store.properties.push(property);
    saveDb(store);
    return property;
  },

  async updateProperty(id, { name, annualGrossIncome, annualServiceCharges, sharePct, vacant }) {
    const store = loadDb();
    const property = store.properties.find(p => p.id === id);
    if (!property) return null;
    property.name = (name || '').trim() || 'Apartment';
    property.annualGrossIncome = Number(annualGrossIncome) || 0;
    property.annualServiceCharges = Number(annualServiceCharges) || 0;
    property.sharePct = Math.max(0, Math.min(100, Number(sharePct) || 100));
    property.vacant = !!vacant;
    saveDb(store);
    return property;
  },

  async deleteProperty(id) {
    const store = loadDb();
    const property = store.properties.find(p => p.id === id);
    store.properties = store.properties.filter(p => p.id !== id);
    // A net-worth investment linked to this apartment survives the apartment
    // being removed from Income - it just freezes onto the last known name
    // instead of vanishing or pointing at nothing.
    if (property) {
      store.investments.forEach(inv => {
        if (inv.propertyId === id) {
          inv.propertyId = null;
          inv.name = property.name;
        }
      });
    }
    saveDb(store);
  },

  // ---- Net worth: investments ----
  // A "Real Estate" investment can optionally link to an apartment already
  // tracked in Income (propertyId) - when linked, its display name always
  // follows the property's own name rather than a separately-typed copy, so
  // renaming the apartment in Income can't leave the net worth side stale.

  async getInvestments() {
    return loadDb().investments;
  },

  async getInvestmentCategories() {
    return loadDb().investmentCategories;
  },

  // Adds a category if it's new (case-insensitively - "gold" and "Gold"
  // are the same category), or just returns the existing one it matches.
  // No rename/delete here on purpose: investments reference a category by
  // name, and "Real Estate" is load-bearing for the apartment link, so
  // free-form renaming is left for later rather than risking either.
  async addInvestmentCategory(name) {
    const store = loadDb();
    const clean = (name || '').trim();
    if (!clean) throw new Error('Category name cannot be empty.');
    const existing = store.investmentCategories.find(c => c.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    store.investmentCategories.push(clean);
    saveDb(store);
    return clean;
  },

  async addInvestment({ name, category, value, propertyId }) {
    const store = loadDb();
    const investment = {
      id: uid(),
      name: (name || '').trim() || 'Investment',
      category: store.investmentCategories.includes(category) ? category : 'Other',
      value: Number(value) || 0,
      propertyId: propertyId || null
    };
    store.investments.push(investment);
    saveDb(store);
    return investment;
  },

  async updateInvestment(id, { name, category, value, propertyId }) {
    const store = loadDb();
    const investment = store.investments.find(i => i.id === id);
    if (!investment) return null;
    investment.name = (name || '').trim() || 'Investment';
    investment.category = store.investmentCategories.includes(category) ? category : 'Other';
    investment.value = Number(value) || 0;
    investment.propertyId = propertyId || null;
    saveDb(store);
    return investment;
  },

  async deleteInvestment(id) {
    const store = loadDb();
    store.investments = store.investments.filter(i => i.id !== id);
    saveDb(store);
  },

  // ---- Net worth: cash & bank ----

  async getCashAccounts() {
    return loadDb().cashAccounts;
  },

  async addCashAccount({ name, balance }) {
    const store = loadDb();
    const account = { id: uid(), name: (name || '').trim() || 'Account', balance: Number(balance) || 0 };
    store.cashAccounts.push(account);
    saveDb(store);
    return account;
  },

  async updateCashAccount(id, { name, balance }) {
    const store = loadDb();
    const account = store.cashAccounts.find(a => a.id === id);
    if (!account) return null;
    account.name = (name || '').trim() || 'Account';
    account.balance = Number(balance) || 0;
    saveDb(store);
    return account;
  },

  async deleteCashAccount(id) {
    const store = loadDb();
    store.cashAccounts = store.cashAccounts.filter(a => a.id !== id);
    saveDb(store);
  },

  // ---- Net worth: money owed to you (receivables) ----

  async getReceivables() {
    return loadDb().receivables;
  },

  async addReceivable({ who, amount, note }) {
    const store = loadDb();
    const receivable = { id: uid(), who: (who || '').trim() || 'Someone', amount: Number(amount) || 0, note: (note || '').trim() };
    store.receivables.push(receivable);
    saveDb(store);
    return receivable;
  },

  async updateReceivable(id, { who, amount, note }) {
    const store = loadDb();
    const receivable = store.receivables.find(r => r.id === id);
    if (!receivable) return null;
    receivable.who = (who || '').trim() || 'Someone';
    receivable.amount = Number(amount) || 0;
    receivable.note = (note || '').trim();
    saveDb(store);
    return receivable;
  },

  async deleteReceivable(id) {
    const store = loadDb();
    store.receivables = store.receivables.filter(r => r.id !== id);
    saveDb(store);
  },

  // ---- Net worth: money you owe (payables) ----

  async getPayables() {
    return loadDb().payables;
  },

  async addPayable({ who, amount, note }) {
    const store = loadDb();
    const payable = { id: uid(), who: (who || '').trim() || 'Someone', amount: Number(amount) || 0, note: (note || '').trim() };
    store.payables.push(payable);
    saveDb(store);
    return payable;
  },

  async updatePayable(id, { who, amount, note }) {
    const store = loadDb();
    const payable = store.payables.find(p => p.id === id);
    if (!payable) return null;
    payable.who = (who || '').trim() || 'Someone';
    payable.amount = Number(amount) || 0;
    payable.note = (note || '').trim();
    saveDb(store);
    return payable;
  },

  async deletePayable(id) {
    const store = loadDb();
    store.payables = store.payables.filter(p => p.id !== id);
    saveDb(store);
  },

  // ---- Budget categories ----

  async getCategories() {
    return loadDb().categories;
  },

  async addCategory({ name, monthlyBudget }) {
    const store = loadDb();
    const category = { id: uid(), name: (name || '').trim() || 'Category', monthlyBudget: Number(monthlyBudget) || 0 };
    store.categories.push(category);
    saveDb(store);
    return category;
  },

  async updateCategory(id, { name, monthlyBudget }) {
    const store = loadDb();
    const category = store.categories.find(c => c.id === id);
    if (!category) return null;
    category.name = (name || '').trim() || 'Category';
    category.monthlyBudget = Number(monthlyBudget) || 0;
    saveDb(store);
    return category;
  },

  async deleteCategory(id) {
    const store = loadDb();
    store.categories = store.categories.filter(c => c.id !== id);
    // Expenses in a deleted category become uncategorized rather than vanishing.
    store.expenses.forEach(e => { if (e.categoryId === id) e.categoryId = null; });
    saveDb(store);
  },

  // ---- Expense sheets (calendar months) ----

  async getSheets() {
    return loadDb().sheets;
  },

  async getActiveSheetId() {
    return loadDb().activeSheetId;
  },

  // Moves the active month by `delta` months (±1 for prev/next), creating
  // that month's sheet on the fly if nothing has ever been logged in it yet.
  async shiftActiveSheet(delta) {
    const store = loadDb();
    const key = shiftMonthKey(store.activeSheetId, delta);
    const sheet = ensureSheet(store, key);
    store.activeSheetId = key;
    saveDb(store);
    return sheet;
  },

  async goToCurrentMonth() {
    const store = loadDb();
    const key = currentMonthKey();
    const sheet = ensureSheet(store, key);
    store.activeSheetId = key;
    saveDb(store);
    return sheet;
  },

  // ---- Expenses ----

  async getExpenses(sheetId) {
    return loadDb().expenses.filter(e => e.sheetId === sheetId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  // The month an expense belongs to is derived from its own date, not from
  // whichever month happened to be on screen when it was added - so it lands
  // in the right place even if you're back-filling a past month's spending.
  // The view follows: after saving, the active sheet becomes that date's
  // month, so the entry is immediately visible.
  async addExpense({ categoryId, amount, note, date }) {
    const store = loadDb();
    const expenseDate = date || todayStr();
    const sheetId = monthKeyFromDate(expenseDate);
    ensureSheet(store, sheetId);
    const expense = {
      id: uid(),
      sheetId,
      categoryId: categoryId || null,
      amount: Number(amount) || 0,
      note: (note || '').trim(),
      date: expenseDate
    };
    store.expenses.push(expense);
    store.activeSheetId = sheetId;
    saveDb(store);
    return expense;
  },

  async updateExpense(id, { categoryId, amount, note, date }) {
    const store = loadDb();
    const expense = store.expenses.find(e => e.id === id);
    if (!expense) return null;
    expense.categoryId = categoryId || null;
    expense.amount = Number(amount) || 0;
    expense.note = (note || '').trim();
    expense.date = date || expense.date;
    expense.sheetId = monthKeyFromDate(expense.date);
    ensureSheet(store, expense.sheetId);
    store.activeSheetId = expense.sheetId;
    saveDb(store);
    return expense;
  },

  async deleteExpense(id) {
    const store = loadDb();
    store.expenses = store.expenses.filter(e => e.id !== id);
    saveDb(store);
  },

  // ---- Share (live read-only link) ----

  async getShare() {
    return loadDb().share;
  },

  async saveShare(share) {
    const store = loadDb();
    store.share = share;
    saveDb(store);
    return store.share;
  },

  async clearShare() {
    const store = loadDb();
    store.share = null;
    saveDb(store);
  },

  // ---- Backup & restore ----

  async exportData() {
    const store = loadDb();
    return {
      app: 'budget-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: store.settings,
      incomeSources: store.incomeSources,
      properties: store.properties,
      categories: store.categories,
      sheets: store.sheets,
      activeSheetId: store.activeSheetId,
      expenses: store.expenses,
      investments: store.investments,
      investmentCategories: store.investmentCategories,
      cashAccounts: store.cashAccounts,
      receivables: store.receivables,
      payables: store.payables
    };
  },

  async importData(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('That file is not a Budget Tracker backup.');
    }
    const { incomeSources, properties, categories, expenses, investments, investmentCategories, cashAccounts, receivables, payables } = payload;
    if (!Array.isArray(categories) || !Array.isArray(expenses)) {
      throw new Error('That file is missing budget data, so it is not a Budget Tracker backup.');
    }
    const store = loadDb();
    store.incomeSources = Array.isArray(incomeSources) ? incomeSources : [];
    store.properties = Array.isArray(properties) ? properties : [];
    store.categories = categories;
    store.expenses = expenses;
    store.investments = Array.isArray(investments) ? investments : [];
    // A backup from before custom categories existed has no
    // investmentCategories of its own - fall back to whatever categories its
    // investments actually use (plus the defaults), so nothing imports into
    // a category the picker doesn't know about.
    store.investmentCategories = Array.isArray(investmentCategories) && investmentCategories.length
      ? investmentCategories
      : [...new Set([...DEFAULT_INVESTMENT_CATEGORIES, ...store.investments.map(i => i.category).filter(Boolean)])];
    if (!store.investmentCategories.includes('Real Estate')) store.investmentCategories.unshift('Real Estate');
    store.cashAccounts = Array.isArray(cashAccounts) ? cashAccounts : [];
    store.receivables = Array.isArray(receivables) ? receivables : [];
    store.payables = Array.isArray(payables) ? payables : [];
    // Re-derive each month's sheet from the imported expenses' own dates,
    // the same as the one-time migration - correct however old the backup is.
    store.sheets = [];
    store.calendarMonths = false;
    migrateToCalendarMonths(store);
    if (payload.settings) store.settings = { ...store.settings, ...payload.settings };
    saveDb(store);
    return {
      incomeSources: store.incomeSources.length,
      properties: store.properties.length,
      categories: store.categories.length,
      sheets: store.sheets.length,
      expenses: store.expenses.length,
      investments: store.investments.length
    };
  }
};
