
export type ChapterType = 'normal' | 'special' | 'extra';

export interface NormalizedChapter {
  number: number | null;
  type: ChapterType;
  slug: string;
}

/**
 * Normalizes chapter labels into numeric values and types.
 * Rules:
 * 1. Strip prefixes (ch, chapter, #)
 * 2. Convert to numeric if possible (preserve decimals)
 * 3. Detect type (normal, special, extra)
 * 4. Treat "Extra", "Special" as non-numeric in terms of 'normal' flow
 */
export function normalizeChapter(label: string, title?: string): NormalizedChapter {
  const sanitized = label.toLowerCase().trim();
  
  let type: ChapterType = 'normal';
  if (sanitized.includes('extra') || sanitized.includes(' ex')) {
    type = 'extra';
  } else if (sanitized.includes('special') || sanitized.includes('omake') || sanitized.includes('oneshot') || sanitized.includes('s')) {
    // Check for 's' carefully to avoid matching 'series' or something
    if (sanitized.match(/\bs\d+/) || sanitized.includes('special')) {
      type = 'special';
    }
  }

  // Extract number
  // Regex matches decimals like 1105.5
  const numberMatch = sanitized.match(/(\d+(\.\d+)?)/);
  const num: number | null = numberMatch ? parseFloat(numberMatch[0]) : null;

  // Slug generation: type-number or type-titlehash
  let slug: string = type;
  if (num !== null) {
    slug = `${type}-${num}`;
  } else if (title) {
    const titleHash = title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
    slug = `${type}-${titleHash}`;
  } else {
    slug = `${type}-unknown`;
  }

  return {
    number: num,
    type,
    slug
  };
}

/**
 * Normalizes a chapter number to a consistent string format for database storage.
 * This ensures that 1, 1.0, 1.00 all become "1" while 1.5 stays "1.5".
 * Used as the unique identifier in the logical_chapters table.
 */
export function normalizeChapterNumberString(num: number | null): string {
  if (num === null || isNaN(num)) {
    return "-1"; // Sentinel for chapters without numbers
  }
  
  // Check if it's effectively an integer (1.0, 1.00, etc.)
  if (Number.isInteger(num) || Math.abs(num - Math.round(num)) < 0.0001) {
    return String(Math.round(num));
  }
  
  // For decimals, strip trailing zeros but keep significant decimal places
  // e.g., 1.50 -> "1.5", 1.123 -> "1.123"
  return String(num).replace(/\.?0+$/, '');
}

/**
 * Dedup decision logic
 */
export function shouldMerge(a: NormalizedChapter, b: NormalizedChapter, titleA?: string, titleB?: string, dateA?: Date, dateB?: Date): boolean {
  // Rule: Same normalized_chapter_number → SAME logical chapter (if same type)
  if (a.number !== null && b.number !== null && a.number === b.number && a.type === b.type) {
    return true;
  }

  // Fallback for missing chapter numbers
  if (a.number === null && b.number === null && a.type === b.type) {
    if (!titleA || !titleB) return false;
    
    const hashA = titleA.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hashB = titleB.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    if (hashA === hashB) {
      if (!dateA || !dateB) return true; // Merge if no dates to compare
      
      const diffMs = Math.abs(dateA.getTime() - dateB.getTime());
      const diffHours = diffMs / (1000 * 60 * 60);
      
      return diffHours <= 72; // Release proximity rule (72 hours)
    }
  }

  return false;
}
