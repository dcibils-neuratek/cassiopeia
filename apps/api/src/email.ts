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
  if (provider === "http") return sendHttp(cfg, from, msg);
  throw new Error(`Proveedor de correo no soportado: ${provider}`);
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
