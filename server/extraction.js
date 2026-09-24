import fs from "fs";
import { db } from "./db.js";
import { nowISO } from "./dates.js";
import { recordLlmUsage } from "./usage.js";

// ─── Claude PDF extraction ────────────────────────────────────────────────────
// Server-side call to the Anthropic API (never from the browser). The raw
// response is stored regardless of parse success; a failed parse degrades to
// manual entry in the review UI — never to data loss.

const EXTRACTION_PROMPT = `You are extracting structured data from a vendor invoice PDF for a café's expense tracking system.

Return ONLY a JSON object — no prose, no markdown fences. Schema:

{
  "vendor_name": "string",
  "invoice_number": "string|null",
  "invoice_date": "YYYY-MM-DD|null",
  "subtotal": 0.0,
  "tax": 0.0,
  "total": 0.0,
  "line_items": [
    {
      "sku": "string|null",
      "description": "string",
      "qty": 0.0,
      "unit": "string|null",
      "units_per_pack": 0.0,
      "unit_price": 0.0,
      "line_total": 0.0
    }
  ]
}

Rules:
- If a field is not present on the invoice, return null rather than guessing.
- "unit_price" must be the price for one "unit" as invoiced (e.g. price per case), NOT the price per individual item inside the pack.
- "units_per_pack" is the number of individual items in one invoiced unit, inferred from the description ONLY where stated (e.g. "12OZ CUP 1000/CS" means 1000). Return null if not stated.
- "unit" is the invoiced unit of measure as printed, e.g. "case", "ea", "lb", "sleeve". Null if not shown.
- Include every line item on the invoice. Do not invent rows.`;

export async function extractInvoicePdf(pdfPath) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic API error ${response.status}`);
  recordLlmUsage({ purpose: "invoice_extract", model: "claude-sonnet-4-6", usage: data.usage,
    meta: { pdf: pdfPath.split("/").pop() } });

  const raw = data.content?.find(b => b.type === "text")?.text || "";
  let parsed = null, error = null;
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : clean);
  } catch (err) {
    error = `Could not parse extraction response: ${err.message}`;
  }
  return { raw, parsed, error };
}

// Run extraction for an invoice row and store the results. Fills header fields
// and line items; matches vendor_name against known vendors if the invoice has
// no vendor yet (manual uploads, unmatched senders).
export async function extractAndStoreInvoice(invoiceId) {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  db.prepare("UPDATE invoices SET extract_attempts = COALESCE(extract_attempts, 0) + 1 WHERE id = ?").run(invoiceId);
  if (!invoice.pdf_path || !fs.existsSync(invoice.pdf_path)) {
    const msg = `PDF missing for invoice ${invoiceId}`;
    db.prepare("UPDATE invoices SET extraction_error = ?, extracted_at = ? WHERE id = ?").run(msg, nowISO(), invoiceId);
    throw new Error(msg);
  }

  let result;
  try {
    result = await extractInvoicePdf(invoice.pdf_path);
  } catch (err) {
    db.prepare("UPDATE invoices SET extraction_error = ?, extracted_at = ? WHERE id = ?")
      .run(err.message, nowISO(), invoiceId);
    throw err;
  }

  const { raw, parsed, error } = result;

  const store = db.transaction(() => {
    db.prepare("UPDATE invoices SET extraction_raw = ?, extraction_error = ?, extracted_at = ? WHERE id = ?")
      .run(raw, error, nowISO(), invoiceId);
    if (!parsed) return;

    let vendorId = invoice.vendor_id;
    if (!vendorId && parsed.vendor_name) {
      const match = db.prepare(
        "SELECT id FROM vendors WHERE ? LIKE '%' || name || '%' COLLATE NOCASE OR name LIKE '%' || ? || '%' COLLATE NOCASE"
      ).get(parsed.vendor_name, parsed.vendor_name);
      if (match) vendorId = match.id;
    }

    db.prepare(`
      UPDATE invoices SET vendor_id = ?, invoice_number = ?, invoice_date = ?, subtotal = ?, tax = ?, total = ?
      WHERE id = ?
    `).run(
      vendorId ?? null,
      parsed.invoice_number ?? null,
      parsed.invoice_date ?? null,
      numOrNull(parsed.subtotal),
      numOrNull(parsed.tax),
      numOrNull(parsed.total),
      invoiceId
    );

    db.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ?").run(invoiceId);
    const insert = db.prepare(`
      INSERT INTO invoice_line_items (invoice_id, sku, description, qty, unit, units_per_pack, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const li of parsed.line_items || []) {
      if (!li || !li.description) continue;
      insert.run(
        invoiceId,
        li.sku ?? null,
        String(li.description),
        numOrNull(li.qty) ?? 0,
        li.unit ?? null,
        numOrNull(li.units_per_pack),
        numOrNull(li.unit_price) ?? 0,
        numOrNull(li.line_total) ?? 0
      );
    }
  });
  store();
  return { parsed: !!parsed, error };
}

function numOrNull(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// Pick up pending invoices whose extraction never finished (a redeploy killed
// the sync mid-run) or failed transiently, and try again — up to 3 attempts
// each, so an unreadable PDF degrades to manual entry instead of a token burn.
// The review button in the UI is not capped; this only bounds the automatic path.
export async function retryPendingExtractions(limit = 10) {
  const rows = db.prepare(`
    SELECT id FROM invoices
    WHERE status = 'pending_review' AND pdf_path IS NOT NULL
      AND (extracted_at IS NULL OR extraction_error IS NOT NULL)
      AND COALESCE(extract_attempts, 0) < 3
    ORDER BY id LIMIT ?
  `).all(limit);
  let extracted = 0, failed = 0;
  for (const { id } of rows) {
    try {
      const r = await extractAndStoreInvoice(id);
      if (r.error) failed++; else extracted++;
    } catch { failed++; }
  }
  return { checked: rows.length, extracted, failed };
}

// ─── Standing order from a screenshot ─────────────────────────────────────────
// One vendor (Oh La La). Takes a photo or screenshot of the order grid and
// returns the parsed items; the client shows them for review before saving.

const ORDER_IMAGE_PROMPT = `This image shows a cafe's weekly pastry standing order: one row per item with quantities for each day of the week, and usually a unit price column and a weekly total column.

Return ONLY a JSON object - no prose, no markdown fences. Schema:

{
  "items": [
    {
      "item": "string",
      "monday": 0, "tuesday": 0, "wednesday": 0, "thursday": 0, "friday": 0, "saturday": 0, "sunday": 0,
      "unit_price": 0.0
    }
  ]
}

Rules:
- One entry per item row, in the order shown. Include items whose quantities are all zero.
- Days may be labeled Mon/Tue/... or full names; the week can start on any day. Map each column to the correct day name.
- "unit_price" is the per-item price if a price column is shown, else null.
- Ignore total rows and total columns entirely.
- Quantities are integers; read them exactly, never guess.`;

export async function extractStandingOrderImage(buffer, mediaType) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const isPdf = mediaType === "application/pdf";
  const source = { type: "base64", media_type: mediaType, data: buffer.toString("base64") };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          isPdf ? { type: "document", source } : { type: "image", source },
          { type: "text", text: ORDER_IMAGE_PROMPT },
        ],
      }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic error ${response.status}`);
  recordLlmUsage({ purpose: "order_image", model: "claude-sonnet-4-6", usage: data.usage,
    meta: { media_type: mediaType } });
  const text = (data.content || []).map(c => c.text || "").join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not find JSON in the extraction response");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.items)) throw new Error("Extraction returned no items");
  return parsed.items;
}
