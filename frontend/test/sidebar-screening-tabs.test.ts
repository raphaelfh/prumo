import {describe, expect, it} from 'vitest';

import {sidebarItems} from '@/components/layout/sidebarConfig';

describe('Sidebar config — Screening tab', () => {
  it('is not a coming-soon placeholder (the area is implemented)', () => {
    const item = sidebarItems.find((i) => i.id === 'screening');
    expect(item).toBeDefined();
    expect(item?.comingSoon).not.toBe(true);
  });

  it('PRISMA report is not a coming-soon placeholder', () => {
    const item = sidebarItems.find((i) => i.id === 'prisma');
    expect(item).toBeDefined();
    expect(item?.comingSoon).not.toBe(true);
  });
});
