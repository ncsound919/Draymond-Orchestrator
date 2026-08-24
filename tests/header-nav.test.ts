import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import Header from '../src/components/Header';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/operations',
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; [key: string]: unknown }) => {
    return createElement('a', { href, ...props }, children);
  },
}));

describe('Header navigation', () => {
  it('marks the active page and gives the logout action an explicit button type', () => {
    const html = renderToStaticMarkup(createElement(Header));

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('type="button"');
    expect(html).toContain('/command-center');
    expect(html).toContain('Sign out');
  });
});
