// Função serverless (Vercel). Recebe a foto do cupom e devolve os itens em JSON.
// A chave da Groq fica só aqui no servidor (GROQ_API_KEY), nunca no navegador.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.8-27b";
const MAX_IMAGE_CHARS = 4_000_000;

const CATEGORIES = [
  "Padaria", "Carnes e ovos", "Massas e grãos", "Hortifruti", "Laticínios e frios", "Bebidas",
  "Mercearia", "Congelados", "Doces e snacks", "Limpeza", "Higiene", "Outros",
];

const PROMPT = `Você lê fotos de cupons fiscais e comprovantes de supermercado brasileiros.
Extraia TODOS os itens comprados. Responda somente com JSON neste formato:
{"store": string, "date": "YYYY-MM-DD" ou "", "items": [{"name": string, "product": string, "category": string, "quantity": number, "unit": "un"|"kg"|"l", "total_price": number}]}
Regras:
- name: texto como aparece no cupom.
- product: nome genérico e curto do produto, para agrupar compras iguais (ex: "PAO FRANCES KG" -> "Pão francês", "LEITE INT 1L PIRACANIN" -> "Leite", "MACARRAO PARAFUSO 500G" -> "Macarrão"). Sem marca, sem peso.
- category: uma destas: ${CATEGORIES.join(", ")}.
- quantity: quantidade comprada. Itens por peso em kg (ex: 0.452), líquidos em l, o resto em un. Se o cupom mostra "2 x 5,00", quantity = 2. Pacote de 500g comprado 1 vez = 1 un.
- total_price: valor total pago pelo item, em reais, com ponto decimal. Já com desconto se houver.
- Ignore subtotal, total, troco, impostos e formas de pagamento.
- Se não conseguir ler algo, omita o item. Não invente.`;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_IMAGE_CHARS + 10_000) throw new Error("too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function verifyUser(token) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon || !token) return false;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  return response.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Método não permitido." });
  if (!process.env.GROQ_API_KEY) return send(res, 500, { error: "GROQ_API_KEY não configurada no servidor." });

  const localBypass = process.env.VITE_LOCAL_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  if (!localBypass) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    let allowed = false;
    try {
      allowed = await verifyUser(token);
    } catch {
      allowed = false;
    }
    if (!allowed) return send(res, 401, { error: "Sessão inválida. Entre novamente." });
  }

  let image;
  try {
    ({ image } = await readBody(req));
  } catch {
    return send(res, 413, { error: "Imagem grande demais." });
  }
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS) {
    return send(res, 400, { error: "Envie uma imagem JPEG, PNG ou WebP de até 3 MB." });
  }

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        temperature: 0,
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        }],
      }),
    });
    if (!response.ok) {
      console.error("Groq error", response.status, await response.text());
      return send(res, 502, { error: "A IA não conseguiu ler a nota fiscal. Tente outra foto." });
    }
    const completion = await response.json();
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    return send(res, 200, parsed);
  } catch (error) {
    console.error(error);
    return send(res, 502, { error: "Falha ao ler a nota fiscal. Tente novamente." });
  }
}
