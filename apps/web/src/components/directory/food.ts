import type { FoodColor } from '@towncore/config';

// How a place to eat looks on the homepage and in the directory (owner, 2026-10-16: "add some
// color, details"): a flavor color and a drawn icon from its cuisine when the map gives one,
// else from words in its name, else from its license. The icon is decoration; the words we
// print come only from the records (license kind, mapped cuisine).

export type FoodIcon =
  | 'pizza'
  | 'taco'
  | 'bowl'
  | 'fish'
  | 'burger'
  | 'coffee'
  | 'sweets'
  | 'leaf'
  | 'cloche'
  | 'bag'
  | 'plate';

export type FoodLook = { color: FoodColor; icon: FoodIcon };

const RULES: Array<[RegExp, FoodLook]> = [
  [/pizz|italian|trattoria|pasta|osteria/, { color: 'tomato', icon: 'pizza' }],
  [
    /mexican|taco|cantina|tex.?mex|latin|burrito|tequila|cuban|peruvian/,
    { color: 'saffron', icon: 'taco' },
  ],
  [
    /sushi|japanese|ramen|poke|chinese|thai|asian|korean|vietnam|pho|noodle|dim.?sum|hibachi|kanpai/,
    { color: 'ocean', icon: 'bowl' },
  ],
  [/seafood|fish|oyster|crab|lobster|raw.?bar/, { color: 'ocean', icon: 'fish' }],
  [/coffee|cafe|café|espresso|tea\b|bagel|breakfast|brunch/, { color: 'cocoa', icon: 'coffee' }],
  [
    /bakery|pastry|dessert|ice.?cream|gelato|donut|cupcake|cake|sweet|cookie|chocolate|crepe/,
    { color: 'berry', icon: 'sweets' },
  ],
  [
    /burger|american|grill|bbq|barbecue|steak|chicken|wings|diner|sandwich|deli|hot.?dog/,
    { color: 'tomato', icon: 'burger' },
  ],
  [
    /salad|vegan|vegetarian|healthy|juice|smoothie|acai|mediterranean|greek|meal.?prep|bowl/,
    { color: 'basil', icon: 'leaf' },
  ],
  [/cater/, { color: 'saffron', icon: 'cloche' }],
];

export function foodLook(input: {
  cuisine?: string | null;
  name: string;
  licenseType?: string | null;
}): FoodLook {
  for (const text of [input.cuisine, input.name, input.licenseType]) {
    const t = text?.toLowerCase();
    if (!t) continue;
    const hit = RULES.find(([re]) => re.test(t));
    if (hit) return hit[1];
  }
  const kind = input.licenseType?.toLowerCase() ?? '';
  if (kind.includes('non-seating') || kind.includes('mobile'))
    return { color: 'saffron', icon: 'bag' };
  return { color: 'basil', icon: 'plate' };
}

/** "Permanent Food Service, non-seating" → "Takeout and counter". */
export function foodKind(licenseType: string | null | undefined): string | null {
  const t = licenseType?.toLowerCase() ?? '';
  if (!t) return null;
  if (t.includes('mobile')) return 'Food truck';
  if (t.includes('cater')) return 'Caterer';
  if (t.includes('non-seating')) return 'Takeout and counter';
  if (t.includes('seating')) return 'Sit-down restaurant';
  if (t.includes('vending')) return null;
  return 'Food service';
}

/** A business name without its legal suffix: "Forma Meal Prep Co LLC" → "Forma Meal Prep Co". */
export const friendlyName = (name: string) =>
  name.replace(/[\s,]+(LLC|L\.L\.C\.?|Inc\.?|Corp\.?|Corporation)$/i, '').trim() || name;

/** "Mexican, tacos" → "Mexican, tacos" with a capital; null stays null. */
export const capitalized = (text: string | null | undefined) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
