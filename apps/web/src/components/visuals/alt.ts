// Alt text without the "Illustration (AI-generated): " prefix older image rows carry (labels
// removed, owner 2026-10-16); the rest is what the picture shows.
export const plainAlt = (alt: string) =>
  alt.replace(/^(Illustration|Image) \(AI-generated\):\s*/, '');
