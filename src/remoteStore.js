import { defaultData } from "./data.js";
import { supabase, supabaseConfigured } from "./supabaseClient.js";

const tableNames = [
  "categories",
  "accounts",
  "cards",
  "planning_items",
  "transactions",
  "market_groups",
  "market_history",
  "investments",
  "investment_history",
  "grocery_receipts",
  "grocery_items",
];

function must(data, error) {
  if (error) throw error;
  return data;
}

function mustResponse(response) {
  if (response.error) throw response.error;
  return response.data;
}

function money(value) {
  return Number(value || 0);
}

function monthDate(month) {
  return `${month}-01`;
}

function monthText(date) {
  return String(date || "").slice(0, 7);
}

function profileName(user) {
  return user?.user_metadata?.display_name || user?.email?.split("@")[0] || "Usuário";
}

export async function getSessionUser() {
  if (!supabaseConfigured) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) return sessionData.session.user || null;
  return data.user || sessionData.session.user || null;
}

export async function signIn(email, password) {
  if (!supabaseConfigured) return { data: {}, error: new Error("Configure as variáveis do Supabase para entrar.") };
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email, password) {
  if (!supabaseConfigured) return { data: {}, error: new Error("Configure as variáveis do Supabase para criar a conta.") };
  return supabase.auth.signUp({ email, password });
}

export async function signOut() {
  if (!supabaseConfigured) return;
  return supabase.auth.signOut();
}

