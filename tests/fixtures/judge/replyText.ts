/** Wraps raw findings in the judge's one-object reply. */
export const replyText = (findings: unknown[], focus = 'fixing the auth token refresh in /src/auth.ts'): string =>
  JSON.stringify({ focus, findings })
