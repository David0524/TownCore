// Multi-domain mail platform (docs/plans/MAIL.md): routing now; SES, MIME, threading,
// suppression, bulk sending and domain onboarding arrive phase by phase.
export { parseAddress, type ParsedAddress } from './address';
export { routeRecipient, type Route, type RoutingInput } from './routing';
