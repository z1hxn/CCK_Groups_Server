export const proxyJson = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  return { ok: response.ok, status: response.status, data };
};

export const proxyAuthJson = async (req, url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  const setCookieHeaders =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : [];

  return {
    status: response.status,
    data,
    setCookieHeaders: setCookieHeaders.filter(Boolean),
  };
};

export const extractListPayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.content)) return payload.content;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.content)) return payload.data.content;
  return [];
};

export const extractObjectPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  return payload;
};
