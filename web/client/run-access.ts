const RUN_TOKEN_KEY = 'eng-committee-run-tokens';

export function rememberRunAccess(runId: string, accessToken: string): void {
  const tokens = readTokenMap();
  tokens[runId] = accessToken;
  localStorage.setItem(RUN_TOKEN_KEY, JSON.stringify(tokens));
}

export function getRunAccessToken(runId: string): string {
  return readTokenMap()[runId] ?? '';
}

export function buildAuthorizedPath(path: string, runId: string): string {
  const accessToken = getRunAccessToken(runId);
  if (!accessToken) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set('accessToken', accessToken);
  return `${url.pathname}${url.search}`;
}

function readTokenMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(RUN_TOKEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
