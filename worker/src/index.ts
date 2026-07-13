import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  ANTHROPIC_API_KEY: string;
}

// Origins allowed to call this Worker. Add your local dev port and your
// deployed GitHub Pages origin (no trailing slash, no path).
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "https://carlybrennan84.github.io",
]);

const MAX_BASE64_LENGTH = 12_000_000; // ~9MB raw image, after client-side resize

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    vendor: { type: "string", description: "The store or business name on the receipt" },
    date: { type: "string", description: "Purchase date in yyyy-mm-dd format. Empty string if not visible." },
    amount: { type: "number", description: "Total amount paid, including GST" },
    category: {
      type: "string",
      enum: ["tools", "clothing", "ppe", "phone", "tafe", "vehicle", "other"],
      description: "Best-fit deduction category for an Australian apprentice/tradie",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["vendor", "date", "amount", "category", "confidence"],
  additionalProperties: false,
} as const;

const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "log_trip",
    description: "Log a vehicle trip (business or personal) to the user's logbook.",
    input_schema: {
      type: "object",
      properties: {
        km: { type: "number", description: "Distance travelled in kilometres" },
        type: { type: "string", enum: ["business", "personal"], description: "Ask the user if this isn't clear from context" },
        purpose: { type: "string", description: "Short description, e.g. 'Site visit — Ballarat'" },
      },
      required: ["km", "type"],
    },
  },
  {
    name: "add_expense",
    description: "Add a work expense the user tells you about, with no photo (they'll add one later if they have it).",
    input_schema: {
      type: "object",
      properties: {
        vendor: { type: "string" },
        amount: { type: "number" },
        category: { type: "string", enum: ["tools", "clothing", "ppe", "phone", "tafe", "vehicle", "other"] },
      },
      required: ["vendor", "amount", "category"],
    },
  },
  {
    name: "search_receipts",
    description: "Search the user's logged receipts by vendor name or keyword. Always call this before update_receipt so you reference the correct one.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "update_receipt",
    description: "Update an existing receipt — e.g. set workPct to 0 if an employer reimbursed it, or fix its amount. Requires the exact id from search_receipts.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        workPct: { type: "number", description: "0-100. Set to 0 if this expense was reimbursed and is no longer claimable." },
        amount: { type: "number" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
  },
];

interface AssistantContext {
  occupation?: string;
  income?: number;
  totalDeductions?: number;
  estimatedRefund?: number;
  receiptsCount?: number;
  tripsCount?: number;
  logbookDays?: number;
}

function assistantSystemPrompt(ctx: AssistantContext): string {
  return `You are TaxMate AI, a friendly assistant inside TaxMate Tradie — a tax deduction tracker for Australian apprentices and tradies.

Current snapshot for this user: occupation "${ctx.occupation || "unknown"}", income $${ctx.income ?? 0}, total deductions logged $${ctx.totalDeductions ?? 0}, estimated refund $${ctx.estimatedRefund ?? 0}, ${ctx.receiptsCount ?? 0} receipts logged, ${ctx.tripsCount ?? 0} trips logged, logbook day ${ctx.logbookDays ?? 0} of 84.

You can log trips and expenses the user tells you about, and look up/update existing receipts (e.g. mark one as reimbursed by an employer, which is no longer claimable). Keep answers short and practical — this is a mobile chat, not an essay. For deduction questions, give a direct answer with a one-line reason, based on general ATO rules for Australian tradies/apprentices. Make clear this is general guidance, not registered tax advice, whenever the question is genuinely uncertain or high-stakes.`;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function handleScanReceipt(request: Request, env: Env, origin: string | null): Promise<Response> {
  let body: { image?: string; mediaType?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const { image, mediaType } = body;
  if (!image || !mediaType) {
    return json({ error: "Missing image or mediaType" }, 400, origin);
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return json({ error: "Image too large to scan automatically" }, 413, origin);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RECEIPT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg", data: image },
            },
            {
              type: "text",
              text: "Read this receipt photo and extract the vendor name, purchase date, total amount paid (including GST), and the best-fit expense category for an Australian apprentice or tradie's tax deductions. If the date isn't visible, return an empty string for it.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return json({ error: "Model returned no readable result" }, 502, origin);
    }

    const parsed = JSON.parse(textBlock.text);
    return json(parsed, 200, origin);
  } catch (err) {
    console.error("Receipt scan failed", err);
    return json({ error: "Failed to read receipt" }, 502, origin);
  }
}

async function handleAssistant(request: Request, env: Env, origin: string | null): Promise<Response> {
  let body: { messages?: Anthropic.MessageParam[]; context?: AssistantContext };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: "Missing messages" }, 400, origin);
  }
  if (body.messages.length > 40) {
    return json({ error: "Conversation too long" }, 413, origin);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: assistantSystemPrompt(body.context || {}),
      tools: ASSISTANT_TOOLS,
      messages: body.messages,
    });
    return json(response, 200, origin);
  } catch (err) {
    console.error("Assistant request failed", err);
    return json({ error: "Assistant request failed" }, 502, origin);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin);
    }
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed" }, 403, origin);
    }

    const { pathname } = new URL(request.url);
    if (pathname === "/assistant") {
      return handleAssistant(request, env, origin);
    }
    return handleScanReceipt(request, env, origin);
  },
};
