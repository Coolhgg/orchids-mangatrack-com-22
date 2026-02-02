import { prisma } from "@/lib/prisma";
import { 
  ImportEntry, 
  MatchResult, 
  normalizeTitle, 
  extractPlatformIds 
} from "./shared";

export async function matchSeries(entry: ImportEntry): Promise<MatchResult> {
  const normalizedInputTitle = normalizeTitle(entry.title);
  
  // 1. EXACT ID MATCH FROM URL (Highest confidence)
  const platformInfo = extractPlatformIds(entry.source_url);
  if (platformInfo) {
    let series;
    if (platformInfo.platform === 'mangadex') {
      series = await prisma.series.findUnique({
        where: { mangadex_id: platformInfo.id },
        select: { id: true }
      });
    }
    
    if (series) {
      return { series_id: series.id, confidence: "high", match_type: "exact_url" };
    }
  }

  // 2. Exact Title Match
  const exactMatch = await prisma.series.findFirst({
    where: {
      OR: [
        { title: { equals: entry.title, mode: "insensitive" } },
        { title: { equals: normalizedInputTitle, mode: "insensitive" } }
      ]
    },
    select: { id: true },
  });
  if (exactMatch) {
    return { series_id: exactMatch.id, confidence: "high", match_type: "exact_title" };
  }

  // 3. Alias Match
  const aliasMatch = await prisma.series.findFirst({
    where: {
      alternative_titles: {
        array_contains: entry.title,
      },
    },
    select: { id: true },
  });
  if (aliasMatch) {
    return { series_id: aliasMatch.id, confidence: "medium", match_type: "alias" };
  }

  return { series_id: null, confidence: "none", match_type: "none" };
}
