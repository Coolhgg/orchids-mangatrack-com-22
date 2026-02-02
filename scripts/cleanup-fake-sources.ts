import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Additional cleanup for fake source IDs with other prefixes
 * Patterns: ma-*, mp-* (clearly fake, not real external IDs)
 */
async function cleanupFakeSources() {
  console.log('=== ADDITIONAL FAKE SOURCE CLEANUP ===\n');
  
  // Find fake sources with ma- prefix
  console.log('--- Finding ma- prefix sources ---');
  const { data: maSources } = await supabase
    .from('series_sources')
    .select('id, series_id, source_id, source_name')
    .like('source_id', 'ma-%');
  
  console.log(`Found ${maSources?.length || 0} ma- sources`);
  
  // Find fake sources with mp- prefix
  console.log('--- Finding mp- prefix sources ---');
  const { data: mpSources } = await supabase
    .from('series_sources')
    .select('id, series_id, source_id, source_name')
    .like('source_id', 'mp-%');
  
  console.log(`Found ${mpSources?.length || 0} mp- sources`);
  
  const allFake = [...(maSources || []), ...(mpSources || [])];
  
  if (allFake.length > 0) {
    // Delete chapters first (FK constraint)
    const fakeSourceIds = allFake.map(s => s.id);
    
    console.log('\n--- Deleting chapters for fake sources ---');
    const { data: deletedChapters, error: chapErr } = await supabase
      .from('chapters')
      .delete()
      .in('series_source_id', fakeSourceIds)
      .select('id');
    
    if (chapErr) {
      console.error('Error:', chapErr.message);
    } else {
      console.log(`Deleted ${deletedChapters?.length || 0} chapters`);
    }
    
    // Delete fake sources
    console.log('\n--- Deleting fake sources ---');
    const { data: deletedSources, error: srcErr } = await supabase
      .from('series_sources')
      .delete()
      .in('id', fakeSourceIds)
      .select('id, source_id');
    
    if (srcErr) {
      console.error('Error:', srcErr.message);
    } else {
      console.log(`Deleted ${deletedSources?.length || 0} fake sources:`);
      deletedSources?.forEach(s => console.log(`  - ${s.source_id}`));
    }
  }
  
  // Final count
  const { count: sourcesCount } = await supabase.from('series_sources').select('*', { count: 'exact', head: true });
  const { count: chaptersCount } = await supabase.from('chapters').select('*', { count: 'exact', head: true });
  
  console.log('\n=== FINAL COUNTS ===');
  console.log('Total sources:', sourcesCount);
  console.log('Total chapters:', chaptersCount);
}

cleanupFakeSources();
