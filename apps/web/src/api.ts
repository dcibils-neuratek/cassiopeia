const TOKEN_KEY = "cass.token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

function authHeaders(hasBody: boolean, extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...(hasBody ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export const api = (path: string, opts: RequestInit = {}) =>
  fetch(`/api${path}`, { ...opts, headers: authHeaders(Boolean(opts.body), opts.headers) }).then(async (r) => {
    if (r.status === 401 && path !== "/auth/login") {
      setToken(null);
      window.dispatchEvent(new Event("cass-unauth"));
    }
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data } as { ok: boolean; status: number; data: any };
  });

/** Authenticated raw fetch (for non-JSON responses like CSV downloads). */
export const apiRaw = (path: string, opts: RequestInit = {}) =>
  fetch(`/api${path}`, { ...opts, headers: authHeaders(Boolean(opts.body), opts.headers) });

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Upload a File and return the value to store on the form field. */
export async function uploadFile(file: File): Promise<{ fileId: string; name: string; size: number; mime: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await api("/files", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type, contentBase64: toBase64(bytes) }) });
  return r.data;
}
