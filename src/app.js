import { defaultData } from "./data.js";
import { exportData } from "./storage.js";
import {
  deleteRemote,
  getSessionUser,
  insertRemote,
  loadRemoteData,
  onAuthChange,
  signIn,
  signOut,
  subscribeToHousehold,
  toDbAccount,
  toDbCategory,
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
  dateInMonth,
  daysUntil,
  formatCurrency,
  formatDate,
  formatPercent,
  getAccountName,
  getCardName,
  getCategoryColor,
  getCategoryName,
  monthLabel,
  normalize,
  toNumber,
} from "./calculations.js";
import { barChart, comparisonBars, donutChart, groupedBarChart, lineChart } from "./charts.js";

const appRoot = document.querySelector("#appRoot");
const sidebar = document.querySelector("#sidebar");
const sidebarNav = document.querySelector("#sidebarNav");
const pageTitle = document.querySelector("#pageTitle");
const pageEyebrow = document.querySelector("#pageEyebrow");
const monthSelect = document.querySelector("#monthSelect");
const yearInput = document.querySelector("#yearInput");
const importFile = document.querySelector("#importFile");
const toast = document.querySelector("#toast");

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
};

async function initializeForUser(user) {
  state.user = user;
  const remote = await loadRemoteData(user);
  state.data = remote.data;
  state.householdId = remote.householdId;
  if (state.unsubscribeRealtime) state.unsubscribeRealtime();
  state.unsubscribeRealtime = subscribeToHousehold(state.householdId, async () => {
    await reloadRemote();
    render();
  });
  state.authReady = true;
  render();
}

async function bootstrap() {
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
    state.user = null;
    render();
    showToast("Não foi possível conectar ao Supabase.");
  }
}

const navItems = [
  { route: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { route: "pending", label: "Pendências do mês", icon: "list-checks" },
  { route: "transactions", label: "Movimentações", icon: "arrow-left-right" },
  { route: "accounts", label: "Contas bancárias", icon: "landmark" },
  { route: "cards", label: "Cartões", icon: "credit-card" },
  { route: "planning", label: "Planejamento", icon: "calendar-clock" },
  { route: "investments", label: "Investimentos", icon: "trending-up" },
  { route: "categories", label: "Categorias", icon: "tags" },
  { route: "settings", label: "Configurações", icon: "settings" },
];

const paymentMethods = ["PIX", "Cartão crédito", "Cartão débito", "Boleto", "Dinheiro", "Transferência", "Outro"];
const transactionTypes = ["income", "expense", "card", "transfer", "investment"];
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
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

async function reloadRemote() {
  if (!state.user) return;
  const remote = await loadRemoteData(state.user);
  state.data = remote.data;
  state.householdId = remote.householdId;
}

async function persist(message) {
  await reloadRemote();
  render();
  showToast(message);
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
    dashboard: ["Dashboard", "Situação financeira"],
    pending: ["Pendências do mês", "Planejado vs realizado"],
    transactions: ["Movimentações", "Eventos financeiros reais"],
    accounts: ["Contas bancárias", "Saldos e fluxo por conta"],
    cards: ["Cartões", "Faturas, limites e compras"],
    planning: ["Planejamento", "Recorrências e previsão"],
    investments: ["Investimentos", "Patrimônio investido"],
    categories: ["Categorias", "Classificação e orçamentos"],
    settings: ["Configurações", "Preferências do assistente"],
  };
  return map[route] || map.dashboard;
}

