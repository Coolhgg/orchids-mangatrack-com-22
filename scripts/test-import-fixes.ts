import { parseCSV } from "../src/lib/sync/csv-parser";
import { calculateSimilarity, extractPlatformIds } from "../src/lib/sync/shared";

async function runTests() {
  console.log("--- TEST 1: CSV PARSING ---");
  const testCSV = `Title,Status,Progress,Series URL
"Gaikotsu Kishi-sama | Tadaima 
Isekai e Odekake-chuu",Reading,21,https://mangadex.org/title/ab245d56-02e0-4965-9856-11f626c117b9/gaikotsu-kishi-sama-tadaima-isekai-e-odekake-chuu
"Ordinary Happy Family",Completed,50,https://comick.io/comic/ordinary-happy-family
"Manga With, Comma",Planning,0,https://mangadex.org/title/123
`;

  const entries = parseCSV(testCSV);
  console.log("Parsed entries:", entries.length);
  
  if (entries.length === 3) {
    console.log("✅ SUCCESS: Correct number of entries.");
    if (entries[0].title.includes('\n') || entries[0].title.includes('\r')) {
       console.log("✅ SUCCESS: Multi-line title preserved.");
    }
  } else {
    console.error("❌ FAILURE: Expected 3 entries, got", entries.length);
  }

  console.log("\n--- TEST 2: SEQUEL PROTECTION ---");
  const cases = [
    { s1: "Solo Leveling", s2: "Solo Leveling", expectedHigh: true },
    { s1: "Solo Leveling", s2: "Solo Leveling 2", expectedLow: true },
    { s1: "Mushoku Tensei", s2: "Mushoku Tensei Season 2", expectedLow: true },
    { s1: "Kingdom", s2: "Kingdom Part II", expectedLow: true },
    { s1: "The One", s2: "One", expectedHigh: true } // Normalization check
  ];

  for (const c of cases) {
    const score = calculateSimilarity(c.s1, c.s2);
    console.log(`'${c.s1}' vs '${c.s2}' -> Score: ${score.toFixed(2)}`);
    if (c.expectedLow && score > 0.5) console.error("❌ FAILURE: Score too high for sequel!");
    if (c.expectedHigh && score < 0.8) console.error("❌ FAILURE: Score too low for identical!");
  }

  console.log("\n--- TEST 3: URL EXTRACTION ---");
  const urls = [
    { url: "https://mangadex.org/title/ab245d56-02e0-4965-9856-11f626c117b9/gaikotsu", p: "mangadex", id: "ab245d56-02e0-4965-9856-11f626c117b9" },
    { url: "https://comick.io/comic/solo-leveling", p: "comick", id: "solo-leveling" },
    { url: "https://manga4life.com/manga/Kingdom", p: "mangasee", id: "Kingdom" }
  ];

  for (const u of urls) {
    const res = extractPlatformIds(u.url);
    if (res && res.platform === u.p && res.id === u.id) {
      console.log(`✅ SUCCESS: ${u.p} extraction correct.`);
    } else {
      console.error(`❌ FAILURE: ${u.p} extraction failed. Got:`, res);
    }
  }
}

runTests().catch(console.error);
