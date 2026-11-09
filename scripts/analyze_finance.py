#!/usr/bin/env python3
"""Normaliza faturas C6 e gera uma auditoria antes da importação no app."""

from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "faturas"
OUTPUT = ROOT / "analises"

SHEET_MONTHS = {
    "Fatura_2026-02-10": "2026-02",
    "Fatura_2026-03-10": "2026-03",
    "Fatura_2026-04-10": "2026-04",
    "Fatura_2026-05-10": "2026-05",
    "Fatura_2026-06-10": "2026-06",
    "Julho": "2026-07",
    "agosto": "2026-08",
}

CATEGORY_RULES = [
    ("Academia", ["ACADEMIA", "U FIT"]),
    ("Assinaturas", ["PRIME VIDEO", "QCONCURSOS", "OVERLEAF", "IFOOD CLUB", "MELIMAIS"]),
    ("Educação", ["UNIVALI", "CURSO", "ESCOLA", "FACULDADE"]),
    ("Alimentação", ["IFOOD", "RESTAUR", "LANCH", "CAFE ", "CAFÉ", "ACAI", "AÇAÍ", "PADARIA", "SUPERMERC", "MERCADO ", "KOCH", "KAZILY", "SORVETE"]),
    ("Transporte", ["UBER", "99APP", "POSTO", "COMBUST", "ESTACION", "PEDAGIO", "PEDÁGIO"]),
    ("Saúde", ["FARMA", "DROGA", "RDSAUDE", "ODONTO", "CLINICA", "CLÍNICA"]),
    ("Viagem", ["AIRBNB", "HOTEL", "LATAM", "AZUL LINHAS", "GOL LINHAS"]),
    ("Lazer", ["STEAM", "CINEMA", "INGRESSO", "EVENTO"]),
    ("Casa", ["MERCADOMOVEIS", "MECANICA SALVIO", "RESCAROLI", "MATERIAL", "MILIUM"]),
    ("Compras", ["AMAZON", "MERCADOLIVRE", "SHOPEE", "CONFECCOES", "DELL"]),
]

KNOWN_RECURRING = [
    "ACADEMIA VIDA FITNESS",
    "U FIT ACADEMIA",
    "QCONCURSOS",
    "GOOGLE PRIME VIDEO",
    "OVERLEAF",
    "IFOOD CLUB",
    "MELIMAIS",
]

MONTH_NUMBERS = {
    "Janeiro": 1, "Fevereiro": 2, "Março": 3, "Abril": 4, "Maio": 5,
    "Junho": 6, "Julho": 7, "Agosto": 8, "Setembro": 9, "Outubro": 10,
    "Novembro": 11, "Dezembro": 12,
}

STATEMENT_TYPES = [
    "Débito de Cartão", "Outros gastos", "Devolução PIX", "Entrada PIX",
    "Saída PIX", "Pagamento", "Entradas",
]


def repair_text(value: object) -> str:
    text = "" if pd.isna(value) else str(value).strip()
    for _ in range(2):
        if "Ã" not in text and "Â" not in text:
            break
        try:
            text = text.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
    return re.sub(r"\s+", " ", text).strip()


def parse_date(value: object) -> date:
    if isinstance(value, (datetime, date)):
        return value.date() if isinstance(value, datetime) else value
    return datetime.strptime(repair_text(value), "%d/%m/%Y").date()


def parse_installment(value: object) -> tuple[int | None, int | None, str]:
    if isinstance(value, (datetime, date)):
        # O Excel converteu textos como 7/10 em uma data: dia = parcela atual,
        # mês = total de parcelas.
        return value.day, value.month, f"{value.day}/{value.month}"
    text = repair_text(value).replace("Ãš", "Ú")
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})", text)
    if match:
        return int(match.group(1)), int(match.group(2)), text
    return None, None, "Única"


def classify_category(description: str, source_category: str) -> str:
    haystack = f"{description} {source_category}".upper()
    for category, needles in CATEGORY_RULES:
        if any(needle in haystack for needle in needles):
            return category
    return "Outros"


def row_kind(description: str, value: float) -> str:
    upper = description.upper()
    if "INCLUSAO DE PAGAMENTO" in upper or "INCLUSÃO DE PAGAMENTO" in upper:
        return "pagamento_fatura"
    if value < 0:
        return "credito_ou_estorno"
    return "compra_cartao"


def normalized_description(description: str) -> str:
    text = description.upper().strip()
    text = re.sub(r"\s+", " ", text)
    # Remove apenas códigos finais que contenham números. Palavras legítimas
    # como ACADEMIA não podem desaparecer por terem oito caracteres.
    text = re.sub(r"\s+(?=[A-Z0-9]*\d)[A-Z0-9]{8,}$", "", text)
    return text


