import { describe, expect, it } from 'vitest';
import { parseAddress } from '../src/address';
import { routeRecipient, type RoutingInput } from '../src/routing';

const input: RoutingInput = {
  domains: new Set(['bocatownsquare.com', 'harborpoint.test']),
  roles: new Map([
    ['sales', 'team-sales'],
    ['news', 'team-editorial'],
  ]),
  catchAllTeamId: 'team-admin',
};

describe('parseAddress', () => {
  it('lowercases, strips a trailing dot and a +tag from the role', () => {
    expect(parseAddress(' Sales+Spring@BocaTownSquare.com. ')).toEqual({
      address: 'sales+spring@bocatownsquare.com',
      role: 'sales',
      domain: 'bocatownsquare.com',
    });
  });

  it.each(['', 'no-at-sign', '@bocatownsquare.com', 'a@b', 'a b@x.com', '+tag@x.com', 'a@-x.com'])(
    'rejects %j',
    (raw) => expect(parseAddress(raw)).toBeNull(),
  );

  it('splits on the last @', () => {
    expect(parseAddress('"odd@local"@x.com')).toBeNull();
    expect(parseAddress('a@b@x.com')).toBeNull();
  });
});

describe('routeRecipient', () => {
  it('sends a role address to its team, on every town', () => {
    for (const domain of ['bocatownsquare.com', 'harborpoint.test']) {
      expect(routeRecipient(`sales@${domain}`, input)).toMatchObject({
        kind: 'team',
        teamId: 'team-sales',
        townAddress: `sales@${domain}`,
        catchAll: false,
      });
    }
  });

  it('keeps the exact address (with its tag) for replies, but routes by role', () => {
    expect(routeRecipient('News+Tips@bocatownsquare.com', input)).toMatchObject({
      teamId: 'team-editorial',
      townAddress: 'news+tips@bocatownsquare.com',
      role: 'news',
    });
  });

  it('sends unknown addresses on a known domain to the catch-all', () => {
    expect(routeRecipient('random@bocatownsquare.com', input)).toMatchObject({
      kind: 'team',
      teamId: 'team-admin',
      townAddress: 'random@bocatownsquare.com',
      catchAll: true,
    });
  });

  it('drops mail for domains we have not onboarded, including news. subdomains', () => {
    expect(routeRecipient('sales@example.com', input)).toEqual({
      kind: 'drop',
      reason: 'unknown_domain',
    });
    expect(routeRecipient('newsletter@news.bocatownsquare.com', input)).toEqual({
      kind: 'drop',
      reason: 'unknown_domain',
    });
    expect(routeRecipient('garbage', input)).toEqual({ kind: 'drop', reason: 'invalid_address' });
  });
});