function renderNav() {
  sidebarNav.innerHTML = navItems
    .map(
      (item) => `
        <button class="nav-item ${state.route === item.route ? "active" : ""}" type="button" data-route="${item.route}">
          <i data-lucide="${item.icon}"></i>
          <span>${escapeHtml(item.label)}</span>
        </button>
      `,
    )
    .join("");
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
    refreshIcons();
    return;
  }

  if (!state.user) {
    document.body.classList.add("auth-mode");
    pageTitle.textContent = "Entrar";
    pageEyebrow.textContent = "Financeiro pessoal";
    sidebarNav.innerHTML = "";
    appRoot.innerHTML = renderAuth();
    refreshIcons();
    return;
  }

  const [title, eyebrow] = routeMeta(state.route);
  document.body.classList.remove("auth-mode");
  pageTitle.textContent = title;
  pageEyebrow.textContent = eyebrow;
  renderMonthSelector();
  renderNav();

  const routes = {
    dashboard: renderDashboard,
    pending: renderPending,
    transactions: renderTransactions,
    accounts: renderAccounts,
    cards: renderCards,
    planning: renderPlanning,
    investments: renderInvestments,
    categories: renderCategories,
    settings: renderSettings,
  };
  appRoot.innerHTML = (routes[state.route] || renderDashboard)();
  refreshIcons();
}

function renderAuth() {
  return `
    <section class="auth-shell">
      <article class="auth-card">
        <div class="brand auth-brand">
          <div class="brand-mark">FP</div>
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
        </form>
      </article>
    </section>
  `;
}

function renderDashboard() {
  const finance = calculateFinance(state.data, state.month);
  const highPriority = finance.todayTasks;
  const saldoTone = finance.saldoDisponivelReal >= 0 ? "positive" : "negative";

  return `
    <section class="command-center">
      <div class="availability-card">
        <span class="summary-kicker">Dinheiro realmente disponível em ${escapeHtml(monthLabel(state.month))}</span>
        <strong>${formatCurrency(finance.saldoDisponivelReal)}</strong>
        <p>Saldo atual menos pendências abertas.</p>
        <div class="availability-grid">
          <span><b>${formatCurrency(finance.saldoAtual)}</b> saldo atual</span>
          <span><b>${formatCurrency(finance.pendingExpense)}</b> gastos pendentes</span>
          <span><b>${formatCurrency(finance.saldoAposPendencias)}</b> após pendências</span>
        </div>
      </div>

      <div class="today-card">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Hoje preciso resolver</h2>
            <p class="panel-subtitle">Itens previstos que estão próximos ou vencidos.</p>
          </div>
        </div>
        <div class="task-list">
          ${
            highPriority.length
              ? highPriority.map((item) => dashboardTask(item)).join("")
              : `<div class="empty-state compact">Nenhuma pendência urgente nos próximos 7 dias.</div>`
          }
        </div>
      </div>
    </section>

    <section class="metric-grid dense">
      ${metricCard({
        label: "Receitas previstas",
        value: formatCurrency(finance.plannedIncome),
        note: `${formatCurrency(finance.pendingIncome)} ainda pendentes`,
        icon: "calendar-plus",
        tone: "positive",
      })}
      ${metricCard({
        label: "Despesas previstas",
        value: formatCurrency(finance.plannedExpense),
        note: `${formatCurrency(finance.pendingExpense)} ainda pendentes`,
        icon: "calendar-minus",
      })}
      ${metricCard({
        label: "Receitas realizadas",
        value: formatCurrency(finance.actualIncome),
        note: `${finance.doneOccurrences.filter((item) => item.type === "income").length} item(ns) conciliados`,
        icon: "circle-dollar-sign",
        tone: "positive",
      })}
      ${metricCard({
        label: "Despesas realizadas",
        value: formatCurrency(finance.actualExpense),
        note: `${formatPercent(finance.realizationRate)} do previsto`,
        icon: "receipt-text",
        tone: "negative",
      })}
      ${metricCard({
        label: "Saldo previsto final",
        value: formatCurrency(finance.saldoPrevistoFinal),
        note: "Saldo em contas após entradas e saídas pendentes",
        icon: "line-chart",
        tone: saldoTone,
      })}
      ${metricCard({
        label: "Saldo atual",
        value: formatCurrency(finance.saldoAtual),
        note: "Soma das contas cadastradas",
        icon: "landmark",
      })}
      ${metricCard({
        label: "Investimentos",
        value: formatCurrency(finance.investments.total),
        note: `${formatCurrency(finance.investments.realYield)} de rendimento real estimado`,
        icon: "trending-up",
        tone: "positive",
      })}
      ${metricCard({
        label: "Próximos pagamentos",
        value: finance.upcomingPayments.length,
        note: `${finance.upcomingSubscriptions.length} assinatura(s) próxima(s)`,
        icon: "bell",
      })}
    </section>

    <section class="dashboard-grid">
      ${panel({
        title: "Receitas x despesas",
        subtitle: "Realizado nos últimos meses.",
        span: 6,
        body: groupedBarChart(finance.monthlyEvolution),
      })}
      ${panel({
        title: "Previsto x realizado",
        subtitle: "O que estava planejado contra o que aconteceu.",
        span: 6,
        body: barChart(finance.plannedVsRealized),
      })}
      ${panel({
        title: "Gastos por categoria",
        subtitle: "Somente movimentações reais do mês.",
        span: 5,
        body: donutChart(finance.byCategory, { centerLabel: "Gastos" }),
      })}
      ${panel({
        title: "Evolução mensal",
        subtitle: "Saldo realizado mês a mês.",
        span: 7,
        body: lineChart(
          finance.monthlyEvolution.map((item) => ({ label: item.label, value: item.balance })),
          { color: finance.saldoPrevistoFinal >= 0 ? "#0f766e" : "#dc2626" },
        ),
      })}
      ${panel({
        title: "Forma de pagamento",
        subtitle: "PIX, cartão, boleto, dinheiro e outros.",
        span: 4,
        body: comparisonBars(finance.byPaymentMethod),
      })}
      ${panel({
        title: "Gastos por conta",
        subtitle: "Conta bancária vinculada à movimentação.",
        span: 4,
        body: comparisonBars(finance.byAccount),
      })}
      ${panel({
        title: "Investimentos",
        subtitle: "Evolução do patrimônio investido.",
        span: 4,
        body: lineChart(finance.investments.history, { color: "#166534" }),
      })}
    </section>
  `;
}

