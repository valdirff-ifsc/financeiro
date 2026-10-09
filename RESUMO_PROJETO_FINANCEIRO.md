# Financeiro — resumo atual

Aplicativo pessoal de finanças compartilhadas, construído com JavaScript, Vite e Supabase.

## Execução local

```bash
npm install
npm run dev
```

Acesse `http://127.0.0.1:5173`.

## Dados e autenticação

- Autenticação, banco e sincronização em tempo real: Supabase.
- Variáveis locais: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no `.env`.
- Nunca use uma chave `service_role` no frontend.
- Faturas e planilhas pessoais ficam em `faturas/` e não devem ser versionadas.

## Modelo financeiro

- O saldo cadastrado em cada conta representa o saldo inicial do mês.
- Receitas e despesas confirmadas atualizam o saldo calculado.
- Compras no cartão afetam gastos e faturas; o caixa bancário só é reduzido quando a fatura é paga.
- Compras no cartão guardam separadamente o mês da compra e o mês da fatura.
- Compromissos realizados são vinculados por `linkedPlanningId`, nunca apenas pelo texto.

## Principais áreas

- Hoje: disponibilidade, gastos, metas e itens que exigem atenção.
- A fazer: receitas, despesas e faturas previstas, com confirmação e opção de desfazer.
- Futuro: projeção dos próximos seis meses.
- Histórico: movimentações efetivamente realizadas.
- Metas: limites mensais por categoria.
- Cadastros: contas, cartões, compromissos, categorias, investimentos, mercado e preferências.

## Publicação

O build de produção é criado com:

```bash
npm run build
```

Os arquivos finais ficam em `dist/`. O projeto pode ser publicado na Vercel.
