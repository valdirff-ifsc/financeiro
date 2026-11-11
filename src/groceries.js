export const GROCERY_CATEGORIES = [
  "Padaria",
  "Carnes e ovos",
  "Massas e grãos",
  "Hortifruti",
  "Laticínios e frios",
  "Bebidas",
  "Mercearia",
  "Congelados",
  "Doces e snacks",
  "Limpeza",
  "Higiene",
  "Outros",
];

export const GROCERY_UNITS = ["un", "kg", "l"];

export function productKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Converte g -> kg e ml -> l para somar o mesmo produto comprado em embalagens diferentes.
export function normalizeQuantity(quantity, unit) {
  const value = number(quantity);
  const key = String(unit || "un").toLowerCase();
  if (key === "g") return { quantity: value / 1000, unit: "kg" };
  if (key === "ml") return { quantity: value / 1000, unit: "l" };
  if (key === "kg" || key === "l") return { quantity: value, unit: key };
  return { quantity: value, unit: "un" };
}

export function formatQuantity(quantity, unit) {
  const value = number(quantity);
  if (unit === "kg" && value > 0 && value < 1) return `${Math.round(value * 1000)} g`;
  if (unit === "l" && value > 0 && value < 1) return `${Math.round(value * 1000)} ml`;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  return `${text} ${unit || "un"}`;
}

export function itemMonth(item) {
  return String(item.purchaseDate || "").slice(0, 7);
}

export function summarizeMonth(items, month) {
  const rows = new Map();
  for (const item of items) {
    if (itemMonth(item) !== month) continue;
    const product = (item.product || item.name || "").trim();
    if (!product) continue;
    const { quantity, unit } = normalizeQuantity(item.quantity, item.unit);
    const key = `${productKey(product)}|${unit}`;
    const row = rows.get(key) || { key, product, category: item.category || "Outros", unit, quantity: 0, total: 0, purchases: 0 };
    row.quantity += quantity;
    row.total += number(item.totalPrice);
    row.purchases += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}

export function compareMonths(items, month, previousMonth) {
  const current = summarizeMonth(items, month);
  const previous = new Map(summarizeMonth(items, previousMonth).map((row) => [row.key, row]));
  return current.map((row) => {
    const before = previous.get(row.key);
    const previousQuantity = before ? before.quantity : null;
    const delta = before ? row.quantity - before.quantity : null;
    const deltaPct = before && before.quantity > 0 ? delta / before.quantity : null;
    return { ...row, previousQuantity, delta, deltaPct };
  });
}

export function categoryTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    const entry = totals.get(row.category) || { category: row.category, total: 0, products: 0 };
    entry.total += row.total;
    entry.products += 1;
    totals.set(row.category, entry);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

export function productHistory(items, product, unit, months) {
  const key = productKey(product);
  return months.map((month) => {
    const row = summarizeMonth(items, month).find((entry) => productKey(entry.product) === key && entry.unit === unit);
    return { month, quantity: row?.quantity || 0, total: row?.total || 0 };
  });
}

// Valida e limpa a resposta da IA antes de mostrar para revisão.
export function sanitizeReceipt(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.date || "")) ? payload.date : "";
  return {
    store: String(payload?.store || "").trim().slice(0, 80),
    date,
    items: items
      .map((item) => {
        const { quantity, unit } = normalizeQuantity(item?.quantity || 1, item?.unit);
        const category = GROCERY_CATEGORIES.includes(item?.category) ? item.category : "Outros";
        const name = String(item?.name || "").trim().slice(0, 80);
        return {
          name,
          product: String(item?.product || name).trim().slice(0, 60),
          category,
          quantity: quantity > 0 ? Number(quantity.toFixed(3)) : 1,
          unit,
          totalPrice: Math.max(0, Number(number(item?.total_price ?? item?.totalPrice).toFixed(2))),
        };
      })
      .filter((item) => item.name || item.product),
  };
}
