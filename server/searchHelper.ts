import * as OpenCC from "opencc-js";

// Initialize converters
const converterToSimp = OpenCC.Converter({ from: "t", to: "cn" });
const converterToTrad = OpenCC.Converter({ from: "cn", to: "t" });

/**
 * Convert text to Simplified Chinese
 */
export function toSimplified(text: string): string {
  if (!text) return "";
  try {
    return converterToSimp(text);
  } catch {
    return text;
  }
}

/**
 * Convert text to Traditional Chinese
 */
export function toTraditional(text: string): string {
  if (!text) return "";
  try {
    return converterToTrad(text);
  } catch {
    return text;
  }
}

/**
 * Clean book title by stripping common brackets, tags, file extensions and formatting
 */
export function cleanBookTitle(rawTitle: string): string {
  if (!rawTitle) return "";
  let t = String(rawTitle).trim();
  // Remove book brackets
  t = t.replace(/^[《<〈「『【\[(（]+/g, "").replace(/[》>〉」』】\])）]+$/g, "").trim();
  // Remove common suffixes and tags
  t = t.replace(/\.(txt|epub|mobi|pdf)$/i, "").trim();
  t = t.replace(/(?:txt|TXT)?(?:全集|完结|最新|精校|精排|全本|正文|连载中|校对版|未删节|典藏版)/gi, "").trim();
  t = t.replace(/^(?:GL|BG|BL|GB|同人|二创|求|附|短篇|长篇)\s*[:：\-—]?\s*/gi, "").trim();
  t = t.replace(/^[《<〈「『【\[(（]+/g, "").replace(/[》>〉」』】\])）]+$/g, "").trim();
  return t.trim();
}

/**
 * Clean author name
 */
export function cleanAuthor(rawAuthor: string): string {
  if (!rawAuthor) return "";
  let a = String(rawAuthor).trim();
  a = a.replace(/^(?:作者|by)\s*[:：]?\s*/i, "").trim();
  a = a.replace(/^[《<〈「『【\[(（]+/g, "").replace(/[》>〉」』】\])）]+$/g, "").trim();
  return a.trim();
}

/**
 * Longest Common Subsequence length
 */
