import test from "node:test";
import assert from "node:assert/strict";
import { compareMonths, normalizeQuantity, sanitizeReceipt, summarizeMonth } from "../src/groceries.js";

const item = (product, quantity, unit, totalPrice, purchaseDate) => ({ product, name: product, category: "Outros", quantity, unit, totalPrice, purchaseDate });

test("soma o mesmo produto ignorando acento e caixa, e converte g para kg", () => {
  const rows = summarizeMonth([
    item("Macarrão", 500, "g", 5, "2026-10-03"),
    item("macarrao", 1, "kg", 9, "2026-10-20"),
    item("Macarrão", 1, "kg", 9, "2026-11-02"),
  ], "2026-10");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 1.5);
  assert.equal(rows[0].total, 14);
});

test("compara com o mês anterior", () => {
  const items = [item("Pão", 10, "un", 20, "2026-10-01"), item("Pão", 15, "un", 30, "2026-11-01"), item("Leite", 2, "l", 12, "2026-11-01")];
  const rows = compareMonths(items, "2026-11", "2026-10");
  const bread = rows.find((row) => row.product === "Pão");
  assert.equal(bread.delta, 5);
  assert.equal(bread.deltaPct, 0.5);
  assert.equal(rows.find((row) => row.product === "Leite").previousQuantity, null);
});

test("sanitiza resposta da IA", () => {
  const result = sanitizeReceipt({ store: " Mercado X ", date: "03/10/2026", items: [{ name: "PAO FR", product: "Pão francês", category: "Padaria", quantity: 300, unit: "g", total_price: "4.5" }, { name: "", product: "" }] });
  assert.equal(result.date, "");
  assert.equal(result.items.length, 1);
  assert.deepEqual([result.items[0].quantity, result.items[0].unit, result.items[0].totalPrice], [0.3, "kg", 4.5]);
  assert.deepEqual(normalizeQuantity(2, "xx"), { quantity: 2, unit: "un" });
});