export async function requestPasswordReset(email, redirectTo) {
  if (!supabaseConfigured) throw new Error("Configure as variáveis do Supabase.");
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

export function onAuthChange(callback) {
  if (!supabaseConfigured) return { data: { subscription: { unsubscribe() {} } } };
  return supabase.auth.onAuthStateChange((_event, session) => callback(session?.user || null));
}

export async function loadRemoteData(user) {
  const membershipResponse = await supabase
    .from("household_members")
    .select("household_id, role, display_name, households(id, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  let memberships = mustResponse(membershipResponse);

  // Novas contas entram no mesmo lar financeiro compartilhado.
  if (!memberships?.length) {
    const joinResponse = await supabase.rpc("join_shared_household");
    if (joinResponse.error && !String(joinResponse.error.message || "").includes("No household available")) {
      throw joinResponse.error;
    }
    if (!joinResponse.error) {
      const refreshed = await supabase
        .from("household_members")
        .select("household_id, role, display_name, households(id, name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      memberships = mustResponse(refreshed);
    }
  }

  let householdId = await resolveHouseholdId(user, memberships);
  if (!householdId) {
    householdId = await createSeededHousehold(user);
  }

  const [
    settings,
    members,
    categories,
    accounts,
    cards,
    planningItems,
    transactions,
    marketGroups,
    marketHistory,
    investments,
    investmentHistory,
    groceryReceipts,
    groceryItems,
  ] = await Promise.all([
    fetchSingle("household_settings", householdId),
    fetchRows("household_members", householdId),
    fetchRows("categories", householdId),
    fetchRows("accounts", householdId),
    fetchRows("cards", householdId),
    fetchRows("planning_items", householdId),
    fetchRows("transactions", householdId, "transaction_date"),
    fetchRows("market_groups", householdId),
    fetchRows("market_history", householdId, "month"),
    fetchRows("investments", householdId),
    fetchRows("investment_history", householdId, "month"),
    fetchOptionalRows("grocery_receipts", householdId, "purchase_date"),
    fetchOptionalRows("grocery_items", householdId, "purchase_date"),
  ]);

  return {
    data: {
      meta: { ...defaultData.meta, householdId },
      settings: {
        mainAccountId: settings?.main_account_id || accounts.find((account) => account.is_primary)?.id || accounts[0]?.id || "",
        defaultMarketForecast: money(settings?.default_market_forecast || 700),
        forecastMonths: Number(settings?.forecast_months || 3),
        highSpendingAlertRate: Number(settings?.high_spending_alert_rate || 0.9),
      },
      currentUser: {
        id: user.id,
        email: user.email,
        displayName: profileName(user),
      },
      household: {
        id: householdId,
        name: memberships?.[0]?.households?.name || "Minha família",
      },
      members: members.map(fromMember),
      categories: categories.map(fromCategory),
      accounts: accounts.map(fromAccount),
      cards: cards.map(fromCard),
      planningItems: planningItems.map(fromPlanningItem),
      transactions: transactions.map(fromTransaction),
      marketGroups: marketGroups.map(fromMarketGroup),
      marketHistory: marketHistory.map(fromMarketHistory),
      investments: investments.map(fromInvestment),
      investmentHistory: investmentHistory.map(fromInvestmentHistory),
      groceryReceipts: groceryReceipts.map(fromGroceryReceipt),
      groceryItems: groceryItems.map(fromGroceryItem),
    },
    householdId,
  };
}

async function resolveHouseholdId(user, memberships) {
  if (memberships?.length === 1) return memberships[0].household_id;

  if (memberships?.length > 1) {
    const ids = memberships.map((membership) => membership.household_id);
    const { data, error } = await supabase
      .from("transactions")
      .select("household_id")
      .in("household_id", ids)
      .limit(1);
    if (error) throw error;
    const activeId = data?.[0]?.household_id;
    if (activeId) return activeId;
    return memberships[0].household_id;
  }

  const householdResponse = await supabase
    .from("households")
    .select("id")
    .eq("created_by", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return must(householdResponse.data, householdResponse.error)?.id || "";
}

async function fetchRows(table, householdId, orderColumn = "created_at") {
  const response = await supabase.from(table).select("*").eq("household_id", householdId).order(orderColumn, { ascending: false });
  return must(response.data, response.error) || [];
}

// Tabelas novas: se a migração ainda não rodou, o app continua funcionando sem elas.
async function fetchOptionalRows(table, householdId, orderColumn) {
  const response = await supabase.from(table).select("*").eq("household_id", householdId).order(orderColumn, { ascending: false });
  if (response.error) {
    console.warn(`Tabela ${table} indisponível. Rode supabase/grocery_receipts.sql.`, response.error.message);
    return [];
  }
  return response.data || [];
}

async function fetchSingle(table, householdId) {
  const response = await supabase.from(table).select("*").eq("household_id", householdId).maybeSingle();
  return must(response.data, response.error);
}

async function createSeededHousehold(user) {
  const household = mustResponse(
    await supabase
      .from("households")
      .insert({ name: "Minha família", created_by: user.id })
      .select("id")
      .single(),
  );
  const householdId = household.id;

  await supabase.from("household_members").insert({
    household_id: householdId,
    user_id: user.id,
    role: "owner",
    display_name: profileName(user),
  });

  const categoryMap = await seedCategories(householdId, user.id);
  const accountMap = await seedAccounts(householdId, user.id);
  await supabase.from("household_settings").insert({
    household_id: householdId,
    main_account_id: accountMap.get(defaultData.settings.mainAccountId) || null,
    default_market_forecast: defaultData.settings.defaultMarketForecast,
    forecast_months: defaultData.settings.forecastMonths,
    high_spending_alert_rate: defaultData.settings.highSpendingAlertRate,
  });
  const cardMap = await seedCards(householdId, user.id, accountMap);
  const planningMap = await seedPlanning(householdId, user.id, categoryMap, accountMap, cardMap);
  await seedTransactions(householdId, user.id, categoryMap, accountMap, cardMap, planningMap);
  await seedSimpleTables(householdId, user.id);

  return householdId;
}

async function seedCategories(householdId, userId) {
  const rows = defaultData.categories.map((category) => ({
    household_id: householdId,
    name: category.name,
    type: category.type === "income" ? "income" : category.type === "investment" ? "investment" : category.type === "mixed" ? "mixed" : "expense",
    color: category.color,
    monthly_budget: category.budget,
    created_by: userId,
  }));
  const inserted = mustResponse(await supabase.from("categories").insert(rows).select("id, name"));
  return mapByDefaultId(defaultData.categories, inserted);
}

async function seedAccounts(householdId, userId) {
  const rows = defaultData.accounts.map((account) => ({
    household_id: householdId,
    name: account.name,
    institution: account.institution,
    type: account.type,
    balance: account.balance,
    is_primary: account.isPrimary,
    notes: account.notes,
    created_by: userId,
  }));
  if (!rows.length) return new Map();
  const inserted = mustResponse(await supabase.from("accounts").insert(rows).select("id, name"));
  return mapByDefaultId(defaultData.accounts, inserted);
}

async function seedCards(householdId, userId, accountMap) {
  const rows = defaultData.cards.map((card) => ({
    household_id: householdId,
    account_id: accountMap.get(card.accountId),
    name: card.name,
    limit_total: card.limitTotal,
    closing_day: card.closingDay,
    due_day: card.dueDay,
    status: statusToDb(card.status),
    notes: card.notes,
    created_by: userId,
  }));
  if (!rows.length) return new Map();
  const inserted = mustResponse(await supabase.from("cards").insert(rows).select("id, name"));
  return mapByDefaultId(defaultData.cards, inserted);
}

async function seedPlanning(householdId, userId, categoryMap, accountMap, cardMap) {
  const rows = defaultData.planningItems.map((item) => ({
    household_id: householdId,
    group_key: item.group,
    type: item.type,
    name: item.name,
    amount: item.amount,
    recurrence: item.recurrence,
    due_day: item.day,
    category_id: categoryMap.get(item.categoryId),
    account_id: accountMap.get(item.accountId),
    card_id: cardMap.get(item.cardId),
    payment_method: item.paymentMethod,
    active: item.active,
    notes: item.notes,
    created_by: userId,
  }));
  if (!rows.length) return new Map();
  const inserted = mustResponse(await supabase.from("planning_items").insert(rows).select("id, name"));
  return mapByDefaultId(defaultData.planningItems, inserted);
}

async function seedTransactions(householdId, userId, categoryMap, accountMap, cardMap, planningMap) {
  const rows = defaultData.transactions.map((item) => ({
    household_id: householdId,
    type: item.type,
    description: item.description,
    amount: item.amount,
    transaction_date: item.date,
    category_id: categoryMap.get(item.categoryId),
    account_id: accountMap.get(item.accountId),
    card_id: cardMap.get(item.cardId),
    planning_item_id: planningMap.get(item.linkedPlanningId),
    payment_method: item.paymentMethod,
    installments: item.installments || 1,
    current_installment: item.currentInstallment || 1,
    status: item.status,
    notes: item.notes,
    created_by: userId,
  }));
  if (rows.length) await supabase.from("transactions").insert(rows);
}

async function seedSimpleTables(householdId, userId) {
  const marketGroups = defaultData.marketGroups.map((item) => ({
      household_id: householdId,
      name: item.name,
      forecast: item.forecast,
      created_by: userId,
    }));
  if (marketGroups.length) await supabase.from("market_groups").insert(marketGroups);

  const marketHistory = defaultData.marketHistory.map((item) => ({
      household_id: householdId,
      month: monthDate(item.month),
      amount: item.amount,
      notes: item.notes,
      created_by: userId,
    }));
  if (marketHistory.length) await supabase.from("market_history").insert(marketHistory);

  const investments = defaultData.investments.map((item) => ({
      household_id: householdId,
      name: item.name,
      type: item.type,
      amount: item.amount,
      estimated_yield: item.estimatedYield,
      real_yield: item.realYield,
      application_date: item.applicationDate || null,
      maturity_date: item.maturityDate || null,
      institution: item.institution,
      liquidity: item.liquidity,
      notes: item.notes,
      created_by: userId,
    }));
  if (investments.length) await supabase.from("investments").insert(investments);

  const investmentHistory = defaultData.investmentHistory.map((item) => ({
      household_id: householdId,
      month: monthDate(item.month),
      amount: item.amount,
      created_by: userId,
    }));
  if (investmentHistory.length) await supabase.from("investment_history").insert(investmentHistory);
}

function mapByDefaultId(defaultRows, insertedRows) {
  const map = new Map();
  defaultRows.forEach((row, index) => {
    map.set(row.id, insertedRows[index]?.id);
  });
  return map;
}

export async function insertRemote(table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select("*").single();
  return must(data, error);
}

export async function updateRemote(table, id, payload, idColumn = "id") {
  const { data, error } = await supabase.from(table).update(payload).eq(idColumn, id).select("*").single();
  return must(data, error);
}

export async function insertManyRemote(table, rows) {
  const { data, error } = await supabase.from(table).insert(rows).select("*");
  return must(data, error);
}

export async function deleteRemote(table, id) {
  const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) {
    const noRow = new Error("O registro não foi excluído. Verifique sua sessão e tente novamente.");
    noRow.code = "DELETE_NO_ROWS";
    throw noRow;
  }
  return data[0];
}

export function subscribeToHousehold(householdId, callback) {
  const channel = supabase.channel(`household:${householdId}`);
  tableNames.forEach((table) => {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` },
      callback,
    );
  });
  channel.subscribe();
  return () => supabase.removeChannel(channel);
}

export function toDbTransaction(transaction, householdId, userId) {
  return {
    household_id: householdId,
    type: transaction.type,
    description: transaction.description,
    amount: transaction.amount,
    transaction_date: transaction.date,
    category_id: transaction.categoryId || null,
    account_id: transaction.accountId || null,
    from_account_id: transaction.fromAccountId || null,
    to_account_id: transaction.toAccountId || null,
    card_id: transaction.cardId || null,
    planning_item_id: transaction.linkedPlanningId || null,
    payment_method: transaction.paymentMethod,
    installments: transaction.installments || 1,
    current_installment: transaction.currentInstallment || 1,
    status: transaction.status || "confirmed",
    notes: transaction.notes || "",
    created_by: transaction.createdBy || userId,
  };
}

export function toDbPlanning(item, householdId, userId) {
  return {
    household_id: householdId,
    group_key: item.group,
    type: item.type,
    name: item.name,
    amount: item.amount,
    recurrence: item.recurrence || "monthly",
    due_day: item.day,
    category_id: item.categoryId || null,
    account_id: item.accountId || null,
    card_id: item.cardId || null,
    payment_method: item.paymentMethod,
    active: item.active ?? true,
    notes: item.notes || "",
    created_by: item.createdBy || userId,
  };
}

export function toDbAccount(item, householdId, userId) {
  return {
    household_id: householdId,
    name: item.name,
    institution: item.institution,
    type: item.type,
    balance: item.balance,
    is_primary: item.isPrimary || false,
    notes: item.notes || "",
    created_by: item.createdBy || userId,
  };
}

export function toDbCategory(item, householdId, userId) {
  return {
    household_id: householdId,
    name: item.name,
    type: item.type,
    color: item.color,
    monthly_budget: item.budget || 0,
    created_by: item.createdBy || userId,
  };
}

export function toDbCard(item, householdId, userId) {
  return {
    household_id: householdId,
    account_id: item.accountId || null,
    name: item.name,
    limit_total: item.limitTotal,
    closing_day: item.closingDay,
    due_day: item.dueDay,
    status: statusToDb(item.status),
    notes: item.notes || "",
    created_by: item.createdBy || userId,
  };
}

export function toDbInvestment(item, householdId, userId) {
  return {
    household_id: householdId,
    name: item.name,
    type: item.type,
    amount: item.amount,
    estimated_yield: item.estimatedYield,
    real_yield: item.realYield,
    application_date: item.applicationDate || null,
    maturity_date: item.maturityDate || null,
    institution: item.institution || "",
    liquidity: item.liquidity || "",
    notes: item.notes || "",
    created_by: item.createdBy || userId,
  };
}

export function toDbInvestmentHistory(item, householdId, userId) {
  return {
    household_id: householdId,
    month: monthDate(item.month),
    amount: item.amount,
    created_by: item.createdBy || userId,
  };
}

export function toDbMarketGroup(item, householdId, userId) {
  return {
    household_id: householdId,
    name: item.name,
    forecast: item.forecast,
    created_by: item.createdBy || userId,
  };
}

export function toDbMarketHistory(item, householdId, userId) {
  return {
    household_id: householdId,
    month: monthDate(item.month),
    amount: item.amount,
    notes: item.notes || "",
    created_by: item.createdBy || userId,
  };
}

export function toDbGroceryReceipt(item, householdId, userId) {
  return {
    household_id: householdId,
    store: item.store || "",
    purchase_date: item.purchaseDate,
    total: item.total || 0,
    created_by: item.createdBy || userId,
  };
}

export function toDbGroceryItem(item, householdId, userId) {
  return {
    household_id: householdId,
    receipt_id: item.receiptId,
    purchase_date: item.purchaseDate,
    name: item.name || item.product,
    product: item.product,
    category: item.category || "Outros",
    quantity: item.quantity,
    unit: item.unit || "un",
    total_price: item.totalPrice || 0,
    created_by: item.createdBy || userId,
  };
}

export function toDbSettings(settings) {
  return {
    main_account_id: settings.mainAccountId || null,
    high_spending_alert_rate: settings.highSpendingAlertRate,
    default_market_forecast: settings.defaultMarketForecast,
    forecast_months: settings.forecastMonths,
  };
}

function fromMember(row) {
  return {
    id: row.user_id,
    role: row.role,
    displayName: row.display_name || "Usuário",
  };
}

function fromCategory(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color,
    budget: money(row.monthly_budget),
    createdBy: row.created_by,
  };
}

function fromAccount(row) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    type: row.type,
    balance: money(row.balance),
    isPrimary: row.is_primary,
    notes: row.notes,
    createdBy: row.created_by,
  };
}

function fromCard(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    limitTotal: money(row.limit_total),
    closingDay: row.closing_day,
    dueDay: row.due_day,
    status: statusFromDb(row.status),
    notes: row.notes,
    createdBy: row.created_by,
  };
}

function fromPlanningItem(row) {
  return {
    id: row.id,
    group: row.group_key,
    type: row.type,
    name: row.name,
    amount: money(row.amount),
    recurrence: row.recurrence,
    day: row.due_day,
    categoryId: row.category_id,
    accountId: row.account_id,
    cardId: row.card_id,
    paymentMethod: row.payment_method,
    active: row.active,
    notes: row.notes,
    createdBy: row.created_by,
  };
}

function fromTransaction(row) {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amount: money(row.amount),
    date: row.transaction_date,
    categoryId: row.category_id,
    accountId: row.account_id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    cardId: row.card_id,
    linkedPlanningId: row.planning_item_id,
    paymentMethod: row.payment_method,
    installments: row.installments,
    currentInstallment: row.current_installment,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
  };
}

function fromMarketGroup(row) {
  return {
    id: row.id,
    name: row.name,
    forecast: money(row.forecast),
    createdBy: row.created_by,
  };
}

function fromMarketHistory(row) {
  return {
    id: row.id,
    month: monthText(row.month),
    amount: money(row.amount),
    notes: row.notes,
    createdBy: row.created_by,
  };
}

function fromGroceryReceipt(row) {
  return {
    id: row.id,
    store: row.store || "",
    purchaseDate: row.purchase_date,
    total: money(row.total),
    createdBy: row.created_by,
  };
}

function fromGroceryItem(row) {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    purchaseDate: row.purchase_date,
    name: row.name,
    product: row.product,
    category: row.category,
    quantity: Number(row.quantity || 0),
    unit: row.unit,
    totalPrice: money(row.total_price),
    createdBy: row.created_by,
  };
}

function fromInvestment(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amount: money(row.amount),
    estimatedYield: money(row.estimated_yield),
    realYield: money(row.real_yield),
    applicationDate: row.application_date,
    maturityDate: row.maturity_date,
    institution: row.institution,
    liquidity: row.liquidity,
    notes: row.notes,
    createdBy: row.created_by,
  };
}

function fromInvestmentHistory(row) {
  return {
    id: row.id,
    month: monthText(row.month),
    amount: money(row.amount),
  };
}

function statusToDb(status) {
  return { aberta: "open", fechada: "closed", paga: "paid", atrasada: "late" }[status] || status || "open";
}

function statusFromDb(status) {
  return { open: "aberta", closed: "fechada", paid: "paga", late: "atrasada" }[status] || status || "aberta";
}