def add_month(month: str, offset: int) -> str:
    year, number = map(int, month.split("-"))
    number += offset
    year += (number - 1) // 12
    number = (number - 1) % 12 + 1
    return f"{year:04d}-{number:02d}"


def brl(value: float) -> str:
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"


def parse_brl(value: str) -> float:
    negative = value.strip().startswith("-")
    number = value.replace("-", "").replace("R$", "").strip().replace(".", "").replace(",", ".")
    return -float(number) if negative else float(number)


def statement_category(description: str) -> str:
    upper = description.upper()
    rules = [
        ("Moradia", ["UNIFIQUE", "FABIANA PEIXER", "ALUGUEL", "ENERGIA", "CELESC"]),
        ("Alimentação", ["KOCH", "KOMPRAO", "CARREFOUR", "ALIMENT", "RESTAUR", "ARCOS DOURADOS", "MCDONALD", "PADARIA", "GAS ", "PAGAR ME"]),
        ("Transporte", ["POSTO", "PEDAGIO", "PEDÁGIO", "C6TAG", "UBER", "99APP"]),
        ("Saúde", ["FARMA", "DROGA", "CLUBE MUTUALISTA", "GROWTH SUPPLEMENTS"]),
        ("Impostos", ["SEFAZ", "RECEITA FEDERAL", "DARE"]),
        ("Telefonia", ["RECARGA CELULAR"]),
        ("Compras", ["MADESA", "LELY CARTUCHOS", "KALUNGA"]),
        ("Lazer", ["ARCOPLEX", "CINEMA"]),
        ("Financeiro", ["SEGURO CONTA", "IOF", "JUROS"]),
    ]
    for category, needles in rules:
        if any(needle in upper for needle in needles):
            return category
    return "Outros"


def statement_kind(entry_type: str, description: str, value: float) -> str:
    upper = description.upper()
    if "PGTO FAT CARTAO C6" in upper:
        return "pagamento_fatura"
    if "APLICAÇÃO DE CDB" in upper or "APLICACAO DE CDB" in upper:
        return "investimento_aplicacao"
    if "RESGATE DE CDB" in upper:
        return "investimento_resgate"
    if "VALDIR FERREIRA FILHO" in upper and ("PIX RECEBIDO" in upper or "PIX ENVIADO" in upper):
        return "transferencia_propria"
    if value > 0 and "TRACTIAN TECNOLOGIA" in upper:
        return "receita_tractian"
    if value > 0 and "CAMILA CRISTINE DE MELO" in upper:
        return "receita_pensao"
    if entry_type == "Devolução PIX":
        return "reembolso"
    if value > 0 and ("RENDIMENTOS" in upper or "CASHBACK" in upper):
        return "receita_financeira"
    if value > 0 and "RECEBIMENTO DE TED" in upper:
        return "entrada_ted_revisar"
    if entry_type == "Entrada PIX" or value > 0:
        return "entrada_revisar"
    if entry_type in {"Débito de Cartão", "Outros gastos", "Pagamento"}:
        return "despesa_conta"
    if entry_type == "Saída PIX":
        upper = description.upper()
        business_markers = [" LTDA", " S/A", " SA", "COMERCIO", "TELECOMUNICACOES", "POSTO", "SUPERMERCADO", "KOCH", "CARREFOUR", "RECEITA FEDERAL", "FACEBOOK", "EBANX", "ASSOCIACAO", "PAGAR ME", "SEFAZ"]
        return "despesa_conta" if any(marker in upper for marker in business_markers) else "saida_pessoal_revisar"
    return "revisar"


