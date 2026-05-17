export const STORAGE_KEY = "financeiro-pessoal-v2";

export const defaultData = {
  meta: {
    version: 2,
    currency: "BRL",
    ownerLabel: "Assistente financeiro pessoal",
  },
  settings: {
    mainAccountId: "",
    highSpendingAlertRate: 0.9,
    defaultMarketForecast: 0,
    forecastMonths: 3,
  },
  categories: [
    { id: "cat-salario", name: "Salário", type: "income", color: "#1f9d55", budget: 0 },
    { id: "cat-bolsa", name: "Bolsa", type: "income", color: "#0f766e", budget: 0 },
    { id: "cat-pix", name: "PIX recorrente", type: "income", color: "#2563eb", budget: 0 },
    { id: "cat-moradia", name: "Moradia", type: "expense", color: "#0f766e", budget: 0 },
    { id: "cat-assinaturas", name: "Assinaturas", type: "expense", color: "#8b5cf6", budget: 0 },
    { id: "cat-saude", name: "Saúde", type: "expense", color: "#059669", budget: 0 },
    { id: "cat-mercado", name: "Mercado", type: "expense", color: "#d97706", budget: 0 },
    { id: "cat-transporte", name: "Transporte", type: "expense", color: "#2563eb", budget: 0 },
    { id: "cat-lazer", name: "Lazer", type: "expense", color: "#db2777", budget: 0 },
    { id: "cat-trabalho", name: "Trabalho", type: "expense", color: "#0891b2", budget: 0 },
    { id: "cat-investimentos", name: "Investimentos", type: "investment", color: "#166534", budget: 0 },
    { id: "cat-outros", name: "Outros", type: "mixed", color: "#64748b", budget: 0 },
  ],
  accounts: [],
  cards: [],
  planningItems: [],
  transactions: [],
  marketHistory: [],
  marketGroups: [],
  investments: [],
  investmentHistory: [],
};
