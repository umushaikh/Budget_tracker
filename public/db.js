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

// Ledger entry kinds. `sign` is how the entry moves the balance of the thing
// it applies to: cash accounts go up with deposits, receivables ("money owed
// to you") go DOWN when someone pays you back and up when you lend more, and
// payables ("money you owe") go down when you pay and up when you borrow more.
const LEDGER_KINDS = {
  deposit:      { accountType: 'cash',       sign: +1, label: 'Deposit' },
  withdrawal:   { accountType: 'cash',       sign: -1, label: 'Withdrawal' },
  transfer_in:  { accountType: 'cash',       sign: +1, label: 'Transfer in' },
  transfer_out: { accountType: 'cash',       sign: -1, label: 'Transfer out' },
  received:     { accountType: 'receivable', sign: -1, label: 'Paid back to you' },
  lent_more:    { accountType: 'receivable', sign: +1, label: 'Lent more' },
  paid:         { accountType: 'payable',    sign: -1, label: 'You paid' },
  borrowed_more:{ accountType: 'payable',    sign: +1, label: 'Borrowed more' }
};
const LEDGER_COLLECTIONS = { cash: 'cashAccounts', receivable: 'receivables', payable: 'payables' };

// The number a ledger entry moves, per account type.
function ledgerBalanceField(accountType) { return accountType === 'cash' ? 'balance' : 'amount'; }
function ledgerAccountName(accountType, account) { return accountType === 'cash' ? account.name : account.who; }

// Can't be renamed or deleted: "Real Estate" drives the apartment link and
// "Other" is where investments land when their category is removed.
const PROTECTED_INVESTMENT_CATEGORIES = ['Real Estate', 'Other'];

// A handful of distinct hues, reused in the same order everywhere a category
// needs a color (budgets list, expenses pie, the shared viewer) so a category
// never changes color between screens.
const CATEGORY_PALETTE = [
  '#35d07f', '#7d93ff', '#ffad42', '#ff70ad', '#5fd4d6',
  '#c792ff', '#ff8a5c', '#8fd14f', '#ffd166', '#6ec6ff'
];

// Number(x) || 100 looks like a safe default but silently turns an explicit
// 0% share into 100%, since 0 is falsy - use this instead anywhere a share
// percentage is parsed from user input.
function clampSharePct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}

const PROPERTY_TYPES = ['Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom', '4+ Bedroom', 'Villa', 'Townhouse', 'Penthouse', 'Office', 'Other'];