def load_statement() -> tuple[list[dict], dict[str, dict]]:
    path = SOURCE / "extrato.md"
    lines = path.read_text(encoding="utf-8").splitlines()
    current_month = None
    declared: dict[str, dict] = {}
    rows = []
    header_re = re.compile(r"^(\w+) 2026 .* Entradas: (R\$ [\d.]+,\d{2}) • Saídas: (R\$ [\d.]+,\d{2})")
    transaction_re = re.compile(r"^(\d{2}/\d{2}) (\d{2}/\d{2}) (.+?) (-?R\$ [\d.]+,\d{2})$")
    occurrence = Counter()
    for index, line in enumerate(lines):
        header = header_re.match(line)
        if header and header.group(1) in MONTH_NUMBERS:
            current_month = f"2026-{MONTH_NUMBERS[header.group(1)]:02d}"
            declared[current_month] = {"entradas": parse_brl(header.group(2)), "saidas": parse_brl(header.group(3))}
            continue
        match = transaction_re.match(line)
        if not match:
            wrapped = re.match(r"^(\d{2}/\d{2}) (\d{2}/\d{2}) (.+?)$", line)
            continuation = []
            if wrapped:
                for candidate in lines[index + 1:index + 6]:
                    if re.match(r"^\d{2}/\d{2} \d{2}/\d{2} ", candidate) or candidate.startswith("Saldo do dia"):
                        break
                    continuation.append(candidate)
                    if re.fullmatch(r"-?R\$ [\d.]+,\d{2}", candidate):
                        break
            if wrapped and continuation and re.fullmatch(r"-?R\$ [\d.]+,\d{2}", continuation[-1]):
                event_date, accounting_date, body = wrapped.groups()
                description = " ".join(continuation[:-1]).strip() or "Descrição ausente no extrato"
                line = f"{event_date} {accounting_date} {body} {description} {continuation[-1]}"
                match = transaction_re.match(line)
        if not match or not current_month:
            continue
        event_date, accounting_date, body, value_text = match.groups()
        entry_type = next((kind for kind in STATEMENT_TYPES if body.startswith(kind + " ")), None)
        if not entry_type:
            continue
        description = body[len(entry_type):].strip()
        value = round(parse_brl(value_text), 2)
        full_date = datetime.strptime(f"{event_date}/2026", "%d/%m/%Y").date()
        full_accounting_date = datetime.strptime(f"{accounting_date}/2026", "%d/%m/%Y").date()
        identity = (full_date.isoformat(), full_accounting_date.isoformat(), entry_type, description, value)
        occurrence[identity] += 1
        raw_key = "extrato|" + "|".join(map(str, identity + (occurrence[identity],)))
        kind = statement_kind(entry_type, description, value)
        rows.append({
            "id_importacao": hashlib.sha256(raw_key.encode()).hexdigest()[:20],
            "data_lancamento": full_date.isoformat(),
            "data_contabil": full_accounting_date.isoformat(),
            "mes": current_month,
            "tipo_extrato": entry_type,
            "descricao": description,
            "natureza": kind,
            "categoria_sugerida": statement_category(description),
            "valor": value,
            "conta": "C6 Bank",
        })
    return rows, declared


def load_rows() -> list[dict]:
    rows: list[dict] = []
    workbook = SOURCE / "faturasC6-2026.xlsx"
    for sheet, invoice_month in SHEET_MONTHS.items():
        frame = pd.read_excel(workbook, sheet_name=sheet)
        frame.columns = [repair_text(column) for column in frame.columns]
        rows.extend(normalize_frame(frame, invoice_month, f"faturasC6-2026.xlsx:{sheet}"))

    csv_path = SOURCE / "Fatura_2026-09-10 - Fatura_2026-10-10.csv"
    frame = pd.read_csv(csv_path)
    frame.columns = [repair_text(column) for column in frame.columns]
    rows.extend(normalize_frame(frame, "2026-10", csv_path.name))
    return rows


def normalize_frame(frame: pd.DataFrame, invoice_month: str, source: str) -> list[dict]:
    normalized = []
    occurrence = Counter()
    for _, raw in frame.iterrows():
        description = repair_text(raw.get("Descrição"))
        if not description:
            continue
        purchase_date = parse_date(raw.get("Data de Compra"))
        value = round(float(raw.get("Valor (em R$)") or 0), 2)
        current, total, installment_label = parse_installment(raw.get("Parcela"))
        source_category = repair_text(raw.get("Categoria"))
        card_ending = repair_text(raw.get("Final do Cartão")).replace(".0", "")
        identity = (invoice_month, purchase_date.isoformat(), description, installment_label, value, card_ending)
        occurrence[identity] += 1
        raw_key = "|".join(map(str, identity + (occurrence[identity],)))
        normalized.append({
            "id_importacao": hashlib.sha256(raw_key.encode()).hexdigest()[:20],
            "fonte": source,
            "mes_fatura": invoice_month,
            "data_compra": purchase_date.isoformat(),
            "mes_compra": purchase_date.strftime("%Y-%m"),
            "descricao_original": description,
            "descricao_normalizada": normalized_description(description),
            "categoria_origem": source_category,
            "categoria_sugerida": classify_category(description, source_category),
            "tipo": row_kind(description, value),
            "parcela_atual": current,
            "parcelas_total": total,
            "parcela": installment_label,
            "valor": value,
            "final_cartao": card_ending,
            "conta": "C6 Bank",
            "instrumento": "Cartão C6",
        })
    return normalized


