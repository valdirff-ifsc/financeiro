import { defaultData } from "./data.js";
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowRightLeft, ArrowUpRight, Banknote, CalendarCheck,
  CalendarClock, CalendarRange, ChartNoAxesCombined, Check, ChevronLeft, ChevronRight,
  CircleCheckBig, CreditCard, Download, Equal, HandCoins, Info, Landmark, Layers3,
  LayoutDashboard, ListChecks, LogIn, LogOut, Menu, Minus, Pause, Pencil, Percent,
  PiggyBank, Play, Plus, Repeat2, Save, Settings, Settings2, ShieldCheck, ShoppingBasket,
  Sparkles, Tags, Target, Trash2, TrendingUp, Undo2, Wallet, WalletCards, X, createIcons,
} from "lucide";
import "../styles/main.css";
import { exportData, loadData, saveData } from "./storage.js";
import {
  deleteRemote,
  getSessionUser,
  insertRemote,
  loadRemoteData,
  onAuthChange,
  requestPasswordReset,
  signIn,
  signOut,
  subscribeToHousehold,
  toDbAccount,
  toDbCard,
  toDbCategory,
  toDbInvestment,
  toDbInvestmentHistory,
  toDbMarketGroup,
  toDbMarketHistory,
  toDbPlanning,
  toDbSettings,
  toDbTransaction,
  updateRemote,
} from "./remoteStore.js";
import {
  addMonths,
  calculateFinance,
  cardInstallmentAmount,
  currentMonth,
  daysUntil,
  formatCurrency,
  formatDate,
  formatPercent,
  getAccountName,
  getCardName,
  getCategoryColor,
  getCategoryName,
  monthLabel,
  makeDate,
  monthDistance,
  normalize,
  firstCardInvoiceMonth,
  parseFinanceMeta,
  toNumber,
  withFinanceMeta,
} from "./calculations.js";
import { comparisonBars, donutChart, groupedBarChart, lineChart } from "./charts.js";

const appRoot = document.querySelector("#appRoot");
const sidebar = document.querySelector("#sidebar");
const sidebarNav = document.querySelector("#sidebarNav");
const menuToggle = document.querySelector("#menuToggle");
const sidebarClose = document.querySelector("#sidebarClose");
const sidebarBackdrop = document.querySelector("#sidebarBackdrop");
const pageTitle = document.querySelector("#pageTitle");
const pageEyebrow = document.querySelector("#pageEyebrow");
const monthSelect = document.querySelector("#monthSelect");
const yearInput = document.querySelector("#yearInput");
const toast = document.querySelector("#toast");
const modalRoot = document.querySelector("#modalRoot");
const confirmDialog = document.querySelector("#confirmDialog");
const quickAddButton = document.querySelector("#quickAddButton");
const LOCAL_AUTH_BYPASS = import.meta.env.DEV && import.meta.env.VITE_LOCAL_AUTH_BYPASS === "true";
const localUser = {
  id: "local-user",
  email: "local@financeiro.app",
  user_metadata: { display_name: "Modo local" },
};

const state = {
  data: defaultData,
  route: window.location.hash.replace("#/", "") || "dashboard",
  month: currentMonth(),
  query: "",
  editing: {},
  filters: {},
  authReady: false,
  user: null,
  householdId: "",
  unsubscribeRealtime: null,
  quickAddOpen: false,
  quickAddPreset: null,
  formDirty: false,
  saving: false,
};

let pendingScrollRestore = null;
let activeInitialization = null;
let lastResumeRefresh = 0;
let modalReturnFocus = null;
let ignoreRealtimeUntil = 0;

function setRoute(route, updateHash = true) {
  state.route = route || "dashboard";
  if (updateHash && window.location.hash !== `#/${state.route}`) {
    window.location.hash = `#/${state.route}`;
  }
}

function resetAuthenticatedState() {
  state.user = null;
  state.data = defaultData;
  state.householdId = "";
  if (state.unsubscribeRealtime) {
    state.unsubscribeRealtime();
    state.unsubscribeRealtime = null;
  }
}

async function initializeForUser(user, options = {}) {
  if (LOCAL_AUTH_BYPASS) {
    state.user = localUser;
    state.data = loadData();
    state.householdId = "local-household";
    state.authReady = true;
    if (options.redirectToDashboard) setRoute("dashboard", true);
    render();
    return;
  }

  if (activeInitialization?.userId === user.id) return activeInitialization.promise;
  const promise = (async () => {
    state.user = user;
    const remote = await loadRemoteData(user);
    state.data = remote.data;
    state.householdId = remote.householdId;
    if (state.unsubscribeRealtime) state.unsubscribeRealtime();
    state.unsubscribeRealtime = subscribeToHousehold(state.householdId, async () => {
      if (Date.now() < ignoreRealtimeUntil) return;
      await reloadRemote();
      if (state.formDirty) {
        showToast("Dados atualizados em outro dispositivo. Seu formulário foi preservado.", "info");
        return;
      }
      render();
      restoreScrollState(pendingScrollRestore);
    });
    if (options.redirectToDashboard) setRoute("dashboard", true);
    state.authReady = true;
    render();
  })();
  activeInitialization = { userId: user.id, promise };
  try {
    return await promise;
  } finally {
    if (activeInitialization?.promise === promise) activeInitialization = null;
  }
}

async function bootstrap() {
  if (LOCAL_AUTH_BYPASS) {
    state.user = localUser;
    state.data = loadData();
    state.householdId = "local-household";
    state.authReady = true;
    render();
    return;
  }

  try {
    const user = await getSessionUser();
    if (user) {
      await initializeForUser(user);
      return;
    }
    state.authReady = true;
    render();
  } catch (error) {
    console.error(error);
    state.authReady = true;
    resetAuthenticatedState();
    render();
    showToast("Não foi possível conectar ao Supabase.");
  }
}

const navItems = [
  { route: "dashboard", label: "Hoje", icon: "layout-dashboard" },
  { route: "pending", label: "A fazer", icon: "list-checks" },
  { route: "future", label: "Futuro", icon: "calendar-range" },
  { route: "history", label: "Histórico", icon: "chart-no-axes-combined" },
  { route: "goals", label: "Metas", icon: "target" },
  { route: "registrations", label: "Cadastros", icon: "settings-2" },
];

const paymentMethods = ["PIX", "Cartão crédito", "Cartão débito", "Boleto", "Dinheiro", "Transferência", "Outro"];
const transactionTypes = ["income", "expense", "card", "transfer"];
const planningGroups = ["income", "expense", "subscription", "market"];
const monthNames = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function visibleNotes(notes) {
  return String(notes || "")
    .split("\n")
    .filter((line) => !line.startsWith("financeiro-meta:"))
    .join("\n")
    .trim();
}

function loanSummary(data = state.data) {
  const people = new Map();
  data.transactions.forEach((transaction) => {
    const meta = parseFinanceMeta(transaction.notes);
    if (meta.kind !== "loan" || !meta.personKey) return;
    const current = people.get(meta.personKey) || {
      personKey: meta.personKey,
      personName: meta.personName || "Pessoa",
      lent: 0,
      repaid: 0,
      balance: 0,
      lastDate: "",
      lastLendDate: "",
      dueDate: "",
      movements: 0,
    };
    const amount = toNumber(transaction.amount);
    if (meta.action === "lend") current.lent += amount;
    if (meta.action === "repayment") current.repaid += amount;
    current.balance = current.lent - current.repaid;
    current.lastDate = String(transaction.date || "") > current.lastDate ? transaction.date : current.lastDate;
    if (meta.action === "lend" && String(transaction.date || "") >= current.lastLendDate) {
      current.lastLendDate = transaction.date || "";
      current.dueDate = meta.dueDate || "";
    }
    current.movements += 1;
    people.set(meta.personKey, current);
  });
  const borrowers = [...people.values()].filter((person) => person.balance > 0.005).sort((a, b) => b.balance - a.balance);
  return {
    borrowers,
    totalReceivable: borrowers.reduce((total, person) => total + person.balance, 0),
  };
}

function uid(prefix = "id") {
  return crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function titleCase(value) {
  const labels = {
    income: "Receita",
    expense: "Despesa",
    card: "Compra no cartão",
    transfer: "Transferência",
    investment: "Investimento",
    subscription: "Assinatura",
    market: "Mercado estimado",
    monthly: "Mensal",
    confirmed: "Confirmado",
  };
  return labels[value] || String(value || "").replace(/^\w/, (letter) => letter.toUpperCase());
}

function refreshIcons() {
  createIcons({ icons: {
    Activity, ArrowDownLeft, ArrowRight, ArrowRightLeft, ArrowUpRight, Banknote, CalendarCheck,
    CalendarClock, CalendarRange, ChartNoAxesCombined, Check, ChevronLeft, ChevronRight,
    CircleCheckBig, CreditCard, Download, Equal, HandCoins, Info, Landmark, Layers3,
    LayoutDashboard, ListChecks, LogIn, LogOut, Menu, Minus, Pause, Pencil, Percent,
    PiggyBank, Play, Plus, Repeat2, Save, Settings, Settings2, ShieldCheck, ShoppingBasket,
    Sparkles, Tags, Target, Trash2, TrendingUp, Undo2, Wallet, WalletCards, X,
  } });
}

function captureScrollState(anchor) {
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    anchorSelector: anchor?.dataset?.action
      ? `[data-action="${anchor.dataset.action}"][data-collection="${anchor.dataset.collection || ""}"][data-id="${anchor.dataset.id || ""}"]`
      : "",
    anchorTop: anchor?.getBoundingClientRect?.().top ?? null,
    containers: [".transactions-list-panel .table-wrap", ".planning-scroll", ".pending-list"].flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).map((element, index) => ({
        selector,
        index,
        left: element.scrollLeft,
        top: element.scrollTop,
      })),
    ),
  };
}

function restoreScrollState(snapshot) {
  if (!snapshot) return;
  window.scrollTo(snapshot.windowX, snapshot.windowY);
  snapshot.containers.forEach((item) => {
    const element = document.querySelectorAll(item.selector)[item.index];
    if (!element) return;
    element.scrollLeft = item.left;
    element.scrollTop = item.top;
  });
  if (snapshot.anchorSelector && snapshot.anchorTop !== null) {
    const anchor = document.querySelector(snapshot.anchorSelector);
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - snapshot.anchorTop);
  }
}

function showToast(message, variant = "") {
  const inferred = variant || (/não|erro|falh|inválid|maior que|atenção/i.test(String(message)) ? "error" : "success");
  toast.textContent = message;
  toast.className = `toast is-${inferred}`;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function setSaving(saving) {
  state.saving = saving;
  document.body.classList.toggle("is-saving", saving);
  appRoot.setAttribute("aria-busy", String(saving));
}

function confirmAction({ title, message, confirmLabel = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    confirmDialog.innerHTML = `<form method="dialog"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><div class="dialog-actions"><button class="button ghost" value="cancel">Cancelar</button><button class="button ${danger ? "danger" : ""}" value="confirm">${escapeHtml(confirmLabel)}</button></div></form>`;
    const finish = () => {
      confirmDialog.removeEventListener("close", finish);
      resolve(confirmDialog.returnValue === "confirm");
    };
    confirmDialog.addEventListener("close", finish);
    confirmDialog.showModal();
  });
}

function authErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (message.includes("email not confirmed")) return "Confirme o e-mail no Supabase antes de entrar.";
  if (message.includes("missing supabase environment")) return "Configure as variáveis do Supabase no ambiente.";
  return error?.message || "Não foi possível autenticar.";
}

async function reloadRemote() {
  if (!state.user) return;
  const remote = await loadRemoteData(state.user);
  state.data = remote.data;
  state.householdId = remote.householdId;
}

async function refreshRemoteOnResume() {
  if (LOCAL_AUTH_BYPASS || !state.authReady || !state.user || document.visibilityState === "hidden") return;
  if (state.formDirty) return;
  const now = Date.now();
  if (now - lastResumeRefresh < 1500) return;
  lastResumeRefresh = now;
  try {
    await reloadRemote();
    render();
  } catch (error) {
    console.error(error);
  }
}

window.addEventListener("focus", refreshRemoteOnResume);
document.addEventListener("visibilitychange", refreshRemoteOnResume);

async function persist(message) {
  const scrollState = pendingScrollRestore || captureScrollState();
  if (LOCAL_AUTH_BYPASS) {
    state.formDirty = false;
    saveData(state.data);
    render();
    restoreScrollState(scrollState);
    window.setTimeout(() => {
      if (pendingScrollRestore === scrollState) pendingScrollRestore = null;
    }, 900);
    showToast(message);
    setSaving(false);
    return;
  }

  await reloadRemote();
  state.formDirty = false;
  render();
  restoreScrollState(scrollState);
  window.setTimeout(() => {
    if (pendingScrollRestore === scrollState) pendingScrollRestore = null;
  }, 900);
  showToast(message);
  setSaving(false);
}

const tableCollections = {
  accounts: "accounts",
  cards: "cards",
  categories: "categories",
  investments: "investments",
  market_groups: "marketGroups",
  market_history: "marketHistory",
  planning_items: "planningItems",
  transactions: "transactions",
};

function localCardStatus(status) {
  return { open: "aberta", closed: "fechada", paid: "paga", late: "atrasada" }[status] || status || "aberta";
}

function localMonthText(date) {
  return String(date || "").slice(0, 7);
}

function localFromDb(table, row) {
  const value = (item) => Number(item || 0);
  const converters = {
    accounts: () => ({
      id: row.id,
      name: row.name,
      institution: row.institution,
      type: row.type,
      balance: value(row.balance),
      isPrimary: Boolean(row.is_primary),
      notes: row.notes || "",
      createdBy: row.created_by,
    }),
    cards: () => ({
      id: row.id,
      accountId: row.account_id || "",
      name: row.name,
      limitTotal: value(row.limit_total),
      closingDay: row.closing_day,
      dueDay: row.due_day,
      status: localCardStatus(row.status),
      notes: row.notes || "",
      createdBy: row.created_by,
    }),
    categories: () => ({
      id: row.id,
      name: row.name,
      type: row.type,
      color: row.color,
      budget: value(row.monthly_budget),
      createdBy: row.created_by,
    }),
    investments: () => ({
      id: row.id,
      name: row.name,
      type: row.type,
      amount: value(row.amount),
      estimatedYield: value(row.estimated_yield),
      realYield: value(row.real_yield),
      applicationDate: row.application_date || "",
      maturityDate: row.maturity_date || "",
      institution: row.institution || "",
      liquidity: row.liquidity || "",
      notes: row.notes || "",
      createdBy: row.created_by,
    }),
    market_groups: () => ({
      id: row.id,
      name: row.name,
      forecast: value(row.forecast),
      createdBy: row.created_by,
    }),
    market_history: () => ({
      id: row.id,
      month: localMonthText(row.month),
      amount: value(row.amount),
      notes: row.notes || "",
      createdBy: row.created_by,
    }),
    planning_items: () => ({
      id: row.id,
      group: row.group_key,
      type: row.type,
      name: row.name,
      amount: value(row.amount),
      recurrence: row.recurrence,
      day: row.due_day,
      categoryId: row.category_id || "",
      accountId: row.account_id || "",
      cardId: row.card_id || "",
      paymentMethod: row.payment_method,
      active: row.active,
      notes: row.notes || "",
      createdBy: row.created_by,
    }),
    transactions: () => ({
      id: row.id,
      type: row.type,
      description: row.description,
      amount: value(row.amount),
      date: row.transaction_date,
      categoryId: row.category_id || "",
      accountId: row.account_id || "",
      fromAccountId: row.from_account_id || "",
      toAccountId: row.to_account_id || "",
      cardId: row.card_id || "",
      linkedPlanningId: row.planning_item_id || "",
      paymentMethod: row.payment_method,
      installments: row.installments,
      currentInstallment: row.current_installment,
      status: row.status,
      notes: row.notes || "",
      createdBy: row.created_by,
    }),
  };
  return converters[table]?.() || row;
}

