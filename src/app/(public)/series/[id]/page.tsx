import { getCachedUser } from "@/lib/supabase/cached-user"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Star, 
  Users, 
  Calendar, 
  Globe, 
  Share2, 
  MoreHorizontal, 
  User, 
  ExternalLink,
  Loader2
} from "lucide-react"
import { notFound } from "next/navigation"
import { selectBestCover } from "@/lib/cover-utils"
import { SeriesDetailCover } from "../../../../components/series/SeriesDetailCover"
import { SeriesActions } from "../../../../components/series/SeriesActions"
import { MetadataRecoveryBanner } from "../../../../components/series/MetadataRecoveryBanner"
import { EnhancedChapterList } from "../../../../components/series/EnhancedChapterList"
import { SeriesStatsTab } from "../../../../components/series/SeriesStatsTab"
import { SourceCard } from "../../../../components/series/SourceCard"
import { ExternalLinkButton } from "../../../../components/series/ExternalLinkButton"

interface ExternalLink {
  site: string
  url: string
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCachedUser()
  const supabase = await createClient()

  const { data: series, error: seriesError } = await supabase
    .from('series')
    .select(`
      *,
      series_sources(*)
    `)
    .eq('id', id)
    .single()

    if (seriesError || !series) {
      console.error("Series fetch error:", seriesError)
      notFound()
    }

    let libraryEntry = null
    if (user) {
        const { data } = await supabase
          .from('library_entries')
          .select('*')
          .eq('series_id', id)
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .maybeSingle()
      libraryEntry = data
    }

    let seriesCreators: { role: string; creators: { id: string; name: string } | null }[] = []

  try {
    const { data: creatorsData } = await supabase
      .from('series_creators')
      .select('role, creators(id, name)')
      .eq('series_id', id)
    seriesCreators = (creatorsData as unknown as typeof seriesCreators) || []
  } catch (err) {
    console.error("Failed to fetch creators:", err)
  }

    const { sanitizePrismaObject } = await import('@/lib/utils')

    const serializedSeries = sanitizePrismaObject(series)
    const serializedLibraryEntry = sanitizePrismaObject(libraryEntry)

  const bestCover = selectBestCover(serializedSeries.series_sources || [])
  const coverUrl = bestCover?.cover_url || serializedSeries.cover_url

      let userSettings = null
      let sourcePriorities: string[] = []
      let seriesPreference: string | null = null

      if (user) {
        const [userRes, prioritiesRes, seriesPrefRes] = await Promise.all([
          supabase
            .from('users')
            .select('default_source')
            .eq('id', user.id)
            .single(),
          supabase
            .from('user_source_priorities')
            .select('source_name')
            .eq('user_id', user.id)
            .order('priority', { ascending: true }),
          supabase
            .from('user_series_source_preferences')
            .select('source_name')
            .eq('user_id', user.id)
            .eq('series_id', id)
            .single()
        ])
        userSettings = userRes.data
        sourcePriorities = (prioritiesRes.data || []).map(p => p.source_name)
        seriesPreference = seriesPrefRes.data?.source_name || serializedLibraryEntry?.preferred_source || null
      }

  const { count: chapterCount } = await supabase
    .from('chapters')
    .select('*', { count: 'exact', head: true })
    .eq('series_id', id)

  const authors = seriesCreators
    .filter((sc) => sc.role === 'author' && sc.creators)
    .map((sc) => sc.creators!)
  const artists = seriesCreators
    .filter((sc) => sc.role === 'artist' && sc.creators)
    .map((sc) => sc.creators!)

  const year = serializedSeries.year || serializedSeries.release_year || (serializedSeries.created_at ? new Date(serializedSeries.created_at).getFullYear() : null)
  
  const altTitles = Array.isArray(serializedSeries.alternative_titles) 
    ? serializedSeries.alternative_titles as string[]
    : []

    const externalLinks = (serializedSeries.external_links as ExternalLink[] | null) || []

