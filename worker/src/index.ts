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
  },
};
