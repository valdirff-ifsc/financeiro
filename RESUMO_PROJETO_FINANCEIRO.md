# Resumo do projeto Financeiro Pessoal

Este arquivo resume o estado atual do projeto para continuidade em outro chat.

## Caminho do projeto

```text
C:\Users\valdi\OneDrive\Documentos\Financeiro
```

## Objetivo atual

Criar uma aplicação web estática, bonita e responsiva para controle financeiro pessoal, com foco em responder:

```text
Quanto dinheiro eu realmente tenho disponível este mês?
```

O sistema foi reestruturado para deixar de ser apenas um cadastro de entidades e passar a funcionar como um assistente financeiro baseado em:

- planejamento financeiro previsto;
- pendências mensais geradas automaticamente;
- movimentações reais;
- previsão de saldo disponível e saldo após pendências.

## Estado atual

A aplicação é uma SPA estática, sem backend, pronta para GitHub Pages.

Ela usa:

- HTML/CSS/JavaScript puro;
- `localStorage` para persistência;
- gráficos SVG próprios;
- ícones via Lucide CDN;
- sem etapa de build.

Servidor local usado durante os testes:

```text
http://127.0.0.1:5500/
```

Comando para rodar:

```powershell
python -m http.server 5500
```

## Arquivos principais

```text
index.html
styles/main.css
src/app.js
src/data.js
src/storage.js
src/calculations.js
src/charts.js
README.md
```

## Modelo de dados atual

O modelo atual está em:

```text
src/data.js
```

A chave de persistência atual é:

```text
financeiro-pessoal-v2
```

Principais coleções:

- `accounts`: contas bancárias;
- `cards`: cartões de crédito;
- `planningItems`: itens recorrentes planejados;
- `transactions`: movimentações reais;
- `marketHistory`: histórico agregado de mercado;
- `marketGroups`: grupos grandes de mercado;
- `investments`: investimentos;
- `investmentHistory`: evolução dos investimentos;
- `categories`: categorias;
- `settings`: preferências do sistema.

## Dados iniciais

O projeto foi limpo para começar sem exemplos financeiros.

Permanecem apenas as categorias iniciais, com orçamento mensal zerado.
Contas, cartões, planejamento, movimentações, mercado e investimentos começam vazios para receber os valores reais do usuário.

## Arquitetura de cálculo

Arquivo:

```text
src/calculations.js
```

Responsabilidades:

- gerar pendências mensais a partir de `planningItems`;
- conciliar pendências com `transactions`;
- calcular diferença entre previsto e realizado;
- calcular receitas previstas e realizadas;
- calcular despesas previstas e realizadas;
- calcular pendências de receita e despesa;
- calcular saldo disponível real;
- calcular saldo após pendências;
- calcular saldo previsto final;
- calcular gastos por categoria;
- calcular gastos por forma de pagamento;
- calcular gastos por conta bancária;
- calcular faturas e uso de limite dos cartões;
- calcular histórico e distribuição dos investimentos;
- calcular média de mercado pelos últimos meses.

Conceito importante:

```text
saldo disponível real = saldo atual em contas - despesas pendentes do mês
```

## Menu atual

O menu foi reorganizado para:

- Dashboard;
- Pendências do mês;
- Movimentações;
- Contas bancárias;
- Cartões;
- Planejamento;
- Investimentos;
- Categorias;
- Configurações.

## Dashboard

O Dashboard foi repaginado para priorizar:

- dinheiro realmente disponível no mês;
- saldo atual;
- gastos pendentes;
- saldo após pendências;
- bloco "Hoje preciso resolver";
- receitas previstas;
- despesas previstas;
- receitas realizadas;
- despesas realizadas;
- saldo previsto final;
- investimentos;
- próximos pagamentos;
- gráficos de receitas x despesas;
- previsto x realizado;
- gastos por categoria;
- evolução mensal;
- forma de pagamento;
- gastos por conta;
- investimentos.

## Pendências do mês

Página central do novo fluxo.

Ela mostra automaticamente tudo que está previsto no mês, separado em:

- receitas previstas;
- despesas previstas.

Ao marcar uma pendência como paga ou recebida:

- o usuário pode editar valor real;
- pode editar data real;
- pode adicionar observação;
- o sistema cria automaticamente uma movimentação real vinculada ao planejamento;
- o sistema calcula diferença entre previsto e realizado.

## Movimentações

