import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Merges attributes from the MangaDex 'included' array into their corresponding relationships.
 * MangaDex returns relationship objects in the main data as { id, type }, and their 
 * full objects in a separate 'included' array.
 */
export function mergeRelationships(data: any[], included: any[]) {
  if (!included || included.length === 0) return data;

  const includedMap = new Map(included.map(item => [`${item.type}:${item.id}`, item]));

  return data.map(item => {
    if (!item.relationships) return item;

    const mergedRelationships = item.relationships.map((rel: any) => {
      const includedItem = includedMap.get(`${rel.type}:${rel.id}`);
      if (includedItem) {
        return { ...rel, attributes: includedItem.attributes };
      }
      return rel;
    });

    return { ...item, relationships: mergedRelationships };
  });
}

/**
 * Merges attributes from the MangaDex 'included' array into a single item's relationships.
 * Used for single manga lookups.
 */
export function mergeRelationshipsSingle(item: any, included: any[]) {
  if (!included || included.length === 0 || !item.relationships) return item;

  const includedMap = new Map(included.map(inc => [`${inc.type}:${inc.id}`, inc]));

  const mergedRelationships = item.relationships.map((rel: any) => {
    const includedItem = includedMap.get(`${rel.type}:${rel.id}`);
    if (includedItem) {
      return { ...rel, attributes: includedItem.attributes };
    }
    return rel;
  });

  return { ...item, relationships: mergedRelationships };
}

/**
 * Sanitizes Prisma objects for Next.js serialization by converting 
 * Decimal values to standard JavaScript numbers.
 */
export function sanitizePrismaObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizePrismaObject) as any;
  }

  if (typeof obj === 'object') {
    // Check if it's a Prisma Decimal object (has toNumber method)
    if ('toNumber' in obj && typeof (obj as any).toNumber === 'function') {
      return (obj as any).toNumber();
    }

    // Handle Date objects (keep them as is, they are serializable)
    if (obj instanceof Date) {
      return obj as any;
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizePrismaObject(value);
    }
    return sanitized;
  }

  return obj;
}