async function dbInsert(table, payload) {
  if (!LOCAL_AUTH_BYPASS) {
    ignoreRealtimeUntil = Date.now() + 1800;
    return insertRemote(table, payload);
  }
  const collection = tableCollections[table];
  if (!collection) return null;
  const item = localFromDb(table, { id: uid(table), ...payload });
  state.data[collection].unshift(item);
  return item;
}

async function dbUpdate(table, id, payload, idColumn = "id") {
  if (!LOCAL_AUTH_BYPASS) {
    ignoreRealtimeUntil = Date.now() + 1800;
    return updateRemote(table, id, payload, idColumn);
  }
  if (table === "household_settings") {
    state.data.settings = {
      ...state.data.settings,
      mainAccountId: payload.main_account_id || "",
      highSpendingAlertRate: payload.high_spending_alert_rate,
      defaultMarketForecast: payload.default_market_forecast,
      forecastMonths: payload.forecast_months,
    };
    return state.data.settings;
  }
  const collection = tableCollections[table];
  const index = state.data[collection]?.findIndex((item) => item.id === id) ?? -1;
  if (index < 0) return null;
  state.data[collection][index] = localFromDb(table, { id, ...payload });
  return state.data[collection][index];
}

async function dbDelete(table, id) {
  if (!LOCAL_AUTH_BYPASS) {
    ignoreRealtimeUntil = Date.now() + 1800;
    return deleteRemote(table, id);
  }
  const collection = tableCollections[table];
  if (!collection) return null;
  state.data[collection] = state.data[collection].filter((item) => item.id !== id);
  return null;
}

