export const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const percentFormatter = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatCurrency(value) {
  return currencyFormatter.format(toNumber(value));
}

export function formatPercent(value) {
  return percentFormatter.format(toNumber(value));
}

export function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month) {
  if (!month) return "";
  const [year, monthIndex] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(year, monthIndex - 1, 1),
  );
}

export function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("pt-BR").format(new Date(year, month - 1, day));
}

export function dateInMonth(date, month) {
  return Boolean(date && month && String(date).slice(0, 7) === month);
}

export function addMonths(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function makeDate(month, day) {
  const [year, monthIndex] = month.split("-").map(Number);
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return `${month}-${String(Math.min(Math.max(1, toNumber(day)), lastDay)).padStart(2, "0")}`;
}

export function daysUntil(dateValue) {
  if (!dateValue) return 999;
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [year, month, day] = dateValue.split("-").map(Number);
  const due = new Date(year, month - 1, day);
  return Math.round((due - todayOnly) / 86400000);
}

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function getCategory(data, id) {
  return data.categories.find((category) => category.id === id);
}

export function getCategoryName(data, id) {
  return getCategory(data, id)?.name || "-";
}

export function getCategoryColor(data, id) {
  return getCategory(data, id)?.color || "#64748b";
}

export function getAccount(data, id) {
  return data.accounts.find((account) => account.id === id);
}

export function getAccountName(data, id) {
  return getAccount(data, id)?.name || "-";
}

export function getCard(data, id) {
  return data.cards.find((card) => card.id === id);
}

export function getCardName(data, id) {
  return getCard(data, id)?.name || "-";
}

export function transactionSignedAmount(transaction) {
  const amount = toNumber(transaction.amount);
  if (transaction.type === "income") return amount;
  if (transaction.type === "transfer") return 0;
  return -amount;
}

export function cardInstallmentAmount(transaction) {
  const installments = Math.max(1, Math.trunc(toNumber(transaction.installments)) || 1);
  return toNumber(transaction.amount) / installments;
}

export function transactionsForMonth(data, month) {
  return data.transactions.filter((transaction) => dateInMonth(transaction.date, month));
}

function matchingTransactionForPlan(transactions, plan) {
  const direct = transactions.find((transaction) => transaction.linkedPlanningId === plan.id);
  if (direct) return direct;

  const planName = normalize(plan.name);
  return transactions.find((transaction) => {
    if (transaction.linkedPlanningId) return false;
    if (transaction.type !== plan.type && !(transaction.type === "card" && plan.type === "expense")) return false;
    const sameCategory = transaction.categoryId === plan.categoryId;
    const similarText =
      normalize(transaction.description).includes(planName) || planName.includes(normalize(transaction.description));
    return sameCategory && similarText;
  });
}

export function planningOccurrences(data, month) {
  const monthTransactions = transactionsForMonth(data, month);
  return data.planningItems
    .filter((plan) => plan.active)
    .map((plan) => {
      const transaction = matchingTransactionForPlan(monthTransactions, plan);
      const actualAmount = transaction ? toNumber(transaction.amount) : 0;
      const expectedAmount = toNumber(plan.amount);
      const dueDate = makeDate(month, plan.day);
      return {
        id: `${plan.id}:${month}`,
        planId: plan.id,
        plan,
        group: plan.group,
        type: plan.type,
        name: plan.name,
        expectedAmount,
        actualAmount,
        difference: transaction ? actualAmount - expectedAmount : 0,
        dueDate,
        transaction,
        status: transaction ? "done" : "pending",
        daysUntil: daysUntil(dueDate),
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function sum(items, getter) {
  return items.reduce((total, item) => total + toNumber(getter(item)), 0);
}

function groupBy(items, keyGetter, valueGetter, labelGetter, colorGetter) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyGetter(item) || "unknown";
    const current = map.get(key) || {
      id: key,
      label: labelGetter(item, key),
      color: colorGetter(item, key),
      value: 0,
    };
    current.value += toNumber(valueGetter(item));
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

function marketForecast(data) {
  const months = Math.max(1, toNumber(data.settings?.forecastMonths) || 3);
  const history = [...data.marketHistory].sort((a, b) => b.month.localeCompare(a.month));
  const recent = history.slice(0, months);
  const average = recent.length ? sum(recent, (entry) => entry.amount) / recent.length : data.settings.defaultMarketForecast;
  const grouped = data.marketGroups.map((group) => ({
    id: group.id,
    label: group.name,
    value: toNumber(group.forecast),
    color: group.id.includes("proteinas")
      ? "#d97706"
      : group.id.includes("higiene")
        ? "#0f766e"
        : group.id.includes("limpeza")
          ? "#2563eb"
          : group.id.includes("cafe")
            ? "#9333ea"
            : "#64748b",
  }));

  return {
    average,
    nextForecast: average,
    history: [...data.marketHistory].sort((a, b) => a.month.localeCompare(b.month)),
    grouped,
  };
}

function monthlyEvolution(data, selectedMonth) {
  return Array.from({ length: 6 }, (_, index) => addMonths(selectedMonth, index - 5)).map((month) => {
    const tx = transactionsForMonth(data, month);
    const income = sum(
      tx.filter((transaction) => transaction.type === "income"),
      (transaction) => transaction.amount,
    );
    const expense = sum(
      tx.filter((transaction) => transaction.type !== "income" && transaction.type !== "transfer"),
      (transaction) =>
        transaction.type === "card" ? cardInstallmentAmount(transaction) : transaction.amount,
    );
    return {
      month,
      label: monthLabel(month).slice(0, 3),
      income,
      expense,
      balance: income - expense,
    };
  });
}

function investmentSummary(data) {
  const total = sum(data.investments, (investment) => investment.amount);
  const estimatedYield = sum(data.investments, (investment) => investment.amount * (toNumber(investment.estimatedYield) / 100));
  const realYield = sum(data.investments, (investment) => investment.amount * (toNumber(investment.realYield) / 100));
  const distribution = groupBy(
    data.investments,
    (investment) => investment.type,
    (investment) => investment.amount,
    (investment) => investment.type,
    (investment) => (investment.type === "Renda fixa" ? "#0f766e" : "#8b5cf6"),
  );

  return {
    total,
    estimatedYield,
    realYield,
    distribution,
    history: data.investmentHistory.map((entry) => ({
      label: monthLabel(entry.month).slice(0, 3),
      value: toNumber(entry.amount),
    })),
  };
}

function cardSummary(data, month) {
  return data.cards.map((card) => {
    const purchases = data.transactions.filter(
      (transaction) => transaction.type === "card" && transaction.cardId === card.id,
    );
    const monthPurchases = purchases.filter((transaction) => dateInMonth(transaction.date, month));
    const invoice = sum(monthPurchases, (transaction) => cardInstallmentAmount(transaction));
    const usedLimit = sum(purchases, (transaction) => {
      const installments = Math.max(1, toNumber(transaction.installments) || 1);
      const current = Math.max(1, toNumber(transaction.currentInstallment) || 1);
      const remaining = Math.max(0, installments - current + 1);
      return cardInstallmentAmount(transaction) * remaining;
    });

    return {
      ...card,
      purchases,
      monthPurchases,
      invoice,
      usedLimit,
      availableLimit: toNumber(card.limitTotal) - usedLimit,
      usageRate: usedLimit / Math.max(1, toNumber(card.limitTotal)),
    };
  });
}

function accountSummary(data, month) {
  const tx = transactionsForMonth(data, month);
  return data.accounts.map((account) => {
    const related = tx.filter(
      (transaction) =>
        transaction.accountId === account.id ||
        transaction.fromAccountId === account.id ||
        transaction.toAccountId === account.id,
    );
    const income = sum(
      related.filter((transaction) => transaction.type === "income" || transaction.toAccountId === account.id),
      (transaction) => transaction.amount,
    );
    const expense = sum(
      related.filter(
        (transaction) =>
          (transaction.type !== "income" && transaction.type !== "transfer") || transaction.fromAccountId === account.id,
      ),
      (transaction) => (transaction.type === "card" ? 0 : transaction.amount),
    );
    return {
      ...account,
      related,
      income,
      expense,
      projectedBalance: toNumber(account.balance) + income - expense,
    };
  });
}

export function calculateFinance(data, selectedMonth) {
  const occurrences = planningOccurrences(data, selectedMonth);
  const pendingOccurrences = occurrences.filter((occurrence) => occurrence.status === "pending");
  const doneOccurrences = occurrences.filter((occurrence) => occurrence.status === "done");
  const tx = transactionsForMonth(data, selectedMonth);
  const actualIncomeTransactions = tx.filter((transaction) => transaction.type === "income");
  const actualExpenseTransactions = tx.filter(
    (transaction) => transaction.type !== "income" && transaction.type !== "transfer",
  );

  const plannedIncome = sum(
    occurrences.filter((occurrence) => occurrence.type === "income"),
    (occurrence) => occurrence.expectedAmount,
  );
  const plannedExpense = sum(
    occurrences.filter((occurrence) => occurrence.type === "expense"),
    (occurrence) => occurrence.expectedAmount,
  );
  const actualIncome = sum(actualIncomeTransactions, (transaction) => transaction.amount);
  const actualExpense = sum(actualExpenseTransactions, (transaction) =>
    transaction.type === "card" ? cardInstallmentAmount(transaction) : transaction.amount,
  );
  const pendingIncome = sum(
    pendingOccurrences.filter((occurrence) => occurrence.type === "income"),
    (occurrence) => occurrence.expectedAmount,
  );
  const pendingExpense = sum(
    pendingOccurrences.filter((occurrence) => occurrence.type === "expense"),
    (occurrence) => occurrence.expectedAmount,
  );
  const accountsBalance = sum(data.accounts, (account) => account.balance);
  const investments = investmentSummary(data);
  const cardData = cardSummary(data, selectedMonth);
  const accounts = accountSummary(data, selectedMonth);
  const market = marketForecast(data);

  const saldoDisponivelReal = accountsBalance - pendingExpense;
  const saldoAtual = accountsBalance;
  const saldoPrevistoFinal = accountsBalance + pendingIncome - pendingExpense;
  const saldoAposPendencias = saldoPrevistoFinal;
  const patrimonioTotal = accountsBalance + investments.total;
  const realizationRate = plannedExpense ? actualExpense / plannedExpense : 0;

  const expenseTransactionsForCharts = actualExpenseTransactions.map((transaction) => ({
    ...transaction,
    chartAmount: transaction.type === "card" ? cardInstallmentAmount(transaction) : toNumber(transaction.amount),
  }));

  const byCategory = groupBy(
    expenseTransactionsForCharts,
    (transaction) => transaction.categoryId,
    (transaction) => transaction.chartAmount,
    (transaction, id) => getCategoryName(data, id),
    (transaction, id) => getCategoryColor(data, id),
  );

  const byPaymentMethod = groupBy(
    expenseTransactionsForCharts,
    (transaction) => transaction.paymentMethod,
    (transaction) => transaction.chartAmount,
    (transaction) => transaction.paymentMethod || "Outro",
    () => "#0f766e",
  );

  const byAccount = groupBy(
    expenseTransactionsForCharts,
    (transaction) => transaction.accountId,
    (transaction) => transaction.chartAmount,
    (transaction, id) => getAccountName(data, id),
    (transaction, id) => (getAccount(data, id)?.isPrimary ? "#0f766e" : "#2563eb"),
  );

  const plannedVsRealized = [
    { label: "Receitas previstas", value: plannedIncome, color: "#1f9d55" },
    { label: "Receitas realizadas", value: actualIncome, color: "#0f766e" },
    { label: "Despesas previstas", value: plannedExpense, color: "#d97706" },
    { label: "Despesas realizadas", value: actualExpense, color: "#dc2626" },
  ];

  const todayTasks = pendingOccurrences
    .filter((occurrence) => occurrence.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 6);

  const upcomingSubscriptions = pendingOccurrences
    .filter((occurrence) => occurrence.group === "subscription")
    .slice(0, 5);

  const upcomingPayments = pendingOccurrences
    .filter((occurrence) => occurrence.type === "expense")
    .slice(0, 6);

  return {
    month: selectedMonth,
    occurrences,
    pendingOccurrences,
    doneOccurrences,
    transactions: tx,
    plannedIncome,
    plannedExpense,
    actualIncome,
    actualExpense,
    pendingIncome,
    pendingExpense,
    accountsBalance,
    saldoDisponivelReal,
    saldoAtual,
    saldoPrevistoFinal,
    saldoAposPendencias,
    patrimonioTotal,
    realizationRate,
    investments,
    cardData,
    accounts,
    market,
    byCategory,
    byPaymentMethod,
    byAccount,
    plannedVsRealized,
    monthlyEvolution: monthlyEvolution(data, selectedMonth),
    todayTasks,
    upcomingSubscriptions,
    upcomingPayments,
  };
}
