import type {
  InvokeInspectionCaptureView,
  InvokeInspectionExchange,
  InvokeInspectionHeaders
} from "../gateway/invoke-inspection";

const PANEL_WIDTH = 58;

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function headerLines(headers: InvokeInspectionHeaders): string[] {
  const entries = Object.entries(headers).sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return ["Headers: <none>"];
  }

  return [
    "Headers:",
    ...entries.map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
  ];
}

function exchangeLines(exchange: InvokeInspectionExchange | null): string[] {
  if (exchange === null) {
    return ["<not captured>"];
  }

  const requestLine = typeof exchange.method === "string" || typeof exchange.url === "string"
    ? [`${exchange.method ?? ""} ${exchange.url ?? ""}`.trim()]
    : [];
  const statusLine = typeof exchange.status_code === "number" ? [`Status: ${exchange.status_code}`] : [];
  const body = prettyBody(exchange.body);

  return [
    ...requestLine,
    ...statusLine,
    ...headerLines(exchange.headers),
    "",
    `Body${exchange.body_truncated ? ` (truncated at ${64} KiB)` : ""}:`,
    ...body.split(/\r?\n/)
  ];
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) {
    return [line];
  }

  const chunks: string[] = [];
  let remaining = line;

  while (remaining.length > width) {
    chunks.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }

  chunks.push(remaining);
  return chunks;
}

function buildPanel(title: string, exchange: InvokeInspectionExchange | null): string[] {
  return [
    title,
    "".padEnd(Math.min(title.length, PANEL_WIDTH), "-"),
    ...exchangeLines(exchange)
  ].flatMap((line) => wrapLine(line, PANEL_WIDTH));
}

function padCell(line: string): string {
  return ` ${line.padEnd(PANEL_WIDTH)} `;
}

function renderPanelPair(left: string[], right: string[]): string[] {
  const rowCount = Math.max(left.length, right.length);
  const rows: string[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    rows.push(`|${padCell(left[index] ?? "")}|${padCell(right[index] ?? "")}|`);
  }

  return rows;
}

export function renderInvokeInspectionTable(capture: InvokeInspectionCaptureView): string {
  const border = "=".repeat(PANEL_WIDTH * 2 + 5);
  const topLeft = buildPanel("Request: Client to SMX", capture.client_to_smx);
  const topRight = buildPanel("Proxied Request: SMX to Provider", capture.smx_to_provider);
  const bottomLeft = buildPanel("Response: SMX to Client", capture.smx_to_client);
  const bottomRight = buildPanel("Upstream Response: Provider to SMX", capture.provider_to_smx);
  const warning = capture.include_secrets
    ? [
        "WARNING: --include-secrets is active. Local secret-bearing headers may be shown in clear text; upstream provider auth remains redacted.",
        ""
      ]
    : [];

  return [
    ...warning,
    `Invoke inspection: ${capture.id}`,
    "",
    border,
    ...renderPanelPair(topLeft, topRight),
    border,
    ...renderPanelPair(bottomLeft, bottomRight),
    border
  ].join("\n");
}