function options(items, selected = "") {
  return items
    .map((item) => {
      const value = typeof item === "string" ? item : item.value;
      const label = typeof item === "string" ? item : item.label;
      return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function categoryOptions(selected = "", filter = "all") {
  const categories = state.data.categories.filter((category) => {
    if (filter === "income") return category.type === "income" || category.type === "mixed";
    if (filter === "expense") return ["expense", "mixed", "investment"].includes(category.type);
    return true;
  });
  return options(categories.map((category) => ({ value: category.id, label: category.name })), selected);
}

function accountOptions(selected = "", includeEmpty = false) {
  const list = state.data.accounts.map((account) => ({ value: account.id, label: account.name }));
  if (includeEmpty) list.unshift({ value: "", label: "Não vincular" });
  return options(list, selected);
}

function cardOptions(selected = "", includeEmpty = false) {
  const list = state.data.cards.map((card) => ({ value: card.id, label: card.name }));
  if (includeEmpty) list.unshift({ value: "", label: "Sem cartão" });
  return options(list, selected);
}

function memberName(id) {
  return state.data.members?.find((member) => member.id === id)?.displayName || "Usuário";
}

function currentUserName() {
  return memberName(state.user?.id);
}

function metricCard({ label, value, note = "", icon = "circle-dollar-sign", tone = "" }) {
  return `
    <article class="metric-card ${tone}">
      <div class="metric-top">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="icon-badge"><i data-lucide="${icon}"></i></span>
      </div>
      <strong class="metric-value">${escapeHtml(value)}</strong>
      ${note ? `<span class="metric-note">${escapeHtml(note)}</span>` : ""}
    </article>
  `;
}

function panel({ title, subtitle = "", span = 6, body, className = "" }) {
  return `
    <section class="panel span-${span} ${className}">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="panel-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        </div>
      </div>
      ${body}
    </section>
  `;
}

function badge(label, variant = "neutral") {
  return `<span class="badge ${variant}"><span class="status-dot"></span>${escapeHtml(label)}</span>`;
}

function dueText(occurrence) {
  if (occurrence.status === "done") return "Realizado";
  if (occurrence.daysUntil < 0) return `Atrasado há ${Math.abs(occurrence.daysUntil)} dia(s)`;
  if (occurrence.daysUntil === 0) return "Vence hoje";
  if (occurrence.daysUntil === 1) return "Vence amanhã";
  return `Vence em ${occurrence.daysUntil} dia(s)`;
}

function routeMeta(route) {
  const map = {
    dashboard: ["Hoje", "Quanto ainda podemos gastar"],
    pending: ["A fazer", "Pagamentos e recebimentos do mês"],
    future: ["Futuro", "Compromissos e previsão dos próximos meses"],
    history: ["Histórico", "O que aconteceu de verdade"],
    registrations: ["Cadastros", "Estrutura e regras do financeiro"],
    transactions: ["Movimentações", "Eventos financeiros reais"],
    accounts: ["Contas bancárias", "Saldos e fluxo por conta"],
    cards: ["Cartões", "Faturas, limites e compras"],
    planning: ["Compromissos", "Recorrências que alimentam a previsão"],
    goals: ["Metas", "Limites mensais por categoria"],
    investments: ["Investimentos", "Patrimônio investido"],
    categories: ["Categorias", "Classificação e orçamentos"],
    settings: ["Configurações", "Preferências do assistente"],
    market: ["Mercado", "Previsão e histórico de compras"],
  };
  return map[route] || map.dashboard;
}

function renderNav() {
  const registrationRoutes = ["accounts", "cards", "planning", "categories", "investments", "market", "settings"];
  const routeButtons = navItems
    .map(
      (item) => `
        <button class="nav-item ${state.route === item.route || (item.route === "registrations" && registrationRoutes.includes(state.route)) || (item.route === "history" && state.route === "transactions") ? "active" : ""}" type="button" data-route="${item.route}">
          <i data-lucide="${item.icon}"></i>
          <span>${escapeHtml(item.label)}</span>
        </button>
      `,
    )
    .join("");

  sidebarNav.innerHTML = `
    ${routeButtons}
    <button class="nav-item" type="button" data-action="logout">
      <i data-lucide="log-out"></i>
      <span>Sair</span>
    </button>
  `;
}

function renderMonthSelector() {
  const [year, month] = state.month.split("-").map(Number);
  monthSelect.innerHTML = monthNames
    .map(
      (name, index) =>
        `<option value="${String(index + 1).padStart(2, "0")}" ${index + 1 === month ? "selected" : ""}>${name}</option>`,
    )
    .join("");
  yearInput.value = year;
}

function setMonth(month) {
  state.month = month;
  render();
}

function setMonthFromControls() {
  const year = Math.max(2000, Math.min(2100, toNumber(yearInput.value) || new Date().getFullYear()));
  const month = monthSelect.value || "01";
  setMonth(`${year}-${month}`);
}

function render() {
  if (!state.authReady) {
    document.body.classList.add("auth-mode");
    pageTitle.textContent = "Carregando";
    pageEyebrow.textContent = "Conectando ao Supabase";
    appRoot.innerHTML = `<section class="auth-shell"><div class="auth-card"><h2>Carregando seus dados...</h2><p>Conectando ao Supabase e verificando a sessão.</p></div></section>`;
    quickAddButton.hidden = true;
    modalRoot.innerHTML = "";
    refreshIcons();
    return;
  }

  if (!state.user) {
    document.body.classList.add("auth-mode");
    pageTitle.textContent = "Entrar";
    pageEyebrow.textContent = "Financeiro pessoal";
    sidebarNav.innerHTML = "";
    appRoot.innerHTML = renderAuth();
    quickAddButton.hidden = true;
    modalRoot.innerHTML = "";
    refreshIcons();
    return;
  }

  const [title, eyebrow] = routeMeta(state.route);
  document.body.classList.remove("auth-mode");
  pageTitle.textContent = title;
  pageEyebrow.textContent = eyebrow;
  renderMonthSelector();
  renderNav();
  quickAddButton.hidden = false;

  const routes = {
    dashboard: renderDashboard,
    pending: renderPending,
    future: renderFuture,
    history: renderHistory,
    registrations: renderRegistrations,
    transactions: renderTransactions,
    accounts: renderAccounts,
    cards: renderCards,
    planning: renderPlanning,
    goals: renderGoals,
    investments: renderInvestments,
    categories: renderCategories,
    settings: renderSettings,
    market: () => marketPlanning(calculateFinance(state.data, state.month)),
  };
  appRoot.innerHTML = (routes[state.route] || renderDashboard)();
  formatMoneyInputs();
  if (!state.quickAddOpen || !modalRoot.querySelector('[data-form="universal-entry"]')) renderQuickAddModal();
  refreshIcons();
}

function renderAuth() {
  return `
    <section class="auth-shell">
      <article class="auth-card">
        <div class="brand auth-brand">
          <img class="brand-mark" src="/assets/icons/icon-192.png?v=12" alt="" />
          <div>
            <strong>Financeiro</strong>
            <span>assistente familiar</span>
          </div>
        </div>
        <h2>Entre para sincronizar suas finanças</h2>
        <p>Acesse com o e-mail e a senha cadastrados no Supabase.</p>
        <form class="auth-form" data-form="auth-login">
          <label class="field">
            <span>E-mail</span>
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <label class="field">
            <span>Senha</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <button class="button" type="submit"><i data-lucide="log-in"></i><span>Entrar</span></button>
          <button class="action-link" type="button" data-action="forgot-password">Esqueci minha senha</button>
        </form>
      </article>
    </section>
  `;
}

function localToday() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function renderQuickAddModal() {
  if (!state.user || !state.quickAddOpen) {
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
    const returnTarget = modalReturnFocus;
    modalReturnFocus = null;
    window.setTimeout(() => returnTarget?.isConnected && returnTarget.focus(), 0);
    return;
  }
  if (!modalRoot.querySelector('[role="dialog"]')) modalReturnFocus = document.activeElement;
  const defaultDate = state.month === currentMonth() ? localToday() : `${state.month}-01`;
  const preset = state.quickAddPreset || {};
  const openLoans = loanSummary().borrowers;
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-quick-add">
      <section class="universal-modal" role="dialog" aria-modal="true" aria-labelledby="quickAddTitle">
        <div class="modal-header">
          <div><span class="eyebrow">Cadastro universal</span><h2 id="quickAddTitle">O que aconteceu?</h2><p>Compra, parcela, assinatura ou conta fixa: tudo começa aqui.</p></div>
          <button class="icon-button modal-close" type="button" data-action="close-quick-add" aria-label="Fechar"><i data-lucide="x"></i></button>
        </div>
        <form class="universal-form" data-form="universal-entry">
          <div class="entry-kind-switch" role="group" aria-label="Tipo de lançamento">
            <label><input type="radio" name="entryType" value="expense" ${preset.entryType !== "loan" ? "checked" : ""} /><span><i data-lucide="arrow-up-right"></i>Gasto</span></label>
            <label><input type="radio" name="entryType" value="income" /><span><i data-lucide="arrow-down-left"></i>Receita</span></label>
            <label><input type="radio" name="entryType" value="loan" ${preset.entryType === "loan" ? "checked" : ""} /><span><i data-lucide="hand-coins"></i>Empréstimo</span></label>
          </div>
          <label class="form-group wide" data-universal-field="description"><span class="form-label">Descrição</span><input name="description" placeholder="Ex.: mercado, Spotify, aluguel" autocomplete="off" required /></label>
          <fieldset class="repeat-fieldset full is-hidden" data-universal-field="loan-action">
            <legend>Movimento</legend>
            <label><input type="radio" name="loanAction" value="lend" ${preset.loanAction !== "repayment" ? "checked" : ""} /><span><strong>Emprestar</strong><small>Aumenta o valor a receber</small></span></label>
            <label><input type="radio" name="loanAction" value="repayment" ${preset.loanAction === "repayment" ? "checked" : ""} /><span><strong>Receber devolução</strong><small>Desconta o que a pessoa deve</small></span></label>
          </fieldset>
          <label class="form-group wide is-hidden" data-universal-field="loan-person"><span class="form-label">Quem recebeu?</span><input name="loanPerson" value="${escapeHtml(preset.personName || "")}" placeholder="Nome da pessoa" autocomplete="off" /></label>
          <label class="form-group wide is-hidden" data-universal-field="repayment-person"><span class="form-label">Quem está pagando?</span><select name="repaymentPersonKey"><option value="">Selecione</option>${options(openLoans.map((person) => ({ value: person.personKey, label: `${person.personName} · deve ${formatCurrency(person.balance)}` })), preset.personKey || "")}</select></label>
          <label class="form-group"><span class="form-label">Valor</span><input name="amount" ${moneyInputAttributes()} placeholder="R$ 0,00" required /></label>
          <label class="form-group"><span class="form-label" data-universal-date-label>Data da compra ou vencimento</span><input name="date" type="date" value="${defaultDate}" required /></label>
          <label class="form-group" data-universal-field="category"><span class="form-label">Categoria</span><select name="categoryId" required><option value="">Selecione</option>${categoryOptions()}</select></label>
          <label class="form-group" data-universal-field="payment"><span class="form-label">Como será pago?</span><select name="paymentMethod">${options(paymentMethods, state.data.cards.length ? "Cartão crédito" : "PIX")}</select></label>
          <label class="form-group is-hidden" data-universal-field="loan-due"><span class="form-label">Previsão de devolução <small>(opcional)</small></span><input name="loanDueDate" type="date" /></label>
          <label class="form-group" data-universal-field="card"><span class="form-label">Cartão</span><select name="cardId"><option value="">Selecione</option>${cardOptions()}</select>${!state.data.cards.length ? `<small class="field-help">Cadastre um cartão antes de salvar.</small>` : ""}</label>
          <label class="form-group" data-universal-field="account"><span class="form-label">Conta</span><select name="accountId">${accountOptions(state.data.settings.mainAccountId, true)}</select></label>
          <fieldset class="repeat-fieldset full" data-universal-field="repeat">
            <legend>Isso acontece como?</legend>
            <label><input type="radio" name="repeatMode" value="one_time" checked /><span><strong>Uma vez</strong><small>Compra ou recebimento já feito</small></span></label>
            <label data-universal-choice="installments"><input type="radio" name="repeatMode" value="installments" /><span><strong>Parcelado</strong><small>Uma compra dividida no cartão</small></span></label>
            <label><input type="radio" name="repeatMode" value="monthly" /><span><strong>Todo mês</strong><small>Assinatura, boleto, aluguel ou receita</small></span></label>
          </fieldset>
          <label class="form-group is-hidden" data-universal-field="installments"><span class="form-label">Quantidade de parcelas</span><input name="installments" type="number" min="2" max="120" value="2" /></label>
          <label class="form-group is-hidden" data-universal-field="occurrences"><span class="form-label">Por quantos meses?</span><select name="totalOccurrences"><option value="0">Sem data para terminar</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="10">10 meses</option><option value="12">12 meses</option><option value="24">24 meses</option><option value="36">36 meses</option></select><small class="field-help">Use uma duração para dívidas ou acordos em PIX.</small></label>
          <label class="form-group full"><span class="form-label">Observação <small>(opcional)</small></span><input name="notes" placeholder="Algum detalhe útil" /></label>
          <div class="universal-summary full" data-universal-summary><i data-lucide="sparkles"></i><span>Será registrado como uma compra única no cartão.</span></div>
          <div class="modal-actions full">
            <button class="button ghost" type="button" data-action="close-quick-add">Cancelar</button>
            <button class="button" type="submit"><i data-lucide="check"></i><span>Salvar</span></button>
            <button class="button secondary" type="submit" data-keep-open="true"><i data-lucide="plus"></i><span>Salvar e adicionar outro</span></button>
          </div>
        </form>
      </section>
    </div>`;
  document.body.classList.add("modal-open");
  formatMoneyInputs(modalRoot);
  updateUniversalFormVisibility();
  refreshIcons();
  const initialFocus = preset.entryType === "loan"
    ? preset.loanAction === "repayment" ? '[name="repaymentPersonKey"]' : '[name="loanPerson"]'
    : '[name="description"]';
  window.setTimeout(() => modalRoot.querySelector(initialFocus)?.focus(), 0);
}

function updateUniversalFormVisibility() {
  const form = modalRoot.querySelector('[data-form="universal-entry"]');
  if (!form) return;
  const entryType = form.querySelector('[name="entryType"]:checked')?.value || "expense";
  const isLoan = entryType === "loan";
  const loanAction = form.querySelector('[name="loanAction"]:checked')?.value || "lend";
  if (isLoan) form.elements.paymentMethod.value = "PIX";
  if (entryType === "income" && form.elements.paymentMethod.value === "Cartão crédito") form.elements.paymentMethod.value = "PIX";
  const paymentMethod = form.elements.paymentMethod.value;
  const repeatMode = form.querySelector('[name="repeatMode"]:checked')?.value || "one_time";
  const usesCard = paymentMethod === "Cartão crédito";
  const categorySelect = form.elements.categoryId;
  if (!isLoan && categorySelect.dataset.kind !== entryType) {
    const previousCategory = categorySelect.value;
    categorySelect.innerHTML = `<option value="">Selecione</option>${categoryOptions(previousCategory, entryType)}`;
    categorySelect.dataset.kind = entryType;
  }
  form.elements.categoryId.required = !isLoan;
  form.elements.description.required = !isLoan;
  form.querySelector('[data-universal-field="description"]')?.classList.toggle("is-hidden", isLoan);
  form.querySelector('[data-universal-field="category"]')?.classList.toggle("is-hidden", isLoan);
  form.querySelector('[data-universal-field="payment"]')?.classList.toggle("is-hidden", isLoan);
  form.querySelector('[data-universal-field="card"]')?.classList.toggle("is-hidden", !usesCard || isLoan);
  form.querySelector('[data-universal-field="account"]')?.classList.toggle("is-hidden", usesCard && !isLoan);
  form.querySelector('[data-universal-field="repeat"]')?.classList.toggle("is-hidden", isLoan);
  form.querySelector('[data-universal-field="loan-action"]')?.classList.toggle("is-hidden", !isLoan);
  form.querySelector('[data-universal-field="loan-person"]')?.classList.toggle("is-hidden", !isLoan || loanAction !== "lend");
  form.querySelector('[data-universal-field="repayment-person"]')?.classList.toggle("is-hidden", !isLoan || loanAction !== "repayment");
  form.querySelector('[data-universal-field="loan-due"]')?.classList.toggle("is-hidden", !isLoan || loanAction !== "lend");
  form.elements.loanPerson.required = isLoan && loanAction === "lend";
  form.elements.repaymentPersonKey.required = isLoan && loanAction === "repayment";
  form.querySelector('[data-universal-date-label]').textContent = isLoan ? "Data do movimento" : "Data da compra ou vencimento";
  form.querySelector('[data-universal-choice="installments"]')?.classList.toggle("is-hidden", !usesCard || entryType === "income" || isLoan);
  form.querySelector('[data-universal-field="occurrences"]')?.classList.toggle("is-hidden", isLoan || repeatMode !== "monthly");
  if ((!usesCard || entryType === "income") && repeatMode === "installments") {
    form.querySelector('[name="repeatMode"][value="one_time"]').checked = true;
  }
  const effectiveMode = form.querySelector('[name="repeatMode"]:checked')?.value || "one_time";
  form.querySelector('[data-universal-field="installments"]')?.classList.toggle("is-hidden", isLoan || effectiveMode !== "installments");
  const labels = {
    one_time: entryType === "income" ? "Será registrada como uma receita realizada." : usesCard ? "Entrará na fatura correta conforme o fechamento do cartão." : "Será registrado como um gasto realizado.",
    installments: "O valor total será dividido entre as faturas. A meta mensal recebe apenas cada parcela.",
    monthly: usesCard ? "Será criado uma vez e aparecerá automaticamente nas próximas faturas." : "Será criado uma vez e aparecerá automaticamente em A fazer e no Futuro.",
  };
  form.querySelector("[data-universal-summary] span").textContent = isLoan
    ? loanAction === "lend" ? "O saldo da pessoa será aumentado." : "O pagamento será descontado do saldo da pessoa."
    : labels[effectiveMode];
}

async function saveUniversalEntry(form, keepOpen = false) {
  const raw = readForm(form);
  const entryType = raw.entryType || "expense";
  const repeatMode = raw.repeatMode || "one_time";
  const amount = toNumber(raw.amount);
  if (!amount) throw new Error("Informe um valor maior que zero.");
  const card = state.data.cards.find((item) => item.id === raw.cardId);
  const usesCard = raw.paymentMethod === "Cartão crédito" && entryType === "expense";
  if (usesCard && !card) throw new Error("Selecione um cartão ou cadastre um em Cadastros.");

  if (entryType === "loan") {
    const action = raw.loanAction || "lend";
    const loans = loanSummary();
    const existing = loans.borrowers.find((person) => person.personKey === raw.repaymentPersonKey);
    const personName = action === "lend" ? raw.loanPerson?.trim() : existing?.personName;
    const personKey = action === "lend" ? normalize(personName) : existing?.personKey;
    if (!personName || !personKey) throw new Error("Informe ou selecione a pessoa.");
    if (action === "repayment" && amount > existing.balance + 0.005) {
      throw new Error(`${personName} deve ${formatCurrency(existing.balance)}. O pagamento informado é maior que o saldo.`);
    }
    const notes = withFinanceMeta(raw.notes, {
      source: "universal",
      kind: "loan",
      action,
      personKey,
      personName,
      dueDate: action === "lend" ? raw.loanDueDate || "" : "",
    });
    await dbInsert("transactions", toDbTransaction({
      type: "transfer",
      description: action === "lend" ? `Empréstimo para ${personName}` : `Devolução de ${personName}`,
      amount,
      date: raw.date,
      categoryId: "",
      accountId: raw.accountId,
      fromAccountId: action === "lend" ? raw.accountId : "",
      toAccountId: action === "repayment" ? raw.accountId : "",
      cardId: "",
      paymentMethod: action === "lend" ? "Dinheiro emprestado" : "Devolução de empréstimo",
      linkedPlanningId: "",
      installments: 1,
      currentInstallment: 1,
      status: "confirmed",
      notes,
    }, state.householdId, state.user.id));
    state.quickAddOpen = keepOpen;
    state.quickAddPreset = keepOpen ? { entryType: "loan" } : null;
    await persist(action === "lend" ? "Empréstimo registrado." : "Devolução registrada.");
    if (keepOpen) renderQuickAddModal();
    return;
  }

  if (repeatMode === "monthly") {
    const totalOccurrences = Math.max(0, Math.trunc(toNumber(raw.totalOccurrences)) || 0);
    const notes = withFinanceMeta(raw.notes, {
      source: "universal",
      repeatMode: "monthly",
      startMonth: raw.date.slice(0, 7),
      totalOccurrences,
    });
    await dbInsert("planning_items", toDbPlanning({
      group: entryType === "income" ? "income" : usesCard ? "subscription" : "expense",
      type: entryType,
      name: raw.description.trim(),
      amount,
      recurrence: "monthly",
      day: Math.max(1, toNumber(raw.date.slice(8, 10)) || 1),
      categoryId: raw.categoryId,
      accountId: usesCard ? card.accountId : raw.accountId,
      cardId: usesCard ? card.id : "",
      paymentMethod: usesCard ? "Cartão crédito" : raw.paymentMethod,
      active: true,
      notes,
    }, state.householdId, state.user.id));
  } else {
    const installments = repeatMode === "installments" ? Math.max(2, Math.trunc(toNumber(raw.installments)) || 2) : 1;
    const notes = usesCard
      ? cardPurchaseNotes(card, raw.date, raw.notes, "universal")
      : raw.notes?.trim() || "";
    await dbInsert("transactions", toDbTransaction({
      type: entryType === "income" ? "income" : usesCard ? "card" : "expense",
      description: raw.description.trim(),
      amount,
      date: raw.date,
      categoryId: raw.categoryId,
      accountId: usesCard ? card.accountId : raw.accountId,
      cardId: usesCard ? card.id : "",
      paymentMethod: usesCard ? "Cartão crédito" : raw.paymentMethod,
      linkedPlanningId: "",
      installments,
      currentInstallment: 1,
      status: "confirmed",
      notes,
    }, state.householdId, state.user.id));
  }

  state.quickAddOpen = keepOpen;
  state.quickAddPreset = null;
  await persist(repeatMode === "monthly" ? "Compromisso recorrente criado." : "Lançamento salvo.");
  if (keepOpen) renderQuickAddModal();
}

function renderDashboard() {
  const finance = calculateFinance(state.data, state.month);
  const highPriority = finance.todayTasks;
  const budgets = finance.categoryBudgets.filter((category) => category.budget > 0);
  const loans = loanSummary();

  return `
    <section class="today-overview">
      <article class="spending-power ${finance.categoryBudget.configuredCount > 0 && finance.categoryBudget.availableForNewSpending <= 0 ? "is-alert" : ""}">
        <span class="summary-kicker">Ainda podemos decidir gastar em ${escapeHtml(monthLabel(state.month))}</span>
        <strong>${formatCurrency(finance.categoryBudget.availableForNewSpending)}</strong>
        <p>Este valor já desconta contas previstas, parcelas e reservas das metas por categoria.</p>
        <div class="availability-grid">
          <span><b>${formatCurrency(finance.actualExpense)}</b> já gasto</span>
          <span><b>${formatCurrency(finance.categoryBudget.committed)}</b> comprometido</span>
          <span><b>${formatCurrency(finance.categoryBudget.reserved)}</b> reservado nas metas</span>
        </div>
        <button class="button inverted" type="button" data-action="open-quick-add"><i data-lucide="plus"></i><span>Registrar compra</span></button>
      </article>

      <article class="panel today-actions">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">O que pede atenção</h2>
            <p class="panel-subtitle">Vencimentos dos próximos 7 dias.</p>
          </div>
          <a class="action-link" href="#/pending">Ver tudo</a>
        </div>
        <div class="task-list">
          ${highPriority.length ? highPriority.map((item) => dashboardTask(item)).join("") : `<div class="empty-state compact">Tudo em dia por aqui.</div>`}
        </div>
      </article>
    </section>

    <section class="section-heading">
      <div><h2>Quanto resta por categoria</h2><p>Gasto real + parcelas + recorrências já assumidas.</p></div>
      <a class="action-link" href="#/goals">Ajustar metas</a>
    </section>
    <section class="budget-card-grid">
      ${budgets.length ? budgets.map(categoryBudgetCard).join("") : `<article class="empty-state budget-empty"><strong>Nenhuma meta definida</strong><a class="button small" href="#/goals">Definir metas</a></article>`}
    </section>

    <section class="metric-grid compact-metrics">
      ${metricCard({ label: "Receita do mês", value: formatCurrency(finance.actualIncome + finance.pendingIncome), note: `${formatCurrency(finance.pendingIncome)} ainda a receber`, icon: "wallet-cards", tone: "positive" })}
      ${metricCard({ label: "Contas previstas", value: formatCurrency(finance.pendingExpense), note: "Inclui faturas e compromissos", icon: "calendar-clock" })}
      ${metricCard({ label: "Saldo após o mês", value: formatCurrency(finance.saldoPrevistoFinal), note: "Se tudo previsto acontecer", icon: "arrow-right-left", tone: finance.saldoPrevistoFinal >= 0 ? "positive" : "negative" })}
    </section>

    ${renderLoansPanel(loans)}

    <section class="dashboard-grid simplified-charts">
      ${panel({ title: "Gastos realizados", subtitle: "Distribuição do que já aconteceu.", span: 5, body: donutChart(finance.byCategory, { centerLabel: "Gastos" }) })}
      ${panel({ title: "Últimos meses", subtitle: "Receitas e despesas efetivamente registradas.", span: 7, body: groupedBarChart(finance.monthlyEvolution) })}
    </section>
  `;
}

function renderLoansPanel(loans) {
  return `
    <section class="loan-panel panel">
      <div class="loan-total">
        <span class="icon-badge"><i data-lucide="hand-coins"></i></span>
        <div><small>A receber de empréstimos</small><strong>${formatCurrency(loans.totalReceivable)}</strong></div>
      </div>
      <div class="loan-people">
        ${loans.borrowers.length ? loans.borrowers.map((person) => `
          <article class="loan-person">
            <span><strong>${escapeHtml(person.personName)}</strong><small>${person.dueDate ? `Previsto ${formatDate(person.dueDate)}` : `${person.movements} movimento(s)`}</small></span>
            <b>${formatCurrency(person.balance)}</b>
            <button class="button ghost small" type="button" data-action="open-loan-repayment" data-person-key="${escapeHtml(person.personKey)}" data-person-name="${escapeHtml(person.personName)}">Receber</button>
          </article>`).join("") : `<span class="loan-empty">Nenhum valor emprestado.</span>`}
      </div>
      <button class="button secondary small" type="button" data-action="open-quick-add-loan"><i data-lucide="plus"></i><span>Emprestar</span></button>
    </section>`;
}

function categoryBudgetCard(category) {
  const width = Math.min(100, category.progress * 100);
  const status = category.exceeded > 0 ? `Excedeu ${formatCurrency(category.exceeded)}` : `${formatCurrency(category.available)} livres`;
  return `
    <article class="budget-card ${category.exceeded > 0 ? "is-over" : category.warning ? "is-warning" : ""}">
      <div class="budget-title"><span class="legend-dot" style="background:${escapeHtml(category.color)}"></span><strong>${escapeHtml(category.name)}</strong><span>${formatPercent(category.progress)}</span></div>
      <div class="progress-track"><div class="progress-fill ${category.exceeded > 0 ? "is-over" : ""}" style="width:${width}%;background:${escapeHtml(category.color)}"></div></div>
      <div class="budget-values"><span><small>Gasto</small>${formatCurrency(category.spent)}</span><span><small>Comprometido</small>${formatCurrency(category.committed)}</span><strong>${status}</strong></div>
    </article>`;
}

function dashboardTask(item) {
  const variant = item.daysUntil < 0 ? "danger" : item.daysUntil <= 1 ? "warning" : "neutral";
  return `
    <article class="task-item">
      <span class="task-check" aria-hidden="true"></span>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(dueText(item))} · ${formatCurrency(item.expectedAmount)}</span>
      </div>
      <button class="task-action ${variant}" type="button" data-action="go-pending">${item.type === "income" ? "Receber" : "Pagar"}</button>
    </article>
  `;
}

function renderPending() {
  const finance = calculateFinance(state.data, state.month);
  const incomes = finance.occurrences.filter((item) => item.type === "income");
  const expenses = finance.occurrences.filter((item) => item.type === "expense");

  return `
    <section class="module-page">
      <div class="focus-strip">
        <div>
          <span>Saldo após pendências</span>
          <strong>${formatCurrency(finance.saldoAposPendencias)}</strong>
        </div>
        <div>
          <span>Falta receber</span>
          <strong>${formatCurrency(finance.pendingIncome)}</strong>
        </div>
        <div>
          <span>Falta pagar</span>
          <strong>${formatCurrency(finance.pendingExpense)}</strong>
        </div>
      </div>
      <section class="pending-columns">
        ${pendingColumn("Receitas previstas", incomes, "A RECEBER", "RECEBIDO")}
        ${pendingColumn("Despesas previstas", expenses, "A PAGAR", "PAGO")}
      </section>
    </section>
  `;
}

function renderFuture() {
  let rollingBalance = calculateFinance(state.data, state.month).saldoPrevistoFinal;
  const months = Array.from({ length: 6 }, (_, index) => addMonths(state.month, index + 1)).map((month) => {
    const finance = calculateFinance(state.data, month, { includeEvolution: false });
    const reserve = finance.categoryBudget.reserved;
    const commitments = finance.plannedExpense;
    const opening = rollingBalance;
    const ending = opening + finance.plannedIncome - commitments - reserve;
    rollingBalance = ending;
    return { month, finance, opening, commitments, reserve, ending };
  });
  const first = months[0];
  const committedPurchases = state.data.transactions
    .filter((transaction) => transaction.type === "card" && toNumber(transaction.installments) > 1)
    .reduce((total, transaction) => {
      const firstInvoice = parseFinanceMeta(transaction.notes).invoiceMonth || String(transaction.date).slice(0, 7);
      const elapsed = Math.max(0, monthDistance(firstInvoice, state.month));
      const currentInstallment = Math.max(1, toNumber(transaction.currentInstallment) + elapsed);
      const remaining = Math.max(0, toNumber(transaction.installments) - currentInstallment + 1);
      return total + cardInstallmentAmount(transaction) * remaining;
    }, 0);

  return `
    <section class="future-hero">
      <div><span class="summary-kicker">Próximo mês</span><h2>${escapeHtml(monthLabel(first.month))}</h2><strong class="${first.ending < 0 ? "negative" : ""}">${formatCurrency(first.ending)}</strong><p>Saldo estimado depois de receitas, compromissos e reservas de categoria.</p></div>
      <div class="future-formula">
        <span><small>Começa com</small><b>${formatCurrency(first.opening)}</b></span>
        <i data-lucide="plus"></i>
        <span><small>Receitas</small><b>${formatCurrency(first.finance.plannedIncome)}</b></span>
        <i data-lucide="minus"></i>
        <span><small>Já assumido</small><b>${formatCurrency(first.commitments)}</b></span>
        <i data-lucide="minus"></i>
        <span><small>Margem de metas</small><b>${formatCurrency(first.reserve)}</b></span>
      </div>
    </section>

    <section class="metric-grid compact-metrics">
      ${metricCard({ label: "Parcelas ainda abertas", value: formatCurrency(committedPurchases), note: "Dívida total futura, separada do orçamento mensal", icon: "layers-3" })}
      ${metricCard({ label: "Compromissos recorrentes", value: state.data.planningItems.filter((item) => item.active).length, note: "Assinaturas, boletos, PIX e receitas", icon: "repeat-2" })}
      ${metricCard({ label: "Horizonte saudável", value: `${months.filter((item) => item.ending >= 0).length} de 6 meses`, note: "Meses que terminam com saldo positivo", icon: "shield-check", tone: months.every((item) => item.ending >= 0) ? "positive" : "negative" })}
    </section>

    <section class="panel forecast-panel">
      <div class="panel-header"><div><h2 class="panel-title">Visão de seis meses</h2><p class="panel-subtitle">Uma previsão viva: ela muda conforme novas compras e compromissos são registrados.</p></div><button class="button small" type="button" data-action="open-quick-add"><i data-lucide="plus"></i><span>Novo compromisso</span></button></div>
      <div class="forecast-table">
        <div class="forecast-row forecast-head"><span>Mês</span><span>Receitas</span><span>Compromissos</span><span>Reserva livre</span><span>Saldo final</span><span>Leitura</span></div>
        ${months.map((item) => `
          <div class="forecast-row">
            <strong>${escapeHtml(monthLabel(item.month))}</strong>
            <span class="positive">+ ${formatCurrency(item.finance.plannedIncome)}</span>
            <span>- ${formatCurrency(item.commitments)}</span>
            <span>- ${formatCurrency(item.reserve)}</span>
            <strong class="${item.ending < 0 ? "negative" : ""}">${formatCurrency(item.ending)}</strong>
            ${badge(item.ending < 0 ? "Atenção" : item.ending < item.reserve ? "Apertado" : "Confortável", item.ending < 0 ? "danger" : item.ending < item.reserve ? "warning" : "success")}
          </div>`).join("")}
      </div>
    </section>

    <section class="forecast-note"><i data-lucide="info"></i><span><strong>Como ler:</strong> parcelas entram somente pelo valor mensal. A dívida restante aparece separada acima, evitando distorcer o orçamento de cada mês.</span></section>
  `;
}

function renderHistory() {
  const selected = calculateFinance(state.data, state.month);
  const months = Array.from({ length: 12 }, (_, index) => addMonths(state.month, index - 11)).map((month) => {
    const finance = calculateFinance(state.data, month, { includeEvolution: false });
    return { month, income: finance.actualIncome, expense: finance.actualExpense, balance: finance.actualIncome - finance.actualExpense, count: finance.transactions.length };
  }).reverse();

  return `
    <section class="metric-grid compact-metrics">
      ${metricCard({ label: "Receitas realizadas", value: formatCurrency(selected.actualIncome), note: monthLabel(state.month), icon: "arrow-down-left", tone: "positive" })}
      ${metricCard({ label: "Gastos realizados", value: formatCurrency(selected.actualExpense), note: `${selected.transactions.length} lançamento(s)`, icon: "arrow-up-right", tone: "negative" })}
      ${metricCard({ label: "Resultado real", value: formatCurrency(selected.actualIncome - selected.actualExpense), note: "Receita menos gastos registrados", icon: "equal", tone: selected.actualIncome >= selected.actualExpense ? "positive" : "negative" })}
    </section>
    <section class="dashboard-grid history-grid">
      ${panel({ title: "Para onde foi o dinheiro", subtitle: monthLabel(state.month), span: 5, body: donutChart(selected.byCategory, { centerLabel: "Gastos" }) })}
      ${panel({ title: "Evolução realizada", subtitle: "Sem misturar previsões com o que já aconteceu.", span: 7, body: groupedBarChart([...months].reverse().slice(-6).map((item) => ({ label: monthLabel(item.month).split(" de ")[0], income: item.income, expense: item.expense, balance: item.balance }))) })}
    </section>
    <section class="panel history-panel">
      <div class="panel-header"><div><h2 class="panel-title">Fechamento mensal</h2><p class="panel-subtitle">Clique no mês no topo para analisar categorias e lançamentos.</p></div><a class="button ghost small" href="#/transactions">Ver lançamentos</a></div>
      <div class="history-list">
        ${months.map((item) => `<button class="history-row ${item.month === state.month ? "is-active" : ""}" type="button" data-month="${item.month}"><span><strong>${escapeHtml(monthLabel(item.month))}</strong><small>${item.count} lançamento(s)</small></span><span class="positive">${formatCurrency(item.income)}</span><span class="negative">${formatCurrency(item.expense)}</span><strong class="${item.balance < 0 ? "negative" : ""}">${formatCurrency(item.balance)}</strong></button>`).join("")}
      </div>
    </section>
  `;
}

function renderRegistrations() {
  const activeCommitments = state.data.planningItems.filter((item) => item.active).length;
  const cardsLabel = state.data.cards.length === 1 ? "1 cartão" : `${state.data.cards.length} cartões`;
  return `
    <section class="registrations-intro"><div><span class="eyebrow">Configure uma vez</span><h2>O cotidiano acontece no botão Adicionar</h2><p>Aqui ficam apenas estruturas, limites e compromissos que não precisam ser recadastrados toda semana.</p></div><button class="button" type="button" data-action="open-quick-add"><i data-lucide="plus"></i><span>Adicionar lançamento</span></button></section>
    <section class="registration-grid">
      ${registrationCard("landmark", "Contas", `${state.data.accounts.length} cadastrada(s)`, "Saldos e conta principal", "accounts")}
      ${registrationCard("credit-card", "Cartões", cardsLabel, "Limite, fechamento e vencimento", "cards")}
      ${registrationCard("repeat-2", "Compromissos", `${activeCommitments} ativo(s)`, "Assinaturas, boletos e PIX recorrentes", "planning")}
      ${registrationCard("tags", "Categorias", `${state.data.categories.length} cadastrada(s)`, "Organização dos gastos e receitas", "categories")}
      ${registrationCard("piggy-bank", "Investimentos", `${state.data.investments.length} cadastrado(s)`, "Patrimônio separado do orçamento", "investments")}
      ${registrationCard("shopping-basket", "Mercado", `${state.data.marketHistory.length} mês(es) no histórico`, "Previsão e grupos de compra", "market")}
      ${registrationCard("settings", "Preferências", "Família e backup", "Conta principal e parâmetros", "settings")}
    </section>
  `;
}

function registrationCard(icon, title, value, description, route) {
  return `<a class="registration-card" href="#/${route}"><span class="registration-icon"><i data-lucide="${icon}"></i></span><div><h3>${escapeHtml(title)}</h3><strong>${escapeHtml(value)}</strong><p>${escapeHtml(description)}</p></div><i data-lucide="chevron-right"></i></a>`;
}

function pendingColumn(title, items, pendingLabel, doneLabel) {
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(title)}</h2>
          <p class="panel-subtitle">Marque para criar a movimentação real automaticamente.</p>
        </div>
      </div>
      <div class="pending-list">
${items.map((item) => pendingItem(item, pendingLabel, doneLabel)).join("")}
      </div>
    </section>
  `;
}

function pendingItem(item, pendingLabel, doneLabel) {
  const isDone = item.status === "done";
  const details = item.source === "card_invoice" && item.plannedCharges?.length
    ? `Inclui ${item.plannedCharges.length} recorrência(s) planejada(s) no cartão`
    : "";
  const formAttribute =
    item.source === "card_invoice"
      ? `data-card-invoice-id="${escapeHtml(item.id)}" data-card-id="${escapeHtml(item.cardId)}"`
      : `data-pending-id="${escapeHtml(item.planId)}"`;
  const undoButton = item.transaction?.id
    ? `<button class="action-link pending-undo" type="button" data-action="undo-pending" data-transaction-id="${escapeHtml(item.transaction.id)}"><i data-lucide="undo-2"></i><span>Desfazer</span></button>`
    : "";
  return `
    <article class="pending-item is-${item.type} ${isDone ? "is-done" : ""}">
      <div class="pending-main">
        <button class="pending-check ${isDone ? "is-checked" : ""}" type="button" ${isDone ? "disabled" : `data-action="focus-pending" data-pending-form="pending-${escapeHtml(item.id)}"`} aria-label="${isDone ? escapeHtml(doneLabel) : escapeHtml(pendingLabel)}"></button>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>${formatDate(item.dueDate)} · previsto ${formatCurrency(item.expectedAmount)}</span>
          ${
            isDone
              ? `<em>Real: ${formatCurrency(item.actualAmount)} · diferença ${formatCurrency(item.difference)}</em>`
              : `<em>${escapeHtml(dueText(item))}${details ? ` · ${escapeHtml(details)}` : ""}</em>`
          }
        </div>
      </div>
      ${
        isDone
          ? `
            <div class="pending-done-actions">
              <span class="pending-complete-status" role="status" aria-label="${escapeHtml(doneLabel)}">
                <i data-lucide="circle-check-big"></i>
                <span>${escapeHtml(doneLabel)}</span>
              </span>
              ${undoButton}
            </div>
          `
          : `
            <form class="quick-realization" id="pending-${escapeHtml(item.id)}" ${formAttribute}>
              <input name="amount" ${moneyInputAttributes()} value="${escapeHtml(item.expectedAmount)}" aria-label="Valor real" />
              <input name="date" type="date" value="${escapeHtml(item.dueDate)}" aria-label="Data real" />
              <input name="notes" type="text" placeholder="Observações" aria-label="Observações" />
              <button class="button small quick-realization-button" type="submit">
                <i data-lucide="check"></i>
                <span>${escapeHtml(pendingLabel)}</span>
              </button>
            </form>
          `
      }
    </article>
  `;
}

function renderTransactions() {
  const finance = calculateFinance(state.data, state.month);
  const records = filteredTransactions(monthlyTransactionRecords(finance));
  const filters = state.filters.transactions || { scope: "all", accountId: "", cardId: "", categoryId: "" };
  const editing = state.editing.transactions
    ? state.data.transactions.find((transaction) => transaction.id === state.editing.transactions)
    : null;

  return `
    <section class="module-page">
      ${transactionQuickStats(records)}
      <section class="transactions-workspace">
      <section class="form-panel elevated transactions-form-panel" id="transactionForm">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${editing ? "Editar movimentação" : "Novo lançamento"}</h2>
            <p class="panel-subtitle">Registre o evento financeiro real em menos de um minuto.</p>
          </div>
        </div>
        ${transactionForm(editing)}
      </section>
      <section class="table-panel transactions-list-panel">
        <div class="table-header">
          <div>
            <h3 class="table-title">Movimentações de ${escapeHtml(monthLabel(state.month))}</h3>
            <p class="table-subtitle">${records.length} lançamento(s) encontrados</p>
          </div>
        </div>
        ${transactionFilters(filters)}
        <div data-transaction-results>${transactionsTable(records)}</div>
      </section>
      </section>
    </section>
  `;
}

function transactionQuickStats(records) {
  const income = records
    .filter((record) => record.type === "income")
    .reduce((total, record) => total + toNumber(record.amount), 0);
  const expense = records
    .filter((record) => record.type !== "income" && record.type !== "transfer")
    .reduce((total, record) => total + (record.type === "card" ? cardInstallmentAmount(record) : toNumber(record.amount)), 0);
  return `
    <section class="module-summary">
      <article class="mini-card"><span>Entradas</span><strong>${formatCurrency(income)}</strong></article>
      <article class="mini-card"><span>Saídas</span><strong>${formatCurrency(expense)}</strong></article>
      <article class="mini-card"><span>Saldo do mês</span><strong>${formatCurrency(income - expense)}</strong></article>
      <article class="mini-card"><span>Movimentações</span><strong>${records.length}</strong></article>
    </section>
  `;
}

function transactionForm(record = {}) {
  const type = record?.type || "expense";
  return `
    <form class="record-form" data-form="transaction">
      <label class="form-group">
        <span class="form-label">Tipo</span>
        <select name="type">${options(transactionTypes.map((type) => ({ value: type, label: titleCase(type) })), type)}</select>
      </label>
      <label class="form-group wide">
        <span class="form-label">Descrição</span>
        <input name="description" type="text" value="${escapeHtml(record?.description || "")}" required />
      </label>
      <label class="form-group">
        <span class="form-label">Valor</span>
        <input name="amount" ${moneyInputAttributes()} value="${escapeHtml(record?.amount || "")}" required />
      </label>
      <label class="form-group">
        <span class="form-label">Data</span>
        <input name="date" type="date" value="${escapeHtml(record?.date || `${state.month}-01`)}" required />
      </label>
      <label class="form-group">
        <span class="form-label">Categoria</span>
        <select name="categoryId">${categoryOptions(record?.categoryId || "", type === "income" ? "income" : "expense")}</select>
      </label>
      <label class="form-group">
        <span class="form-label">Conta bancária</span>
        <select name="accountId">${accountOptions(record?.accountId || state.data.settings.mainAccountId)}</select>
      </label>
      <label class="form-group ${type === "transfer" ? "" : "is-hidden"}" data-transaction-field="transfer">
        <span class="form-label">Conta de origem</span>
        <select name="fromAccountId">${accountOptions(record?.fromAccountId || record?.accountId || state.data.settings.mainAccountId, true)}</select>
      </label>
      <label class="form-group ${type === "transfer" ? "" : "is-hidden"}" data-transaction-field="transfer">
        <span class="form-label">Conta de destino</span>
        <select name="toAccountId">${accountOptions(record?.toAccountId || "", true)}</select>
      </label>
      <label class="form-group">
        <span class="form-label">Forma de pagamento</span>
        <select name="paymentMethod">${options(paymentMethods, record?.paymentMethod || "PIX")}</select>
      </label>
      <label class="form-group">
        <span class="form-label">Cartão</span>
        <select name="cardId">${cardOptions(record?.cardId || "", true)}</select>
      </label>
      <label class="form-group">
        <span class="form-label">Parcelas</span>
        <input name="installments" type="number" min="1" value="${escapeHtml(record?.installments || 1)}" />
      </label>
      <label class="form-group">
        <span class="form-label">Parcela atual</span>
        <input name="currentInstallment" type="number" min="1" value="${escapeHtml(record?.currentInstallment || 1)}" />
      </label>
      <label class="form-group wide">
        <span class="form-label">Planejamento vinculado</span>
        <select name="linkedPlanningId">
          <option value="">Sem vínculo</option>
          ${options(
            state.data.planningItems.map((plan) => ({ value: plan.id, label: plan.name })),
            record?.linkedPlanningId || "",
          )}
        </select>
      </label>
      <label class="form-group full">
        <span class="form-label">Observações</span>
        <textarea name="notes">${escapeHtml(visibleNotes(record?.notes))}</textarea>
      </label>
      <div class="form-helper full">Responsável: ${escapeHtml(record?.createdBy ? memberName(record.createdBy) : currentUserName())}</div>
      <div class="form-actions">
        ${
          record?.id
            ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="transactions"><i data-lucide="x"></i><span>Cancelar</span></button>`
            : ""
        }
        <button class="button" type="submit"><i data-lucide="save"></i><span>${record?.id ? "Salvar" : "Adicionar"}</span></button>
      </div>
    </form>
  `;
}

function plannedCardTransactionRows(cardData) {
  return cardData.flatMap((card) =>
    (card.plannedCharges || []).map((charge) => ({
      id: `planned-card:${charge.id}`,
      isVirtual: true,
      type: "card",
      description: charge.name,
      amount: charge.amount,
      date: charge.dueDate,
      categoryId: charge.categoryId,
      accountId: card.accountId || "",
      cardId: card.id,
      paymentMethod: "Cartão crédito · previsto",
      installments: 1,
      currentInstallment: 1,
      status: "planned",
    })),
  );
}

function monthlyTransactionRecords(finance) {
  return [...finance.transactions, ...plannedCardTransactionRows(finance.cardData)];
}

function transactionFilters(filters) {
  return `
    <div class="transaction-filters">
      <label class="filter-control search-field">
        <span class="filter-label">Buscar</span>
        <input type="search" data-transaction-search value="${escapeHtml(state.query)}" placeholder="Descrição, categoria, conta..." />
      </label>
      <label class="filter-control">
        <span class="filter-label">Visualizar</span>
        <select data-transaction-filter="scope">
          ${options(
            [
              { value: "all", label: "Todas" },
              { value: "account", label: "Conta bancária" },
              { value: "card", label: "Cartões" },
            ],
            filters.scope || "all",
          )}
        </select>
      </label>
      ${
        filters.scope === "account"
          ? `
            <label class="filter-control">
              <span class="filter-label">Conta</span>
              <select data-transaction-filter="accountId">
                <option value="">Todas as contas</option>
                ${accountOptions(filters.accountId || "")}
              </select>
            </label>
          `
          : ""
      }
      ${
        filters.scope === "card"
          ? `
            <label class="filter-control">
              <span class="filter-label">Cartão</span>
              <select data-transaction-filter="cardId">
                <option value="">Todos os cartões</option>
                ${cardOptions(filters.cardId || "")}
              </select>
            </label>
          `
          : ""
      }
      <label class="filter-control">
        <span class="filter-label">Categoria</span>
        <select data-transaction-filter="categoryId">
          <option value="">Todas as categorias</option>
          ${categoryOptions(filters.categoryId || "")}
        </select>
      </label>
    </div>
  `;
}

function filteredTransactions(transactions) {
  const filters = state.filters.transactions || {};
  const scope = filters.scope || "all";
  const query = normalize(state.query);
  return sortTransactions(transactions.filter((transaction) => {
    if (scope === "account" && transaction.type === "card") return false;
    if (scope === "account" && filters.accountId && transaction.accountId !== filters.accountId) return false;
    if (scope === "card" && transaction.type !== "card") return false;
    if (scope === "card" && filters.cardId && transaction.cardId !== filters.cardId) return false;
    if (filters.categoryId && transaction.categoryId !== filters.categoryId) return false;
    if (!query) return true;
    return normalize(
      `${transaction.description} ${transaction.paymentMethod} ${getAccountName(state.data, transaction.accountId)} ${getCardName(
        state.data,
        transaction.cardId,
      )} ${getCategoryName(state.data, transaction.categoryId)}`,
    ).includes(query);
  }));
}

function sortTransactions(transactions) {
  return [...transactions].sort((a, b) => {
    const byDate = String(a.date || "").localeCompare(String(b.date || ""));
    if (byDate) return byDate;
    const byDescription = String(a.description || "").localeCompare(String(b.description || ""), "pt-BR", {
      sensitivity: "base",
    });
    if (byDescription) return byDescription;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function transactionsTable(records) {
  if (!records.length) return `<div class="empty-state">Nenhuma movimentação encontrada.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Movimentação</th>
            <th>Categoria</th>
            <th>Valor</th>
            <th>Data</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${records.map(transactionRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function categoryTag(categoryId) {
  const name = getCategoryName(state.data, categoryId);
  const color = getCategoryColor(state.data, categoryId);
  return `
    <span class="category-tag" style="--tag-color: ${escapeHtml(color)};">
      <span class="category-tag-dot"></span>
      ${escapeHtml(name)}
    </span>
  `;
}

function transactionRow(record) {
  const signedTone = record.type === "income" ? "positive" : "negative";
  const amount = record.type === "card" ? cardInstallmentAmount(record) : toNumber(record.amount);
  const installments = Math.max(1, Math.trunc(toNumber(record.installments)) || 1);
  const currentInstallment = Math.max(1, Math.trunc(toNumber(record.currentInstallment)) || 1);
  const installmentLabel =
    record.type === "card" && !record.isVirtual
      ? installments > 1
        ? `${currentInstallment}/${installments}`
        : "À vista"
      : "";
  return `
    <tr class="${record.isVirtual ? "is-virtual" : ""}">
      <td>
        <span class="cell-main">
          <strong>${escapeHtml(record.description)}</strong>
          <span>${escapeHtml(record.paymentMethod || titleCase(record.type))}${installmentLabel ? ` · ${escapeHtml(installmentLabel)}` : ""}</span>
        </span>
      </td>
      <td>${categoryTag(record.categoryId)}</td>
      <td class="amount ${signedTone}">${formatCurrency(amount)}</td>
      <td>${formatDate(record.date)}</td>
      <td>
        ${
          record.isVirtual
            ? badge("Previsto", "warning")
            : `
              <div class="row-actions">
                <button class="action-link" type="button" data-action="edit" data-collection="transactions" data-id="${record.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
                <button class="action-link" type="button" data-action="delete" data-collection="transactions" data-id="${record.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
              </div>
            `
        }
      </td>
    </tr>
  `;
}

function renderAccounts() {
  const finance = calculateFinance(state.data, state.month);
  const editing = state.editing.accounts ? state.data.accounts.find((account) => account.id === state.editing.accounts) : null;
  return `
    <section class="module-page">
      <section class="account-grid">
        ${
          finance.accounts
            .map(
              (account) => `
                <article class="account-card">
                  <div class="account-top">
                    <div>
                      <span>${escapeHtml(account.type)}</span>
                      <strong>${escapeHtml(account.name)}</strong>
                    </div>
                    ${account.isPrimary ? badge("Principal", "success") : badge("Secundária")}
                  </div>
                  <div class="account-balance">${formatCurrency(account.projectedBalance)}</div>
                  <div class="account-flow">
                    <span>Entradas <b>${formatCurrency(account.income)}</b></span>
                    <span>Saídas <b>${formatCurrency(account.expense)}</b></span>
                    <span>Projetado <b>${formatCurrency(account.projectedBalance)}</b></span>
                  </div>
                  <p>${escapeHtml(account.notes || "")}</p>
                  <div class="row-actions">
                    <button class="action-link" type="button" data-action="edit" data-collection="accounts" data-id="${account.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
                    <button class="action-link" type="button" data-action="delete" data-collection="accounts" data-id="${account.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
                  </div>
                </article>
              `,
            )
            .join("") || `<div class="empty-state">Nenhuma conta cadastrada.</div>`
        }
      </section>
      <section class="form-panel" id="accountForm">
        <div class="panel-header"><div><h2 class="panel-title">${editing ? "Editar conta" : "Nova conta"}</h2><p class="panel-subtitle">Informe o saldo no início do mês; as movimentações confirmadas atualizam o valor automaticamente.</p></div></div>
        ${accountForm(editing || {})}
      </section>
    </section>
  `;
}

function accountForm(record = {}) {
  return `
    <form class="record-form" data-form="account">
      <label class="form-group wide"><span class="form-label">Nome</span><input name="name" value="${escapeHtml(record.name || "")}" required /></label>
      <label class="form-group"><span class="form-label">Instituição</span><input name="institution" value="${escapeHtml(record.institution || "")}" /></label>
      <label class="form-group"><span class="form-label">Tipo</span><input name="type" value="${escapeHtml(record.type || "Conta secundária")}" /></label>
      <label class="form-group"><span class="form-label">Saldo inicial do mês</span><input name="balance" ${moneyInputAttributes()} value="${escapeHtml(record.balance || "")}" required /></label>
      <label class="form-group"><span class="form-label">Principal</span><span class="checkbox-row"><input name="isPrimary" type="checkbox" ${record.isPrimary ? "checked" : ""} /><span>Sim</span></span></label>
      <label class="form-group full"><span class="form-label">Observações</span><textarea name="notes">${escapeHtml(visibleNotes(record.notes))}</textarea></label>
      <div class="form-actions">
        ${record.id ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="accounts"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
        <button class="button" type="submit"><i data-lucide="save"></i><span>${record.id ? "Salvar conta" : "Adicionar conta"}</span></button>
      </div>
    </form>
  `;
}

function renderCards() {
  const finance = calculateFinance(state.data, state.month);
  const editing = state.editing.cards ? state.data.cards.find((card) => card.id === state.editing.cards) : null;
  return `
    <section class="module-page">
      <section class="card-board">
        ${finance.cardData.map(cardPanel).join("") || `<div class="empty-state">Nenhum cartão cadastrado.</div>`}
      </section>
      <section class="form-panel" id="cardForm">
        <div class="panel-header"><div><h2 class="panel-title">${editing ? "Editar cartão" : "Novo cartão"}</h2><p class="panel-subtitle">Cadastre limites, vencimento e conta vinculada.</p></div></div>
        ${cardForm(editing || {})}
      </section>
      <section class="form-panel elevated" id="cardPurchaseForm">
        <div class="panel-header"><div><h2 class="panel-title">Adicionar compra no cartão</h2><p class="panel-subtitle">Compras parceladas e recorrentes entram na fatura e no limite.</p></div></div>
        ${cardPurchaseForm()}
      </section>
    </section>
  `;
}

function cardPanel(card) {
  const invoiceRows = cardInvoiceRows(card);
  return `
    <article class="credit-panel">
      <div class="credit-header">
        <div>
          <span>${escapeHtml(getAccountName(state.data, card.accountId))}</span>
          <strong>${escapeHtml(card.name)}</strong>
        </div>
        ${badge(titleCase(card.status), card.status === "atrasada" ? "danger" : "warning")}
      </div>
      <div class="credit-limit">
        <span>Fatura atual</span>
        <strong>${formatCurrency(card.invoice)}</strong>
      </div>
      <div class="progress">
        <div class="progress-meta"><span>Limite usado</span><strong>${formatPercent(card.usageRate)}</strong></div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, card.usageRate * 100)}%"></div></div>
      </div>
      <div class="credit-meta">
        <span>Limite ${formatCurrency(card.limitTotal)}</span>
        <span>Disponível ${formatCurrency(card.availableLimit)}</span>
        <span>Fecha dia ${card.closingDay}</span>
        <span>Vence dia ${card.dueDay}</span>
      </div>
      <div class="purchase-list">
        ${
          invoiceRows.length
            ? invoiceRows
                .slice(0, 6)
                .map(
                  (row) => `
                    <div class="purchase-row ${row.isPlanned ? "is-planned" : ""}">
                      <span><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(row.detail)}</small></span>
                      <b>${formatCurrency(row.amount)}</b>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty-state compact">Nenhuma cobrança nesta fatura.</div>`
        }
      </div>
      <div class="row-actions">
        <button class="action-link" type="button" data-action="edit" data-collection="cards" data-id="${card.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
        <button class="action-link" type="button" data-action="delete" data-collection="cards" data-id="${card.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
      </div>
    </article>
  `;
}

function cardInvoiceRows(card) {
  const realRows = (card.monthPurchases || []).map((purchase) => ({
    description: purchase.description,
    detail: getCategoryName(state.data, purchase.categoryId),
    amount: cardInstallmentAmount(purchase),
    date: purchase.date,
    isPlanned: false,
  }));
  const plannedRows = (card.plannedCharges || []).map((charge) => ({
    description: charge.name,
    detail: `${getCategoryName(state.data, charge.categoryId)} · previsto`,
    amount: charge.amount,
    date: charge.dueDate,
    isPlanned: true,
  }));
  return [...realRows, ...plannedRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function cardForm(record = {}) {
  return `
    <form class="record-form" data-form="card">
      <label class="form-group wide"><span class="form-label">Nome</span><input name="name" value="${escapeHtml(record.name || "")}" required /></label>
      <label class="form-group"><span class="form-label">Conta vinculada</span><select name="accountId">${accountOptions(record.accountId || "", true)}</select></label>
      <label class="form-group"><span class="form-label">Limite total</span><input name="limitTotal" ${moneyInputAttributes()} value="${escapeHtml(record.limitTotal || "")}" required /></label>
      <label class="form-group"><span class="form-label">Fechamento</span><input name="closingDay" type="number" min="1" max="31" value="${escapeHtml(record.closingDay || 1)}" required /></label>
      <label class="form-group"><span class="form-label">Vencimento</span><input name="dueDay" type="number" min="1" max="31" value="${escapeHtml(record.dueDay || 1)}" required /></label>
      <label class="form-group"><span class="form-label">Status</span><select name="status">${options(["aberta", "fechada", "paga", "atrasada"].map((status) => ({ value: status, label: titleCase(status) })), record.status || "aberta")}</select></label>
      <label class="form-group full"><span class="form-label">Observações</span><textarea name="notes">${escapeHtml(record.notes || "")}</textarea></label>
      <div class="form-actions">
        ${record.id ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="cards"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
        <button class="button" type="submit"><i data-lucide="save"></i><span>${record.id ? "Salvar cartão" : "Adicionar cartão"}</span></button>
      </div>
    </form>
  `;
}

function cardPurchaseForm() {
  return `
    <form class="record-form" data-form="card-purchase">
      <label class="form-group wide"><span class="form-label">Descrição</span><input name="description" required /></label>
      <label class="form-group"><span class="form-label">Valor</span><input name="amount" ${moneyInputAttributes()} required /></label>
      <label class="form-group"><span class="form-label">Parcelas</span><input name="installments" type="number" min="1" value="1" /></label>
      <label class="form-group"><span class="form-label">Categoria</span><select name="categoryId">${categoryOptions("", "expense")}</select></label>
      <label class="form-group"><span class="form-label">Data</span><input name="date" type="date" value="${state.month}-01" required /></label>
      <label class="form-group"><span class="form-label">Cartão</span><select name="cardId">${cardOptions()}</select></label>
      <label class="form-group full"><span class="form-label">Observações</span><textarea name="notes"></textarea></label>
      <div class="form-actions"><button class="button" type="submit"><i data-lucide="plus"></i><span>Adicionar compra</span></button></div>
    </form>
  `;
}

function renderPlanning() {
  const editing = state.editing.planning_items
    ? state.data.planningItems.find((item) => item.id === state.editing.planning_items)
    : null;
  return `
    <section class="module-page">
      <section class="planning-workspace">
        <section class="form-panel elevated planning-form-panel" id="planningForm">
          <div class="panel-header"><div><h2 class="panel-title">${editing ? "Editar compromisso" : "Novo compromisso"}</h2><p class="panel-subtitle">Cadastre aqui apenas estruturas recorrentes. O dia a dia usa o botão Adicionar.</p></div></div>
          ${planningForm(editing || {})}
        </section>
        <section class="panel planning-list-panel">
          <div class="panel-header"><div><h2 class="panel-title">Compromissos cadastrados</h2><p class="panel-subtitle">${state.data.planningItems.length} item(ns) recorrentes</p></div></div>
          <div class="planning-scroll">
            ${planningList()}
          </div>
        </section>
      </section>
    </section>
  `;
}

function planningList() {
  const items = [...state.data.planningItems].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return Number(a.day || 0) - Number(b.day || 0);
  });
  if (!items.length) return `<div class="empty-state compact">Nenhum item cadastrado.</div>`;
  return `
    <table class="data-table planning-table">
      <thead>
        <tr>
          <th>Planejamento</th>
          <th>Categoria</th>
          <th>Valor</th>
          <th>Dia</th>
          <th>Status</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>
                  <div class="cell-main">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${escapeHtml(item.paymentMethod)} · ${escapeHtml(commitmentDetail(item))}</span>
                  </div>
                </td>
                <td>${categoryTag(item.categoryId)}</td>
                <td><strong class="amount ${item.type === "income" ? "positive" : "negative"}">${formatCurrency(item.amount)}</strong></td>
                <td>Dia ${item.day}</td>
                <td>${badge(item.active ? "Ativo" : "Inativo", item.active ? "success" : "neutral")}</td>
                <td>
                  <div class="row-actions">
                    <button class="action-link" type="button" data-action="edit" data-collection="planning_items" data-id="${item.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
                    <button class="action-link" type="button" data-action="toggle-active" data-id="${item.id}"><i data-lucide="${item.active ? "pause" : "play"}"></i><span>${item.active ? "Desativar" : "Ativar"}</span></button>
                    <button class="action-link" type="button" data-action="delete" data-collection="planning_items" data-id="${item.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
                  </div>
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function commitmentDetail(item) {
  const meta = parseFinanceMeta(item.notes);
  if (!meta.startMonth) return "todo mês";
  const duration = toNumber(meta.totalOccurrences) > 0 ? `${toNumber(meta.totalOccurrences)} meses` : "sem data para terminar";
  return `desde ${monthLabel(meta.startMonth)} · ${duration}`;
}

function marketPlanning(finance) {
  const editingGroup = state.editing.market_groups
    ? state.data.marketGroups.find((group) => group.id === state.editing.market_groups)
    : null;
  const editingHistory = state.editing.market_history
    ? state.data.marketHistory.find((entry) => entry.id === state.editing.market_history)
    : null;
  return `
    <section class="panel">
      <div class="panel-header"><div><h2 class="panel-title">Mercado estimado</h2><p class="panel-subtitle">Planejamento agregado por grandes categorias.</p></div></div>
      <div class="market-forecast">
        <strong>${formatCurrency(finance.market.nextForecast)}</strong>
        <span>Média dos últimos meses para prever o próximo mês.</span>
      </div>
      ${comparisonBars(finance.market.grouped)}
      ${lineChart(finance.market.history.map((entry) => ({ label: monthLabel(entry.month).slice(0, 3), value: entry.amount })), { color: "#d97706" })}
      <div class="split-list">
        ${state.data.marketGroups
          .map(
            (group) => `
              <div class="split-row">
                <span><strong>${escapeHtml(group.name)}</strong><span>Previsão do grupo</span></span>
                <span class="row-actions">
                  <strong>${formatCurrency(group.forecast)}</strong>
                  <button class="action-link" type="button" data-action="edit" data-collection="market_groups" data-id="${group.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
                  <button class="action-link" type="button" data-action="delete" data-collection="market_groups" data-id="${group.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
                </span>
              </div>
            `,
          )
          .join("") || `<div class="empty-state compact">Nenhum grupo de mercado cadastrado.</div>`}
      </div>
      ${marketGroupForm(editingGroup || {})}
      <div class="split-list">
        ${state.data.marketHistory
          .map(
            (entry) => `
              <div class="split-row">
                <span><strong>${escapeHtml(monthLabel(entry.month))}</strong><span>${escapeHtml(entry.notes || "Histórico de mercado")}</span></span>
                <span class="row-actions">
                  <strong>${formatCurrency(entry.amount)}</strong>
                  <button class="action-link" type="button" data-action="edit" data-collection="market_history" data-id="${entry.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
                  <button class="action-link" type="button" data-action="delete" data-collection="market_history" data-id="${entry.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
                </span>
              </div>
            `,
          )
          .join("") || `<div class="empty-state compact">Nenhum histórico de mercado cadastrado.</div>`}
      </div>
      ${marketHistoryForm(editingHistory || {})}
    </section>
  `;
}

function marketGroupForm(record = {}) {
  return `
    <form class="record-form compact-form" id="marketGroupForm" data-form="market-group">
      <label class="form-group wide"><span class="form-label">Grupo de mercado</span><input name="name" value="${escapeHtml(record.name || "")}" required /></label>
      <label class="form-group"><span class="form-label">Previsão</span><input name="forecast" ${moneyInputAttributes()} value="${escapeHtml(record.forecast || "")}" required /></label>
      <div class="form-actions">
        ${record.id ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="market_groups"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
        <button class="button secondary" type="submit"><i data-lucide="save"></i><span>${record.id ? "Salvar grupo" : "Adicionar grupo"}</span></button>
      </div>
    </form>
  `;
}

function marketHistoryForm(record = {}) {
  return `
    <form class="record-form compact-form" id="marketHistoryForm" data-form="market-history">
      <label class="form-group"><span class="form-label">Mês</span><input name="month" type="month" value="${escapeHtml(record.month || state.month)}" required /></label>
      <label class="form-group"><span class="form-label">Valor real</span><input name="amount" ${moneyInputAttributes()} value="${escapeHtml(record.amount || "")}" required /></label>
      <label class="form-group wide"><span class="form-label">Observações</span><input name="notes" value="${escapeHtml(record.notes || "")}" /></label>
      <div class="form-actions">
        ${record.id ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="market_history"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
        <button class="button secondary" type="submit"><i data-lucide="save"></i><span>${record.id ? "Salvar histórico" : "Adicionar histórico"}</span></button>
      </div>
    </form>
  `;
}

function planningForm(record = {}) {
  return `
    <form class="record-form" data-form="planning">
      <label class="form-group wide"><span class="form-label">Nome</span><input name="name" value="${escapeHtml(record.name || "")}" required /></label>
      <label class="form-group"><span class="form-label">Valor previsto</span><input name="amount" ${moneyInputAttributes()} value="${escapeHtml(record.amount || "")}" required /></label>
      <label class="form-group"><span class="form-label">Dia</span><input name="day" type="number" min="1" max="31" value="${escapeHtml(record.day || "")}" required /></label>
      <label class="form-group"><span class="form-label">Categoria</span><select name="categoryId">${categoryOptions(record.categoryId || "")}</select></label>
      <label class="form-group"><span class="form-label">Conta</span><select name="accountId">${accountOptions(record.accountId || state.data.settings.mainAccountId, true)}</select></label>
      <label class="form-group"><span class="form-label">Pagamento</span><select name="paymentMethod">${options(paymentMethods, record.paymentMethod || "PIX")}</select></label>
      <label class="form-group"><span class="form-label">Cartão</span><select name="cardId">${cardOptions(record.cardId || "", true)}</select></label>
      <label class="form-group"><span class="form-label">Ativo</span><span class="checkbox-row"><input name="active" type="checkbox" ${record.active ?? true ? "checked" : ""} /><span>Sim</span></span></label>
      <label class="form-group full"><span class="form-label">Observações</span><textarea name="notes">${escapeHtml(visibleNotes(record.notes))}</textarea></label>
      <div class="form-actions">
        ${record.id ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="planning_items"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
        <button class="button" type="submit"><i data-lucide="save"></i><span>${record.id ? "Salvar planejamento" : "Adicionar planejamento"}</span></button>
      </div>
    </form>
  `;
}

function renderInvestments() {
  const finance = calculateFinance(state.data, state.month);
  const editing = state.editing.investments ? state.data.investments.find((item) => item.id === state.editing.investments) : null;
  const editingHistory = state.editing.investment_history
    ? state.data.investmentHistory.find((item) => item.id === state.editing.investment_history)
    : null;
  return `
    <section class="module-page">
      <section class="metric-grid">
        ${metricCard({ label: "Patrimônio investido", value: formatCurrency(finance.investments.total), icon: "trending-up", tone: "positive" })}
        ${metricCard({ label: "Rendimento estimado", value: formatCurrency(finance.investments.estimatedYield), icon: "percent", tone: "positive" })}
        ${metricCard({ label: "Rendimento real", value: formatCurrency(finance.investments.realYield), icon: "activity", tone: "positive" })}
        ${metricCard({ label: "Patrimônio total", value: formatCurrency(finance.patrimonioTotal), icon: "wallet" })}
      </section>
      <section class="dashboard-grid">
        ${panel({ title: "Evolução", subtitle: "Histórico do valor investido.", span: 7, body: lineChart(finance.investments.history, { color: "#166534" }) })}
        ${panel({ title: "Distribuição", subtitle: "Por tipo de investimento.", span: 5, body: donutChart(finance.investments.distribution, { centerLabel: "Investido" }) })}
      </section>
      <section class="table-panel">
        <div class="table-header"><div><h3 class="table-title">Aplicações</h3><p class="table-subtitle">${state.data.investments.length} investimento(s)</p></div></div>
        <div class="table-wrap">
          <table><thead><tr><th>Investimento</th><th>Tipo</th><th>Valor</th><th>Rend. est.</th><th>Rend. real</th><th>Liquidez</th><th>Ações</th></tr></thead>
          <tbody>${state.data.investments
            .map(
              (item) => `
                <tr>
                  <td><span class="cell-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.institution)}</span></span></td>
                  <td>${escapeHtml(item.type)}</td>
                  <td class="amount positive">${formatCurrency(item.amount)}</td>
                  <td>${toNumber(item.estimatedYield).toFixed(2)}%</td>
                  <td>${toNumber(item.realYield).toFixed(2)}%</td>
                  <td>${escapeHtml(item.liquidity)}</td>
                  <td><div class="row-actions">
                    <button class="action-link" type="button" data-action="edit" data-collection="investments" data-id="${item.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
                    <button class="action-link" type="button" data-action="delete" data-collection="investments" data-id="${item.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
                  </div></td>
                </tr>
              `,
            )
            .join("") || `<tr><td colspan="7">Nenhum investimento cadastrado.</td></tr>`}</tbody></table>
        </div>
      </section>
      <section class="form-panel" id="investmentForm">
        <div class="panel-header"><div><h2 class="panel-title">${editing ? "Editar investimento" : "Novo investimento"}</h2><p class="panel-subtitle">Cadastre aplicações reais e acompanhe o patrimônio.</p></div></div>
        ${investmentForm(editing || {})}
      </section>
      <section class="form-panel" id="investmentHistoryForm">
        <div class="panel-header"><div><h2 class="panel-title">Evolução do patrimônio</h2><p class="panel-subtitle">Registre o total investido no fechamento de cada mês para alimentar o gráfico.</p></div></div>
        <form class="record-form" data-form="investment-history">
          <label class="form-group"><span class="form-label">Mês</span><input name="month" type="month" value="${escapeHtml(editingHistory?.month || state.month)}" required /></label>
          <label class="form-group"><span class="form-label">Total investido</span><input name="amount" ${moneyInputAttributes()} value="${escapeHtml(editingHistory?.amount || finance.investments.total || "")}" required /></label>
          <div class="form-actions">
            ${editingHistory ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="investment_history"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
            <button class="button" type="submit"><i data-lucide="save"></i><span>${editingHistory ? "Atualizar mês" : "Registrar mês"}</span></button>
          </div>
        </form>
        <div class="split-list">
          ${[...state.data.investmentHistory].sort((a, b) => b.month.localeCompare(a.month)).map((entry) => `<div class="split-row"><span><strong>${escapeHtml(monthLabel(entry.month))}</strong><span>${formatCurrency(entry.amount)}</span></span><span class="row-actions"><button class="action-link" type="button" data-action="edit" data-collection="investment_history" data-id="${entry.id}"><i data-lucide="pencil"></i><span>Editar</span></button><button class="action-link" type="button" data-action="delete" data-collection="investment_history" data-id="${entry.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button></span></div>`).join("") || `<div class="empty-state compact">Nenhum fechamento mensal registrado.</div>`}
        </div>
      </section>
    </section>
  `;
}

function investmentForm(record = {}) {
  return `
    <form class="record-form" data-form="investment">
      <label class="form-group wide"><span class="form-label">Nome</span><input name="name" value="${escapeHtml(record.name || "")}" required /></label>
      <label class="form-group"><span class="form-label">Tipo</span><input name="type" value="${escapeHtml(record.type || "Renda fixa")}" required /></label>
      <label class="form-group"><span class="form-label">Valor</span><input name="amount" ${moneyInputAttributes()} value="${escapeHtml(record.amount || "")}" required /></label>
      <label class="form-group"><span class="form-label">Rend. estimado (%)</span><input name="estimatedYield" type="number" step="0.01" value="${escapeHtml(record.estimatedYield || "")}" /></label>
      <label class="form-group"><span class="form-label">Rend. real (%)</span><input name="realYield" type="number" step="0.01" value="${escapeHtml(record.realYield || "")}" /></label>
      <label class="form-group"><span class="form-label">Instituição</span><input name="institution" value="${escapeHtml(record.institution || "")}" /></label>
      <label class="form-group"><span class="form-label">Liquidez</span><input name="liquidity" value="${escapeHtml(record.liquidity || "")}" /></label>
      <label class="form-group"><span class="form-label">Aplicação</span><input name="applicationDate" type="date" value="${escapeHtml(record.applicationDate || "")}" /></label>
      <label class="form-group"><span class="form-label">Vencimento</span><input name="maturityDate" type="date" value="${escapeHtml(record.maturityDate || "")}" /></label>
      <label class="form-group full"><span class="form-label">Observações</span><textarea name="notes">${escapeHtml(record.notes || "")}</textarea></label>
      <div class="form-actions">
        ${record.id ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="investments"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
        <button class="button" type="submit"><i data-lucide="save"></i><span>${record.id ? "Salvar investimento" : "Adicionar investimento"}</span></button>
      </div>
    </form>
  `;
}

function renderGoals() {
  const finance = calculateFinance(state.data, state.month);
  const categories = finance.categoryBudgets;
  const totalGoal = categories.reduce((total, category) => total + toNumber(category.budget), 0);
  const totalSpent = categories.reduce((total, category) => total + category.spent, 0);
  const totalCommitted = categories.reduce((total, category) => total + category.committed, 0);
  const exceededGoals = categories.filter((category) => category.exceeded > 0).length;

  return `
    <section class="module-page">
      <section class="module-summary">
        <article class="mini-card"><span>Gasto no mês</span><strong>${formatCurrency(totalSpent)}</strong></article>
        <article class="mini-card"><span>Já comprometido</span><strong>${formatCurrency(totalCommitted)}</strong></article>
        <article class="mini-card"><span>Meta total</span><strong>${formatCurrency(totalGoal)}</strong></article>
        <article class="mini-card"><span>Disponível</span><strong>${formatCurrency(Math.max(0, totalGoal - totalSpent - totalCommitted))}</strong><small>${exceededGoals ? `${exceededGoals} acima da meta` : "Todas sob controle"}</small></article>
      </section>

      <section class="goals-list">
        ${
          categories.length
            ? categories.map((category) => goalRow(category)).join("")
            : `<div class="empty-state">Nenhuma categoria de gasto cadastrada.</div>`
        }
      </section>
    </section>
  `;
}

function goalRow(category) {
  const goal = toNumber(category.budget);
  const spent = category.spent;
  const committed = category.committed;
  const used = spent + committed;
  const remaining = goal - used;
  const progress = goal > 0 ? used / goal : 0;
  const progressWidth = Math.min(100, progress * 100);
  const status =
    goal <= 0
      ? { label: "Sem meta", variant: "neutral" }
      : used > goal
        ? { label: "Meta excedida", variant: "danger" }
        : used === goal
          ? { label: "Meta atingida", variant: "warning" }
        : progress >= 0.8
          ? { label: "Próximo da meta", variant: "warning" }
          : { label: "Dentro da meta", variant: "success" };

  return `
    <article class="goal-row">
      <div class="goal-heading">
        <span class="legend-dot" style="background:${escapeHtml(category.color)}"></span>
        <div>
          <strong>${escapeHtml(category.name)}</strong>
          <span>${escapeHtml(monthLabel(state.month))}</span>
        </div>
      </div>

      <div class="goal-overview">
        <div class="goal-values">
          <span><small>Gasto</small><strong>${formatCurrency(spent)}</strong></span>
          <span><small>Comprometido</small><strong>${formatCurrency(committed)}</strong></span>
          <span><small>Meta</small><strong>${goal > 0 ? formatCurrency(goal) : "Não definida"}</strong></span>
          <span>
            <small>${remaining >= 0 ? "Restante" : "Excedido"}</small>
            <strong class="${remaining < 0 ? "negative" : ""}">${goal > 0 ? formatCurrency(Math.abs(remaining)) : "—"}</strong>
          </span>
        </div>
        <div class="goal-progress">
          <div class="progress-meta">
            <span>Progresso mensal</span>
            <strong>${goal > 0 ? formatPercent(progress) : "Sem limite"}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${used > goal && goal > 0 ? "is-over" : ""}" style="width:${progressWidth}%;background:${escapeHtml(category.color)}"></div>
          </div>
          <div class="goal-status">
            ${badge(status.label, status.variant)}
          </div>
        </div>
      </div>

      <div class="goal-settings">
        <form class="goal-form" data-form="goal" data-category-id="${escapeHtml(category.id)}">
          <label class="form-group">
            <span class="form-label">Meta mensal</span>
            <input name="budget" ${moneyInputAttributes()} value="${escapeHtml(goal || "")}" aria-label="Meta mensal de ${escapeHtml(category.name)}" />
          </label>
          <button class="button small" type="submit">
            <i data-lucide="save"></i>
            <span>Salvar</span>
          </button>
        </form>
      </div>
    </article>
  `;
}

function renderCategories() {
  const editing = state.editing.categories ? state.data.categories.find((category) => category.id === state.editing.categories) : null;
  return `
    <section class="module-page">
      <section class="category-grid">
        ${state.data.categories
          .map(
            (category) => `
              <article class="category-chip-card">
                <span class="legend-dot" style="background:${escapeHtml(category.color)}"></span>
                <div>
                  <strong>${escapeHtml(category.name)}</strong>
                  <span>${escapeHtml(titleCase(category.type))} · orçamento ${formatCurrency(category.budget)}</span>
                </div>
                <button class="action-link category-edit" type="button" data-action="edit" data-collection="categories" data-id="${category.id}" aria-label="Editar categoria ${escapeHtml(category.name)}">
                  <i data-lucide="pencil"></i>
                </button>
                <button class="action-link category-delete" type="button" data-action="delete" data-collection="categories" data-id="${category.id}" aria-label="Excluir categoria ${escapeHtml(category.name)}">
                  <i data-lucide="trash-2"></i>
                </button>
              </article>
            `,
          )
          .join("") || `<div class="empty-state">Nenhuma categoria cadastrada.</div>`}
      </section>
      <section class="form-panel" id="categoryForm">
        <div class="panel-header"><div><h2 class="panel-title">${editing ? "Editar categoria" : "Nova categoria"}</h2><p class="panel-subtitle">Use categorias para orçamento e previsões automáticas.</p></div></div>
        ${categoryForm(editing || {})}
      </section>
    </section>
  `;
}

function categoryForm(record = {}) {
  return `
    <form class="record-form" data-form="category">
      <label class="form-group wide"><span class="form-label">Nome</span><input name="name" value="${escapeHtml(record.name || "")}" required /></label>
      <label class="form-group"><span class="form-label">Tipo</span><select name="type">${options(["income", "expense", "investment", "mixed"].map((type) => ({ value: type, label: titleCase(type) })), record.type || "expense")}</select></label>
      <label class="form-group"><span class="form-label">Orçamento mensal</span><input name="budget" ${moneyInputAttributes()} value="${escapeHtml(record.budget || "")}" /></label>
      <label class="form-group"><span class="form-label">Cor</span><input name="color" type="color" value="${escapeHtml(record.color || "#0f766e")}" /></label>
      <div class="form-actions">
        ${record.id ? `<button class="button ghost" type="button" data-action="cancel-edit" data-collection="categories"><i data-lucide="x"></i><span>Cancelar</span></button>` : ""}
        <button class="button" type="submit"><i data-lucide="save"></i><span>${record.id ? "Salvar categoria" : "Adicionar categoria"}</span></button>
      </div>
    </form>
  `;
}

function renderSettings() {
  return `
    <section class="module-page">
      <section class="panel">
        <div class="panel-header"><div><h2 class="panel-title">Família</h2><p class="panel-subtitle">Dados compartilhados entre usuários do mesmo household.</p></div></div>
        <div class="split-list">
          <div class="split-row">
            <span><strong>${escapeHtml(state.data.household?.name || "Minha família")}</strong><span>Família atual</span></span>
            ${badge(`${state.data.members?.length || 1} membro(s)`, "success")}
          </div>
          ${(state.data.members || [])
            .map(
              (member) => `
                <div class="split-row">
                  <span><strong>${escapeHtml(member.displayName)}</strong><span>${escapeHtml(member.id === state.user?.id ? "Você" : "Membro")}</span></span>
                  ${badge(member.role === "owner" ? "Dono" : "Membro", member.role === "owner" ? "success" : "neutral")}
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="backup-actions" style="margin-top:14px">
          <button class="button ghost" type="button" data-action="logout"><i data-lucide="log-out"></i><span>Sair</span></button>
        </div>
      </section>
      <section class="form-panel elevated">
        <div class="panel-header"><div><h2 class="panel-title">Preferências do assistente</h2><p class="panel-subtitle">Ajustes usados nas previsões e alertas.</p></div></div>
        <form class="record-form" data-form="settings">
          <label class="form-group"><span class="form-label">Conta principal</span><select name="mainAccountId">${accountOptions(state.data.settings.mainAccountId)}</select></label>
          <label class="form-group"><span class="form-label">Avisar quando a categoria atingir (%)</span><input name="highSpendingAlertRate" type="number" min="1" max="100" step="1" value="${escapeHtml(Math.round(toNumber(state.data.settings.highSpendingAlertRate) * 100))}" /></label>
          <label class="form-group"><span class="form-label">Mercado padrão</span><input name="defaultMarketForecast" ${moneyInputAttributes()} value="${escapeHtml(state.data.settings.defaultMarketForecast)}" /></label>
          <label class="form-group"><span class="form-label">Meses para média</span><input name="forecastMonths" type="number" min="1" value="${escapeHtml(state.data.settings.forecastMonths)}" /></label>
          <div class="form-actions"><button class="button" type="submit"><i data-lucide="save"></i><span>Salvar configurações</span></button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header"><div><h2 class="panel-title">Backup</h2><p class="panel-subtitle">Os dados principais agora ficam no Supabase. O JSON serve como cópia manual.</p></div></div>
        <div class="backup-actions">
          <button class="button secondary" type="button" data-action="export"><i data-lucide="download"></i><span>Exportar JSON</span></button>
        </div>
      </section>
    </section>
  `;
}

function readForm(form) {
  const formData = new FormData(form);
  const raw = Object.fromEntries(formData.entries());
  form.querySelectorAll("[data-money-input]").forEach((input) => {
    raw[input.name] = parseMoneyInput(input.value);
  });
  return raw;
}

function parseMoneyInput(value) {
  const cleaned = String(value || "").replace(/[^\d,.-]/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? String(number) : "";
}

function moneyInputAttributes() {
  return `type="text" inputmode="decimal" data-money-input`;
}

function formatMoneyInput(input) {
  const raw = parseMoneyInput(input.value);
  if (!raw) return;
  input.value = formatCurrency(Number(raw));
}

function editMoneyInput(input) {
  const raw = parseMoneyInput(input.value);
  if (!raw) return;
  input.value = raw.replace(".", ",");
  input.select();
}

function formatMoneyInputs(root = appRoot) {
  root.querySelectorAll("[data-money-input]").forEach(formatMoneyInput);
}

function cardPurchaseNotes(card, date, notes = "", source = "transaction", previousNotes = "") {
  const spendingMonth = String(date || "").slice(0, 7) || state.month;
  const statementMonth = firstCardInvoiceMonth(card, date);
  const previousMeta = parseFinanceMeta(previousNotes);
  return withFinanceMeta(notes, {
    ...previousMeta,
    source,
    spendingMonth,
    statementMonth,
    invoiceMonth: statementMonth,
    dueDate: makeDate(statementMonth, card?.dueDay || 1),
  });
}

function normalizeTransaction(raw, previous = {}) {
  const paymentMethod = raw.paymentMethod || "PIX";
  let type = raw.type || previous.type || "expense";
  if (paymentMethod === "Cartão crédito" && type === "expense") type = "card";
  if (type === "card" && !raw.cardId) raw.cardId = state.data.cards[0]?.id || "";
  const card = state.data.cards.find((item) => item.id === raw.cardId);
  if (type === "card" && !card) throw new Error("Selecione um cartão para a compra no crédito.");
  const date = raw.date || `${state.month}-01`;
  if (type === "transfer" && (!raw.fromAccountId || !raw.toAccountId)) throw new Error("Selecione as contas de origem e destino.");
  if (type === "transfer" && raw.fromAccountId === raw.toAccountId) throw new Error("A conta de destino deve ser diferente da origem.");
  return {
    ...previous,
    type,
    description: raw.description?.trim() || "Movimentação",
    amount: toNumber(raw.amount),
    date,
    categoryId: raw.categoryId,
    accountId: raw.accountId,
    fromAccountId: raw.fromAccountId || (type === "transfer" ? raw.accountId : ""),
    toAccountId: raw.toAccountId || "",
    paymentMethod,
    cardId: raw.cardId || "",
    linkedPlanningId: raw.linkedPlanningId || "",
    installments: Math.max(1, toNumber(raw.installments) || 1),
    currentInstallment: Math.max(1, toNumber(raw.currentInstallment) || 1),
    status: "confirmed",
    notes: type === "card"
      ? cardPurchaseNotes(card, date, raw.notes, "transaction-form", previous.notes)
      : raw.notes?.trim() || "",
  };
}

function transactionFromOccurrence(plan, raw) {
  const isCard = plan.paymentMethod === "Cartão crédito";
  return {
    id: uid("tx"),
    type: plan.type === "income" ? "income" : isCard ? "card" : "expense",
    description: plan.type === "income" ? `Recebi ${plan.name}` : `Paguei ${plan.name}`,
    amount: toNumber(raw.amount),
    date: raw.date,
    categoryId: plan.categoryId,
    accountId: plan.accountId,
    cardId: plan.cardId || "",
    paymentMethod: plan.paymentMethod,
    linkedPlanningId: plan.id,
    installments: 1,
    currentInstallment: 1,
    status: "confirmed",
    notes: raw.notes?.trim() || "",
  };
}

function transactionFromCardInvoice(card, invoiceId, raw) {
  return {
    id: uid("tx"),
    type: "transfer",
    description: `Pagamento da fatura ${card.name}`,
    amount: toNumber(raw.amount),
    date: raw.date,
    categoryId: "",
    accountId: card.accountId || "",
    fromAccountId: card.accountId || "",
    toAccountId: "",
    cardId: card.id,
    paymentMethod: "Pagamento de fatura",
    linkedPlanningId: "",
    installments: 1,
    currentInstallment: 1,
    status: "confirmed",
    notes: [invoiceId, raw.notes?.trim()].filter(Boolean).join(" · "),
  };
}

function inferPlanningKind(raw, previous = {}) {
  const category = state.data.categories.find((item) => item.id === raw.categoryId);
  const type = category?.type === "income" ? "income" : previous.type || "expense";
  const group = type === "income" ? "income" : previous.group === "subscription" ? "subscription" : "expense";
  return { group, type };
}

async function handleFormSubmit(form) {
  const kind = form.dataset.form;
  const raw = readForm(form);
  const householdId = state.householdId;
  const userId = state.user?.id;

  if (kind === "goal") {
    const category = state.data.categories.find((item) => item.id === form.dataset.categoryId);
    if (!category) return;
    await dbUpdate(
      "categories",
      category.id,
      toDbCategory({ ...category, budget: Math.max(0, toNumber(raw.budget)) }, householdId, userId),
    );
    await persist(`Meta de ${category.name} atualizada.`);
  }

  if (kind === "transaction") {
    const editingId = state.editing.transactions;
    const previous = editingId ? state.data.transactions.find((item) => item.id === editingId) : {};
    const payload = toDbTransaction(normalizeTransaction(raw, previous), householdId, userId);
    if (editingId) {
      await dbUpdate("transactions", editingId, payload);
      state.editing.transactions = "";
      await persist("Movimentação atualizada.");
    } else {
      await dbInsert("transactions", payload);
      await persist("Movimentação criada.");
    }
  }

  if (kind === "card-purchase") {
    const card = state.data.cards.find((item) => item.id === raw.cardId);
    await dbInsert("transactions", toDbTransaction({
      type: "card",
      description: raw.description.trim(),
      amount: toNumber(raw.amount),
      date: raw.date,
      categoryId: raw.categoryId,
      accountId: card?.accountId || state.data.settings.mainAccountId,
      cardId: raw.cardId,
      paymentMethod: "Cartão crédito",
      linkedPlanningId: "",
      installments: Math.max(1, toNumber(raw.installments) || 1),
      currentInstallment: 1,
      status: "confirmed",
      notes: cardPurchaseNotes(card, raw.date, raw.notes, "card-form"),
    }, householdId, userId));
    await persist("Compra adicionada ao cartão.");
  }

  if (kind === "card") {
    const editingId = state.editing.cards;
    const previous = editingId ? state.data.cards.find((item) => item.id === editingId) : {};
    const payload = toDbCard({
      ...previous,
      name: raw.name.trim(),
      accountId: raw.accountId || "",
      limitTotal: toNumber(raw.limitTotal),
      closingDay: Math.max(1, Math.min(31, toNumber(raw.closingDay))),
      dueDay: Math.max(1, Math.min(31, toNumber(raw.dueDay))),
      status: raw.status || "aberta",
      notes: raw.notes?.trim() || "",
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("cards", editingId, payload);
      state.editing.cards = "";
      await persist("Cartão atualizado.");
    } else {
      await dbInsert("cards", payload);
      await persist("Cartão criado.");
    }
  }

  if (kind === "planning") {
    const editingId = state.editing.planning_items;
    const previous = editingId ? state.data.planningItems.find((item) => item.id === editingId) : {};
    const planningKind = inferPlanningKind(raw, previous);
    const payload = toDbPlanning({
      ...previous,
      group: planningKind.group,
      type: planningKind.type,
      name: raw.name.trim(),
      amount: toNumber(raw.amount),
      recurrence: "monthly",
      day: Math.max(1, Math.min(31, toNumber(raw.day))),
      categoryId: raw.categoryId,
      accountId: raw.accountId,
      paymentMethod: raw.paymentMethod,
      cardId: raw.cardId || "",
      active: Boolean(raw.active),
      notes: Object.keys(parseFinanceMeta(previous.notes)).length
        ? withFinanceMeta(raw.notes, parseFinanceMeta(previous.notes))
        : raw.notes?.trim() || "",
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("planning_items", editingId, payload);
      state.editing.planning_items = "";
      await persist("Planejamento atualizado.");
    } else {
      await dbInsert("planning_items", payload);
      await persist("Planejamento recorrente criado.");
    }
  }

  if (kind === "account") {
    const editingId = state.editing.accounts;
    const previous = editingId ? state.data.accounts.find((item) => item.id === editingId) : {};
    const payload = toDbAccount({
      ...previous,
      name: raw.name.trim(),
      institution: raw.institution?.trim() || raw.name.trim(),
      type: raw.type?.trim() || "Conta secundária",
      balance: toNumber(raw.balance),
      isPrimary: Boolean(raw.isPrimary),
      notes: raw.notes?.trim() || "",
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("accounts", editingId, payload);
      state.editing.accounts = "";
      await persist("Conta atualizada.");
    } else {
      await dbInsert("accounts", payload);
      await persist("Conta adicionada.");
    }
  }

  if (kind === "category") {
    const editingId = state.editing.categories;
    const previous = editingId ? state.data.categories.find((item) => item.id === editingId) : {};
    const payload = toDbCategory({
      ...previous,
      name: raw.name.trim(),
      type: raw.type,
      color: raw.color || "#0f766e",
      budget: toNumber(raw.budget),
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("categories", editingId, payload);
      state.editing.categories = "";
      await persist("Categoria atualizada.");
    } else {
      await dbInsert("categories", payload);
      await persist("Categoria adicionada.");
    }
  }

  if (kind === "investment") {
    const editingId = state.editing.investments;
    const previous = editingId ? state.data.investments.find((item) => item.id === editingId) : {};
    const payload = toDbInvestment({
      ...previous,
      name: raw.name.trim(),
      type: raw.type.trim(),
      amount: toNumber(raw.amount),
      estimatedYield: toNumber(raw.estimatedYield),
      realYield: toNumber(raw.realYield),
      applicationDate: raw.applicationDate || "",
      maturityDate: raw.maturityDate || "",
      institution: raw.institution?.trim() || "",
      liquidity: raw.liquidity?.trim() || "",
      notes: raw.notes?.trim() || "",
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("investments", editingId, payload);
      state.editing.investments = "";
      await persist("Investimento atualizado.");
    } else {
      await dbInsert("investments", payload);
      await persist("Investimento adicionado.");
    }
  }

  if (kind === "investment-history") {
    const editingId = state.editing.investment_history;
    const previous = editingId ? state.data.investmentHistory.find((item) => item.id === editingId) : {};
    const payload = toDbInvestmentHistory({
      ...previous,
      month: raw.month,
      amount: toNumber(raw.amount),
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("investment_history", editingId, payload);
      state.editing.investment_history = "";
      await persist("Histórico de investimento atualizado.");
    } else {
      await dbInsert("investment_history", payload);
      await persist("Fechamento de investimento registrado.");
    }
  }

  if (kind === "market-group") {
    const editingId = state.editing.market_groups;
    const previous = editingId ? state.data.marketGroups.find((item) => item.id === editingId) : {};
    const payload = toDbMarketGroup({
      ...previous,
      name: raw.name.trim(),
      forecast: toNumber(raw.forecast),
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("market_groups", editingId, payload);
      state.editing.market_groups = "";
      await persist("Grupo de mercado atualizado.");
    } else {
      await dbInsert("market_groups", payload);
      await persist("Grupo de mercado adicionado.");
    }
  }

  if (kind === "market-history") {
    const editingId = state.editing.market_history;
    const previous = editingId ? state.data.marketHistory.find((item) => item.id === editingId) : {};
    const payload = toDbMarketHistory({
      ...previous,
      month: raw.month,
      amount: toNumber(raw.amount),
      notes: raw.notes?.trim() || "",
    }, householdId, userId);
    if (editingId) {
      await dbUpdate("market_history", editingId, payload);
      state.editing.market_history = "";
      await persist("Histórico de mercado atualizado.");
    } else {
      await dbInsert("market_history", payload);
      await persist("Histórico de mercado adicionado.");
    }
  }

  if (kind === "settings") {
    const settings = {
      mainAccountId: raw.mainAccountId,
      highSpendingAlertRate: Math.max(0.01, Math.min(1, toNumber(raw.highSpendingAlertRate) / 100)),
      defaultMarketForecast: toNumber(raw.defaultMarketForecast),
      forecastMonths: Math.max(1, toNumber(raw.forecastMonths)),
    };
    await dbUpdate("household_settings", householdId, toDbSettings(settings), "household_id");
    await persist("Configurações salvas.");
  }
}

function setSidebarOpen(open) {
  sidebar.classList.toggle("open", open);
  document.body.classList.toggle("sidebar-open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
}

menuToggle.addEventListener("click", () => setSidebarOpen(!sidebar.classList.contains("open")));
sidebarClose.addEventListener("click", () => setSidebarOpen(false));
sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));

sidebarNav.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton?.dataset.action === "logout") {
    if (LOCAL_AUTH_BYPASS) {
      showToast("Modo local temporário ativo.");
      return;
    }
    await signOut();
    resetAuthenticatedState();
    setRoute("dashboard", true);
    setSidebarOpen(false);
    render();
    return;
  }

  const button = event.target.closest("[data-route]");
  if (!button) return;
  setRoute(button.dataset.route, false);
  state.editing = {};
  window.location.hash = `#/${state.route}`;
  setSidebarOpen(false);
  render();
});

monthSelect.addEventListener("change", setMonthFromControls);
yearInput.addEventListener("change", setMonthFromControls);

document.querySelector("#monthPrev").addEventListener("click", () => {
  setMonth(addMonths(state.month, -1));
});

document.querySelector("#monthNext").addEventListener("click", () => {
  setMonth(addMonths(state.month, 1));
});

document.querySelector("#monthToday").addEventListener("click", () => {
  setMonth(currentMonth());
});

quickAddButton.addEventListener("click", () => {
  state.quickAddOpen = true;
  state.quickAddPreset = null;
  renderQuickAddModal();
});

modalRoot.addEventListener("click", (event) => {
  const close = event.target.closest('[data-action="close-quick-add"]');
  if (!close) return;
  if (close.classList.contains("modal-backdrop") && event.target !== close) return;
  state.quickAddOpen = false;
  state.quickAddPreset = null;
  renderQuickAddModal();
});

modalRoot.addEventListener("change", (event) => {
  if (event.target.closest('[data-form="universal-entry"]')) updateUniversalFormVisibility();
});

modalRoot.addEventListener("submit", async (event) => {
  const form = event.target.closest('[data-form="universal-entry"]');
  if (!form) return;
  event.preventDefault();
  setSaving(true);
  const submitter = event.submitter;
  form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    await saveUniversalEntry(form, submitter?.dataset.keepOpen === "true");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível salvar.");
    setSaving(false);
    form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
});

modalRoot.addEventListener("focus", (event) => {
  const input = event.target.closest?.("[data-money-input]");
  if (input) editMoneyInput(input);
}, true);

modalRoot.addEventListener("blur", (event) => {
  const input = event.target.closest?.("[data-money-input]");
  if (input) formatMoneyInput(input);
}, true);

document.addEventListener("keydown", (event) => {
  if (state.quickAddOpen && event.key === "Tab") {
    const focusable = [...modalRoot.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')]
      .filter((element) => !element.closest(".is-hidden"));
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  if (event.key !== "Escape") return;
  if (state.quickAddOpen) {
    state.quickAddOpen = false;
    state.quickAddPreset = null;
    renderQuickAddModal();
  }
  if (sidebar.classList.contains("open")) setSidebarOpen(false);
});

appRoot.addEventListener("submit", async (event) => {
  pendingScrollRestore = captureScrollState(document.activeElement);
  const authForm = event.target.closest('[data-form="auth-login"]');
  if (authForm) {
    event.preventDefault();
    const loginButton = authForm.querySelector('button[type="submit"]');
    if (loginButton) loginButton.disabled = true;
    setSaving(true);
    const raw = readForm(authForm);
    try {
      const response = await signIn(raw.email, raw.password);
      if (response.error) throw response.error;
      state.user = response.data.user || (await getSessionUser());
      if (state.user) await initializeForUser(state.user, { redirectToDashboard: true });
      showToast("Login realizado.");
      setSaving(false);
    } catch (error) {
      console.error(error);
      showToast(authErrorMessage(error));
      setSaving(false);
      if (loginButton) loginButton.disabled = false;
    }
    pendingScrollRestore = null;
    return;
  }

  const cardInvoiceForm = event.target.closest("[data-card-invoice-id]");
  if (cardInvoiceForm) {
    event.preventDefault();
    setSaving(true);
    const card = state.data.cards.find((item) => item.id === cardInvoiceForm.dataset.cardId);
    if (!card) return;
    try {
      await dbInsert(
        "transactions",
        toDbTransaction(
          transactionFromCardInvoice(card, cardInvoiceForm.dataset.cardInvoiceId, readForm(cardInvoiceForm)),
          state.householdId,
          state.user.id,
        ),
      );
      await persist("Fatura paga.");
    } catch (error) {
      pendingScrollRestore = null;
      console.error(error);
      showToast(error.message || "Não foi possível pagar a fatura.");
      setSaving(false);
    }
    return;
  }

  const pendingForm = event.target.closest("[data-pending-id]");
  if (pendingForm) {
    event.preventDefault();
    setSaving(true);
    const plan = state.data.planningItems.find((item) => item.id === pendingForm.dataset.pendingId);
    if (!plan) return;
    try {
      await dbInsert("transactions", toDbTransaction(transactionFromOccurrence(plan, readForm(pendingForm)), state.householdId, state.user.id));
      await persist(plan.type === "income" ? "Receita realizada." : "Despesa paga.");
    } catch (error) {
      pendingScrollRestore = null;
      console.error(error);
      showToast(error.message || "Não foi possível criar a movimentação.");
      setSaving(false);
    }
    return;
  }

  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  setSaving(true);
  form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = true; });
  try {
    await handleFormSubmit(form);
  } catch (error) {
    pendingScrollRestore = null;
    console.error(error);
    showToast(error.message || "Não foi possível salvar.");
    setSaving(false);
    form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = false; });
  }
});

appRoot.addEventListener(
  "focus",
  (event) => {
    const input = event.target.closest?.("[data-money-input]");
    if (input) editMoneyInput(input);
  },
  true,
);

appRoot.addEventListener(
  "blur",
  (event) => {
    const input = event.target.closest?.("[data-money-input]");
    if (input) formatMoneyInput(input);
  },
  true,
);

appRoot.addEventListener("change", (event) => {
  const transactionType = event.target.closest('[data-form="transaction"] [name="type"]');
  if (transactionType) {
    transactionType.form.querySelectorAll('[data-transaction-field="transfer"]').forEach((field) => {
      field.classList.toggle("is-hidden", transactionType.value !== "transfer");
    });
  }
  const filter = event.target.closest("[data-transaction-filter]");
  if (!filter) return;
  const key = filter.dataset.transactionFilter;
  const previous = state.filters.transactions || { scope: "all", accountId: "", cardId: "", categoryId: "" };
  const next = { ...previous, [key]: filter.value };
  if (key === "scope") {
    next.accountId = "";
    next.cardId = "";
  }
  state.filters.transactions = next;
  render();
});

appRoot.addEventListener("input", (event) => {
  if (event.target.closest("form") && !event.target.matches("[data-transaction-search]")) state.formDirty = true;
  const search = event.target.closest("[data-transaction-search]");
  if (!search) return;
  state.query = search.value;
  const finance = calculateFinance(state.data, state.month);
  const records = filteredTransactions(monthlyTransactionRecords(finance));
  const results = appRoot.querySelector("[data-transaction-results]");
  if (results) results.innerHTML = transactionsTable(records);
  const count = appRoot.querySelector(".transactions-list-panel .table-subtitle");
  if (count) count.textContent = `${records.length} lançamento(s) encontrados`;
  refreshIcons();
});

appRoot.addEventListener("click", async (event) => {
  const monthTarget = event.target.closest("[data-month]");
  if (monthTarget) {
    setMonth(monthTarget.dataset.month);
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "forgot-password") {
    const email = appRoot.querySelector('[data-form="auth-login"] [name="email"]')?.value.trim();
    if (!email) { showToast("Informe seu e-mail para recuperar a senha.", "error"); return; }
    try {
      setSaving(true);
      await requestPasswordReset(email, window.location.origin);
      showToast("Enviamos as instruções de recuperação para seu e-mail.");
    } catch (error) {
      showToast(error.message || "Não foi possível enviar a recuperação.", "error");
    } finally {
      setSaving(false);
    }
    return;
  }

  if (action === "go-pending") {
    window.location.hash = "#/pending";
    return;
  }

  if (action === "focus-pending") {
    const form = document.getElementById(target.dataset.pendingForm);
    form?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => form?.querySelector('[name="amount"]')?.focus(), 260);
    return;
  }

  if (action === "open-quick-add") {
    state.quickAddOpen = true;
    state.quickAddPreset = null;
    renderQuickAddModal();
    return;
  }

  if (action === "open-quick-add-loan") {
    state.quickAddOpen = true;
    state.quickAddPreset = { entryType: "loan", loanAction: "lend" };
    renderQuickAddModal();
    return;
  }

  if (action === "open-loan-repayment") {
    state.quickAddOpen = true;
    state.quickAddPreset = {
      entryType: "loan",
      loanAction: "repayment",
      personKey: target.dataset.personKey,
      personName: target.dataset.personName,
    };
    renderQuickAddModal();
    return;
  }

  if (action === "edit") {
    const scrollState = captureScrollState(target);
    state.editing[target.dataset.collection] = target.dataset.id;
    render();
    restoreScrollState(scrollState);
  }

  if (action === "cancel-edit") {
    state.editing[target.dataset.collection] = "";
    render();
  }

  if (action === "delete") {
    if (!(await confirmAction({ title: "Excluir registro?", message: "Esta ação não poderá ser desfeita.", confirmLabel: "Excluir", danger: true }))) return;
    const collection = target.dataset.collection;
    const tableMap = { transactions: "transactions" };
    try {
      await dbDelete(tableMap[collection] || collection, target.dataset.id);
      await persist("Registro excluído.");
    } catch (error) {
      console.error(error);
      if (error.code === "23503") {
        showToast("Registro em uso. Remova ou altere os vínculos antes de excluir.");
      } else {
        showToast(error.message || "Não foi possível excluir.");
      }
    }
  }

  if (action === "undo-pending") {
    if (!(await confirmAction({ title: "Desfazer confirmação?", message: "A movimentação criada para este compromisso será removida.", confirmLabel: "Desfazer", danger: true }))) return;
    try {
      await dbDelete("transactions", target.dataset.transactionId);
      await persist("Pagamento desfeito.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Não foi possível desfazer.");
    }
  }

  if (action === "toggle-active") {
    const item = state.data.planningItems.find((plan) => plan.id === target.dataset.id);
    if (!item) return;
    try {
      await dbUpdate("planning_items", item.id, toDbPlanning({ ...item, active: !item.active }, state.householdId, state.user.id));
      await persist(item.active ? "Planejamento desativado." : "Planejamento ativado.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Não foi possível alterar o planejamento.");
    }
  }

  if (action === "export") exportData(state.data);
  if (action === "logout") {
    if (LOCAL_AUTH_BYPASS) {
      showToast("Modo local temporário ativo.");
      return;
    }
    await signOut();
    resetAuthenticatedState();
    setRoute("dashboard", true);
    render();
  }
});

window.addEventListener("hashchange", () => {
  const route = window.location.hash.replace("#/", "") || "dashboard";
  if (route !== state.route) {
    state.route = route;
    render();
  }
});

onAuthChange(async (user) => {
  if (LOCAL_AUTH_BYPASS) return;
  if (!state.authReady) return;
  if (user && user.id !== state.user?.id) {
    await initializeForUser(user, { redirectToDashboard: true });
  }
  if (!user && state.user) {
    resetAuthenticatedState();
    setRoute("dashboard", true);
    render();
  }
});

bootstrap();