function dashboardTask(item) {
  const variant = item.daysUntil < 0 ? "danger" : item.daysUntil <= 1 ? "warning" : "neutral";
  return `
    <article class="task-item">
      <span class="task-check">□</span>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(dueText(item))} · ${formatCurrency(item.expectedAmount)}</span>
      </div>
      ${badge(item.type === "income" ? "Receber" : "Pagar", variant)}
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
        ${pendingColumn("Receitas previstas", incomes, "Recebido")}
        ${pendingColumn("Despesas previstas", expenses, "Pago")}
      </section>
    </section>
  `;
}

function pendingColumn(title, items, doneLabel) {
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(title)}</h2>
          <p class="panel-subtitle">Marque para criar a movimentação real automaticamente.</p>
        </div>
      </div>
      <div class="pending-list">
        ${items.map((item) => pendingItem(item, doneLabel)).join("")}
      </div>
    </section>
  `;
}

function pendingItem(item, doneLabel) {
  const isDone = item.status === "done";
  return `
    <article class="pending-item ${isDone ? "is-done" : ""}">
      <div class="pending-main">
        <span class="pending-check">${isDone ? "✓" : "□"}</span>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>${formatDate(item.dueDate)} · previsto ${formatCurrency(item.expectedAmount)}</span>
          ${
            isDone
              ? `<em>Real: ${formatCurrency(item.actualAmount)} · diferença ${formatCurrency(item.difference)}</em>`
              : `<em>${escapeHtml(dueText(item))}</em>`
          }
        </div>
      </div>
      ${
        isDone
          ? badge(doneLabel, "success")
          : `
            <form class="quick-realization" data-pending-id="${escapeHtml(item.planId)}">
              <input name="amount" type="number" step="0.01" value="${escapeHtml(item.expectedAmount)}" aria-label="Valor real" />
              <input name="date" type="date" value="${escapeHtml(item.dueDate)}" aria-label="Data real" />
              <input name="notes" type="text" placeholder="Observações" aria-label="Observações" />
              <button class="button small" type="submit">
                <i data-lucide="check"></i>
                <span>${escapeHtml(doneLabel)}</span>
              </button>
            </form>
          `
      }
    </article>
  `;
}

function renderTransactions() {
  const finance = calculateFinance(state.data, state.month);
  const records = filteredTransactions(finance.transactions);
  const editing = state.editing.transactions
    ? state.data.transactions.find((transaction) => transaction.id === state.editing.transactions)
    : null;

  return `
    <section class="module-page">
      ${transactionQuickStats(finance)}
      <section class="form-panel elevated" id="transactionForm">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${editing ? "Editar movimentação" : "Novo lançamento"}</h2>
            <p class="panel-subtitle">Registre o evento financeiro real em menos de um minuto.</p>
          </div>
        </div>
        ${transactionForm(editing)}
      </section>
      <section class="table-panel">
        <div class="table-header">
          <div>
            <h3 class="table-title">Movimentações de ${escapeHtml(monthLabel(state.month))}</h3>
            <p class="table-subtitle">${records.length} lançamento(s) encontrados</p>
          </div>
        </div>
        ${transactionsTable(records)}
      </section>
    </section>
  `;
}

function transactionQuickStats(finance) {
  return `
    <section class="module-summary">
      <article class="mini-card"><span>Entradas realizadas</span><strong>${formatCurrency(finance.actualIncome)}</strong></article>
      <article class="mini-card"><span>Saídas realizadas</span><strong>${formatCurrency(finance.actualExpense)}</strong></article>
      <article class="mini-card"><span>Saldo real do mês</span><strong>${formatCurrency(finance.actualIncome - finance.actualExpense)}</strong></article>
      <article class="mini-card"><span>Movimentações</span><strong>${finance.transactions.length}</strong></article>
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
        <input name="amount" type="number" step="0.01" value="${escapeHtml(record?.amount || "")}" required />
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
        <textarea name="notes">${escapeHtml(record?.notes || "")}</textarea>
      </label>
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

