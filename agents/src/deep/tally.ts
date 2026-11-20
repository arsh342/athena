export type Vote = 'confirmed' | 'refuted' | 'needs-human';

/** Majority of the usable votes, decided in code (never by a model): at least two must agree, otherwise a person decides. */
export function tally(votes: Vote[]): Vote {
  const count = (v: Vote) => votes.filter((x) => x === v).length;
  if (count('confirmed') >= 2) return 'confirmed';
  if (count('refuted') >= 2) return 'refuted';
  return 'needs-human';
}
