export const api = (path: string, opts: RequestInit = {}) =>
  fetch(`/api${path}`, {
    ...opts,
    headers: opts.body ? { "content-type": "application/json", ...opts.headers } : opts.headers,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data } as { ok: boolean; status: number; data: any };
  });
