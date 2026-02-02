import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Fix protected series with real MangaDex data
 */
async function fixProtectedSeries() {
  console.log('=== FIXING PROTECTED SERIES ===\n');
  
  const fixes = [
    {
      seriesId: '73323c46-6710-4971-9c3f-ca8e7305bf9f',
      title: 'Tower of God',
      mangadexId: '57e1d491-1dc9-4854-83bf-7a9379566fb2',
    },
    {
      seriesId: 'b041ec66-6d39-4ba1-ac68-5a873f51abaf', 
      title: 'One Piece',
      mangadexId: 'a1c7c817-4e59-43b7-9365-09675a149a6f',
    },
  ];
  
  for (const fix of fixes) {
    console.log(`\nFixing ${fix.title}...`);
    
    // Update series.mangadex_id
    const { error: updateErr } = await supabase
      .from('series')
      .update({ mangadex_id: fix.mangadexId })
      .eq('id', fix.seriesId);
    
    if (updateErr) {
      console.error(`  Error updating series: ${updateErr.message}`);
      continue;
    }
    console.log(`  Updated mangadex_id to ${fix.mangadexId}`);
    
    // Check if valid source exists
    const { data: existingSource } = await supabase
      .from('series_sources')
      .select('id')
      .eq('series_id', fix.seriesId)
      .eq('source_name', 'mangadex')
      .eq('source_id', fix.mangadexId)
      .single();
    
    if (!existingSource) {
      // Create series_source
      const { error: srcErr } = await supabase
        .from('series_sources')
        .insert({
          series_id: fix.seriesId,
          source_name: 'mangadex',
          source_id: fix.mangadexId,
          source_url: `https://mangadex.org/title/${fix.mangadexId}`,
          trust_score: 9.0,
        });
      
      if (srcErr) {
        console.error(`  Error creating source: ${srcErr.message}`);
      } else {
        console.log(`  Created MangaDex source`);
      }
    } else {
      console.log(`  Valid source already exists`);
    }
    
    // Fetch cover from MangaDex API
    try {
      const res = await fetch(`https://api.mangadex.org/manga/${fix.mangadexId}?includes[]=cover_art`);
      const data = await res.json();
      
        const coverRel = data.data?.relationships?.find((r: any) => r.type === 'cover_art');
        if (coverRel?.attributes?.fileName) {
          const coverUrl = `https://uploads.mangadex.org/covers/${fix.mangadexId}/${coverRel.attributes.fileName}`;
          
          // Use variants if needed by adding .256.jpg, .512.jpg, or .1024.jpg

        await supabase
          .from('series')
          .update({ cover_url: coverUrl })
          .eq('id', fix.seriesId);
        
        // Update source cover
        await supabase
          .from('series_sources')
          .update({ 
            cover_url: coverUrl,
            cover_updated_at: new Date().toISOString(),
          })
          .eq('series_id', fix.seriesId)
          .eq('source_name', 'mangadex');
        
        console.log(`  Updated cover: ${coverUrl.substring(0, 60)}...`);
      }
    } catch (e: any) {
      console.error(`  Error fetching cover: ${e.message}`);
    }
  }
  
  console.log('\n=== FIX COMPLETE ===');
}

fixProtectedSeries();
