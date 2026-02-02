
import { parseCSV } from '@/lib/sync/csv-parser';

const testCSV = `Title,Status,Progress,URL
"One Piece","Reading",1080,"https://mangadex.org/title/a1c7c10b-6323-42e1-8884-6351050e95c1"
"Solo Leveling","Completed",179,"https://asuracomics.com/manga/solo-leveling/"
"Multi-line
Title","Reading",10,"https://comick.io/comic/one-piece"
"Escaped ""Quotes"" Series","Reading",5,"https://mangafire.to/manga/one-piece.xrp"
"Reaper Scan","Reading",1,"https://reaperscans.com/series/test-manga"
`;

const results = parseCSV(testCSV);
console.log(JSON.stringify(results, null, 2));
