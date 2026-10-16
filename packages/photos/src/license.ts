// The license grants a sender accepts with a photo (M9, CLAUDE.md §11c; docs/plans/M9.md D-M9-2).
// The exact text and its version are stored with each submission, so a later wording change never
// rewrites what someone agreed to.

export type LicenseGrant = { version: string; text: string };

export function readerLicense(siteName: string): LicenseGrant {
  return {
    version: 'reader-v1',
    text: `I took this photo and I own it. I give ${siteName} a non-exclusive, royalty-free license to publish it, with my credit line, on its website, in its newsletter and on its social media pages. I keep the copyright. It shows no one under 18 who can be identified, and no private home's address.`,
  };
}

export function businessLicense(siteName: string): LicenseGrant {
  return {
    version: 'business-v1',
    text: `The business owns this photo or may license it. It gives ${siteName} a non-exclusive, royalty-free license to show it, with the credit line, on the business's listing, in stories about the business and in the newsletter, until the business removes it. It shows no one under 18 who can be identified.`,
  };
}
