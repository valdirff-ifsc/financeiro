# Financeiro Pessoal

Aplicação web para controle financeiro pessoal familiar, integrada ao Supabase e preparada para deploy na Vercel.

A pergunta central da plataforma é:

```text
Quanto dinheiro eu realmente tenho disponível este mês?
```

## Stack

- HTML, CSS e JavaScript puro.
- Vite como servidor local e build para produção.
- Supabase Auth para login/logout.
- Supabase Database com Row Level Security.
- Supabase Realtime preparado para sincronização entre dispositivos.
- Gráficos SVG próprios.
- PWA instalável com manifest, ícones e service worker.

## Como rodar localmente

Instale as dependências:

```powershell
npm install
```

Crie um arquivo `.env` local com as variáveis do Supabase:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLISHABLE_OU_ANON
```

Rode em desenvolvimento:

```powershell
npm run dev
```

Acesse:

```text
http://127.0.0.1:5173/
```

Gerar build de produção:

```powershell
npm run build
```

Pré-visualizar o build:

```powershell
npm run preview
```

## Variáveis Supabase

Use o arquivo `.env.example` como modelo:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

No Vite, apenas variáveis prefixadas com `VITE_` ficam disponíveis no frontend. Use somente a chave pública publishable/anon do Supabase. Nunca coloque `service_role` no frontend, no GitHub ou na Vercel.

## Deploy na Vercel

Conecte o repositório GitHub na Vercel e use a detecção automática de Vite.

Configuração esperada:

- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

No painel da Vercel, crie as variáveis de ambiente:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

O Supabase guarda autenticação, permissões e dados financeiros. A Vercel hospeda apenas o frontend gerado pelo Vite.

Este projeto usa hash routes (`#/dashboard`, `#/transactions` etc.), então não precisa de `vercel.json` para fallback de SPA.

## Instalação como app no celular

O projeto é uma PWA chamada `Financeiro`. Para instalar no celular, publique em um domínio HTTPS, como a URL da Vercel.

No Android/Chrome:

1. Abra a URL do app no Chrome.
2. Toque no menu de três pontos.
3. Escolha `Adicionar à tela inicial` ou `Instalar app`.
4. Confirme o nome `Financeiro`.

No iPhone/Safari:

1. Abra a URL do app no Safari.
2. Toque no botão de compartilhar.
3. Escolha `Adicionar à Tela de Início`.
4. Confirme o nome `Financeiro`.

O suporte offline é básico: depois da primeira visita, os arquivos principais da interface ficam em cache. A sincronização dos dados financeiros ainda depende do Supabase quando houver conexão.

## Supabase

O modelo usa:

- `profiles`
- `households`
- `household_members`
- `household_settings`
- `categories`
- `accounts`
- `cards`
- `planning_items`
- `transactions`
- `market_groups`
- `market_history`
- `investments`
- `investment_history`
- `household_invites`

Todas as tabelas públicas têm RLS ativo.

## Modelo de permissão

Fluxo:

```text
Usuário
↓
Família / Household
↓
Dados financeiros compartilhados
```

Cada linha financeira pertence a um `household_id`.

As políticas RLS permitem acesso apenas a usuários que estejam em `household_members` para aquela família.

Cada lançamento também registra:

```text
created_by
```

Assim a interface consegue mostrar quem criou a movimentação.

## Fluxo principal do produto

O sistema separa:

- Planejamento: receitas, despesas, assinaturas e mercado estimado.
- Pendências: ocorrências mensais geradas automaticamente.
- Movimentações: eventos reais.

Quando uma pendência é marcada como paga ou recebida, a aplicação cria uma movimentação real vinculada ao planejamento.

## Menu

- Dashboard
- Pendências do mês
- Movimentações
- Contas bancárias
- Cartões
- Planejamento
- Investimentos
- Categorias
- Configurações

## Auth

Implementado:

- login por e-mail e senha;
- logout;
- criação automática de família no primeiro acesso;
- seed inicial apenas com categorias.

## Dados iniciais

Ao criar a primeira família, o sistema mantém somente categorias iniciais.
Contas, cartões, planejamento, movimentações, mercado e investimentos começam vazios para o usuário inserir os valores reais.

## Arquivos principais

```text
index.html
styles/main.css
src/app.js
src/data.js
src/calculations.js
src/charts.js
src/supabaseClient.js
src/supabaseConfig.js
src/remoteStore.js
src/storage.js
public/manifest.json
public/sw.js
public/assets/icons/icon-192.png
public/assets/icons/icon-512.png
package.json
```

`src/storage.js` permanece apenas para exportação JSON/compatibilidade. O banco principal é Supabase.

## Segurança

- `.env` e `.env.*` ficam no `.gitignore`.
- `.env.example` não contém valores reais.
- Chaves `service_role` nunca devem ser usadas no frontend.

Referências:

- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase JS client: https://supabase.com/docs/reference/javascript/initializing
- Vercel Vite deployments: https://vercel.com/docs/frameworks/vite
