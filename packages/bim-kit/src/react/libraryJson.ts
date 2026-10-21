/**
 * Reading JSON from the user's library, and saying what went wrong when the
 * answer was not JSON at all.
 */

/** What failed, and the address and cause behind it. */
export interface Problem {
  summary: string;
  detail: string;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a response as JSON, or say what actually came back.
 *
 * The library URL a host supplies is built from parts, and one of those parts
 * is usually the signed-in user. Whenever that part is wrong, missing, or not
 * known yet, the request still succeeds: it stops matching the workspace and
 * lands on the host application, which answers with its own HTML page and
 * HTTP 200. `response.json()` then reports "Unexpected token '<'", which
 * blames JSON for an address that was never the library.
 *
 * Both failures seen so far were this: first a name that had not arrived yet,
 * then a deployment serving a workspace under a different name than the one
 * signed in. So the message names the address and states that cause.
 */
export async function readJson<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new Error(
      `The workspace returned a web page instead of data at ${url}. That `
      + 'address carries the name of the signed-in user, and a workspace '
      + 'served under a different name is what this looks like.',
    );
  }
  return response.json() as Promise<T>;
}

/** Fetch one JSON file of the library, sending the session's credentials. */
export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init });
  return readJson<T>(response, url);
}
