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

const FINANCE_META_PREFIX = "financeiro-meta:";

export function parseFinanceMeta(notes) {
  const line = String(notes || "")
    .split("\n")
    .find((item) => item.startsWith(FINANCE_META_PREFIX));
  if (!line) return {};
  try {
    return JSON.parse(line.slice(FINANCE_META_PREFIX.length));
  } catch {
    return {};
  }
}

export function withFinanceMeta(notes, meta) {
  const cleanNotes = String(notes || "")
    .split("\n")
    .filter((line) => !line.startsWith(FINANCE_META_PREFIX))
    .join("\n")
    .trim();
  return [`${FINANCE_META_PREFIX}${JSON.stringify(meta)}`, cleanNotes].filter(Boolean).join("\n");
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

export function monthDistance(fromMonth, toMonth) {
  const [fromYear, fromIndex] = String(fromMonth).split("-").map(Number);
  const [toYear, toIndex] = String(toMonth).split("-").map(Number);
  return (toYear - fromYear) * 12 + toIndex - fromIndex;
}

export function firstCardInvoiceMonth(card, dateValue) {
  const purchaseMonth = String(dateValue || "").slice(0, 7) || currentMonth();
  const purchaseDay = Math.max(1, toNumber(String(dateValue || "").slice(8, 10)) || 1);
  const closingDay = Math.max(1, toNumber(card?.closingDay) || 1);
  const dueDay = Math.max(1, toNumber(card?.dueDay) || 1);
  const baseOffset = dueDay <= closingDay ? 1 : 0;
  return addMonths(purchaseMonth, baseOffset + (purchaseDay > closingDay ? 1 : 0));
}

function cardTransactionForMonth(transaction, month, basis = "spending") {
  const meta = parseFinanceMeta(transaction.notes);
  const purchaseMonth = meta.spendingMonth || String(transaction.date || "").slice(0, 7);
  const statementMonth =
    meta.statementMonth ||
    meta.invoiceMonth ||
    String(transaction.notes || "").match(/Aba: Fatura_([0-9]{4}-[0-9]{2})-[0-9]{2}/)?.[1] ||
    purchaseMonth;
  const referenceMonth = basis === "statement" ? statementMonth : purchaseMonth;
  const installments = Math.max(1, Math.trunc(toNumber(transaction.installments)) || 1);
  const currentInstallment = Math.max(1, Math.trunc(toNumber(transaction.currentInstallment)) || 1);
  const offset = monthDistance(referenceMonth, month);
  const installment = currentInstallment + offset;

  if (offset < 0 || installment > installments) return null;

  const day = Math.max(1, Math.trunc(toNumber(String(transaction.date || "").slice(8, 10))) || 1);
  return {
    ...transaction,
    date: makeDate(month, day),
    currentInstallment: installment,
    isProjectedInstallment: offset > 0,
  };
}

function planningAppliesToMonth(plan, month) {
  const meta = parseFinanceMeta(plan.notes);
  const startMonth = meta.startMonth || "";
  if (!startMonth) return true;
  const offset = monthDistance(startMonth, month);
  if (offset < 0) return false;
  if (meta.repeatMode === "once") return offset === 0;
  if (meta.frequency === "yearly") return offset % 12 === 0;
  const totalOccurrences = Math.max(0, Math.trunc(toNumber(meta.totalOccurrences)) || 0);
  return !totalOccurrences || offset < totalOccurrences;
}

export function transactionsForMonth(data, month) {
  return data.transactions.flatMap((transaction) => {
    if (transaction.type !== "card") return dateInMonth(transaction.date, month) ? [transaction] : [];
    const installment = cardTransactionForMonth(transaction, month);
    return installment ? [installment] : [];
  });
}

function isCardPlanning(plan) {
  return plan.type === "expense" && plan.paymentMethod === "Cartão crédito" && Boolean(plan.cardId);
}

function matchingTransactionForPlan(transactions, plan) {
  return transactions.find((transaction) => transaction.linkedPlanningId === plan.id);
}

export function planningOccurrences(data, month) {
  const monthTransactions = transactionsForMonth(data, month);
  return data.planningItems
    .filter((plan) => plan.active)
    .filter((plan) => planningAppliesToMonth(plan, month))
    .filter((plan) => !isCardPlanning(plan))
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

function plannedCardCharges(data, month, card, monthTransactions) {
  const hasImportedStatement = monthTransactions.some((transaction) => {
    const meta = parseFinanceMeta(transaction.notes);
    return meta.source === "c6-import" && meta.statementMonth === month;
  });
  if (hasImportedStatement) return [];

  return data.planningItems
    .filter((plan) => plan.active && isCardPlanning(plan) && plan.cardId === card.id)
    .filter((plan) => planningAppliesToMonth(plan, month))
    .filter((plan) => !matchingTransactionForPlan(monthTransactions, plan))
    .map((plan) => ({
      id: `${plan.id}:${month}`,
      planId: plan.id,
      name: plan.name,
      amount: toNumber(plan.amount),
      dueDate: makeDate(month, plan.day),
      categoryId: plan.categoryId,
      source: "planning",
    }));
}

function cardSummary(data, month) {
  return data.cards.map((card) => {
    const purchases = data.transactions.filter(
      (transaction) => transaction.type === "card" && transaction.cardId === card.id,
    );
    const monthPurchases = purchases
      .map((transaction) => cardTransactionForMonth(transaction, month, "statement"))
      .filter(Boolean);
    const plannedCharges = plannedCardCharges(data, month, card, monthPurchases);
    const invoice =
      sum(monthPurchases, (transaction) => cardInstallmentAmount(transaction)) +
      sum(plannedCharges, (charge) => charge.amount);
    const usedLimit = sum(purchases, (transaction) => {
      const installments = Math.max(1, toNumber(transaction.installments) || 1);
      const meta = parseFinanceMeta(transaction.notes);
      const invoiceMonth = meta.statementMonth || meta.invoiceMonth || String(transaction.date || "").slice(0, 7);
      const elapsed = Math.max(0, monthDistance(invoiceMonth, month));
      const current = Math.max(1, toNumber(transaction.currentInstallment) + elapsed || 1);
      const remaining = Math.max(0, installments - current + 1);
      return cardInstallmentAmount(transaction) * remaining;
    });

    return {
      ...card,
      purchases,
      monthPurchases,
      plannedCharges,
      invoice,
      usedLimit,
      availableLimit: toNumber(card.limitTotal) - usedLimit,
      usageRate: usedLimit / Math.max(1, toNumber(card.limitTotal)),
    };
  });
}

function cardInvoiceOccurrences(data, month, cardData) {
  const monthTransactions = transactionsForMonth(data, month);
  return cardData
    .filter((card) => toNumber(card.invoice) > 0)
    .map((card) => {
      const id = `card_invoice:${card.id}:${month}`;
      const payment = monthTransactions.find(
        (transaction) =>
          transaction.type === "transfer" &&
          transaction.cardId === card.id &&
          transaction.paymentMethod === "Pagamento de fatura" &&
          String(transaction.notes || "").includes(id),
      );
      const expectedAmount = toNumber(card.invoice);
      const actualAmount = payment ? toNumber(payment.amount) : 0;
      const dueDate = makeDate(month, card.dueDay || 1);
      return {
        id,
        planId: "",
        source: "card_invoice",
        cardId: card.id,
        accountId: card.accountId || "",
        group: "card_invoice",
        type: "expense",
        name: `Fatura ${card.name}`,
        plannedCharges: card.plannedCharges || [],
        expectedAmount,
        actualAmount,
        difference: payment ? actualAmount - expectedAmount : 0,
        dueDate,
        transaction: payment,
        status: payment ? "done" : "pending",
        daysUntil: daysUntil(dueDate),
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

function cashImpact(transaction) {
  const amount = toNumber(transaction.amount);
  if (transaction.type === "card") return 0;
  if (transaction.type === "income") return amount;
  if (transaction.type === "transfer") {
    if (transaction.fromAccountId && !transaction.toAccountId) return -amount;
    if (transaction.toAccountId && !transaction.fromAccountId) return amount;
    return 0;
  }
  return -amount;
}

export function calculateFinance(data, selectedMonth, options = {}) {
  const cardData = cardSummary(data, selectedMonth);
  const occurrences = [...planningOccurrences(data, selectedMonth), ...cardInvoiceOccurrences(data, selectedMonth, cardData)].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate),
  );
  const pendingOccurrences = occurrences.filter((occurrence) => occurrence.status === "pending");
  const doneOccurrences = occurrences.filter((occurrence) => occurrence.status === "done");
  const tx = transactionsForMonth(data, selectedMonth);
  const actualIncomeTransactions = tx.filter((transaction) => transaction.type === "income");
  const expenseTransactions = tx.filter(
    (transaction) => transaction.type !== "income" && transaction.type !== "transfer",
  );
  const isFutureMonth = selectedMonth > currentMonth();
  const actualExpenseTransactions = expenseTransactions.filter(
    () => !isFutureMonth,
  );
  const projectedInstallmentTransactions = expenseTransactions.filter(
    (transaction) => transaction.type === "card" && isFutureMonth,
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
  const openingAccountsBalance = sum(data.accounts, (account) => account.balance);
  const confirmedCashFlow = sum(tx, cashImpact);
  const accountsBalance = openingAccountsBalance + confirmedCashFlow;
  const investments = investmentSummary(data);
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

  const actualByCategory = new Map(byCategory.map((item) => [item.id, item.value]));
  const committedByCategory = new Map();
  const addCommitted = (categoryId, amount) => {
    if (!categoryId) return;
    committedByCategory.set(categoryId, (committedByCategory.get(categoryId) || 0) + toNumber(amount));
  };
  projectedInstallmentTransactions.forEach((transaction) =>
    addCommitted(transaction.categoryId, cardInstallmentAmount(transaction)),
  );
  pendingOccurrences
    .filter((occurrence) => occurrence.source !== "card_invoice" && occurrence.plan?.categoryId)
    .forEach((occurrence) => addCommitted(occurrence.plan.categoryId, occurrence.expectedAmount));
  cardData.forEach((card) =>
    card.plannedCharges.forEach((charge) => addCommitted(charge.categoryId, charge.amount)),
  );

  const categoryBudgets = data.categories
    .filter((category) => category.type !== "income")
    .map((category) => {
      const budget = Math.max(0, toNumber(category.budget));
      const spent = toNumber(actualByCategory.get(category.id));
      const committed = toNumber(committedByCategory.get(category.id));
      const used = spent + committed;
      return {
        ...category,
        budget,
        spent,
        committed,
        used,
        available: budget > 0 ? Math.max(0, budget - used) : 0,
        exceeded: budget > 0 ? Math.max(0, used - budget) : 0,
        progress: budget > 0 ? used / budget : 0,
        warning: budget > 0 && used / budget >= Math.max(0.01, toNumber(data.settings?.highSpendingAlertRate) || 0.9),
      };
    })
    .sort((a, b) => (b.budget > 0) - (a.budget > 0) || b.used - a.used);
  const configuredCategoryBudgets = categoryBudgets.filter((category) => category.budget > 0);
  const categoryReserved = sum(configuredCategoryBudgets, (category) => category.available);
  const categoryBudgetTotal = sum(configuredCategoryBudgets, (category) => category.budget);
  const categoryUsedTotal = sum(configuredCategoryBudgets, (category) => category.used);
  const categorySpentTotal = sum(categoryBudgets, (category) => category.spent);
  const categoryCommittedTotal = sum(categoryBudgets, (category) => category.committed);
  const cashAfterCommitments = Math.max(0, saldoPrevistoFinal);
  const availableForNewSpending = configuredCategoryBudgets.length
    ? Math.max(0, Math.min(categoryReserved, cashAfterCommitments))
    : cashAfterCommitments;

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
    categoryBudgets,
    categoryBudget: {
      total: categoryBudgetTotal,
      used: categoryUsedTotal,
      spent: categorySpentTotal,
      committed: categoryCommittedTotal,
      reserved: categoryReserved,
      availableForNewSpending,
      configuredCount: configuredCategoryBudgets.length,
    },
    byPaymentMethod,
    byAccount,
    plannedVsRealized,
    monthlyEvolution: options.includeEvolution === false ? [] : monthlyEvolution(data, selectedMonth),
    todayTasks,
    upcomingSubscriptions,
    upcomingPayments,
  };
}
