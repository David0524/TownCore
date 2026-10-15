// Email address handling for routing (docs/plans/MAIL.md). Addresses arrive from the SES
// envelope recipient, which already carries no display name or angle brackets.

export type ParsedAddress = {
  /** The whole address, lowercased: what a reply is sent from. */
  address: string;
  /** Local part without a `+tag`, lowercased: what picks the role. */
  role: string;
  domain: string;
};

const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Parses a bare address, or returns null if it isn't one we can route. */
export function parseAddress(raw: string): ParsedAddress | null {
  const value = raw.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).replace(/\.$/, '');
  if (!LOCAL.test(local) || !DOMAIN.test(domain)) return null;
  const role = local.split('+')[0]!;
  if (!role) return null;
  return { address: `${local}@${domain}`, role, domain };
}
