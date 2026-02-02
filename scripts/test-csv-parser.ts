import { parseCSV } from '../src/lib/sync/csv-parser';

const testCSV = `Title,Status,Progress,Series URL
"Gaikotsu Kishi-sama | Tadaima 
Isekai e Odekake-chuu",Reading,21,https://mangadex.org/title/ab245d56-02e0-4965-9856-11f626c117b9/gaikotsu-kishi-sama-tadaima-isekai-e-odekake-chuu
"Ordinary Happy Family",Completed,50,https://comick.io/comic/ordinary-happy-family
"Manga With, Comma",Planning,0,https://mangadex.org/title/123
`;

const entries = parseCSV(testCSV);
console.log(JSON.stringify(entries, null, 2));

if (entries.length === 3 && entries[0].title.includes('\n')) {
  console.log("SUCCESS: Multi-line title parsed correctly.");
} else {
  console.error("FAILURE: Parsing issues detected.");
  console.log("Actual length:", entries.length);
}
