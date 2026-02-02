import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSeed() {
  const seedTitles = ['Solo Leveling', 'One Piece', 'Tower of God', 'Berserk', 'Omniscient Reader'];
  
  // Check for seed series by title
  console.log('=== SEED SERIES CHECK (by title) ===');
  const { data: seedByTitle, error: e1 } = await supabase
    .from('series')
    .select('id, title, cover_url')
    .in('title', seedTitles);
  
  if (e1) console.error('Error:', e1.message);
  console.log('Seed series found by title:', seedByTitle?.length || 0);
  seedByTitle?.forEach(s => console.log(`  - ${s.title} (${s.id}) cover: ${s.cover_url?.substring(0, 50)}...`));
  
  // Check for unsplash covers (placeholder)
  console.log('\n=== PLACEHOLDER COVERS (unsplash) ===');
  const { data: unsplashSeries, error: e1b } = await supabase
    .from('series')
    .select('id, title, cover_url')
    .like('cover_url', '%unsplash.com%');
  
  if (e1b) console.error('Error:', e1b.message);
  console.log('Series with unsplash covers:', unsplashSeries?.length || 0);
  unsplashSeries?.forEach(s => console.log(`  - ${s.title} (${s.id})`));
  
  // Check for fake MangaDex IDs (md-prefix without valid UUID format)
  console.log('\n=== FAKE SOURCE IDS (md- prefix) ===');
  const { data: fakeSources, error: e2 } = await supabase
    .from('series_sources')
    .select('id, series_id, source_id, source_name')
    .like('source_id', 'md-%');
  
  if (e2) console.error('Error:', e2.message);
  console.log('Fake sources found:', fakeSources?.length || 0);
  fakeSources?.forEach(s => console.log(`  - ${s.source_id} (series: ${s.series_id})`));
  
  // Check library_entries - DO NOT DELETE series referenced here
  console.log('\n=== USER LIBRARY REFERENCES ===');
  const { data: libraryRefs, error: e3 } = await supabase
    .from('library_entries')
    .select('series_id, user_id');
  
  if (e3) console.error('Error:', e3.message);
  console.log('Library entries:', libraryRefs?.length || 0);
  
  const protectedSeriesIds = new Set(libraryRefs?.map(l => l.series_id) || []);
  console.log('Protected series IDs (in user libraries):', protectedSeriesIds.size);
  if (protectedSeriesIds.size > 0) {
    console.log('Protected IDs:', Array.from(protectedSeriesIds));
  }
  
  // Total counts
  console.log('\n=== TOTAL COUNTS ===');
  const { count: seriesCount } = await supabase.from('series').select('*', { count: 'exact', head: true });
  const { count: sourcesCount } = await supabase.from('series_sources').select('*', { count: 'exact', head: true });
  const { count: chaptersCount } = await supabase.from('chapters').select('*', { count: 'exact', head: true });
  const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
  
  console.log('Total series:', seriesCount);
  console.log('Total sources:', sourcesCount);
  console.log('Total chapters:', chaptersCount);
  console.log('Total users:', usersCount);
}

checkSeed();