    const initialChaptersPromise = fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/series/${id}/chapters?page=1&limit=30&grouped=true&sort=chapter_desc`, {
      cache: 'no-store'
    }).then(res => res.json())

    const sourcesForChapterList = (serializedSeries.series_sources || []).map((s: any) => ({

        id: s.id,
        source_name: s.source_name,
        source_url: s.source_url,
        chapter_count: s.source_chapter_count || 0,
        trust_score: Number(s.trust_score),
        source_status: s.source_status,
      }))


  const getSourceColor = (sourceName: string) => {
    const name = sourceName.toLowerCase()
    if (name.includes("mangadex")) return "bg-orange-500"
    if (name.includes("mangapark")) return "bg-green-500"
    if (name.includes("mangasee")) return "bg-blue-500"
    return "bg-zinc-500"
  }

  const getSourceIcon = (sourceName: string) => {
    const name = sourceName.toLowerCase()
    if (name.includes("mangadex")) return "MD"
    if (name.includes("mangapark")) return "MP"
    if (name.includes("mangasee")) return "MS"
    return sourceName.slice(0, 2).toUpperCase()
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-950">
      <div className="relative h-[250px] md:h-[350px] w-full">
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-transparent dark:from-zinc-950 dark:via-zinc-950/50 z-10" />
        {coverUrl && (
          <SeriesDetailCover
            coverUrl={coverUrl}
            title={serializedSeries.title}
            contentRating={serializedSeries.content_rating}
            variant="background"
          />
        )}
        
        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12 z-20 max-w-7xl mx-auto w-full flex flex-col md:flex-row items-end gap-8">
          <div className="hidden md:block w-[200px] shrink-0 aspect-[3/4] rounded-2xl overflow-hidden border-4 border-white dark:border-zinc-950 shadow-2xl shadow-zinc-500/20">
            <SeriesDetailCover
              coverUrl={coverUrl}
              title={serializedSeries.title}
              contentRating={serializedSeries.content_rating}
              variant="main"
            />
          </div>
          <div className="flex-1 space-y-4 pb-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 capitalize">{serializedSeries.type}</Badge>
              <Badge variant="secondary" className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 capitalize">{serializedSeries.status}</Badge>
              {serializedSeries.demographic && (
                <Badge variant="secondary" className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 capitalize">{serializedSeries.demographic}</Badge>
              )}
              {chapterCount && chapterCount > 0 && (
                <Badge variant="secondary" className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                  {chapterCount} Chapters
                </Badge>
              )}
                {serializedSeries.content_rating && serializedSeries.content_rating !== 'safe' && (
                  <Badge variant="secondary" className="bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-400 capitalize">
                    {serializedSeries.content_rating}
                  </Badge>
                )}
                  {serializedLibraryEntry?.metadata_status === 'failed' && (
                    <Badge variant="outline" className="bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700">
                      Metadata unavailable
                    </Badge>
                  )}
                  {serializedLibraryEntry?.metadata_status === 'pending' && (
                    <Badge variant="outline" className="bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700">
                      <Loader2 className="size-3 mr-2 animate-spin" />
                      Enriching...
                    </Badge>
                  )}
              </div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 leading-tight">
              {serializedSeries.title}
            </h1>
            {altTitles.length > 0 && (
              <p className="text-sm text-zinc-500 truncate max-w-xl">
                {altTitles[0]}
              </p>
            )}
            <div className="flex items-center gap-6 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1.5"><Star className="size-4 text-yellow-500 fill-yellow-500" /> {serializedSeries.average_rating || "N/A"}</span>
              <span className="flex items-center gap-1.5"><Users className="size-4" /> {serializedSeries.total_follows ? `${(serializedSeries.total_follows / 1000).toFixed(1)}K` : "0"} Followers</span>
              {year && <span className="flex items-center gap-1.5"><Calendar className="size-4" /> {year}</span>}
              {serializedSeries.original_language && (
                <span className="flex items-center gap-1.5">
                  <Globe className="size-4" /> 
                  {serializedSeries.original_language.toUpperCase()}
                </span>
              )}
            </div>
          </div>
                <div className="flex items-center gap-3 pb-4">
                  <SeriesActions 
                    seriesId={serializedSeries.id} 
                    seriesTitle={serializedSeries.title}
                    libraryEntry={serializedLibraryEntry} 
                    sources={sourcesForChapterList}
                    seriesPreference={seriesPreference}
                  />

              <Button variant="outline" size="icon" className="rounded-full border-zinc-200 dark:border-zinc-800">
              <Share2 className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="rounded-full border-zinc-200 dark:border-zinc-800">
              <MoreHorizontal className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-12 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-12">
            {serializedLibraryEntry && (
              <MetadataRecoveryBanner
                libraryEntryId={serializedLibraryEntry.id}
                metadataStatus={serializedLibraryEntry.metadata_status}
                needsReview={serializedLibraryEntry.needs_review}
                seriesTitle={serializedSeries.title}
                sourceUrl={serializedLibraryEntry.source_url}
              />
            )}
            <Tabs defaultValue="chapters" className="w-full">
              <TabsList className="bg-transparent border-b border-zinc-100 dark:border-zinc-900 w-full justify-start rounded-none h-auto p-0 gap-8">
                <TabsTrigger value="chapters" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold text-lg">Chapters</TabsTrigger>
                <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold text-lg">Overview</TabsTrigger>
                <TabsTrigger value="statistics" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold text-lg">Statistics</TabsTrigger>
              </TabsList>
              
              <TabsContent value="chapters" className="pt-8 space-y-6">
                  <EnhancedChapterList 
                    seriesId={serializedSeries.id}
                    seriesTitle={serializedSeries.title}
                    libraryEntry={serializedLibraryEntry ? {
                      id: serializedLibraryEntry.id,
                      last_read_chapter: serializedLibraryEntry.last_read_chapter ? Number(serializedLibraryEntry.last_read_chapter) : null,
                      preferred_source: seriesPreference || serializedLibraryEntry.preferred_source,
                    } : null}
                      sources={sourcesForChapterList}
                      userDefaultSource={userSettings?.default_source}
                      sourcePriorities={sourcePriorities}
                      seriesPreference={seriesPreference}
                      isAuthenticated={!!user}
                    />
                </TabsContent>

              <TabsContent value="overview" className="pt-8 space-y-8">
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Synopsis</h3>
                  <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-2xl whitespace-pre-line">
                    {serializedSeries.description || "No description available."}
                  </p>
                </div>


              {(authors.length > 0 || artists.length > 0) && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Creators</h3>
                  <div className="flex flex-wrap gap-4">
                    {authors.map((author: { id: string; name: string }) => (
                      <div key={author.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900">
                        <User className="size-4 text-zinc-500" />
                        <div>
                          <p className="text-sm font-medium">{author.name}</p>
                          <p className="text-xs text-zinc-500">Author</p>
                        </div>
                      </div>
                    ))}
                    {artists.filter((a: { id: string }) => !authors.find((au: { id: string }) => au.id === a.id)).map((artist: { id: string; name: string }) => (
                      <div key={artist.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900">
                        <User className="size-4 text-zinc-500" />
                        <div>
                          <p className="text-sm font-medium">{artist.name}</p>
                          <p className="text-xs text-zinc-500">Artist</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {series.genres && series.genres.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Genres</h3>
                  <div className="flex flex-wrap gap-2">
                    {series.genres.map((genre: string) => (
                      <Badge key={genre} variant="outline" className="border-zinc-200 dark:border-zinc-800 capitalize">{genre}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {series.themes && series.themes.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Themes</h3>
                  <div className="flex flex-wrap gap-2">
                    {series.themes.map((theme: string) => (
                      <Badge key={theme} variant="secondary" className="bg-zinc-100 dark:bg-zinc-800 capitalize">{theme}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {series.tags && series.tags.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {series.tags.map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="bg-zinc-100 dark:bg-zinc-800">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {altTitles.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">Alternative Titles</h3>
                  <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {altTitles.slice(0, 5).map((title, i) => (
                      <li key={i}>{title}</li>
                    ))}
                    {altTitles.length > 5 && (
                      <li className="text-zinc-500">+{altTitles.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}

              {externalLinks.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">External Links</h3>
                  <div className="flex flex-wrap gap-2">
                      {externalLinks.map((link, i) => (
                        <ExternalLinkButton
                          key={i}
                          url={link.url}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors text-sm"
                        >
                          <ExternalLink className="size-3.5" />
                          {link.site}
                        </ExternalLinkButton>
                      ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="statistics">
              <SeriesStatsTab seriesId={series.id} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-8">
          {series.series_sources && series.series_sources.length > 0 && (
            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
              <h3 className="font-bold">Available Sources</h3>
              <div className="space-y-3">
                    {series.series_sources.map((source: {
                      id: string
                      source_name: string
                      source_url: string
                      source_chapter_count: number | null
                      trust_score: number
                      last_success_at: string | null
                      source_status: string
                    }) => (
                      <div key={source.id} className="space-y-2">
                        <SourceCard 
                          sourceUrl={source.source_url}
                          className={`flex items-center justify-between p-3 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${source.source_status === 'inactive' ? 'opacity-70' : ''}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`size-9 rounded-lg ${getSourceColor(source.source_name)} text-white text-xs font-bold flex items-center justify-center`}>
                              {getSourceIcon(source.source_name)}
                            </div>
                            <div>
                              <p className="text-sm font-bold capitalize">{source.source_name}</p>
                              {source.source_status === 'inactive' ? (
                                <p className="text-[10px] text-zinc-400 font-medium">Currently Unsupported</p>
                              ) : source.source_chapter_count ? (
                                <p className="text-xs text-zinc-500">{source.source_chapter_count} chapters</p>
                              ) : null}
                            </div>
                          </div>
                            <div className="flex items-center gap-2">
                              <div className={`flex items-center gap-1.5 text-[10px] font-bold ${source.source_status === 'inactive' || source.source_status === 'broken' ? 'text-zinc-400' : 'text-green-500'}`}>
                                <div className={`size-1.5 rounded-full ${source.source_status === 'inactive' ? 'bg-zinc-400' : source.source_status === 'broken' ? 'bg-red-500' : 'bg-green-500'}`} />
                                {source.source_status === 'inactive' ? 'N/A' : source.source_status === 'broken' ? 'Broken' : `${Math.round(Number(source.trust_score) * 10)}%`}
                              </div>
                              <ExternalLink className="size-3.5 text-zinc-400" />
                            </div>
                          </SourceCard>
                          {source.source_status === 'inactive' && (
                            <p className="text-[10px] text-zinc-500 px-3 flex items-center gap-1.5">
                              <span className="size-1 rounded-full bg-zinc-400" />
                              This source is not supported yet. Chapter sync is disabled.
                            </p>
                          )}
                          {source.source_status === 'broken' && (
                            <p className="text-[10px] text-red-500 px-3 flex items-center gap-1.5 font-medium">
                              <span className="size-1 rounded-full bg-red-500" />
                              This source is currently experiencing technical issues.
                            </p>
                          )}

                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
            <h3 className="font-bold">Information</h3>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Type</span>
                <span className="font-bold capitalize">{series.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Status</span>
                <span className="font-bold capitalize">{series.status}</span>
              </div>
              {series.demographic && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Demographic</span>
                  <span className="font-bold capitalize">{series.demographic}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-500">Chapters</span>
                <span className="font-bold">{chapterCount || 0}</span>
              </div>
              {year && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Year</span>
                  <span className="font-bold">{year}</span>
                </div>
              )}
              {series.original_language && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Original Language</span>
                  <span className="font-bold uppercase">{series.original_language}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-500">Views</span>
                <span className="font-bold">{series.total_views?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Content Rating</span>
                <span className="font-bold capitalize">{series.content_rating || "Safe"}</span>
              </div>
            </div>
          </div>

          {series.translated_languages && series.translated_languages.length > 0 && (
            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-4">
              <h3 className="font-bold">Available Languages</h3>
              <div className="flex flex-wrap gap-2">
                {series.translated_languages.map((lang: string) => (
                  <Badge key={lang} variant="secondary" className="uppercase text-xs">
                    {lang}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