def identify_patterns(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    purchases = [row for row in rows if row["tipo"] == "compra_cartao"]
    by_merchant: dict[str, list[dict]] = defaultdict(list)
    for row in purchases:
        by_merchant[row["descricao_normalizada"]].append(row)

    recurring, periodic = [], []
    for merchant, items in by_merchant.items():
        months = sorted({item["mes_fatura"] for item in items})
        unique_items = [item for item in items if item["parcelas_total"] is None]
        unique_months = sorted({item["mes_fatura"] for item in unique_items})
        values = [item["valor"] for item in unique_items if item["valor"] > 0]
        known = any(needle in merchant for needle in KNOWN_RECURRING)
        stable = bool(values) and max(values) - min(values) <= max(2.0, sum(values) / len(values) * 0.08)
        record = {
            "descricao": merchant,
            "meses": months,
            "ocorrencias": len(items),
            "valor_mediano": round(float(pd.Series(values).median()), 2) if values else 0,
            "categoria": Counter(item["categoria_sugerida"] for item in items).most_common(1)[0][0],
        }
        if len(unique_months) >= 3 and (known or stable):
            record["confianca"] = "alta" if known and stable else "média"
            recurring.append(record)
        elif len(months) >= 3:
            record["motivo"] = "repetido, mas variável ou parcelado; não assumir assinatura"
            periodic.append(record)
    return sorted(recurring, key=lambda item: (-item["ocorrencias"], item["descricao"])), sorted(periodic, key=lambda item: (-item["ocorrencias"], item["descricao"]))


def active_installments(rows: list[dict]) -> list[dict]:
    latest = max(row["mes_fatura"] for row in rows)
    items = []
    for row in rows:
        if row["mes_fatura"] != latest or row["tipo"] != "compra_cartao":
            continue
        current, total = row["parcela_atual"], row["parcelas_total"]
        if current and total and current < total:
            remaining = total - current
            items.append({
                "descricao": row["descricao_normalizada"],
                "parcela_atual": current,
                "parcelas_total": total,
                "valor_mensal": row["valor"],
                "parcelas_restantes": remaining,
                "saldo_previsto": round(row["valor"] * remaining, 2),
                "ultimo_mes": add_month(latest, remaining),
                "categoria": row["categoria_sugerida"],
            })
    return sorted(items, key=lambda item: (item["ultimo_mes"], item["descricao"]))


def write_csv(rows: list[dict]) -> None:
    path = OUTPUT / "lancamentos_normalizados.csv"
    fields = list(rows[0])
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def monthly_summary(rows: list[dict]) -> list[dict]:
    grouped = defaultdict(lambda: {"compras": 0.0, "creditos": 0.0, "pagamentos": 0.0, "linhas": 0})
    for row in rows:
        group = grouped[row["mes_fatura"]]
        group["linhas"] += 1
        if row["tipo"] == "compra_cartao":
            group["compras"] += row["valor"]
        elif row["tipo"] == "credito_ou_estorno":
            group["creditos"] += row["valor"]
        else:
            group["pagamentos"] += row["valor"]
    result = []
    for month in sorted(grouped):
        item = grouped[month]
        item = {key: round(value, 2) if isinstance(value, float) else value for key, value in item.items()}
        item["mes"] = month
        item["fatura_liquida_sem_pagamento"] = round(item["compras"] + item["creditos"], 2)
        result.append(item)
    return result


def write_reports(rows: list[dict], recurring: list[dict], periodic: list[dict], installments: list[dict]) -> None:
    summaries = monthly_summary(rows)
    card_endings = Counter(row["final_cartao"] for row in rows)
    category_totals = defaultdict(float)
    for row in rows:
        if row["tipo"] in {"compra_cartao", "credito_ou_estorno"}:
            category_totals[row["categoria_sugerida"]] += row["valor"]

    report = [
        "# Relatório financeiro C6 — 2026",
        "",
        "> Auditoria das faturas disponíveis. O cruzamento com o extrato está documentado separadamente em `CONCILIACAO_CONTA_C6.md`.",
        "",
        "## Cobertura",
        "",
        "- Faturas encontradas: fevereiro a agosto e outubro de 2026.",
        "- Lacunas documentais: janeiro e setembro de 2026.",
        "- Conta lógica: **C6 Bank**; finais de cartão são instrumentos da mesma conta, não contas separadas.",
        f"- Finais observados: {', '.join(f'{ending} ({count} linhas)' for ending, count in sorted(card_endings.items()))}.",
        f"- Total de linhas normalizadas: **{len(rows)}**.",
        "",
        "## Fechamento por fatura",
        "",
        "| Mês da fatura | Compras | Créditos/estornos | Pagamento lançado na fatura | Fatura líquida sem pagamento |",
        "|---|---:|---:|---:|---:|",
    ]
    for item in summaries:
        report.append(f"| {item['mes']} | {brl(item['compras'])} | {brl(item['creditos'])} | {brl(item['pagamentos'])} | **{brl(item['fatura_liquida_sem_pagamento'])}** |")
    report += [
        "",
        "## Gastos líquidos por categoria sugerida",
        "",
        "| Categoria | Valor |",
        "|---|---:|",
    ]
    for category, value in sorted(category_totals.items(), key=lambda item: -item[1]):
        report.append(f"| {category} | {brl(value)} |")
    report += [
        "",
        "## Regras financeiras adotadas",
        "",
        "- Compra no cartão pertence ao mês da compra para análise de comportamento.",
        "- A mesma compra pertence ao mês da fatura para fluxo de compromissos.",
        "- Pagamento da fatura não é uma segunda despesa; é saída de caixa que quita compras já contabilizadas.",
        "- Valor negativo de estabelecimento é crédito/estorno; `Inclusao de Pagamento` é pagamento de fatura.",
        "- Parcelas são registradas pelo valor mensal, mantendo o saldo restante separadamente.",
    ]
    (OUTPUT / "RELATORIO_FINANCEIRO_2026.md").write_text("\n".join(report) + "\n", encoding="utf-8")

    installments_md = [
        "# Parcelamentos ativos",
        "",
        "> Projeção baseada na fatura mais recente disponível (outubro de 2026).",
        "",
        "| Descrição | Parcela atual | Valor mensal | Restantes | Saldo previsto | Último mês | Categoria |",
        "|---|---:|---:|---:|---:|---|---|",
    ]
    for item in installments:
        installments_md.append(f"| {item['descricao']} | {item['parcela_atual']}/{item['parcelas_total']} | {brl(item['valor_mensal'])} | {item['parcelas_restantes']} | {brl(item['saldo_previsto'])} | {item['ultimo_mes']} | {item['categoria']} |")
    installments_md += ["", f"**Saldo parcelado futuro identificado:** {brl(sum(item['saldo_previsto'] for item in installments))}." ]
    (OUTPUT / "PARCELAMENTOS_ATIVOS.md").write_text("\n".join(installments_md) + "\n", encoding="utf-8")

    recurring_md = [
        "# Recorrências identificadas",
        "",
        "Recorrência só é sugerida quando há repetição suficiente e padrão estável ou estabelecimento reconhecido. Parcelamento não é tratado como assinatura.",
        "",
        "## Recorrências prováveis",
        "",
        "| Descrição | Ocorrências | Valor de referência | Categoria | Confiança |",
        "|---|---:|---:|---|---|",
    ]
    for item in recurring:
        recurring_md.append(f"| {item['descricao']} | {item['ocorrencias']} | {brl(item['valor_mediano'])} | {item['categoria']} | {item['confianca']} |")
    recurring_md += ["", "## Repetições que não devem virar recorrência automaticamente", "", "| Descrição | Ocorrências | Motivo |", "|---|---:|---|"]
    for item in periodic[:30]:
        recurring_md.append(f"| {item['descricao']} | {item['ocorrencias']} | {item['motivo']} |")
    (OUTPUT / "RECORRENCIAS_IDENTIFICADAS.md").write_text("\n".join(recurring_md) + "\n", encoding="utf-8")

    forecast = defaultdict(float)
    for item in installments:
        for offset in range(1, item["parcelas_restantes"] + 1):
            forecast[add_month("2026-10", offset)] += item["valor_mensal"]
    for item in recurring:
        if item["confianca"] != "alta":
            continue
        for offset in range(1, 7):
            forecast[add_month("2026-10", offset)] += item["valor_mediano"]
    forecast_md = [
        "# Previsão dos próximos meses",
        "",
        "> Base mínima já comprometida por parcelas ativas e recorrências prováveis do cartão. Não inclui aluguel, boletos, PIX ou receitas até o extrato ser conciliado.",
        "",
        "| Mês | Cartão previsto |",
        "|---|---:|",
    ]
    for month in sorted(forecast):
        forecast_md.append(f"| {month} | **{brl(forecast[month])}** |")
    (OUTPUT / "PREVISAO_PROXIMOS_MESES.md").write_text("\n".join(forecast_md) + "\n", encoding="utf-8")

    merchants = defaultdict(lambda: {"valor": 0.0, "ocorrencias": 0, "meses": set(), "categoria": Counter()})
    for row in rows:
        if row["tipo"] not in {"compra_cartao", "credito_ou_estorno"}:
            continue
        merchant = merchants[row["descricao_normalizada"]]
        merchant["valor"] += row["valor"]
        merchant["ocorrencias"] += 1
        merchant["meses"].add(row["mes_fatura"])
        merchant["categoria"][row["categoria_sugerida"]] += 1
    merchants_md = [
        "# Categorias e estabelecimentos",
        "",
        "> Ranking auditável dos estabelecimentos nas faturas. Os valores incluem parcelas cobradas em cada fatura e descontam créditos do próprio estabelecimento.",
        "",
        "| Estabelecimento | Categoria sugerida | Ocorrências | Faturas | Valor líquido |",
        "|---|---|---:|---:|---:|",
    ]
    for name, item in sorted(merchants.items(), key=lambda pair: -pair[1]["valor"]):
        category = item["categoria"].most_common(1)[0][0]
        merchants_md.append(f"| {name} | {category} | {item['ocorrencias']} | {len(item['meses'])} | {brl(item['valor'])} |")
    (OUTPUT / "CATEGORIAS_E_ESTABELECIMENTOS.md").write_text("\n".join(merchants_md) + "\n", encoding="utf-8")

    questions = [
        "# Pendências e confirmações",
        "",
        "## Lacunas documentais",
        "",
        "1. Não foram encontradas as faturas com vencimento em janeiro e setembro de 2026; os pagamentos aparecem no extrato, mas o detalhamento das compras não.",
        "",
        "## Antes da importação no Supabase",
        "",
        "- Confirmar os casos de recorrência com confiança média.",
        "- Revisar lançamentos classificados como `Outros`.",
        "- Classificar entradas de terceiros: renda, reembolso, empréstimo recebido ou transferência.",
        "- Classificar PIX enviados a pessoas: despesa, aluguel, empréstimo concedido, reembolso ou transferência.",
        "- Conferir se todos os finais de cartão pertencem ao mesmo cartão/conta C6 familiar.",
        "- Conciliar cada pagamento de fatura com uma saída correspondente no extrato.",
        "- Não importar nada enquanto os totais mensais não forem aprovados.",
    ]
    (OUTPUT / "PENDENCIAS_E_DUVIDAS.md").write_text("\n".join(questions) + "\n", encoding="utf-8")

    index = [
        "# Auditoria financeira C6",
        "",
        "Estes arquivos são a camada de conferência anterior à importação no Supabase.",
        "",
        "- [Relatório financeiro de 2026](RELATORIO_FINANCEIRO_2026.md)",
        "- [Categorias e estabelecimentos](CATEGORIAS_E_ESTABELECIMENTOS.md)",
        "- [Parcelamentos ativos](PARCELAMENTOS_ATIVOS.md)",
        "- [Recorrências identificadas](RECORRENCIAS_IDENTIFICADAS.md)",
        "- [Previsão dos próximos meses](PREVISAO_PROXIMOS_MESES.md)",
        "- [Pendências e confirmações](PENDENCIAS_E_DUVIDAS.md)",
        "- `lancamentos_normalizados.csv`: tabela para conferência humana.",
        "- `lancamentos_normalizados.json`: base estruturada para uma futura importação idempotente.",
        "",
        "Nenhum dado desta pasta foi enviado ao banco. A importação só deve ocorrer após a conciliação do extrato e a aprovação dos totais.",
    ]
    (OUTPUT / "README.md").write_text("\n".join(index) + "\n", encoding="utf-8")


def write_statement_reports(rows: list[dict], declared: dict[str, dict], card_rows: list[dict]) -> None:
    path = OUTPUT / "extrato_normalizado.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    (OUTPUT / "extrato_normalizado.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    grouped = defaultdict(lambda: defaultdict(float))
    for row in rows:
        month = grouped[row["mes"]]
        if row["valor"] > 0:
            month["entradas_banco"] += row["valor"]
        else:
            month["saidas_banco"] += -row["valor"]
        nature = row["natureza"]
        if nature in {"receita_tractian", "receita_pensao", "receita_financeira"}:
            month["receita_confirmada"] += row["valor"]
        elif nature in {"entrada_ted_revisar", "entrada_revisar"}:
            month["entrada_revisar"] += row["valor"]
        elif nature == "despesa_conta":
            month["despesa_direta"] += -row["valor"]
        elif nature == "saida_pessoal_revisar":
            month["saida_revisar"] += -row["valor"]
        elif nature == "pagamento_fatura":
            month["pagamento_fatura"] += -row["valor"]
        elif nature == "investimento_resgate":
            month["resgate"] += row["valor"]
        elif nature == "investimento_aplicacao":
            month["aplicacao"] += -row["valor"]
        elif nature == "transferencia_propria":
            month["transferencia_propria"] += row["valor"]

    payments = {row["mes"]: round(-row["valor"], 2) for row in rows if row["natureza"] == "pagamento_fatura"}
    invoices = {item["mes"]: item["fatura_liquida_sem_pagamento"] for item in monthly_summary(card_rows)}
    reconciliation = []
    for month in sorted(set(payments) | set(invoices)):
        paid = payments.get(month)
        invoice = invoices.get(month)
        reconciliation.append({
            "mes": month,
            "fatura": invoice,
            "pagamento": paid,
            "diferenca": round((paid or 0) - (invoice or 0), 2) if paid is not None and invoice is not None else None,
        })

    report = [
        "# Conciliação da conta C6 — 2026",
        "",
        "> Período do extrato: 1º de janeiro a 15 de outubro de 2026. Receita confirmada é deliberadamente conservadora: resgates, transferências próprias e entradas ainda duvidosas não são tratados como renda.",
        "",
        "## Fluxo mensal",
        "",
        "| Mês | Entradas no banco | Saídas do banco | Receita confirmada | Entradas a revisar | Despesa direta | Saídas pessoais a revisar | Pagamento de fatura |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for month in sorted(grouped):
        item = grouped[month]
        report.append(f"| {month} | {brl(item['entradas_banco'])} | {brl(item['saidas_banco'])} | **{brl(item['receita_confirmada'])}** | {brl(item['entrada_revisar'])} | {brl(item['despesa_direta'])} | {brl(item['saida_revisar'])} | {brl(item['pagamento_fatura'])} |")
    report += [
        "",
        "## Validação contra os totais declarados pelo C6",
        "",
        "| Mês | Diferença entradas | Diferença saídas | Status |",
        "|---|---:|---:|---|",
    ]
    for month in sorted(declared):
        incoming_difference = round(grouped[month]["entradas_banco"] - declared[month]["entradas"], 2)
        outgoing_difference = round(grouped[month]["saidas_banco"] - declared[month]["saidas"], 2)
        status = "OK" if incoming_difference == 0 and outgoing_difference == 0 else "REVISAR"
        report.append(f"| {month} | {brl(incoming_difference)} | {brl(outgoing_difference)} | **{status}** |")
    report += [
        "",
        "## Conciliação dos pagamentos de fatura",
        "",
        "| Mês | Fatura disponível | Pagamento no extrato | Diferença | Situação |",
        "|---|---:|---:|---:|---|",
    ]
    for item in reconciliation:
        invoice_text = brl(item["fatura"]) if item["fatura"] is not None else "—"
        payment_text = brl(item["pagamento"]) if item["pagamento"] is not None else "—"
        difference_text = brl(item["diferenca"]) if item["diferenca"] is not None else "—"
        status = "Conciliado" if item["diferenca"] == 0 else "Documento ausente" if item["diferenca"] is None else "Divergência"
        report.append(f"| {item['mes']} | {invoice_text} | {payment_text} | {difference_text} | **{status}** |")
    report += [
        "",
        "## Leitura correta para o aplicativo",
        "",
        "- `Entradas no banco` representa fluxo bruto, não renda: inclui CDB, transferências e devoluções.",
        "- `Receita confirmada` contém apenas Tractian, pensão identificada, cashback e rendimentos.",
        "- Pagamento de cartão reduz o saldo bancário, mas não deve ser somado novamente às despesas das compras.",
        "- Transferências para pessoas permanecem em revisão até sabermos se são aluguel, empréstimo, reembolso ou gasto pessoal.",
    ]
    (OUTPUT / "CONCILIACAO_CONTA_C6.md").write_text("\n".join(report) + "\n", encoding="utf-8")

    income_groups = defaultdict(lambda: {"valor": 0.0, "ocorrencias": 0, "meses": set(), "natureza": Counter()})
    transfer_groups = defaultdict(lambda: {"valor": 0.0, "ocorrencias": 0, "meses": set(), "natureza": Counter()})
    for row in rows:
        target = income_groups if row["valor"] > 0 else transfer_groups
        name = normalized_description(row["descricao"])
        item = target[name]
        item["valor"] += row["valor"]
        item["ocorrencias"] += 1
        item["meses"].add(row["mes"])
        item["natureza"][row["natureza"]] += 1
    review = [
        "# Receitas e transferências",
        "",
        "## Entradas identificadas",
        "",
        "| Origem | Natureza sugerida | Ocorrências | Meses | Total |",
        "|---|---|---:|---:|---:|",
    ]
    for name, item in sorted(income_groups.items(), key=lambda pair: -pair[1]["valor"]):
        review.append(f"| {name} | {item['natureza'].most_common(1)[0][0]} | {item['ocorrencias']} | {len(item['meses'])} | {brl(item['valor'])} |")
    review += ["", "## Saídas por PIX e transferências", "", "| Destino | Natureza sugerida | Ocorrências | Meses | Total |", "|---|---|---:|---:|---:|"]
    for name, item in sorted(transfer_groups.items(), key=lambda pair: pair[1]["valor"]):
        review.append(f"| {name} | {item['natureza'].most_common(1)[0][0]} | {item['ocorrencias']} | {len(item['meses'])} | {brl(-item['valor'])} |")
    (OUTPUT / "RECEITAS_E_TRANSFERENCIAS.md").write_text("\n".join(review) + "\n", encoding="utf-8")

    direct = [row for row in rows if row["natureza"] == "despesa_conta"]
    repeated = defaultdict(lambda: {"values": [], "months": set(), "category": Counter()})
    for row in direct:
        name = normalized_description(row["descricao"])
        repeated[name]["values"].append(-row["valor"])
        repeated[name]["months"].add(row["mes"])
        repeated[name]["category"][row["categoria_sugerida"]] += 1
    recurring_md = [
        "# Recorrências da conta C6",
        "",
        "| Descrição | Meses presentes | Ocorrências | Valor mediano | Categoria | Interpretação |",
        "|---|---:|---:|---:|---|---|",
    ]
    for name, item in sorted(repeated.items(), key=lambda pair: (-len(pair[1]["months"]), pair[0])):
        if len(item["months"]) < 3:
            continue
        values = item["values"]
        median = float(pd.Series(values).median())
        stable = max(values) - min(values) <= max(2, median * 0.08)
        interpretation = "recorrência provável" if stable else "frequente, valor variável"
        recurring_md.append(f"| {name} | {len(item['months'])} | {len(values)} | {brl(median)} | {item['category'].most_common(1)[0][0]} | {interpretation} |")
    (OUTPUT / "RECORRENCIAS_CONTA_C6.md").write_text("\n".join(recurring_md) + "\n", encoding="utf-8")

    consolidated = [
        "# Resumo mensal consolidado",
        "",
        "> Visão conservadora para orientar o futuro painel. `Gasto confirmado` soma despesas diretas da conta e compras líquidas da fatura, sem duplicar o pagamento do cartão. PIX para pessoas ficam separados até serem classificados.",
        "",
        "| Mês | Receita confirmada | Entradas a revisar | Despesa direta | Cartão do mês | Gasto confirmado | Saídas pessoais a revisar | Resultado confirmado |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    invoice_by_month = {item["mes"]: item["fatura_liquida_sem_pagamento"] for item in monthly_summary(card_rows)}
    for month in sorted(grouped):
        item = grouped[month]
        card_value = invoice_by_month.get(month)
        # Nos dois meses sem arquivo de fatura, o pagamento é exibido como
        # aproximação explícita, não como detalhamento de compras.
        card_budget = card_value if card_value is not None else item["pagamento_fatura"]
        confirmed_spending = item["despesa_direta"] + card_budget
        confirmed_result = item["receita_confirmada"] - confirmed_spending
        card_label = brl(card_value) if card_value is not None else f"{brl(card_budget)}¹"
        consolidated.append(f"| {month} | {brl(item['receita_confirmada'])} | {brl(item['entrada_revisar'])} | {brl(item['despesa_direta'])} | {card_label} | **{brl(confirmed_spending)}** | {brl(item['saida_revisar'])} | **{brl(confirmed_result)}** |")
    consolidated += [
        "",
        "¹ Janeiro e setembro usam o pagamento da fatura como aproximação porque o arquivo detalhado da respectiva fatura não está disponível.",
        "",
        "## O que falta para este quadro virar a tela inicial",
        "",
        "- Identificar a renda anterior à Tractian que aparece como TED ou PIX sem remetente.",
        "- Confirmar quais entradas de terceiros são renda, reembolso ou pagamento de empréstimo.",
        "- Confirmar quais PIX para pessoas são aluguel, empréstimos, transferências familiares ou despesas.",
        "- Definir metas mensais por categoria; sem meta, não existe um valor confiável de “quanto ainda posso gastar”.",
    ]
    (OUTPUT / "RESUMO_MENSAL_CONSOLIDADO.md").write_text("\n".join(consolidated) + "\n", encoding="utf-8")

    # Atualiza o índice sem duplicar links em execuções subsequentes.
    index_path = OUTPUT / "README.md"
    index = index_path.read_text(encoding="utf-8")
    marker = "- [Conciliação da conta C6](CONCILIACAO_CONTA_C6.md)"
    if marker not in index:
        index = index.replace("- [Relatório financeiro de 2026]", marker + "\n- [Receitas e transferências](RECEITAS_E_TRANSFERENCIAS.md)\n- [Recorrências da conta C6](RECORRENCIAS_CONTA_C6.md)\n- [Relatório financeiro de 2026]")
        index = index.replace("- `lancamentos_normalizados.csv`", "- `extrato_normalizado.csv` e `extrato_normalizado.json`: movimentações da conta.\n- `lancamentos_normalizados.csv`")
        index_path.write_text(index, encoding="utf-8")
    summary_marker = "- [Resumo mensal consolidado](RESUMO_MENSAL_CONSOLIDADO.md)"
    if summary_marker not in index_path.read_text(encoding="utf-8"):
        index = index_path.read_text(encoding="utf-8").replace(marker, summary_marker + "\n" + marker)
        index_path.write_text(index, encoding="utf-8")


def main() -> None:
    OUTPUT.mkdir(exist_ok=True)
    rows = load_rows()
    recurring, periodic = identify_patterns(rows)
    installments = active_installments(rows)
    write_csv(rows)
    (OUTPUT / "lancamentos_normalizados.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_reports(rows, recurring, periodic, installments)
    statement_rows, declared = load_statement()
    write_statement_reports(statement_rows, declared, rows)
    print(f"Gerados {len(rows)} lançamentos de cartão, {len(statement_rows)} movimentos de conta, {len(recurring)} recorrências e {len(installments)} parcelamentos ativos em {OUTPUT}")


if __name__ == "__main__":
    main()
