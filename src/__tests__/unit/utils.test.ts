import { sanitizePrismaObject } from '@/lib/utils';

describe('sanitizePrismaObject', () => {
  it('should convert Prisma Decimal to number', () => {
    const mockDecimal = {
      toNumber: () => 10.5,
      toString: () => '10.5'
    };
    
    const input = {
      id: '1',
      rating: mockDecimal,
      nested: {
        value: mockDecimal
      },
      list: [mockDecimal, 20]
    };
    
    const expected = {
      id: '1',
      rating: 10.5,
      nested: {
        value: 10.5
      },
      list: [10.5, 20]
    };
    
    expect(sanitizePrismaObject(input)).toEqual(expected);
  });

  it('should preserve Date objects', () => {
    const date = new Date();
    const input = { date };
    expect(sanitizePrismaObject(input).date).toBeInstanceOf(Date);
    expect(sanitizePrismaObject(input).date.getTime()).toBe(date.getTime());
  });

  it('should handle null and undefined', () => {
    expect(sanitizePrismaObject(null)).toBe(null);
    expect(sanitizePrismaObject(undefined)).toBe(undefined);
  });

  it('should handle primitives', () => {
    expect(sanitizePrismaObject(123)).toBe(123);
    expect(sanitizePrismaObject('string')).toBe('string');
    expect(sanitizePrismaObject(true)).toBe(true);
  });
});
