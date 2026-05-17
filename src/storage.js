import { defaultData, STORAGE_KEY } from "./data.js";

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(saved) {
  const base = clone(defaultData);
  if (!saved || typeof saved !== "object") return base;

  const merged = { ...base, ...saved };
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key])) {
      merged[key] = Array.isArray(saved[key]) ? saved[key] : base[key];
    } else if (base[key] && typeof base[key] === "object") {
      merged[key] = { ...base[key], ...(saved[key] || {}) };
    }
  }

  return merged;
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(defaultData);
    return mergeDefaults(JSON.parse(raw));
  } catch (error) {
    console.warn("Não foi possível carregar os dados locais.", error);
    return clone(defaultData);
  }
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function resetData() {
  const data = clone(defaultData);
  saveData(data);
  return data;
}

export function exportData(data) {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "financeiro-pessoal",
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `financeiro-pessoal-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function importData(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const data = parsed.data || parsed;
  const merged = mergeDefaults(data);
  saveData(merged);
  return merged;
}
