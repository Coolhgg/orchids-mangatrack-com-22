import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { handleApiError, ApiError, ErrorCodes } from "@/lib/api-utils"
import { createClient } from "@/lib/supabase/server"
import { PRODUCTION_QUERIES } from "@/lib/sql/production-queries"
import { generateImportResultsCSV } from "@/lib/sync/csv-parser"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const format = searchParams.get("format"); // 'csv' for downloadable file

    if (!jobId) {
      throw new ApiError("Job ID is required", 400, ErrorCodes.INVALID_INPUT);
    }

    const job = await prisma.importJob.findUnique({
      where: { id: jobId, user_id: user.id }
    });

    if (!job) {
      throw new ApiError("Import job not found", 404, ErrorCodes.NOT_FOUND);
    }

    const items = await prisma.importItem.findMany({
      where: { job_id: jobId },
      include: {
        series: {
          select: {
            id: true,
            title: true,
            cover_url: true,
            status: true,
            type: true
          }
        }
      },
      orderBy: { title: 'asc' }
    });

    // If CSV format requested, return downloadable file
    if (format === 'csv') {
      const csvData = items.map(item => ({
        title: item.title,
        status: item.status as "SUCCESS" | "FAILED" | "PENDING",
        reason_code: item.reason_code || undefined,
        reason_message: item.reason_message || undefined,
        matched_series: item.series?.title || undefined,
        source_url: (item.metadata as any)?.source_url || undefined
      }));

      const csvContent = generateImportResultsCSV(csvData);
      const filename = `import-results-${jobId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // Default JSON response
    let summary: any[] = [];
    try {
      summary = await prisma.$queryRawUnsafe<any[]>(
        PRODUCTION_QUERIES.IMPORT_JOB_SUMMARY,
        jobId
      );
    } catch (summaryError) {
      console.warn('[Import Results] Summary query failed:', summaryError);
      // Fallback: calculate summary manually
      const successCount = items.filter(i => i.status === 'SUCCESS').length;
      const failedCount = items.filter(i => i.status === 'FAILED').length;
      const pendingCount = items.filter(i => i.status === 'PENDING').length;
      summary = [
        { status: 'SUCCESS', item_count: successCount },
        { status: 'FAILED', item_count: failedCount },
        { status: 'PENDING', item_count: pendingCount }
      ];
    }

    return NextResponse.json({
      job,
      items,
      summary: summary.map(row => ({
        status: row.status,
        reason_code: row.reason_code,
        count: Number(row.item_count)
      }))
    });
  } catch (error) {
    return handleApiError(error);
  }
}
