import { ImportEntry } from "./shared";

export interface ParsedCSVResult {
  entries: ImportEntry[];
  hasProgressColumn: boolean;
  totalProgressValue: number;
}

/**
 * Robust CSV Parser for MangaTrack and other platforms.
 * Uses a state-machine to correctly handle:
 * - Multi-line fields (quoted newlines)
 * - Escaped quotes ("")
 * - Different delimiters (comma, pipe)
 * - BOM (Byte Order Mark) removal
 * - Skip invalid entries
 */
export function parseCSV(csvText: string): ImportEntry[];
export function parseCSV(csvText: string, returnMetadata: true): ParsedCSVResult;
export function parseCSV(csvText: string, returnMetadata?: boolean): ImportEntry[] | ParsedCSVResult {
  const emptyResult: ParsedCSVResult = { entries: [], hasProgressColumn: false, totalProgressValue: 0 };
  if (!csvText) return returnMetadata ? emptyResult : [];

  // 1. Strip BOM and normalize line endings
  const cleanText = csvText.replace(/^\uFEFF/, '');
  
  if (cleanText.trim() === "") return returnMetadata ? emptyResult : [];

  // 2. Detect delimiter: pipe (|) or comma (,)
  const firstLine = cleanText.split(/\r?\n/)[0];
  const delimiter = (firstLine.includes('|') && !firstLine.includes(',')) ? '|' : ',';

  const rows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;
  let i = 0;

  // 3. State-machine based parsing
  while (i < cleanText.length) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote: "" -> "
        currentField += '"';
        i++; // skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      // Field separator
      currentRow.push(currentField.trim());
      currentField = "";
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      // Row separator
      if (char === '\r' && nextChar === '\n') i++; // Handle CRLF
      
      currentRow.push(currentField.trim());
      // Only push non-empty rows
      if (currentRow.some(field => field !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      currentField += char;
    }
    i++;
  }

  // Handle last field/row
  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field !== "")) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return returnMetadata ? emptyResult : [];

  const rawHeaders = rows[0].map(h => h.toLowerCase().replace(/['"]/g, '').trim());
  const entries: ImportEntry[] = [];
  
  const progressHeaders = ["progress", "chapters", "read", "last_read", "last_chapter_read", "num_read_chapters", "chapters_read"];
  const hasProgressColumn = rawHeaders.some(h => progressHeaders.includes(h));
  let totalProgressValue = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const values = rows[rowIndex];
    const entry: Partial<ImportEntry> = {};
    
    rawHeaders.forEach((header, index) => {
      let val = (values[index] || "").trim();
      
      // Clean up quotes if they survived the state machine (e.g. malformed)
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1).replace(/""/g, '"').trim();
      }

      // Title mapping
      if (header === "title" || header === "name" || header === "manga" || header === "series" || header === "manga_title") {
        entry.title = val;
      } 
      // Status mapping
      else if (header === "status" || header === "state" || header === "my_status") {
        entry.status = val;
      } 
      // Progress mapping
      else if (header === "progress" || header === "chapters" || header === "read" || 
               header === "last_read" || header === "last_chapter_read" || 
               header === "num_read_chapters" || header === "chapters_read") {
        const parsed = parseFloat(val.replace(/[^\d.]/g, ''));
        entry.progress = isNaN(parsed) ? 0 : Math.floor(parsed);
      } 
      // External ID mapping
      else if (header === "external_id" || header === "id" || header === "mal_id" || header === "mangadex_id") {
        entry.external_id = val;
      } 
      // Source platform
      else if (header === "source" || header === "platform" || header === "tracked_site" || header === "source_name") {
        entry.source_platform = val;
        entry.source_name = val;
      }
        // Source URL (CRITICAL for platform ID extraction)
        else if (header === "series_url" || header === "source_url" || header === "url" || header === "link") {
          entry.source_url = val;
          
          // Extract IDs from URLs if not already present
          if (!entry.external_id) {
            if (val.includes('mangadex.org/title/')) {
              const match = val.match(/title\/([a-f\d-]+)/i);
              if (match) {
                entry.external_id = match[1];
                  entry.source_platform = 'mangadex';
                }
              } else if (val.includes('mangafire.to/manga/')) {
                const match = val.match(/manga\/([^/?#]+)/);
              if (match) {
                entry.external_id = match[1];
                entry.source_platform = 'mangafire';
              }
            } else if (val.includes('reaperscans.com/series/')) {
              const match = val.match(/series\/([^/?#]+)/);
              if (match) {
                entry.external_id = match[1];
                entry.source_platform = 'reaperscans';
              }
            } else if (val.includes('asuracomics.com/manga/')) {
              const match = val.match(/manga\/([^/?#]+)/);
              if (match) {
                entry.external_id = match[1];
                entry.source_platform = 'asura';
              }
            }
          }
        }

      // Last updated
      else if (header === "last_read_at" || header === "last_updated" || header === "updated_at") {
        entry.last_updated = val;
      }
    });

    // Valid title check - skip if missing
    if (entry.title && entry.title.trim() !== "") {
      const progressVal = entry.progress ?? 0;
      if (progressVal > 0) {
        totalProgressValue += progressVal;
      }
      entries.push({
        title: entry.title.trim(),
        status: entry.status || "reading",
        progress: progressVal,
        external_id: entry.external_id || undefined,
        source_platform: entry.source_platform || undefined,
        source_url: entry.source_url || undefined,
        source_name: entry.source_name || undefined,
        last_updated: entry.last_updated || undefined
      });
    }
  }

  if (returnMetadata) {
    return { entries, hasProgressColumn, totalProgressValue };
  }
  return entries;
}

/**
 * Generates a CSV string from import results for download.
 */
export function generateImportResultsCSV(results: Array<{
  title: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  reason_code?: string;
  reason_message?: string;
  matched_series?: string;
  source_url?: string;
}>): string {
  const headers = ["Title", "Status", "Reason Code", "Reason Message", "Matched Series", "Source URL"];
  
  const escapeCSV = (val: string | undefined): string => {
    if (!val) return "";
    const escaped = val.replace(/"/g, '""');
    if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n") || escaped.includes("\r")) {
      return `"${escaped}"`;
    }
    return escaped;
  };
  
  const rows = results.map(r => [
    escapeCSV(r.title),
    escapeCSV(r.status),
    escapeCSV(r.reason_code),
    escapeCSV(r.reason_message),
    escapeCSV(r.matched_series),
    escapeCSV(r.source_url)
  ].join(","));
  
  return [headers.join(","), ...rows].join("\n");
}
