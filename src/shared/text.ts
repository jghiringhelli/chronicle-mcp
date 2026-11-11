/**
 * Text normalisation shared by every path that compares a query to a memory.
 *
 * It lives in `shared/` rather than next to one of its callers because three layers need the
 * identical answer and none of them may import the others: the SQL candidate filter is an
 * adapter, `recall-ranker` is a service, and `lexical-vector-gateway` is infrastructure. If
 * two of them tokenised differently, a memory could pass the filter and then score zero, or
 * score well and never be retrieved — a disagreement that presents as "recall sometimes misses
 * things" and is close to undebuggable from the outside.
 */

/**
 * English stop words.
 *
 * Deliberately short. A long list starts removing words that carry meaning in a technical
 * memory, and the negations are kept for exactly that reason: `not`, `no` and `never` must
 * survive, or "request bodies are never logged" and "request bodies are logged" become the
 * same text.
 *
 * The list exists because of a measured defect, not on principle. Without it the recall SQL
 * OR-ed one `LIKE` per word, so "what is the capital of France" matched almost every memory in
 * the corpus through `is` and `of`, and two of three out-of-scope queries returned a full page
 * of results (`docs/evidence/recall-experiment.json`, the `keyword` configuration).
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into', 'about', 'over',
  'it', 'its', 'we', 'our', 'us', 'they', 'them', 'their', 'he', 'she', 'his', 'her',
  'you', 'your', 'i', 'me', 'my',
  'what', 'which', 'who', 'whom', 'where', 'when', 'how', 'why',
  'so', 'such', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'there', 'here', 'also', 'just', 'only', 'very', 'too', 'both', 'each', 'any', 'all', 'some',
  'get', 'gets', 'got',
]);

/**
 * Split text into lowercase content tokens.
 *
 * Single characters are dropped along with stop words: a one-letter `LIKE '%a%'` matches
 * essentially every row, which is the same defect as a stop word by another route.
 *
 * @param text - Raw text
 * @returns Tokens in order of appearance, lowercased, stop words and single characters removed
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}
