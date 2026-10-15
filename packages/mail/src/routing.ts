import { parseAddress } from './address';

// Roles are global (D-MAIL-3): `sales@` on any town goes to the same team, and anything unknown
// goes to the catch-all team. Mail for a domain we haven't onboarded is dropped and logged.

export type RoutingInput = {
  /** Onboarded town domains, lowercased (no `news.` subdomains: they receive no mail). */
  domains: ReadonlySet<string>;
  roles: ReadonlyMap<string, string>;
  catchAllTeamId: string;
};

export type Route =
  | {
      kind: 'team';
      teamId: string;
      /** The exact town address the mail was sent to; replies go out from it. */
      townAddress: string;
      domain: string;
      role: string;
      catchAll: boolean;
    }
  | { kind: 'drop'; reason: 'invalid_address' | 'unknown_domain' };

export function routeRecipient(envelopeRecipient: string, input: RoutingInput): Route {
  const parsed = parseAddress(envelopeRecipient);
  if (!parsed) return { kind: 'drop', reason: 'invalid_address' };
  if (!input.domains.has(parsed.domain)) return { kind: 'drop', reason: 'unknown_domain' };
  const teamId = input.roles.get(parsed.role);
  return {
    kind: 'team',
    teamId: teamId ?? input.catchAllTeamId,
    townAddress: parsed.address,
    domain: parsed.domain,
    role: parsed.role,
    catchAll: teamId === undefined,
  };
}