function getLcsLength(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  if (m === 0 || n === 0) return 0;
  
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export interface SearchResultItem {
  title: string;
  author: string;
  category: string;
  url: string;
  rawUrl?: string;
  desc: string;
  matchScore?: number;
  exactMatch?: boolean;
}

/**
 * Calculate match score between search query and a novel item
 * Considers bidirectional Simplified and Traditional Chinese variants
 */
export function evaluateMatch(
  item: SearchResultItem,
  rawQuery: string
): { score: number; exactMatch: boolean } {
  const queryClean = cleanBookTitle(rawQuery);
  const qSimp = toSimplified(queryClean).toLowerCase().replace(/\s+/g, "");
  const qTrad = toTraditional(queryClean).toLowerCase().replace(/\s+/g, "");

  const titleClean = cleanBookTitle(item.title);
  const tSimp = toSimplified(titleClean).toLowerCase().replace(/\s+/g, "");
  const tTrad = toTraditional(titleClean).toLowerCase().replace(/\s+/g, "");

  const authorClean = cleanAuthor(item.author || "");
  const aSimp = toSimplified(authorClean).toLowerCase().replace(/\s+/g, "");
  const aTrad = toTraditional(authorClean).toLowerCase().replace(/\s+/g, "");

  if (!qSimp) return { score: 0, exactMatch: false };

  // 1. Exact match check (Simplified or Traditional)
  const isExact = (
    tSimp === qSimp || 
    tTrad === qTrad || 
    tSimp === qTrad || 
    tTrad === qSimp
  );

  if (isExact) {
    return { score: 10000, exactMatch: true };
  }

  // Author exact match check
  if (aSimp === qSimp || aTrad === qTrad) {
    return { score: 8500, exactMatch: false };
  }

  // 2. Starts with query (e.g. "凡人修仙" -> "凡人修仙传")
  if (tSimp.startsWith(qSimp) || tTrad.startsWith(qTrad)) {
    const lenDiff = Math.abs(tSimp.length - qSimp.length);
    const score = Math.max(5000 - lenDiff * 30, 2000);
    return { score, exactMatch: false };
  }

  // 3. Ends with query
  if (tSimp.endsWith(qSimp) || tTrad.endsWith(qTrad)) {
    const lenDiff = Math.abs(tSimp.length - qSimp.length);
    const score = Math.max(4500 - lenDiff * 30, 1800);
    return { score, exactMatch: false };
  }

  // 4. Substring contains query
  if (tSimp.includes(qSimp) || tTrad.includes(qTrad)) {
    const lenDiff = Math.abs(tSimp.length - qSimp.length);
    const score = Math.max(3500 - lenDiff * 25, 1200);
    return { score, exactMatch: false };
  }

  // 5. Query contains title (user searched "凡人修仙传全集TXT")
  if (qSimp.includes(tSimp) || qTrad.includes(tTrad)) {
    const lenDiff = Math.abs(qSimp.length - tSimp.length);
    const score = Math.max(3000 - lenDiff * 25, 1000);
    return { score, exactMatch: false };
  }

  // 6. Fuzzy overlap and Longest Common Subsequence (LCS)
  const lcsSimp = getLcsLength(qSimp, tSimp);
  const lcsTrad = getLcsLength(qTrad, tTrad);
  const bestLcs = Math.max(lcsSimp, lcsTrad);

  // Character set overlap
  const qChars = new Set(qSimp.split(""));
  let matchedCharCount = 0;
  for (const char of tSimp) {
    if (qChars.has(char)) matchedCharCount++;
  }

  const lcsRatio = bestLcs / qSimp.length;
  const overlapRatio = matchedCharCount / Math.max(qSimp.length, tSimp.length);

  // If at least 50% characters match in order, or high overlap
  if (lcsRatio >= 0.5 || (qSimp.length <= 4 && bestLcs >= 2) || (qSimp.length > 4 && bestLcs >= 3)) {
    const lenDiffPenalty = Math.abs(tSimp.length - qSimp.length) * 20;
    const score = Math.round(lcsRatio * 1600 + overlapRatio * 800 - lenDiffPenalty);
    return { score: Math.max(score, 100), exactMatch: false };
  }

  // Check if author matches partially
  if (aSimp && (aSimp.includes(qSimp) || qSimp.includes(aSimp))) {
    return { score: 600, exactMatch: false };
  }

  return { score: 0, exactMatch: false };
}

/**
 * Filter and sort search results by match mode
 * - 'exact': Only returns items that exactly match book title (Simp/Trad cross check)
 * - 'fuzzy': Returns items ranked by match score, limited to at most 10 items
 */
export function rankAndFilterSearchResults(
  items: SearchResultItem[],
  query: string,
  mode: "fuzzy" | "exact" = "fuzzy"
): SearchResultItem[] {
  if (!items || items.length === 0) return [];
  if (!query || !query.trim()) return items.slice(0, 10);

  // Score each item
  const scoredItems = items.map(item => {
    const { score, exactMatch } = evaluateMatch(item, query);
    return {
      ...item,
      matchScore: score,
      exactMatch
    };
  });

  if (mode === "exact") {
    // Only return exact matches, strictly capped at 10
    const exactMatches = scoredItems.filter(item => item.exactMatch);
    const uniqueExact: SearchResultItem[] = [];
    const seenExactKeys = new Set<string>();
    for (const item of exactMatches) {
      const key = `${cleanBookTitle(item.title).toLowerCase()}|${cleanAuthor(item.author).toLowerCase()}`;
      if (!seenExactKeys.has(key)) {
        seenExactKeys.add(key);
        uniqueExact.push(item);
      }
    }
    return uniqueExact.slice(0, 10);
  }

  // Fuzzy mode:
  // Sort descending by match score
  scoredItems.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

  // Filter out completely irrelevant items (score <= 0), unless no items scored
  let candidates = scoredItems.filter(item => (item.matchScore || 0) > 0);
  if (candidates.length === 0) {
    candidates = scoredItems;
  }

  // Deduplicate identical title + author pairs while preserving descending score order
  const uniqueCandidates: SearchResultItem[] = [];
  const seenFuzzyKeys = new Set<string>();
  for (const c of candidates) {
    const key = `${cleanBookTitle(c.title).toLowerCase()}|${cleanAuthor(c.author).toLowerCase()}`;
    if (!seenFuzzyKeys.has(key)) {
      seenFuzzyKeys.add(key);
      uniqueCandidates.push(c);
    }
  }

  // Strictly limit to at most 10 results
  return uniqueCandidates.slice(0, 10);
}
