// About page copy (CLAUDE.md Rule 1: names the publisher). Draft for owner review before launch.
// Laid out per docs/plans/M4b.md §4: an "In short" box, how we work in three steps, what we
// cover, then corrections, advertising and contact, ending with the publisher line.

export const aboutInShort = [
  '{site_name} reports what the public record says about {town_name}: meetings, votes, permits, new businesses, official releases and weather.',
  'Stories are drafted by software from public records, checked fact by fact against those records, and every one links to its sources.',
  'Every byline says "(AI-assisted)". Sensitive stories are approved by a person before they publish.',
];

export const aboutSteps = [
  {
    title: 'We start from public records',
    text: 'City meeting calendars and releases, state business and license records, and National Weather Service data. We never rewrite other news outlets.',
  },
  {
    title: 'Software drafts, a separate check verifies',
    text: 'A draft is written from the records alone. A separate check compares every name, number and quote against them; anything it can’t find goes back or to a person.',
  },
  {
    title: 'People approve the sensitive ones',
    text: 'Stories about public safety, health, inspections or any private person are approved by an editor before they publish, and the byline says so.',
  },
];

export const aboutRest = `
## What we don't do

- We don't rewrite other news outlets' stories.
- We don't publish mugshots, rumors, or the names of minors or victims.
- We don't let advertisers affect what we cover or how stories are ranked. Paid placements are
  always labeled "Sponsored" or "Advertisement".

## Corrections and contact

If we got something wrong, tell us at [{contact_email}](mailto:{contact_email}). We fix errors
quickly and note every correction on the story and on our [Corrections](/corrections) page.

News tips and public records are welcome at the same address. [How we report](/methods)
explains our process in detail.

Took a photo around town? [Send it to us](/photos). An editor reviews every photo, and we print
your credit line.

## Advertising

Local businesses can sponsor {site_name} or feature their listing. Ask at
[{contact_email}](mailto:{contact_email}).

## Publisher

{publisher_line}
`;
