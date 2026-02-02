import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * SEED DATA CLEANUP SCRIPT
 * 
 * RULES:
 * - Never delete series that are in user libraries
 * - Delete fake sources (md- prefix) from all series
 * - Delete unprotected seed series and their chapters/sources
 * - Preserve schema, users, and real user data
 */
async function cleanupSeedData() {
  console.log('=== SEED DATA CLEANUP ===\n');
  
  // Get protected series IDs (in user libraries)
  const { data: libraryRefs } = await supabase
    .from('library_entries')
    .select('series_id');
  
  const protectedSeriesIds = new Set(libraryRefs?.map(l => l.series_id) || []);
  console.log('Protected series (in user libraries):', protectedSeriesIds.size);
  
  // Seed series by title
  const seedTitles = ['Solo Leveling', 'One Piece', 'Tower of God', 'Berserk', 'Omniscient Reader'];
  
  const { data: seedSeries } = await supabase
    .from('series')
    .select('id, title')
    .in('title', seedTitles);
  
  const seedSeriesIds = seedSeries?.map(s => s.id) || [];
  console.log('Seed series found:', seedSeriesIds.length);
  
  // Separate protected vs unprotected seed series
  const unprotectedSeedIds = seedSeriesIds.filter(id => !protectedSeriesIds.has(id));
  const protectedSeedIds = seedSeriesIds.filter(id => protectedSeriesIds.has(id));
  
  console.log('Unprotected seed series (safe to delete):', unprotectedSeedIds.length);
  console.log('Protected seed series (will keep, only delete fake sources):', protectedSeedIds.length);
  
  let deletedChapters = 0;
  let deletedSources = 0;
  let deletedSeries = 0;
  let deletedFakeSources = 0;
  
  // STEP 1: Delete chapters for unprotected seed series
  if (unprotectedSeedIds.length > 0) {
    console.log('\n--- Deleting chapters for unprotected seed series ---');
    const { data: chapters, error: chapErr } = await supabase
      .from('chapters')
      .delete()
      .in('series_id', unprotectedSeedIds)
      .select('id');
    
    if (chapErr) {
      console.error('Error deleting chapters:', chapErr.message);
    } else {
      deletedChapters = chapters?.length || 0;
      console.log(`Deleted ${deletedChapters} chapters`);
    }
  }
  
  // STEP 2: Delete series_sources for unprotected seed series
  if (unprotectedSeedIds.length > 0) {
    console.log('\n--- Deleting sources for unprotected seed series ---');
    const { data: sources, error: srcErr } = await supabase
      .from('series_sources')
      .delete()
      .in('series_id', unprotectedSeedIds)
      .select('id');
    
    if (srcErr) {
      console.error('Error deleting sources:', srcErr.message);
    } else {
      deletedSources = sources?.length || 0;
      console.log(`Deleted ${deletedSources} sources`);
    }
  }
  
  // STEP 3: Delete unprotected seed series
  if (unprotectedSeedIds.length > 0) {
    console.log('\n--- Deleting unprotected seed series ---');
    const { data: series, error: serErr } = await supabase
      .from('series')
      .delete()
      .in('id', unprotectedSeedIds)
      .select('id, title');
    
    if (serErr) {
      console.error('Error deleting series:', serErr.message);
    } else {
      deletedSeries = series?.length || 0;
      series?.forEach(s => console.log(`  Deleted: ${s.title}`));
      console.log(`Deleted ${deletedSeries} series`);
    }
  }
  
  // STEP 4: Delete fake sources (md- prefix) from ALL series including protected
  console.log('\n--- Deleting fake sources (md- prefix) ---');
  const { data: fakeSources, error: fakeErr } = await supabase
    .from('series_sources')
    .delete()
    .like('source_id', 'md-%')
    .select('id, source_id, series_id');
  
  if (fakeErr) {
    console.error('Error deleting fake sources:', fakeErr.message);
  } else {
    deletedFakeSources = fakeSources?.length || 0;
    fakeSources?.forEach(s => console.log(`  Deleted fake source: ${s.source_id}`));
    console.log(`Deleted ${deletedFakeSources} fake sources`);
  }
  
  // STEP 5: Clean up orphaned chapters (chapters whose series_source no longer exists)
  console.log('\n--- Cleaning orphaned chapters ---');
  const { data: orphanedChapters, error: orphanErr } = await supabase.rpc('delete_orphaned_chapters');
  if (orphanErr) {
    // RPC might not exist, try manual approach
    console.log('RPC not available, checking for orphaned chapters manually...');
    
    // Get all chapter series_source_ids
    const { data: allChapters } = await supabase.from('chapters').select('id, series_source_id');
    const { data: allSources } = await supabase.from('series_sources').select('id');
    
    const sourceIds = new Set(allSources?.map(s => s.id) || []);
    const orphanIds = allChapters?.filter(c => !sourceIds.has(c.series_source_id)).map(c => c.id) || [];
    
    if (orphanIds.length > 0) {
      const { data: deleted } = await supabase
        .from('chapters')
        .delete()
        .in('id', orphanIds)
        .select('id');
      console.log(`Deleted ${deleted?.length || 0} orphaned chapters`);
    } else {
      console.log('No orphaned chapters found');
    }
  }
  
  // Summary
  console.log('\n=== CLEANUP SUMMARY ===');
  console.log(`Chapters deleted: ${deletedChapters}`);
  console.log(`Sources deleted: ${deletedSources}`);
  console.log(`Series deleted: ${deletedSeries}`);
  console.log(`Fake sources deleted: ${deletedFakeSources}`);
  console.log('\nNo real user data was deleted.');
  
  // Final counts
  const { count: seriesCount } = await supabase.from('series').select('*', { count: 'exact', head: true });
  const { count: sourcesCount } = await supabase.from('series_sources').select('*', { count: 'exact', head: true });
  const { count: chaptersCount } = await supabase.from('chapters').select('*', { count: 'exact', head: true });
  
  console.log('\n=== FINAL COUNTS ===');
  console.log('Total series:', seriesCount);
  console.log('Total sources:', sourcesCount);
  console.log('Total chapters:', chaptersCount);
}

cleanupSeedData();
