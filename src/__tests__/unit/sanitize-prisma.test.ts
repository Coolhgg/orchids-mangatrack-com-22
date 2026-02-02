import { sanitizePrismaObject } from '@/lib/utils';
import { Decimal } from '@prisma/client/runtime/library';

describe('sanitizePrismaObject', () => {
  it('converts Prisma Decimal to number', () => {
    const obj = {
      id: '123',
      chapter_number: new Decimal(10.5),
      nested: {
        val: new Decimal(100.0)
      }
    };

    const sanitized = sanitizePrismaObject(obj);
    expect(typeof sanitized.chapter_number).toBe('number');
    expect(sanitized.chapter_number).toBe(10.5);
    expect(sanitized.nested.val).toBe(100);
  });

  it('handles arrays of objects', () => {
    const arr = [
      { num: new Decimal(1) },
      { num: new Decimal(2.5) }
    ];

    const sanitized = sanitizePrismaObject(arr);
    expect(sanitized[0].num).toBe(1);
    expect(sanitized[1].num).toBe(2.5);
  });

  it('preserves Dates and other types', () => {
    const now = new Date();
    const obj = {
      date: now,
      str: 'test',
      bool: true,
      nullVal: null
    };

    const sanitized = sanitizePrismaObject(obj);
    expect(sanitized.date).toBe(now);
    expect(sanitized.str).toBe('test');
    expect(sanitized.bool).toBe(true);
    expect(sanitized.nullVal).toBe(null);
  });
});