Tela central para eventos financeiros reais.

Tipos:

- Receita;
- Despesa;
- Compra no cartão;
- Transferência;
- Investimento.

Campos:

- tipo;
- descrição;
- valor;
- data;
- categoria;
- conta bancária;
- forma de pagamento;
- cartão;
- parcelas;
- parcela atual;
- planejamento vinculado;
- observações.

Formas de pagamento:

- PIX;
- Cartão crédito;
- Cartão débito;
- Boleto;
- Dinheiro;
- Transferência;
- Outro.

## Cartões

A página antiga de compras no cartão foi removida.

Cartões e compras agora ficam juntos na página `Cartões`.

Cada cartão mostra:

- fatura atual;
- limite total;
- limite usado;
- limite disponível;
- dia de fechamento;
- dia de vencimento;
- compras vinculadas.

Há formulário para adicionar compra diretamente no cartão.

## Planejamento

Página reorganizada em:

- Receitas recorrentes;
- Despesas recorrentes;
- Assinaturas;
- Mercado estimado.

O mercado deixou de ser detalhado por item individual e agora é agregado por grupos:

- Proteínas;
- Higiene;
- Limpeza;
- Café da manhã;
- Snacks;
- Outros.

O sistema usa `marketHistory` para calcular média dos últimos meses e previsão do próximo mês.

## Investimentos

A página de investimentos foi mantida e melhorada.

Mostra:

- patrimônio investido;
- rendimento estimado;
- rendimento real;
- patrimônio total;
- evolução;
- distribuição por tipo;
- tabela de aplicações.

## Categorias

Categorias atuais incluem:

- Salário;
- Bolsa;
- PIX recorrente;
- Moradia;
- Assinaturas;
- Saúde;
- Mercado;
- Transporte;
- Lazer;
- Trabalho;
- Investimentos;
- Outros.

Cada categoria tem:

- nome;
- tipo;
- cor;
- orçamento mensal.

## Configurações

O topo da aplicação foi limpo.

Foram removidos do cabeçalho:

- pesquisar;
- exportar;
- importar;
- resetar.

Backup e reset ficaram apenas em:

```text
Configurações > Backup local
```

Lá ainda existem:

- Exportar JSON;
- Importar JSON;
- Resetar dados.

## Seletor de mês

O seletor nativo ruim de mês foi substituído por um controle próprio no topo:

- seta para mês anterior;
- seta para próximo mês;
- seletor de mês;
- ano separado no desktop;
- botão "Este mês".

No mobile, o ano foi ocultado para evitar quebra visual, e a navegação por mês fica pelas setas.

Arquivos alterados nessa mudança:

```text
index.html
src/app.js
styles/main.css
```

## Design atual

Estilo buscado:

- visual moderno;
- mistura de Notion, Nubank e app financeiro;
- sidebar escura;
- cards claros;
- cartão principal em verde/azul escuro;
- sombras suaves;
- ícones Lucide;
- responsivo para desktop e celular.

## Validações feitas

Foram feitos testes com Chrome headless nas rotas principais:

- Dashboard;
- Pendências;
- Movimentações;
- Cartões;
- Planejamento;
- Configurações.

Também foram geradas capturas desktop/mobile durante a validação visual.

## Observações importantes para continuidade

- Não voltar ao modelo antigo de telas separadas para `fixedExpenses`, `subscriptions`, `variableExpenses`, `cardPurchases` e `marketItems`.
- O fluxo principal deve continuar sendo `planningItems` + `transactions`.
- A página de Pendências é central para reduzir o esforço diário do usuário.
- O usuário quer gastar menos de 1 minuto por dia alimentando o sistema.
- Evitar aparência de formulário administrativo simples.
- Preferir ações rápidas, baixa de pendências e previsão automática.
- Se for conectar backend depois, preservar o modelo de dados atual e trocar primeiro `src/storage.js`.

## Possíveis próximos passos

- Melhorar edição/exclusão de itens de planejamento.
- Adicionar edição de contas e cartões existentes.
- Melhorar transferência entre contas.
- Criar autenticação e backend com Supabase/Firebase.
- Criar tabela real no backend espelhando `planningItems`, `transactions`, `accounts`, `cards` e `categories`.
- Adicionar importação de extratos bancários.
- Melhorar conciliação automática por valor/data/texto.
- Criar visão semanal.
- Adicionar alertas inteligentes de orçamento.