// Everything that counts as "your data" for two-way sync between devices -
// deliberately not `settings` (each device keeps its own theme), `share`, or
// `sync` itself (a device's own share/sync credentials must never travel
// inside the data they authenticate, or pulling a sync would overwrite the
// very credentials being used to pull it).
const SYNC_FIELDS = [
  'incomeSources', 'properties', 'propertyTransactions', 'propertyTypes',
  'categories', 'sheets', 'expenses', 'investments', 'investmentCategories',
  'cashAccounts', 'receivables', 'payables', 'ledger', 'importRules', 'csvImportMapping'
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
    propertyTransactions: [],
    propertyTypes: [...PROPERTY_TYPES],
    categories: DEFAULT_CATEGORIES.map(name => ({ id: uid(), name, monthlyBudget: 0 })),
    sheets: [{ id: key, name: monthLabel(key), createdAt: Date.now() }],
    activeSheetId: key,
    expenses: [],
    investments: [],
    investmentCategories: [...DEFAULT_INVESTMENT_CATEGORIES],
    cashAccounts: [],
    receivables: [],
    payables: [],
    ledger: [], // see LEDGER_KINDS - every change made to a net worth balance from the Ledger tab
    importRules: [], // [{ id, keyword, categoryId }] - "any description containing keyword" -> categoryId
    csvImportMapping: null, // { headerSignature, dateCol, amountCol, descCol, negativeIsSpend } - remembered per statement format
    share: null, // { serverUrl, code, token, enabled }
    sync: null, // { serverUrl, code, token, enabled, lastSyncedAt, lastRemoteUpdatedAt } - see SYNC_FIELDS
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

// An investment saved before ownership share existed has no sharePct yet.
// Its stored value was always meant as the full value (there was nothing
// else it could have meant), so defaulting to 100% leaves its computed net
// value exactly as it was.
function migrateInvestmentSharePct(store) {
  store.investments.forEach(i => {
    if (i.sharePct === undefined) i.sharePct = 100;
    if (i.annualReturn === undefined) i.annualReturn = 0;
  });
}

// A rent payment logged before "pending" existed was always something that
// had actually been received - there was no other kind yet - so it keeps
// counting as Collected rather than being reclassified as a future cheque.
function migratePropertyTransactionStatus(store) {
  store.propertyTransactions.forEach(t => {
    if (t.status === undefined) t.status = 'received';
  });
}

// Expenses saved before `reward` (cashback/points earned on the purchase)
// and `source` (manual/csv/pdf, so a bad statement import can be found and
// bulk-removed later) existed get the defaults those fields would have had
// all along - no cashback, entered by hand.
function migrateExpenseFields(store) {
  store.expenses.forEach(e => {
    if (e.reward === undefined) e.reward = 0;
    if (e.source === undefined) e.source = 'manual';
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
      if (!parsed.propertyTransactions) parsed.propertyTransactions = [];
      if (!parsed.propertyTypes) parsed.propertyTypes = [...PROPERTY_TYPES];
      if (!parsed.categories) parsed.categories = [];
      if (!parsed.sheets) parsed.sheets = [];
      if (!parsed.expenses) parsed.expenses = [];
      if (!parsed.investments) parsed.investments = [];
      if (!parsed.investmentCategories) parsed.investmentCategories = [...DEFAULT_INVESTMENT_CATEGORIES];
      if (!parsed.investmentCategories.includes('Real Estate')) parsed.investmentCategories.unshift('Real Estate');
      if (!parsed.investmentCategories.includes('Other')) parsed.investmentCategories.push('Other');
      if (!parsed.cashAccounts) parsed.cashAccounts = [];
      if (!parsed.receivables) parsed.receivables = [];
      if (!parsed.payables) parsed.payables = [];
      if (!parsed.ledger) parsed.ledger = [];
      if (!parsed.importRules) parsed.importRules = [];
      if (parsed.csvImportMapping === undefined) parsed.csvImportMapping = null;
      if (parsed.share === undefined) parsed.share = null;
      if (parsed.sync === undefined) parsed.sync = null;
      migrateToCalendarMonths(parsed);
      migratePropertyIncomeFields(parsed);
      migrateInvestmentSharePct(parsed);
      migrateExpenseFields(parsed);
      migratePropertyTransactionStatus(parsed);
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

function applyLedgerEntry(store, { kind, accountId, amount, date, note, transferId }) {
  const spec = LEDGER_KINDS[kind];
  if (!spec) throw new Error('Unknown transaction type.');
  const value = Math.round(Number(amount) * 100) / 100;
  if (!isFinite(value) || value <= 0) throw new Error('Enter an amount greater than zero.');
  const account = store[LEDGER_COLLECTIONS[spec.accountType]].find(a => a.id === accountId);
  if (!account) throw new Error('That account no longer exists.');
  const field = ledgerBalanceField(spec.accountType);
  const name = ledgerAccountName(spec.accountType, account);
  const delta = spec.sign * value;
  const after = Math.round(((account[field] || 0) + delta) * 100) / 100;
  if (after < 0) {
    throw new Error(spec.accountType === 'cash'
      ? `"${name}" only has ${account[field]} - that would take it below zero.`
      : `That's more than the ${account[field]} listed for "${name}".`);
  }
  account[field] = after;
  const entry = {
    id: uid(),
    date: date || todayStr(),
    accountType: spec.accountType,
    accountId,
    accountName: name,
    kind,
    delta,
    balanceAfter: after,
    note: (note || '').trim(),
    transferId: transferId || null,
    createdAt: Date.now()
  };
  store.ledger.push(entry);
  return entry;
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

  async getPropertyTypes() {
    return loadDb().propertyTypes;
  },

  // Adds a type if it's new (case-insensitively), or just returns the
  // existing one it matches - same pattern as addInvestmentCategory.
  async addPropertyType(name) {
    const store = loadDb();
    const clean = (name || '').trim();
    if (!clean) throw new Error('Type name cannot be empty.');
    const existing = store.propertyTypes.find(t => t.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    store.propertyTypes.push(clean);
    saveDb(store);
    return clean;
  },

  async addProperty({ name, type, annualGrossIncome, annualServiceCharges, sharePct, vacant }) {
    const store = loadDb();
    const property = {
      id: uid(),
      name: (name || '').trim() || 'Apartment',
      type: store.propertyTypes.includes(type) ? type : '',
      annualGrossIncome: Number(annualGrossIncome) || 0,
      annualServiceCharges: Number(annualServiceCharges) || 0,
      sharePct: clampSharePct(sharePct),
      vacant: !!vacant
    };
    store.properties.push(property);
    saveDb(store);
    return property;
  },

  async updateProperty(id, { name, type, annualGrossIncome, annualServiceCharges, sharePct, vacant }) {
    const store = loadDb();
    const property = store.properties.find(p => p.id === id);
    if (!property) return null;
    property.name = (name || '').trim() || 'Apartment';
    property.type = store.propertyTypes.includes(type) ? type : '';
    property.annualGrossIncome = Number(annualGrossIncome) || 0;
    property.annualServiceCharges = Number(annualServiceCharges) || 0;
    property.sharePct = clampSharePct(sharePct);
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
    // Unlike an investment, a rent/cost ledger has no meaning once its
    // apartment is gone - nothing to unlink it to - so it goes with it.
    store.propertyTransactions = store.propertyTransactions.filter(t => t.propertyId !== id);
    saveDb(store);
  },

  // ---- Property management: rent payments & maintenance costs ----
  // A per-apartment ledger, deliberately kept separate from the Income tab's
  // annual gross/service-charge figures - those stay a simple yearly
  // projection, while this is the actual history of what came in and what
  // got spent on a given apartment.

  async getPropertyTransactions(propertyId) {
    return loadDb().propertyTransactions
      .filter(t => t.propertyId === propertyId)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  // `status` only means anything for a rent payment - "pending" is a future
  // cheque you're expecting but haven't received/cleared yet, kept out of
  // Collected until you mark it received. A cost is always just something
  // that already happened, so it's never anything but "received".
  async addPropertyTransaction({ propertyId, type, date, amount, note, status }) {
    const store = loadDb();
    const txn = {
      id: uid(),
      propertyId,
      type: type === 'cost' ? 'cost' : 'payment',
      date: date || todayStr(),
      amount: Number(amount) || 0,
      note: (note || '').trim(),
      status: type === 'cost' ? 'received' : (status === 'pending' ? 'pending' : 'received')
    };
    store.propertyTransactions.push(txn);
    saveDb(store);
    return txn;
  },

  async updatePropertyTransaction(id, { type, date, amount, note, status }) {
    const store = loadDb();
    const txn = store.propertyTransactions.find(t => t.id === id);
    if (!txn) return null;
    txn.type = type === 'cost' ? 'cost' : 'payment';
    txn.date = date || txn.date;
    txn.amount = Number(amount) || 0;
    txn.note = (note || '').trim();
    txn.status = txn.type === 'cost' ? 'received' : (status === 'pending' ? 'pending' : 'received');
    saveDb(store);
    return txn;
  },

  async deletePropertyTransaction(id) {
    const store = loadDb();
    store.propertyTransactions = store.propertyTransactions.filter(t => t.id !== id);
    saveDb(store);
  },

  // One-tap version of editing a pending cheque just to flip its status once
  // it actually clears, rather than reopening the full form for that alone.
  async markPropertyTransactionReceived(id) {
    const store = loadDb();
    const txn = store.propertyTransactions.find(t => t.id === id);
    if (!txn) return null;
    txn.status = 'received';
    saveDb(store);
    return txn;
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
  // "Real Estate" (apartment link) and "Other" (the fallback every
  // investment drops into) are load-bearing, so they can't be renamed or
  // deleted - see rename/deleteInvestmentCategory below.
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

  // Renames a category and moves every investment in it across, so nothing
  // is orphaned. Returns the new name. A name that matches a different
  // existing category (case-insensitively) is refused rather than merged.
  async renameInvestmentCategory(oldName, newName) {
    const store = loadDb();
    if (PROTECTED_INVESTMENT_CATEGORIES.includes(oldName)) {
      throw new Error(`"${oldName}" can't be renamed.`);
    }
    const clean = (newName || '').trim();
    if (!clean) throw new Error('Category name cannot be empty.');
    const idx = store.investmentCategories.indexOf(oldName);
    if (idx === -1) throw new Error('That category no longer exists.');
    const clash = store.investmentCategories.find(c => c !== oldName && c.toLowerCase() === clean.toLowerCase());
    if (clash) throw new Error(`There's already a category called "${clash}".`);
    store.investmentCategories[idx] = clean;
    store.investments.forEach(i => { if (i.category === oldName) i.category = clean; });
    saveDb(store);
    return clean;
  },

  // Removes a category; its investments move to "Other" instead of being
  // deleted, so no value drops out of net worth.
  async deleteInvestmentCategory(name) {
    const store = loadDb();
    if (PROTECTED_INVESTMENT_CATEGORIES.includes(name)) {
      throw new Error(`"${name}" can't be deleted.`);
    }
    store.investmentCategories = store.investmentCategories.filter(c => c !== name);
    store.investments.forEach(i => { if (i.category === name) i.category = 'Other'; });
    saveDb(store);
  },

  // `value` is always the investment's full value; `sharePct` is how much of
  // it is actually yours (100 by default). For one linked to an apartment,
  // sharePct is ignored here and always read live from that apartment's own
  // share in Income instead (see investmentSharePct in app.js) - the same
  // pattern as its name, so the two can never drift apart. `annualReturn` is
  // optional income the investment itself throws off (dividends, interest,
  // and the like) - separate from `value`, which is a net-worth figure, not
  // income - and counts toward total income the same way rental income does.
  async addInvestment({ name, category, value, propertyId, sharePct, annualReturn }) {
    const store = loadDb();
    const investment = {
      id: uid(),
      name: (name || '').trim() || 'Investment',
      category: store.investmentCategories.includes(category) ? category : 'Other',
      value: Number(value) || 0,
      propertyId: propertyId || null,
      sharePct: clampSharePct(sharePct),
      annualReturn: Number(annualReturn) || 0
    };
    store.investments.push(investment);
    saveDb(store);
    return investment;
  },

  async updateInvestment(id, { name, category, value, propertyId, sharePct, annualReturn }) {
    const store = loadDb();
    const investment = store.investments.find(i => i.id === id);
    if (!investment) return null;
    investment.name = (name || '').trim() || 'Investment';
    investment.category = store.investmentCategories.includes(category) ? category : 'Other';
    investment.value = Number(value) || 0;
    investment.propertyId = propertyId || null;
    investment.sharePct = clampSharePct(sharePct);
    investment.annualReturn = Number(annualReturn) || 0;
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

  // ---- Statement import (CSV) ----
  // Everything here runs against a file you chose in your own browser -
  // nothing is uploaded or checked against anywhere but this device.

  async getImportRules() {
    return loadDb().importRules;
  },

  // One rule per keyword - re-adding an existing keyword updates its
  // category instead of creating a second, conflicting rule for it.
  async addImportRule({ keyword, categoryId }) {
    const store = loadDb();
    const clean = (keyword || '').trim().toLowerCase();
    if (!clean) throw new Error('Keyword cannot be empty.');
    let rule = store.importRules.find(r => r.keyword === clean);
    if (rule) rule.categoryId = categoryId || null;
    else {
      rule = { id: uid(), keyword: clean, categoryId: categoryId || null };
      store.importRules.push(rule);
    }
    saveDb(store);
    return rule;
  },

  async deleteImportRule(id) {
    const store = loadDb();
    store.importRules = store.importRules.filter(r => r.id !== id);
    saveDb(store);
  },

  async getCsvMapping() {
    return loadDb().csvImportMapping;
  },

  async saveCsvMapping(mapping) {
    const store = loadDb();
    store.csvImportMapping = mapping;
    saveDb(store);
    return mapping;
  },

  // Bulk-adds statement rows as expenses, skipping any that exactly match
  // an existing expense (same date, amount, and description) so importing
  // an overlapping statement period twice doesn't double-count anything.
  // Each row's month sheet is derived from its own date, same as adding an
  // expense by hand. Tagged with where it came from (`source`), so a bad
  // import can be found and removed in bulk with deleteExpensesBySource.
  async importExpenses(rows, source) {
    const store = loadDb();
    let imported = 0, skipped = 0;
    rows.forEach(row => {
      const note = (row.note || '').trim();
      const amount = Number(row.amount) || 0;
      const isDuplicate = store.expenses.some(e => e.date === row.date && e.amount === amount && e.note === note);
      if (isDuplicate) { skipped++; return; }
      const sheetId = monthKeyFromDate(row.date);
      ensureSheet(store, sheetId);
      store.expenses.push({
        id: uid(),
        sheetId,
        categoryId: row.categoryId || null,
        amount,
        note,
        date: row.date,
        reward: Number(row.reward) || 0,
        source: source || 'import'
      });
      imported++;
    });
    if (imported > 0) {
      const last = rows[rows.length - 1];
      if (last) store.activeSheetId = monthKeyFromDate(last.date);
    }
    saveDb(store);
    return { imported, skipped };
  },

  // For cleaning up after a bad statement import (e.g. a parsing bug that
  // picked up the wrong column) without having to hand-delete every row it
  // added. Only reaches expenses tagged with that exact source - manual
  // entries and imports from the other path are never touched.
  async deleteExpensesBySource(source) {
    const store = loadDb();
    const before = store.expenses.length;
    store.expenses = store.expenses.filter(e => e.source !== source);
    saveDb(store);
    return before - store.expenses.length;
  },

  async countExpensesBySource(source) {
    return loadDb().expenses.filter(e => e.source === source).length;
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
  async addExpense({ categoryId, amount, note, date, reward }) {
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
      date: expenseDate,
      reward: Number(reward) || 0,
      source: 'manual'
    };
    store.expenses.push(expense);
    store.activeSheetId = sheetId;
    saveDb(store);
    return expense;
  },

  async updateExpense(id, { categoryId, amount, note, date, reward }) {
    const store = loadDb();
    const expense = store.expenses.find(e => e.id === id);
    if (!expense) return null;
    expense.categoryId = categoryId || null;
    expense.amount = Number(amount) || 0;
    expense.note = (note || '').trim();
    expense.date = date || expense.date;
    expense.reward = Number(reward) || 0;
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

  async deleteExpenses(ids) {
    const store = loadDb();
    const idSet = new Set(ids);
    const before = store.expenses.length;
    store.expenses = store.expenses.filter(e => !idSet.has(e.id));
    saveDb(store);
    return before - store.expenses.length;
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

  // ---- Sync (two-way, between your own devices) ----

  async getSync() {
    return loadDb().sync;
  },

  async saveSync(sync) {
    const store = loadDb();
    store.sync = sync;
    saveDb(store);
    return store.sync;
  },

  async clearSync() {
    const store = loadDb();
    store.sync = null;
    saveDb(store);
  },

  // The whole-database snapshot a push sends up. Not the same shape as
  // exportData's backup file (that includes settings and is meant to be
  // read by a human re-importing it); this is exactly what applySyncPayload
  // below expects back.
  async getSyncPayload() {
    const store = loadDb();
    const payload = {};
    SYNC_FIELDS.forEach(f => { payload[f] = store[f]; });
    return payload;
  },

  // Replaces the local copy of every synced collection with whatever the
  // other device last pushed - whole-database last-write-wins, not a
  // per-record merge, so a change made on both devices in the same window
  // before either synced has one of them lose silently. Re-runs the same
  // migrations loadDb() always runs, in case the payload came from a device
  // still running an older version of the app.
  async applySyncPayload(payload) {
    const store = loadDb();
    SYNC_FIELDS.forEach(f => {
      if (payload[f] !== undefined) store[f] = payload[f];
    });
    migrateToCalendarMonths(store);
    migratePropertyIncomeFields(store);
    migrateInvestmentSharePct(store);
    migrateExpenseFields(store);
    migratePropertyTransactionStatus(store);
    if (!store.sheets.some(s => s.id === store.activeSheetId)) {
      store.activeSheetId = store.sheets.length ? store.sheets[store.sheets.length - 1].id : currentMonthKey();
      ensureSheet(store, store.activeSheetId);
    }
    saveDb(store);
  },

  // ---- Ledger: transactions against net worth balances ----

  async getLedger() {
    return loadDb().ledger;
  },

  // Applies one entry to its account's balance and records it. Refuses
  // anything that would push a balance below zero (withdrawing more than is
  // there, or repaying more than is owed) rather than silently clamping.
  // For a loan entry (paid back / lent more / you paid / borrowed more),
  // `counterAccountId` optionally names the cash account the money actually
  // went into or came out of; that second entry is linked to the first by a
  // shared transferId, so the two are applied and deleted together.
  async addLedgerEntry({ kind, accountId, amount, date, note, counterAccountId }) {
    const store = loadDb();
    const spec = LEDGER_KINDS[kind];
    if (counterAccountId && (!spec || spec.accountType === 'cash')) {
      throw new Error('A linked cash account only applies to money owed to or by you.');
    }
    const transferId = counterAccountId ? uid() : null;
    const entry = applyLedgerEntry(store, { kind, accountId, amount, date, note, transferId });
    if (counterAccountId) {
      // Money you receive (paid back, or a new loan) goes INTO the account;
      // money you hand over (lending more, paying a debt) comes OUT of it.
      const cashKind = (kind === 'received' || kind === 'borrowed_more') ? 'deposit' : 'withdrawal';
      applyLedgerEntry(store, { kind: cashKind, accountId: counterAccountId, amount, date, note, transferId });
    }
    saveDb(store);
    return entry;
  },

  // Moves money between two cash accounts as two linked entries, applied
  // together or not at all.
  async addTransfer({ fromId, toId, amount, date, note }) {
    const store = loadDb();
    if (!fromId || !toId || fromId === toId) throw new Error('Pick two different accounts.');
    const transferId = uid();
    const out = applyLedgerEntry(store, { kind: 'transfer_out', accountId: fromId, amount, date, note, transferId });
    const into = applyLedgerEntry(store, { kind: 'transfer_in', accountId: toId, amount, date, note, transferId });
    saveDb(store);
    return [out, into];
  },

  // Deletes an entry AND undoes its effect on the balance. A transfer is
  // always deleted as a pair. If the account has since been deleted there is
  // nothing to undo; if undoing would push a balance below zero, it's refused.
  async deleteLedgerEntry(id) {
    const store = loadDb();
    const entry = store.ledger.find(e => e.id === id);
    if (!entry) return;
    const doomed = entry.transferId ? store.ledger.filter(e => e.transferId === entry.transferId) : [entry];
    doomed.forEach(e => {
      const account = store[LEDGER_COLLECTIONS[e.accountType]].find(a => a.id === e.accountId);
      if (!account) return;
      const field = ledgerBalanceField(e.accountType);
      const reverted = (account[field] || 0) - e.delta;
      if (reverted < -0.005) {
        throw new Error(`Can't delete this: undoing it would take "${ledgerAccountName(e.accountType, account)}" below zero. Delete the later entries first.`);
      }
    });
    doomed.forEach(e => {
      const account = store[LEDGER_COLLECTIONS[e.accountType]].find(a => a.id === e.accountId);
      if (account) {
        const field = ledgerBalanceField(e.accountType);
        account[field] = Math.max(0, Math.round(((account[field] || 0) - e.delta) * 100) / 100);
      }
    });
    const ids = new Set(doomed.map(e => e.id));
    store.ledger = store.ledger.filter(e => !ids.has(e.id));
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
      propertyTransactions: store.propertyTransactions,
      propertyTypes: store.propertyTypes,
      categories: store.categories,
      sheets: store.sheets,
      activeSheetId: store.activeSheetId,
      expenses: store.expenses,
      investments: store.investments,
      investmentCategories: store.investmentCategories,
      cashAccounts: store.cashAccounts,
      receivables: store.receivables,
      payables: store.payables,
      ledger: store.ledger,
      importRules: store.importRules
    };
  },

  async importData(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('That file is not a Budget Tracker backup.');
    }
    const { incomeSources, properties, propertyTransactions, propertyTypes, categories, expenses, investments, investmentCategories, cashAccounts, receivables, payables, importRules } = payload;
    if (!Array.isArray(categories) || !Array.isArray(expenses)) {
      throw new Error('That file is missing budget data, so it is not a Budget Tracker backup.');
    }
    const store = loadDb();
    store.incomeSources = Array.isArray(incomeSources) ? incomeSources : [];
    store.properties = Array.isArray(properties) ? properties : [];
    store.propertyTransactions = Array.isArray(propertyTransactions) ? propertyTransactions : [];
    // A backup from before custom property types existed has no
    // propertyTypes of its own - fall back to the defaults plus whatever
    // types its properties actually use, so nothing imports into a type the
    // picker doesn't know about.
    store.propertyTypes = Array.isArray(propertyTypes) && propertyTypes.length
      ? propertyTypes
      : [...new Set([...PROPERTY_TYPES, ...store.properties.map(p => p.type).filter(Boolean)])];
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
    if (!store.investmentCategories.includes('Other')) store.investmentCategories.push('Other');
    store.cashAccounts = Array.isArray(cashAccounts) ? cashAccounts : [];
    store.receivables = Array.isArray(receivables) ? receivables : [];
    store.payables = Array.isArray(payables) ? payables : [];
    store.ledger = Array.isArray(payload.ledger) ? payload.ledger : [];
    store.importRules = Array.isArray(importRules) ? importRules : [];
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
