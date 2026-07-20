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
