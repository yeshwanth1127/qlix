/**
 * Place names that mean the same city.
 *
 * A real lead sheet mixes the current and the former spelling in one column — "Bangalore" on
 * one row, "Bengaluru" on the next — and a stage that matches the literal string keeps the
 * first and silently drops the second. Every group is a set of names for one place, never a
 * region rollup: entries here are treated as interchangeable when filtering leads.
 */
const CITY_ALIAS_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['bengaluru', 'bangalore', 'bangaluru', 'benagaluru', 'blr'],
  ['mumbai', 'bombay'],
  ['chennai', 'madras'],
  ['kolkata', 'calcutta'],
  ['pune', 'poona'],
  ['gurugram', 'gurgaon'],
  ['thiruvananthapuram', 'trivandrum'],
  ['kochi', 'cochin'],
  ['mysuru', 'mysore'],
  ['vadodara', 'baroda'],
  ['puducherry', 'pondicherry'],
  ['visakhapatnam', 'vishakhapatnam', 'vizag'],
  ['varanasi', 'banaras', 'benares'],
  ['tiruchirappalli', 'trichy'],
  ['ahmedabad', 'amdavad'],
  ['prayagraj', 'allahabad'],
  ['new delhi', 'delhi'],
  ['noida', 'new okhla industrial development authority'],
];

const CANONICAL_BY_ALIAS = new Map<string, string>();
for (const group of CITY_ALIAS_GROUPS) {
  for (const alias of group) CANONICAL_BY_ALIAS.set(alias, group[0]!);
}

/** Case, accent and punctuation stripped, so "Bengaluru " and "bengaluru" compare equal. */
export function normalizeCityValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Alias-resolved form. A place with no known alias keeps its own normalized spelling. */
export function canonicalCity(value: unknown): string {
  const normalized = normalizeCityValue(value);
  return CANONICAL_BY_ALIAS.get(normalized) ?? normalized;
}

/** Two place names that refer to the same city, whichever spelling each one uses. */
export function sameCity(left: unknown, right: unknown): boolean {
  const canonical = canonicalCity(left);
  return canonical.length > 0 && canonical === canonicalCity(right);
}

/** Every known spelling of a city, most-current first. Empty when the name has no aliases. */
export function cityAliasVariants(value: unknown): string[] {
  const canonical = canonicalCity(value);
  const group = CITY_ALIAS_GROUPS.find((item) => item[0] === canonical);
  return group ? [...group] : [];
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

/**
 * A filter instruction that names the alias spellings actually at stake, e.g.
 * `Bangalore, Bengaluru and Blr are the same city`. The generic "treat aliases as the same
 * place" line is easy for a small model to skim past; naming the city in the goal is not.
 */
export function cityAliasHint(goal: string): string {
  const normalized = normalizeCityValue(goal);
  const named: string[][] = [];
  const seen = new Set<string>();
  for (const group of CITY_ALIAS_GROUPS) {
    if (group.length < 2) continue;
    const canonical = group[0]!;
    if (seen.has(canonical)) continue;
    const mentioned = group.some((alias) =>
      new RegExp(`(^| )${alias}( |$)`).test(normalized),
    );
    if (!mentioned) continue;
    seen.add(canonical);
    named.push(group.map(titleCase));
  }
  if (named.length === 0) return '';
  const clauses = named.map((group) => {
    const spellings = group.slice(0, 3);
    return `${spellings.slice(0, -1).join(', ')} and ${spellings[spellings.length - 1]} are the same city`;
  });
  return `- ${clauses.join('; ')} — keep every row spelled any of those ways.\n`;
}