function filteredTransactions(transactions) {
  const query = normalize(state.query);
  if (!query) return transactions;
  return transactions.filter((transaction) =>
    normalize(
      `${transaction.description} ${transaction.paymentMethod} ${getAccountName(state.data, transaction.accountId)} ${getCardName(
        state.data,
        transaction.cardId,
      )} ${getCategoryName(state.data, transaction.categoryId)}`,
    ).includes(query),
  );
}

function transactionsTable(records) {
  if (!records.length) return `<div class="empty-state">Nenhuma movimentação encontrada.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Movimentação</th>
            <th>Tipo</th>
            <th>Valor</th>
            <th>Data</th>
            <th>Conta/cartão</th>
            <th>Pagamento</th>
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

function transactionRow(record) {
  const signedTone = record.type === "income" ? "positive" : "negative";
  const amount = record.type === "card" ? cardInstallmentAmount(record) : toNumber(record.amount);
  const creator = state.data.members?.find((member) => member.id === record.createdBy)?.displayName || "Usuário";
  return `
    <tr>
      <td>
        <span class="cell-main">
          <strong>${escapeHtml(record.description)}</strong>
          <span>${escapeHtml(getCategoryName(state.data, record.categoryId))}</span>
        </span>
      </td>
      <td>${badge(titleCase(record.type), record.type === "income" ? "success" : record.type === "card" ? "warning" : "neutral")}</td>
      <td class="amount ${signedTone}">${formatCurrency(amount)}</td>
      <td>${formatDate(record.date)}</td>
      <td>${escapeHtml(record.cardId ? getCardName(state.data, record.cardId) : getAccountName(state.data, record.accountId))}</td>
      <td><span class="cell-main"><strong>${escapeHtml(record.paymentMethod || "-")}</strong><span>Criado por ${escapeHtml(creator)}</span></span></td>
      <td>
        <div class="row-actions">
          <button class="action-link" type="button" data-action="edit" data-collection="transactions" data-id="${record.id}"><i data-lucide="pencil"></i><span>Editar</span></button>
          <button class="action-link" type="button" data-action="delete" data-collection="transactions" data-id="${record.id}"><i data-lucide="trash-2"></i><span>Excluir</span></button>
        </div>
      </td>
    </tr>
  `;
}

function renderAccounts() {
  const finance = calculateFinance(state.data, state.month);
  return `
    <section class="module-page">
      <section class="account-grid">
        ${finance.accounts
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
                <div class="account-balance">${formatCurrency(account.balance)}</div>
                <div class="account-flow">
                  <span>Entradas <b>${formatCurrency(account.income)}</b></span>
                  <span>Saídas <b>${formatCurrency(account.expense)}</b></span>
                  <span>Projetado <b>${formatCurrency(account.projectedBalance)}</b></span>
                </div>
                <p>${escapeHtml(account.notes || "")}</p>
              </article>
            `,
          )
          .join("")}
      </section>
      <section class="form-panel">
        <div class="panel-header"><div><h2 class="panel-title">Ajustar conta</h2><p class="panel-subtitle">Use para atualizar saldo, observações ou criar novas contas.</p></div></div>
        ${accountForm()}
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
      <label class="form-group"><span class="form-label">Saldo atual</span><input name="balance" type="number" step="0.01" value="${escapeHtml(record.balance || "")}" required /></label>
      <label class="form-group"><span class="form-label">Principal</span><span class="checkbox-row"><input name="isPrimary" type="checkbox" ${record.isPrimary ? "checked" : ""} /><span>Sim</span></span></label>
      <label class="form-group full"><span class="form-label">Observações</span><textarea name="notes">${escapeHtml(record.notes || "")}</textarea></label>
      <div class="form-actions">
        <button class="button" type="submit"><i data-lucide="save"></i><span>Adicionar conta</span></button>
      </div>
    </form>
  `;
}

function renderCards() {
  const finance = calculateFinance(state.data, state.month);
  return `
    <section class="module-page">
      <section class="card-board">
        ${finance.cardData.map(cardPanel).join("")}
      </section>
      <section class="form-panel elevated" id="cardPurchaseForm">
        <div class="panel-header"><div><h2 class="panel-title">Adicionar compra no cartão</h2><p class="panel-subtitle">Compras parceladas e recorrentes entram na fatura e no limite.</p></div></div>
        ${cardPurchaseForm()}
      </section>
    </section>
  `;
}

function cardPanel(card) {
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
          card.purchases.length
            ? card.purchases
                .slice(0, 6)
                .map(
                  (purchase) => `
                    <div class="purchase-row">
                      <span><strong>${escapeHtml(purchase.description)}</strong><small>${escapeHtml(getCategoryName(state.data, purchase.categoryId))}</small></span>
                      <b>${formatCurrency(cardInstallmentAmount(purchase))}</b>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty-state compact">Nenhuma compra cadastrada.</div>`
        }
      </div>
    </article>
  `;
}

function cardPurchaseForm() {
  return `
    <form class="record-form" data-form="card-purchase">
      <label class="form-group wide"><span class="form-label">Descrição</span><input name="description" required /></label>
      <label class="form-group"><span class="form-label">Valor</span><input name="amount" type="number" step="0.01" required /></label>
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
  const finance = calculateFinance(state.data, state.month);
  return `
    <section class="module-page">
      <section class="planning-sections">
        ${planningGroup("Receitas recorrentes", "income")}
        ${planningGroup("Despesas recorrentes", "expense")}
        ${planningGroup("Assinaturas", "subscription")}
        ${marketPlanning(finance)}
      </section>
      <section class="form-panel elevated">
        <div class="panel-header"><div><h2 class="panel-title">Novo item de planejamento</h2><p class="panel-subtitle">Itens ativos geram pendências automaticamente todos os meses.</p></div></div>
        ${planningForm()}
      </section>
    </section>
  `;
}

function planningGroup(title, group) {
  const items = state.data.planningItems.filter((item) => item.group === group && item.active);
  return `
    <section class="panel">
      <div class="panel-header"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${items.length} item(ns) recorrentes</p></div></div>
      <div class="split-list">
        ${items
          .map(
            (item) => `
              <div class="split-row">
                <span><strong>${escapeHtml(item.name)}</strong><span>Dia ${item.day} · ${escapeHtml(item.paymentMethod)} · ${escapeHtml(getCategoryName(state.data, item.categoryId))}</span></span>
                <strong>${formatCurrency(item.amount)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function marketPlanning(finance) {
  return `
    <section class="panel">
      <div class="panel-header"><div><h2 class="panel-title">Mercado estimado</h2><p class="panel-subtitle">Planejamento agregado por grandes categorias.</p></div></div>
      <div class="market-forecast">
        <strong>${formatCurrency(finance.market.nextForecast)}</strong>
        <span>Média dos últimos meses para prever o próximo mês.</span>
      </div>
      ${comparisonBars(finance.market.grouped)}
      ${lineChart(finance.market.history.map((entry) => ({ label: monthLabel(entry.month).slice(0, 3), value: entry.amount })), { color: "#d97706" })}
    </section>
  `;
}

function planningForm() {
  return `
    <form class="record-form" data-form="planning">
      <label class="form-group"><span class="form-label">Grupo</span><select name="group">${options(planningGroups.map((group) => ({ value: group, label: titleCase(group) })))}</select></label>
      <label class="form-group"><span class="form-label">Tipo</span><select name="type">${options([{ value: "income", label: "Receita" }, { value: "expense", label: "Despesa" }])}</select></label>
      <label class="form-group wide"><span class="form-label">Nome</span><input name="name" required /></label>
      <label class="form-group"><span class="form-label">Valor previsto</span><input name="amount" type="number" step="0.01" required /></label>
      <label class="form-group"><span class="form-label">Dia</span><input name="day" type="number" min="1" max="31" required /></label>
      <label class="form-group"><span class="form-label">Categoria</span><select name="categoryId">${categoryOptions()}</select></label>
      <label class="form-group"><span class="form-label">Conta</span><select name="accountId">${accountOptions(state.data.settings.mainAccountId)}</select></label>
      <label class="form-group"><span class="form-label">Pagamento</span><select name="paymentMethod">${options(paymentMethods)}</select></label>
      <label class="form-group"><span class="form-label">Cartão</span><select name="cardId">${cardOptions("", true)}</select></label>
      <label class="form-group full"><span class="form-label">Observações</span><textarea name="notes"></textarea></label>
      <div class="form-actions"><button class="button" type="submit"><i data-lucide="save"></i><span>Salvar planejamento</span></button></div>
    </form>
  `;
}

function renderInvestments() {
  const finance = calculateFinance(state.data, state.month);
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
          <table><thead><tr><th>Investimento</th><th>Tipo</th><th>Valor</th><th>Rend. est.</th><th>Rend. real</th><th>Liquidez</th></tr></thead>
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
                </tr>
              `,
            )
            .join("")}</tbody></table>
        </div>
      </section>
    </section>
  `;
}

function renderCategories() {
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
                <button class="action-link category-delete" type="button" data-action="delete" data-collection="categories" data-id="${category.id}" aria-label="Excluir categoria ${escapeHtml(category.name)}">
                  <i data-lucide="trash-2"></i>
                </button>
              </article>
            `,
          )
          .join("")}
      </section>
      <section class="form-panel">
        <div class="panel-header"><div><h2 class="panel-title">Nova categoria</h2><p class="panel-subtitle">Use categorias para orçamento e previsões automáticas.</p></div></div>
        <form class="record-form" data-form="category">
          <label class="form-group wide"><span class="form-label">Nome</span><input name="name" required /></label>
          <label class="form-group"><span class="form-label">Tipo</span><select name="type">${options(["income", "expense", "investment", "mixed"].map((type) => ({ value: type, label: titleCase(type) })))}</select></label>
          <label class="form-group"><span class="form-label">Orçamento mensal</span><input name="budget" type="number" step="0.01" /></label>
          <label class="form-group"><span class="form-label">Cor</span><input name="color" type="color" value="#0f766e" /></label>
          <div class="form-actions"><button class="button" type="submit"><i data-lucide="plus"></i><span>Adicionar</span></button></div>
        </form>
      </section>
    </section>
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
          <label class="form-group"><span class="form-label">Alerta de orçamento (%)</span><input name="highSpendingAlertRate" type="number" step="0.01" value="${escapeHtml(state.data.settings.highSpendingAlertRate)}" /></label>
          <label class="form-group"><span class="form-label">Mercado padrão</span><input name="defaultMarketForecast" type="number" step="0.01" value="${escapeHtml(state.data.settings.defaultMarketForecast)}" /></label>
          <label class="form-group"><span class="form-label">Meses para média</span><input name="forecastMonths" type="number" min="1" value="${escapeHtml(state.data.settings.forecastMonths)}" /></label>
          <div class="form-actions"><button class="button" type="submit"><i data-lucide="save"></i><span>Salvar configurações</span></button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header"><div><h2 class="panel-title">Backup</h2><p class="panel-subtitle">Os dados principais agora ficam no Supabase. O JSON serve como cópia manual.</p></div></div>
        <div class="backup-actions">
          <button class="button secondary" type="button" data-action="export"><i data-lucide="download"></i><span>Exportar JSON</span></button>
          <button class="button secondary" type="button" data-action="import"><i data-lucide="upload"></i><span>Importar JSON</span></button>
          <button class="button danger" type="button" data-action="reset"><i data-lucide="refresh-cw"></i><span>Resetar dados</span></button>
        </div>
      </section>
    </section>
  `;
}

function readForm(form) {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function normalizeTransaction(raw, previous = {}) {
  const paymentMethod = raw.paymentMethod || "PIX";
  let type = raw.type || previous.type || "expense";
  if (paymentMethod === "Cartão crédito" && type === "expense") type = "card";
  if (type === "card" && !raw.cardId) raw.cardId = state.data.cards[0]?.id || "";
  return {
    ...previous,
    type,
    description: raw.description?.trim() || "Movimentação",
    amount: toNumber(raw.amount),
    date: raw.date || `${state.month}-01`,
    categoryId: raw.categoryId,
    accountId: raw.accountId,
    paymentMethod,
    cardId: raw.cardId || "",
    linkedPlanningId: raw.linkedPlanningId || "",
    installments: Math.max(1, toNumber(raw.installments) || 1),
    currentInstallment: Math.max(1, toNumber(raw.currentInstallment) || 1),
    status: "confirmed",
    notes: raw.notes?.trim() || "",
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

async function handleFormSubmit(form) {
  const kind = form.dataset.form;
  const raw = readForm(form);
  const householdId = state.householdId;
  const userId = state.user?.id;

  if (kind === "transaction") {
    const editingId = state.editing.transactions;
    const payload = toDbTransaction(normalizeTransaction(raw), householdId, userId);
    if (editingId) {
      await updateRemote("transactions", editingId, payload);
      state.editing.transactions = "";
      await persist("Movimentação atualizada.");
    } else {
      await insertRemote("transactions", payload);
      await persist("Movimentação criada.");
    }
  }

  if (kind === "card-purchase") {
    const card = state.data.cards.find((item) => item.id === raw.cardId);
    await insertRemote("transactions", toDbTransaction({
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
      notes: raw.notes?.trim() || "",
    }, householdId, userId));
    await persist("Compra adicionada ao cartão.");
  }

  if (kind === "planning") {
    await insertRemote("planning_items", toDbPlanning({
      group: raw.group,
      type: raw.type,
      name: raw.name.trim(),
      amount: toNumber(raw.amount),
      recurrence: "monthly",
      day: Math.max(1, Math.min(31, toNumber(raw.day))),
      categoryId: raw.categoryId,
      accountId: raw.accountId,
      paymentMethod: raw.paymentMethod,
      cardId: raw.cardId || "",
      active: true,
      notes: raw.notes?.trim() || "",
    }, householdId, userId));
    await persist("Planejamento recorrente criado.");
  }

  if (kind === "account") {
    await insertRemote("accounts", toDbAccount({
      name: raw.name.trim(),
      institution: raw.institution?.trim() || raw.name.trim(),
      type: raw.type?.trim() || "Conta secundária",
      balance: toNumber(raw.balance),
      isPrimary: Boolean(raw.isPrimary),
      notes: raw.notes?.trim() || "",
    }, householdId, userId));
    await persist("Conta adicionada.");
  }

  if (kind === "category") {
    await insertRemote("categories", toDbCategory({
      name: raw.name.trim(),
      type: raw.type,
      color: raw.color || "#0f766e",
      budget: toNumber(raw.budget),
    }, householdId, userId));
    await persist("Categoria adicionada.");
  }

  if (kind === "settings") {
    const settings = {
      mainAccountId: raw.mainAccountId,
      highSpendingAlertRate: toNumber(raw.highSpendingAlertRate),
      defaultMarketForecast: toNumber(raw.defaultMarketForecast),
      forecastMonths: Math.max(1, toNumber(raw.forecastMonths)),
    };
    await updateRemote("household_settings", householdId, toDbSettings(settings), "household_id");
    await persist("Configurações salvas.");
  }
}

document.querySelector("#menuToggle").addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

sidebarNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-route]");
  if (!button) return;
  state.route = button.dataset.route;
  state.editing = {};
  window.location.hash = `#/${state.route}`;
  sidebar.classList.remove("open");
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

appRoot.addEventListener("submit", async (event) => {
  const authForm = event.target.closest('[data-form="auth-login"]');
  if (authForm) {
    event.preventDefault();
    const raw = readForm(authForm);
    try {
      const response = await signIn(raw.email, raw.password);
      if (response.error) throw response.error;
      state.user = response.data.user || (await getSessionUser());
      if (state.user) await initializeForUser(state.user);
      showToast("Login realizado.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Não foi possível autenticar.");
    }
    return;
  }

  const pendingForm = event.target.closest("[data-pending-id]");
  if (pendingForm) {
    event.preventDefault();
    const plan = state.data.planningItems.find((item) => item.id === pendingForm.dataset.pendingId);
    if (!plan) return;
    try {
      await insertRemote("transactions", toDbTransaction(transactionFromOccurrence(plan, readForm(pendingForm)), state.householdId, state.user.id));
      await persist(plan.type === "income" ? "Receita realizada." : "Despesa paga.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Não foi possível criar a movimentação.");
    }
    return;
  }

  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  try {
    await handleFormSubmit(form);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível salvar.");
  }
});

appRoot.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "edit") {
    state.editing[target.dataset.collection] = target.dataset.id;
    render();
    window.setTimeout(() => document.querySelector("#transactionForm")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  if (action === "cancel-edit") {
    state.editing[target.dataset.collection] = "";
    render();
  }

  if (action === "delete") {
    if (!window.confirm("Excluir este registro?")) return;
    const collection = target.dataset.collection;
    const tableMap = { transactions: "transactions" };
    try {
      await deleteRemote(tableMap[collection] || collection, target.dataset.id);
      await persist("Registro excluído.");
    } catch (error) {
      console.error(error);
      if (collection === "categories" && error.code === "23503") {
        showToast("Categoria em uso. Remova ou altere os registros vinculados antes de excluir.");
      } else {
        showToast(error.message || "Não foi possível excluir.");
      }
    }
  }

  if (action === "export") exportData(state.data);
  if (action === "import") showToast("Importação para Supabase ainda não foi implementada.");
  if (action === "reset") {
    showToast("Reset remoto não foi habilitado para evitar apagar dados por engano.");
  }
  if (action === "logout") {
    await signOut();
    state.user = null;
    state.data = defaultData;
    state.householdId = "";
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
  if (!state.authReady) return;
  if (user && user.id !== state.user?.id) {
    await initializeForUser(user);
  }
  if (!user && state.user) {
    state.user = null;
    state.data = defaultData;
    state.householdId = "";
    if (state.unsubscribeRealtime) state.unsubscribeRealtime();
    render();
  }
});

bootstrap();
