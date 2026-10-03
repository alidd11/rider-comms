// Server-side filter for objectionable text (App Store guideline 1.2 asks
// apps with user-generated content to filter it before it's posted). It is a
// floor, not moderation: reports, blocks and the staff queue handle the rest.
//
// Two tiers:
// - SEVERE: slurs and sexual-violence terms, rejected everywhere, private
//   messages included.
// - PROFANE: general profanity and explicit words, rejected only in text
//   other riders see without being friends (usernames, display names,
//   handles, social usernames). Friends can swear at each other in DMs.
//
// Matching normalises case, accents, common look-alike characters (0→o,
// 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s) and separators. Short terms only match
// as whole words so place names like "Scunthorpe" or "Penistone" pass.

// Each term matches as a whole word; terms marked * also match inside other
// words. Inside-matching is reserved for strings that never occur in
// innocent words, so "therapist", "grape", "Sussex", "Peacock" and surnames
// that collide with slurs are not blocked.
const SEVERE_TERMS = [
  'nigger*', 'nigga*', 'faggot*', 'fagot', 'tranny', 'retard', 'spastic', 'chink', 'gook', 'kike', 'paki', 'wetback*',
  'raghead*', 'towelhead*', 'spic', 'beaner', 'golliwog*', 'pedophile*', 'paedophile*', 'childporn*', 'rapist',
  'gasthejews*', 'heilhitler*', 'siegheil*', 'whitepower*',
];

const PROFANE_TERMS = [
  'fuck*', 'fucker', 'fucking', 'shit', 'shite', 'cunt', 'pussy', 'twat', 'wanker*', 'bitch', 'slut', 'whore',
  'porn', 'porno', 'pornhub*', 'onlyfans*', 'nudes', 'sex', 'cum', 'jizz*', 'tits', 'boobs', 'penis', 'vagina',
  'rape', 'blowjob*', 'handjob*', 'dildo*', 'hentai*', 'nazi', 'hitler',
  'dickhead', 'prick', 'arsehole', 'asshole', 'bellend', 'bastard', 'tosser', 'knobhead',
];

function compile(terms: readonly string[]): Array<{ term: string; inside: boolean }> {
  return terms.map((entry) => ({ term: entry.replace('*', ''), inside: entry.endsWith('*') }));
}

const SEVERE = compile(SEVERE_TERMS);
const PROFANE = compile(PROFANE_TERMS);

const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function normalise(text: string): { words: string[]; compact: string } {
  const folded = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // A handle's leading @ is punctuation, not an "a".
    .replace(/(^|\s)@+/g, '$1')
    .replace(/[013457@$!]/g, (c) => LOOKALIKES[c] ?? c);
  const words = folded.split(/[^a-z]+/).filter(Boolean);
  return { words, compact: words.join('') };
}

function matches(text: string, terms: ReadonlyArray<{ term: string; inside: boolean }>): boolean {
  const { words, compact } = normalise(text);
  if (!compact) return false;
  const wordSet = new Set(words);
  // "f u c k" or "f.u.c.k": a run of single letters also counts as one word.
  const spelled = new Set<string>();
  let run = '';
  for (const word of [...words, '']) {
    if (word.length === 1) {
      run += word;
      continue;
    }
    if (run.length > 1) spelled.add(run);
    run = '';
  }
  return terms.some(({ term, inside }) => wordSet.has(term) || spelled.has(term) || (inside && compact.includes(term)));
}

/** True when the text contains a slur or sexual-violence term (blocked everywhere). */
export function containsSevereText(text: unknown): boolean {
  return typeof text === 'string' && matches(text, SEVERE);
}

/** True when public-facing text (names, handles) contains severe or profane terms. */
export function containsObjectionableText(text: unknown): boolean {
  return typeof text === 'string' && (matches(text, SEVERE) || matches(text, PROFANE));
}
