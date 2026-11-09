import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const analyses = path.join(root, "analises");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(analyses, name), "utf8"));
const cardRows = readJson("lancamentos_normalizados.json");
const statementRows = readJson("extrato_normalizado.json");

const confirmedIncome = new Set(["receita_financeira", "receita_pensao", "receita_tractian", "reembolso"]);
const confirmedExpense = new Set(["despesa_conta"]);
const categoryNames = new Set();

const cardTransactions = cardRows
  .filter((row) => row.tipo !== "pagamento_fatura")
  .map((row) => {
    categoryNames.add(row.categoria_sugerida);
    return {
      importId: `c6-card-${row.id_importacao}`,
      kind: "transaction",
      type: "card",
      description: row.descricao_normalizada,
      amount: row.valor,
      date: row.data_compra,
      statementMonth: row.mes_fatura,
      spendingMonth: row.mes_compra,
      category: row.categoria_sugerida,
      account: "C6 Bank",
      card: "C6 Bank",
      paymentMethod: "Cartão crédito",
      installments: 1,
      currentInstallment: 1,
      status: "confirmed",
      notes: `Importação C6 auditada | importId:c6-card-${row.id_importacao}`,
    };
  });

const accountTransactions = statementRows
  .filter((row) => confirmedIncome.has(row.natureza) || confirmedExpense.has(row.natureza) || row.natureza === "pagamento_fatura")
  .map((row) => {
    const isIncome = confirmedIncome.has(row.natureza);
    const isInvoicePayment = row.natureza === "pagamento_fatura";
    const category = isInvoicePayment ? "" : row.categoria_sugerida;
    if (category) categoryNames.add(category);
    return {
      importId: `c6-account-${row.id_importacao}`,
      kind: "transaction",
      type: isInvoicePayment ? "transfer" : isIncome ? "income" : "expense",
      description: row.descricao,
      amount: Math.abs(row.valor),
      date: row.data_contabil || row.data_lancamento,
      category,
      account: "C6 Bank",
      card: isInvoicePayment ? "C6 Bank" : "",
      paymentMethod: isInvoicePayment ? "Pagamento de fatura" : row.tipo_extrato,
      installments: 1,
      currentInstallment: 1,
      status: "confirmed",
      notes: `Importação extrato C6 auditada | importId:c6-account-${row.id_importacao}`,
    };
  });

const latestInvoice = "2026-10";
const activeInstallments = new Map();
for (const row of cardRows) {
  if (row.mes_fatura !== latestInvoice || row.tipo !== "compra_cartao") continue;
  if (!row.parcelas_total || !row.parcela_atual || row.parcela_atual >= row.parcelas_total) continue;
  const key = `${row.descricao_normalizada}|${row.final_cartao}|${row.parcelas_total}|${row.valor}`;
  if (!activeInstallments.has(key)) activeInstallments.set(key, row);
}

const installmentForecasts = [...activeInstallments.values()].map((row) => {
  categoryNames.add(row.categoria_sugerida);
  return {
    importId: `c6-installment-${row.id_importacao}`,
    kind: "transaction",
    type: "card",
    description: row.descricao_normalizada,
    amount: Number((row.valor * row.parcelas_total).toFixed(2)),
    date: "2026-11-01",
    statementMonth: "2026-11",
    spendingMonth: "2026-11",
    category: row.categoria_sugerida,
    account: "C6 Bank",
    card: "C6 Bank",
    paymentMethod: "Cartão crédito",
    installments: row.parcelas_total,
    currentInstallment: row.parcela_atual + 1,
    status: "confirmed",
    notes: `Saldo parcelado auditado; origem ${row.parcela_atual}/${row.parcelas_total} em 2026-10 | importId:c6-installment-${row.id_importacao}`,
  };
});

const planning = [
  ["c6-plan-meliplus", "EC *MELIMAIS", 9.9, 10, "Assinaturas", "Cartão crédito", "C6 Bank"],
  ["c6-plan-ifood-club", "IFood Club", 7.95, 10, "Assinaturas", "Cartão crédito", "C6 Bank"],
  ["c6-plan-prime-video", "Prime Video", 19.9, 10, "Assinaturas", "Cartão crédito", "C6 Bank"],
  ["c6-plan-seguro-carro", "Seguro do carro", 110, 10, "Transporte", "Boleto", ""],
  ["c6-plan-internet", "Internet", 100, 10, "Moradia", "Boleto", ""],
  ["c6-plan-seguro-conta", "Seguro da conta", 7, 10, "Financeiro", "PIX", ""],
  ["c6-plan-aluguel", "Aluguel", 1750, 10, "Moradia", "PIX", ""],
  ["c6-plan-salario", "Tractian — salário líquido", 4600, 10, "Salário", "Conta", ""],
  ["c6-plan-academia", "Tractian — academia", 300, 10, "Salário", "Conta", ""],
  ["c6-plan-alimentacao", "Tractian — alimentação", 1035, 10, "Salário", "Conta", ""],
  ["c6-plan-pensao", "Camila — pensão", 1800, 10, "PIX recorrente", "PIX", ""],
].map(([importId, name, amount, day, category, paymentMethod, card]) => {
  categoryNames.add(category);
  const income = importId.includes("salario") || importId.includes("academia") || importId.includes("alimentacao") || importId.includes("pensao");
  return {
    importId,
    kind: "planning",
    group: income ? "income" : category === "Assinaturas" ? "subscription" : "expense",
    type: income ? "income" : "expense",
    name,
    amount,
    recurrence: "monthly",
    day,
    category,
    account: "C6 Bank",
    card,
    paymentMethod,
    active: true,
    notes: `Compromisso confirmado | startMonth:2026-11 | importId:${importId}`,
  };
});

const bundle = {
  version: 1,
  generatedAt: new Date().toISOString(),
  policy: {
    idempotency: "importId presente em notes",
    excludedStatementKinds: [...new Set(statementRows.map((row) => row.natureza).filter((kind) => !confirmedIncome.has(kind) && !confirmedExpense.has(kind) && kind !== "pagamento_fatura"))].sort(),
    mediumConfidenceRecurrences: "excluded",
  },
  requiredCategories: [...categoryNames].filter(Boolean).sort(),
  requiredAccount: "C6 Bank",
  requiredCard: "C6 Bank",
  transactions: [...cardTransactions, ...accountTransactions, ...installmentForecasts],
  planning,
  audit: {
    cardHistory: cardTransactions.length,
    accountHistory: accountTransactions.length,
    installmentForecasts: installmentForecasts.length,
    planning: planning.length,
    excludedForReview: statementRows.length - accountTransactions.length,
  },
};

fs.writeFileSync(path.join(analyses, "importacao_supabase.json"), `${JSON.stringify(bundle, null, 2)}\n`);
console.log(JSON.stringify(bundle.audit, null, 2));
