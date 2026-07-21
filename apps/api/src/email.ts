// Provider-neutral outbound email. Config lives in the `mailer` connector
// (Settings → Correo); the api key is encrypted at rest like any connector
// secret. Default provider is Resend; `http` posts to the bank's own mail
// service so this can be swapped without touching callers.

import { getConnector } from "./db.js";

export interface EmailMsg {
  to: string;
  subject: string;
  html: string;
}

export function mailerConfigured(): boolean {
  try {
    const cfg = getConnector("mailer").config;
    return Boolean(cfg && cfg.from);
  } catch {
    return false;
  }
}

export async function sendEmail(msg: EmailMsg): Promise<void> {
  if (!msg.to) throw new Error("Falta el destinatario del correo");
  let cfg: Record<string, unknown>;
  try { cfg = getConnector("mailer").config; }
  catch { throw new Error("El correo no está configurado (Ajustes → Correo)"); }

  const provider = String(cfg.provider ?? "resend");
  const from = String(cfg.from ?? "");
  if (!from) throw new Error("Falta el remitente (from) en la configuración de correo");

  if (provider === "resend") return sendResend(cfg, from, msg);
  if (provider === "mandrill") return sendMandrill(cfg, from, msg);
  if (provider === "http") return sendHttp(cfg, from, msg);
  throw new Error(`Proveedor de correo no soportado: ${provider}`);
}

/** Split a "Nombre <correo@dominio>" string into name + email. */
function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1], email: m[2].trim() } : { name: "", email: from.trim() };
}

const MANDRILL_URL = "https://mandrillapp.com/api/1.0/messages/send.json";

// Mandrill REST /messages/send.json — body is { key, message:{…} }. It returns
// 200 with a per-recipient list even on rejection, so the real outcome is the
// item's `status` (sent/queued/scheduled = ok; rejected/invalid = failure).
async function sendMandrill(cfg: Record<string, unknown>, from: string, msg: EmailMsg): Promise<void> {
  const apiKey = String(cfg.apiKey ?? "");
  if (!apiKey) throw new Error("Falta la API key de Mandrill");
  const f = parseFrom(from);
  const body = {
    key: apiKey,
    message: {
      from_email: f.email,
      from_name: f.name || undefined,
      to: [{ email: msg.to, type: "to" }],
      subject: msg.subject,
      html: msg.html,
    },
  };
  let res: Response;
  try {
    res = await fetch(MANDRILL_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (err) {
    throw new Error(`Mandrill no disponible: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Mandrill HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Mandrill: respuesta vacía o inesperada");
  const first = data[0] as { status?: string; reject_reason?: string; _id?: string };
  if (first.status === "rejected" || first.status === "invalid") {
    throw new Error(`Mandrill rechazó el envío: ${first.reject_reason || first.status}`);
  }
}

async function sendResend(cfg: Record<string, unknown>, from: string, msg: EmailMsg): Promise<void> {
  const apiKey = String(cfg.apiKey ?? "");
  if (!apiKey) throw new Error("Falta la API key de Resend");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
}

/** Generic webhook to the bank's own mail system (or a mock endpoint). */
async function sendHttp(cfg: Record<string, unknown>, from: string, msg: EmailMsg): Promise<void> {
  const url = String(cfg.url ?? "");
  if (!url) throw new Error("Falta la URL del servicio de correo (proveedor http)");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${String(cfg.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html }),
  });
  if (!res.ok) throw new Error(`Servicio de correo HTTP ${res.status}: ${await res.text()}`);
}
