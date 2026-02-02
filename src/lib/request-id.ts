import { NextRequest, NextResponse } from 'next/server';

export const REQUEST_ID_HEADER = 'X-Request-ID';

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0].toUpperCase();
  }
  return (Math.random().toString(36).substring(2, 10) + Date.now().toString(36)).toUpperCase();
}

export function getRequestId(request: NextRequest | Request): string {
  const existingId = request.headers.get(REQUEST_ID_HEADER);
  if (existingId) return existingId;
  return generateRequestId();
}

export function addRequestIdHeader(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function withRequestId<T extends NextResponse>(
  request: NextRequest | Request,
  response: T
): T {
  const requestId = getRequestId(request);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string | null;
  path: string;
  method: string;
  timestamp: Date;
}

export function createRequestContext(request: NextRequest | Request): RequestContext {
  const url = new URL(request.url);
  return {
    requestId: getRequestId(request as NextRequest),
    ip: request.headers.get('x-real-ip') || 
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
        '127.0.0.1',
    userAgent: request.headers.get('user-agent'),
    path: url.pathname,
    method: request.method,
    timestamp: new Date(),
  };
}
