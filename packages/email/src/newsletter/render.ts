import type { IssueContent, SlotFill } from './gather';

// An issue as email (docs/plans/M5.md): HTML that survives email clients (tables, inline
// styles, no images, no tracking) and a matching plain-text part. Mail-5 adds the page wrapper,
// the unsubscribe link and the postal address when it sends.

export type RenderedIssue = { subject: string; preheader: string; html: string; text: string };

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** D-M5-5: story links carry ?ref=newsletter for the cookieless click counters. */
export function storyUrl(domain: string, slug: string): string {
  return `https://${domain}/news/${encodeURIComponent(slug)}?ref=newsletter`;
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function meetingTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(at);
}

/** Plain and factual (§6a): the weekday and the lead headline, no added hooks. */
export function issueSubject(c: Pick<IssueContent, 'date' | 'items' | 'weather' | 'town'>): string {
  const lead = c.weather?.alerts[0]?.headline ?? c.items[0]?.headline ?? `${c.town.name} today`;
  const subject = `${weekday(c.date)}: ${lead}`;
  return subject.length > 120 ? `${subject.slice(0, 117).trimEnd()}…` : subject;
}

export function renderIssue(c: IssueContent): RenderedIssue {
  const p = c.palette;
  const subject = issueSubject(c);
  const preheader = c.items
    .slice(c.weather?.alerts.length ? 0 : 1, 3)
    .map((i) => i.headline)
    .join(' · ');
  const h2 = (t: string) =>
    `<h2 style="margin:28px 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${p.ink};border-bottom:2px solid ${p.accent};padding-bottom:4px">${esc(t)}</h2>`;
  const slot = (s: SlotFill) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:${p.surface};border:1px solid ${p.tint}"><tr><td style="padding:14px 16px">` +
    `<p style="margin:0 0 6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${p.ink}">${esc(s.label)}</p>` +
    `<p style="margin:0;font-weight:bold"><a href="${esc(s.href)}" style="color:${p.ink}">${esc(s.headline)}</a></p>` +
    (s.body ? `<p style="margin:6px 0 0;font-size:15px">${esc(s.body)}</p>` : '') +
    `</td></tr></table>`;

  const html: string[] = [];
  html.push(
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:3px solid ${p.ink}"><tr><td style="padding:0 0 10px">` +
      `<p style="margin:0;font-size:28px;font-weight:bold;color:${p.ink}">${esc(c.town.siteName)}</p>` +
      `<p style="margin:4px 0 0;font-size:14px;color:${p.ink}">${esc(longDate(c.date))}</p></td></tr></table>`,
  );
  if (c.top) html.push(slot(c.top));
  if (c.weather) {
    html.push(h2('Weather'));
    for (const a of c.weather.alerts)
      html.push(
        `<p style="margin:0 0 10px;padding:10px 12px;border-left:4px solid ${p.accent};background:${p.surface}"><strong>${esc(a.headline)}</strong> <a href="${esc(a.url)}" style="color:${p.ink}">Details</a></p>`,
      );
    for (const w of c.weather.periods)
      html.push(`<p style="margin:0 0 8px"><strong>${esc(w.name)}:</strong> ${esc(w.text)}</p>`);
    if (c.weather.outlook)
      html.push(
        `<p style="margin:0 0 8px"><strong>${esc(c.weather.outlook.label)}:</strong> ${esc(c.weather.outlook.line)}</p>`,
      );
    if (c.weather.tropics)
      html.push(
        `<p style="margin:0 0 8px"><strong>Tropics:</strong> <a href="${esc(c.weather.tropics.url)}" style="color:${p.ink}">${esc(c.weather.tropics.line)}</a></p>`,
      );
  }
  if (c.items.length) {
    html.push(h2('Top stories'));
    for (const i of c.items)
      html.push(
        `<p style="margin:0 0 4px;font-size:19px;font-weight:bold;line-height:1.3"><a href="${esc(storyUrl(c.town.domain, i.slug))}" style="color:${p.ink};text-decoration:none">${esc(i.headline)}</a></p>` +
          (i.dek
            ? `<p style="margin:0 0 18px;font-size:16px">${esc(i.dek)}</p>`
            : '<p style="margin:0 0 18px"></p>'),
      );
  }
  html.push(slot(c.mid));
  if (c.meetings.length) {
    html.push(h2('Coming up'));
    html.push(
      `<ul style="margin:0;padding-left:20px">${c.meetings
        .map(
          (m) =>
            `<li style="margin:0 0 6px">${esc(meetingTime(m.startsAt, c.town.timezone))}: ${
              m.url
                ? `<a href="${esc(m.url)}" style="color:${p.ink}">${esc(m.title)}</a>`
                : esc(m.title)
            }</li>`,
        )
        .join('')}</ul>`,
    );
  }
  if (c.corrections.length) {
    html.push(h2('Corrections'));
    for (const f of c.corrections)
      html.push(
        `<p style="margin:0 0 8px"><a href="${esc(storyUrl(c.town.domain, f.slug))}" style="color:${p.ink}">${esc(f.headline)}</a>: ${esc(f.note)}</p>`,
      );
  }
  html.push(
    `<p style="margin:28px 0 0;font-size:14px">Written by the ${esc(c.town.siteName)} Newsroom from public records. Every story links to the records it was written from. <a href="https://${esc(c.town.domain)}/methods" style="color:${p.ink}">How we report</a></p>`,
  );

  const text: string[] = [`${c.town.siteName}`, longDate(c.date), ''];
  const slotText = (s: SlotFill) => [
    `[${s.label}] ${s.headline}`,
    ...(s.body ? [s.body] : []),
    s.href,
    '',
  ];
  if (c.top) text.push(...slotText(c.top));
  if (c.weather) {
    text.push('WEATHER');
    for (const a of c.weather.alerts) text.push(`ALERT: ${a.headline} ${a.url}`);
    for (const w of c.weather.periods) text.push(`${w.name}: ${w.text}`);
    if (c.weather.outlook) text.push(`${c.weather.outlook.label}: ${c.weather.outlook.line}`);
    if (c.weather.tropics) text.push(`Tropics: ${c.weather.tropics.line} ${c.weather.tropics.url}`);
    text.push('');
  }
  if (c.items.length) {
    text.push('TOP STORIES');
    for (const i of c.items)
      text.push(i.headline, ...(i.dek ? [i.dek] : []), storyUrl(c.town.domain, i.slug), '');
  }
  text.push(...slotText(c.mid));
  if (c.meetings.length) {
    text.push('COMING UP');
    for (const m of c.meetings)
      text.push(
        `${meetingTime(m.startsAt, c.town.timezone)}: ${m.title}${m.url ? ` ${m.url}` : ''}`,
      );
    text.push('');
  }
  if (c.corrections.length) {
    text.push('CORRECTIONS');
    for (const f of c.corrections)
      text.push(`${f.headline}: ${f.note} ${storyUrl(c.town.domain, f.slug)}`);
    text.push('');
  }
  text.push(
    `Written by the ${c.town.siteName} Newsroom from public records. Every story links to the records it was written from. How we report: https://${c.town.domain}/methods`,
  );
  return { subject, preheader, html: html.join('\n'), text: text.join('\n') };
}
