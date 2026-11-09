import test from "node:test";
import assert from "node:assert/strict";
import { calculateFinance, cardInstallmentAmount, withFinanceMeta } from "../src/calculations.js";

function data(overrides = {}) {
  return {
    settings: { highSpendingAlertRate: 0.9, defaultMarketForecast: 0, forecastMonths: 3 },
    accounts: [], cards: [], categories: [], planningItems: [], transactions: [],
    marketGroups: [], marketHistory: [], investments: [], investmentHistory: [],
    ...overrides,
  };
}

test("separa o mês da compra do mês da fatura", () => {
  const card = { id: "card-1", name: "C6", accountId: "account-1", limitTotal: 5000, closingDay: 5, dueDay: 10 };
  const purchase = {
    id: "tx-1", type: "card", description: "Compra", amount: 100, date: "2026-07-20",
    categoryId: "cat-1", accountId: "account-1", cardId: card.id, paymentMethod: "Cartão crédito",
    installments: 1, currentInstallment: 1, status: "confirmed", linkedPlanningId: "",
    notes: withFinanceMeta("", { spendingMonth: "2026-07", statementMonth: "2026-08", invoiceMonth: "2026-08" }),
  };
  const base = data({ cards: [card], transactions: [purchase], categories: [{ id: "cat-1", name: "Compras", type: "expense", budget: 0, color: "#fff" }] });
  assert.equal(calculateFinance(base, "2026-07", { includeEvolution: false }).actualExpense, 100);
  assert.equal(calculateFinance(base, "2026-08", { includeEvolution: false }).cardData[0].invoice, 100);
});

test("não marca compromisso como pago por semelhança de texto", () => {
  const plan = { id: "plan-1", active: true, type: "expense", group: "expense", name: "Luz", amount: 90, day: 10, categoryId: "cat-1", accountId: "account-1", cardId: "", paymentMethod: "PIX", notes: "" };
  const unrelated = { id: "tx-2", type: "expense", description: "Luz de emergência", amount: 30, date: "2026-08-02", categoryId: "cat-1", accountId: "account-1", linkedPlanningId: "", installments: 1, currentInstallment: 1, notes: "" };
  const finance = calculateFinance(data({ planningItems: [plan], transactions: [unrelated] }), "2026-08", { includeEvolution: false });
  assert.equal(finance.occurrences[0].status, "pending");
});

test("saldo calculado aplica caixa confirmado sem descontar compra de cartão duas vezes", () => {
  const transactions = [
    { id: "income", type: "income", amount: 100, date: "2026-08-01", linkedPlanningId: "", installments: 1, currentInstallment: 1, notes: "" },
    { id: "expense", type: "expense", amount: 50, date: "2026-08-02", linkedPlanningId: "", installments: 1, currentInstallment: 1, notes: "" },
    { id: "card", type: "card", amount: 200, date: "2026-08-03", linkedPlanningId: "", installments: 1, currentInstallment: 1, notes: "" },
  ];
  const finance = calculateFinance(data({ accounts: [{ id: "account-1", balance: 1000 }], transactions }), "2026-08", { includeEvolution: false });
  assert.equal(finance.saldoAtual, 1050);
});

test("não soma cobranças planejadas sobre uma fatura C6 já importada", () => {
  const card = { id: "card-1", name: "C6", accountId: "account-1", limitTotal: 5000, closingDay: 3, dueDay: 10 };
  const plan = {
    id: "plan-1", active: true, type: "expense", group: "subscription", name: "Assinatura",
    amount: 100, day: 10, categoryId: "cat-1", accountId: "account-1", cardId: card.id,
    paymentMethod: "Cartão crédito", notes: withFinanceMeta("", { startMonth: "2026-09", repeatMode: "monthly" }),
  };
  const importedPurchase = {
    id: "tx-1", type: "card", description: "Compra importada", amount: 50, date: "2026-09-15",
    categoryId: "cat-1", accountId: "", cardId: card.id, paymentMethod: "Cartão crédito",
    installments: 1, currentInstallment: 1, status: "confirmed", linkedPlanningId: "",
    notes: withFinanceMeta("", { source: "c6-import", statementMonth: "2026-10", invoiceMonth: "2026-09" }),
  };

  const finance = calculateFinance(data({ cards: [card], planningItems: [plan], transactions: [importedPurchase] }), "2026-10", { includeEvolution: false });
  assert.equal(finance.cardData[0].invoice, 50);
  assert.deepEqual(finance.cardData[0].plannedCharges, []);
});

test("exibe o valor unitário da parcela armazenada como compromisso total", () => {
  assert.equal(cardInstallmentAmount({ amount: 109.98, installments: 2 }), 54.99);
});
