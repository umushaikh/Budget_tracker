const DB_KEY = 'budgetTrackerDb';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const DEFAULT_CATEGORIES = [
  'Groceries', 'Rent/Mortgage', 'Utilities', 'Transport', 'Dining Out',
  'Entertainment', 'Health', 'Savings', 'Other'
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

function monthName() {
  return new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
}

function seedStore() {
  const sheetId = uid();
  return {
    settings: { theme: 'dark', currency: 'AED', onboarded: false },
    incomeSources: [],
    properties: [],
    categories: DEFAULT_CATEGORIES.map(name => ({ id: uid(), name, monthlyBudget: 0 })),
    sheets: [{ id: sheetId, name: monthName(), createdAt: Date.now() }],
    activeSheetId: sheetId,
    expenses: [],
    share: null // { serverUrl, code, token, enabled }
  };
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
      if (!parsed.sheets || !parsed.sheets.length) {
        const sheetId = uid();
        parsed.sheets = [{ id: sheetId, name: monthName(), createdAt: Date.now() }];
        parsed.activeSheetId = sheetId;
      }
      if (!parsed.activeSheetId || !parsed.sheets.some(s => s.id === parsed.activeSheetId)) {
        parsed.activeSheetId = parsed.sheets[0].id;
      }
      if (!parsed.expenses) parsed.expenses = [];
      if (parsed.share === undefined) parsed.share = null;
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

  async addProperty({ name, annualNetIncome, sharePct, vacant }) {
    const store = loadDb();
    const property = {
      id: uid(),
      name: (name || '').trim() || 'Apartment',
      annualNetIncome: Number(annualNetIncome) || 0,
      sharePct: Math.max(0, Math.min(100, Number(sharePct) || 100)),
      vacant: !!vacant
    };
    store.properties.push(property);
    saveDb(store);
    return property;
  },

  async updateProperty(id, { name, annualNetIncome, sharePct, vacant }) {
    const store = loadDb();
    const property = store.properties.find(p => p.id === id);
    if (!property) return null;
    property.name = (name || '').trim() || 'Apartment';
    property.annualNetIncome = Number(annualNetIncome) || 0;
    property.sharePct = Math.max(0, Math.min(100, Number(sharePct) || 100));
    property.vacant = !!vacant;
    saveDb(store);
    return property;
  },

  async deleteProperty(id) {
    const store = loadDb();
    store.properties = store.properties.filter(p => p.id !== id);
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

  // ---- Expense sheets ----

  async getSheets() {
    return loadDb().sheets;
  },

  async getActiveSheetId() {
    return loadDb().activeSheetId;
  },

  async setActiveSheet(id) {
    const store = loadDb();
    if (store.sheets.some(s => s.id === id)) store.activeSheetId = id;
    saveDb(store);
    return store.activeSheetId;
  },

  async addSheet(name) {
    const store = loadDb();
    const sheet = { id: uid(), name: (name || '').trim() || monthName(), createdAt: Date.now() };
    store.sheets.push(sheet);
    store.activeSheetId = sheet.id;
    saveDb(store);
    return sheet;
  },

  async deleteSheet(id) {
    const store = loadDb();
    if (store.sheets.length <= 1) throw new Error('At least one expense sheet is required.');
    store.sheets = store.sheets.filter(s => s.id !== id);
    store.expenses = store.expenses.filter(e => e.sheetId !== id);
    if (store.activeSheetId === id) store.activeSheetId = store.sheets[0].id;
    saveDb(store);
  },

  // ---- Expenses ----

  async getExpenses(sheetId) {
    return loadDb().expenses.filter(e => e.sheetId === sheetId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  async addExpense({ sheetId, categoryId, amount, note, date }) {
    const store = loadDb();
    const expense = {
      id: uid(),
      sheetId,
      categoryId: categoryId || null,
      amount: Number(amount) || 0,
      note: (note || '').trim(),
      date: date || todayStr()
    };
    store.expenses.push(expense);
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
      expenses: store.expenses
    };
  },

  async importData(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('That file is not a Budget Tracker backup.');
    }
    const { incomeSources, properties, categories, sheets, expenses } = payload;
    if (!Array.isArray(categories) || !Array.isArray(sheets) || !Array.isArray(expenses)) {
      throw new Error('That file is missing budget data, so it is not a Budget Tracker backup.');
    }
    const store = loadDb();
    store.incomeSources = Array.isArray(incomeSources) ? incomeSources : [];
    store.properties = Array.isArray(properties) ? properties : [];
    store.categories = categories;
    store.sheets = sheets.length ? sheets : store.sheets;
    store.activeSheetId = payload.activeSheetId && sheets.some(s => s.id === payload.activeSheetId)
      ? payload.activeSheetId : store.sheets[0].id;
    store.expenses = expenses;
    if (payload.settings) store.settings = { ...store.settings, ...payload.settings };
    saveDb(store);
    return {
      incomeSources: store.incomeSources.length,
      properties: store.properties.length,
      categories: store.categories.length,
      sheets: store.sheets.length,
      expenses: store.expenses.length
    };
  }
};
