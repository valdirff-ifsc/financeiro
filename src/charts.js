import { formatCurrency, toNumber } from "./calculations.js";

const fallbackColors = ["#0f766e", "#d95f48", "#4f5fa8", "#c18120", "#248a55", "#8f4d73"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emptyChart(message = "Sem dados suficientes para este gráfico.") {
  return `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function legend(items) {
  if (!items.length) return "";
  return `<div class="legend">${items
    .map(
      (item, index) => `
        <div class="legend-item">
          <span class="legend-name">
            <span class="legend-dot" style="background:${item.color || fallbackColors[index % fallbackColors.length]}"></span>
            <span>${escapeHtml(item.label)}</span>
          </span>
          <strong>${formatCurrency(item.value)}</strong>
        </div>
      `,
    )
    .join("")}</div>`;
}

export function donutChart(items, options = {}) {
  const filtered = items.filter((item) => toNumber(item.value) > 0);
  const total = filtered.reduce((sum, item) => sum + toNumber(item.value), 0);
  if (!total) return emptyChart(options.emptyMessage);

  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const circles = filtered
    .map((item, index) => {
      const value = toNumber(item.value);
      const dash = (value / total) * circumference;
      const circle = `
        <circle
          cx="110"
          cy="110"
          r="${radius}"
          fill="transparent"
          stroke="${item.color || fallbackColors[index % fallbackColors.length]}"
          stroke-width="28"
          stroke-dasharray="${dash} ${circumference - dash}"
          stroke-dashoffset="${-offset}"
          stroke-linecap="round"
        />`;
      offset += dash;
      return circle;
    })
    .join("");

  return `
    <div class="chart">
      <svg viewBox="0 0 220 220" role="img" aria-label="${escapeHtml(options.label || "Gráfico de rosca")}">
        <circle cx="110" cy="110" r="${radius}" fill="transparent" stroke="var(--chart-line)" stroke-width="28" />
        <g transform="rotate(-90 110 110)">${circles}</g>
        <text x="110" y="104" text-anchor="middle" font-size="17" font-weight="800" fill="var(--chart-text)">${escapeHtml(options.centerLabel || "Total")}</text>
        <text x="110" y="128" text-anchor="middle" font-size="16" font-weight="700" fill="var(--chart-muted)">${escapeHtml(formatCurrency(total))}</text>
      </svg>
      ${legend(filtered.slice(0, options.legendLimit || 6))}
    </div>
  `;
}

export function barChart(items, options = {}) {
  const filtered = items.filter((item) => toNumber(item.value) > 0);
  const max = Math.max(...filtered.map((item) => toNumber(item.value)), 0);
  if (!max) return emptyChart(options.emptyMessage);

  const width = 720;
  const height = 260;
  const padding = { top: 18, right: 22, bottom: 56, left: 64 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const barGap = 14;
  const barWidth = Math.max(28, (plotWidth - barGap * (filtered.length - 1)) / filtered.length);

  const bars = filtered
    .map((item, index) => {
      const value = toNumber(item.value);
      const barHeight = (value / max) * plotHeight;
      const x = padding.left + index * (barWidth + barGap);
      const y = padding.top + plotHeight - barHeight;
      const label = String(item.label || "").length > 14 ? `${String(item.label).slice(0, 13)}...` : item.label;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="${item.color || fallbackColors[index % fallbackColors.length]}" />
        <text x="${x + barWidth / 2}" y="${height - 30}" text-anchor="middle" font-size="12" fill="var(--chart-muted)">${escapeHtml(label)}</text>
        <text x="${x + barWidth / 2}" y="${Math.max(18, y - 7)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--chart-text)">${escapeHtml(formatCurrency(value))}</text>
      `;
    })
    .join("");

  return `
    <div class="chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Gráfico de barras")}">
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="var(--chart-line)" />
        ${bars}
      </svg>
    </div>
  `;
}

export function groupedBarChart(items, options = {}) {
  if (!items.length) return emptyChart(options.emptyMessage);
  const max = Math.max(...items.flatMap((item) => [toNumber(item.income), toNumber(item.expense)]), 0);
  if (!max) return emptyChart(options.emptyMessage);

  const width = 760;
  const height = 270;
  const padding = { top: 18, right: 24, bottom: 56, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const groupWidth = plotWidth / items.length;
  const barWidth = Math.min(24, groupWidth / 3);

  const bars = items
    .map((item, index) => {
      const x = padding.left + index * groupWidth + groupWidth / 2;
      const incomeHeight = (toNumber(item.income) / max) * plotHeight;
      const expenseHeight = (toNumber(item.expense) / max) * plotHeight;
      const baseY = padding.top + plotHeight;
      return `
        <rect x="${x - barWidth - 2}" y="${baseY - incomeHeight}" width="${barWidth}" height="${incomeHeight}" rx="5" fill="#248a55" />
        <rect x="${x + 2}" y="${baseY - expenseHeight}" width="${barWidth}" height="${expenseHeight}" rx="5" fill="#d95f48" />
        <text x="${x}" y="${height - 30}" text-anchor="middle" font-size="12" fill="var(--chart-muted)">${escapeHtml(item.label)}</text>
      `;
    })
    .join("");

  return `
    <div class="chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Receitas e despesas")}">
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="var(--chart-line)" />
        ${bars}
      </svg>
      <div class="legend">
        <div class="legend-item"><span class="legend-name"><span class="legend-dot" style="background:#248a55"></span><span>Receitas</span></span></div>
        <div class="legend-item"><span class="legend-name"><span class="legend-dot" style="background:#d95f48"></span><span>Despesas</span></span></div>
      </div>
    </div>
  `;
}

export function lineChart(items, options = {}) {
  if (!items.length) return emptyChart(options.emptyMessage);
  const values = items.map((item) => toNumber(item.value ?? item.balance));
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const width = 760;
  const height = 270;
  const padding = { top: 22, right: 24, bottom: 52, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const points = values.map((value, index) => {
    const x = padding.left + (index / Math.max(1, values.length - 1)) * plotWidth;
    const y = padding.top + plotHeight - ((value - min) / range) * plotHeight;
    return { x, y, value, label: items[index].label };
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  return `
    <div class="chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Evolução")}">
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="var(--chart-line)" />
        <path d="${path}" fill="none" stroke="${options.color || "#0f766e"}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        ${points
          .map(
            (point) => `
              <circle cx="${point.x}" cy="${point.y}" r="5" fill="${options.color || "#0f766e"}" />
              <text x="${point.x}" y="${height - 29}" text-anchor="middle" font-size="12" fill="var(--chart-muted)">${escapeHtml(point.label)}</text>
            `,
          )
          .join("")}
      </svg>
    </div>
  `;
}

export function comparisonBars(items, options = {}) {
  const max = Math.max(...items.map((item) => toNumber(item.value)), 0);
  if (!max) return emptyChart(options.emptyMessage);

  return `
    <div class="split-list">
      ${items
        .map((item, index) => {
          const rate = Math.min(100, (toNumber(item.value) / max) * 100);
          return `
            <div class="progress">
              <div class="progress-meta">
                <strong>${escapeHtml(item.label)}</strong>
                <span>${formatCurrency(item.value)}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width:${rate}%;background:${item.color || fallbackColors[index % fallbackColors.length]}"></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}
