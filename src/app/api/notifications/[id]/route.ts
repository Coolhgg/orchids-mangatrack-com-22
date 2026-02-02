import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { 
  checkRateLimit, 
  handleApiError, 
  validateUUID, 
  ApiError, 
  ErrorCodes, 
  validateOrigin, 
  getClientIp 
} from "@/lib/api-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`notification-get:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { id } = await params;
    validateUUID(id, "notification ID");

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        user_id: user.id,
      },
      include: {
        series: {
          select: {
            id: true,
            title: true,
            cover_url: true,
          },
        },
      },
    });

    if (!notification) {
      throw new ApiError("Notification not found", 404, ErrorCodes.NOT_FOUND);
    }

    return NextResponse.json({ notification });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    validateOrigin(request);

    const ip = getClientIp(request);
    if (!await checkRateLimit(`notification-delete:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { id } = await params;
    validateUUID(id, "notification ID");

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        user_id: user.id,
      },
    });

    if (!notification) {
      throw new ApiError("Notification not found", 404, ErrorCodes.NOT_FOUND);
    }

    await prisma.notification.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    return handleApiError(error);
  }
}
