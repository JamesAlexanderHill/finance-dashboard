/** Sends an email through Mailgun's HTTP API. Without credentials (local dev) the message is logged instead. */
export async function sendMail(to: string, subject: string, text: string) {
  const { MAILGUN_API_KEY: key, MAILGUN_DOMAIN: domain, MAILGUN_FROM: from } = process.env;
  if (!key || !domain || !from) {
    console.info(`[mail] (Mailgun not configured) to=${to} subject="${subject}"\n${text}`);
    return;
  }
  const base = process.env.MAILGUN_BASE_URL ?? 'https://api.mailgun.net';
  const res = await fetch(`${base}/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`api:${key}`)}` },
    body: new URLSearchParams({ from, to, subject, text }),
  });
  if (!res.ok) console.error(`[mail] Mailgun rejected message: ${res.status} ${await res.text()}`);
}
