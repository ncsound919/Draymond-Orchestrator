/**
 * MathRenderer — assistant markdown + KaTeX math, sanitized with DOMPurify.
 * Ported from @mathx/web. KaTeX CSS is imported once in src/app/layout.tsx.
 */
'use client';

import { useMemo } from 'react';
import katex from 'katex';

// ---------------------------------------------------------------------------
// DOMPurify — lazy-load to survive SSR/test environments
// ---------------------------------------------------------------------------

let purify: { sanitize: (html: string, cfg?: object) => string } | null = null;

function getSanitizer() {
  if (purify) return purify;
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DOMPurify = require('dompurify');
    purify = typeof DOMPurify.sanitize === 'function' ? DOMPurify : DOMPurify.default;
  }
  if (!purify) {
    purify = { sanitize: (html: string) => html.replace(/<[^>]+>/g, '') };
  }
  return purify;
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'code', 'pre', 'span', 'div',
    'sup', 'sub',
    'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub',
    'mfrac', 'mover', 'munder', 'mtext', 'annotation', 'mspace',
    'mtable', 'mtr', 'mtd', 'mstyle',
    'svg', 'path', 'line', 'rect', 'circle', 'g', 'use', 'defs',
    'clippath', 'mask',
  ],
  ALLOWED_ATTR: [
    'style', 'class', 'title',
    'viewbox', 'xmlns', 'fill', 'stroke', 'stroke-width',
    'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r',
    'width', 'height', 'transform', 'clip-path', 'mask',
  ],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'a'],
  FORBID_ATTR: ['href', 'src', 'action', 'onerror', 'onload', 'onclick', 'onmouseover'],
  ALLOW_DATA_ATTR: false,
  FORCE_BODY: true,
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderKaTeX(src: string): string {
  src = src.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_m, a?: string, b?: string) => {
    try {
      return katex.renderToString((a || b || '').trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<code>${escapeHtml(a || b || '')}</code>`;
    }
  });
  src = src.replace(/\$([^\$\n]+?)\$|\\\((.+?)\\\)/g, (_m, a?: string, b?: string) => {
    try {
      return katex.renderToString((a || b || '').trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code>${escapeHtml(a || b || '')}</code>`;
    }
  });
  return src;
}

function applyMarkdown(src: string, accent: string): string {
  return src
    .replace(/\*\*##\s*(.+?)\*\*/g,
      `<div style="color:${accent};font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:14px 0 5px;font-family:var(--font-mono)">$1</div>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong style='color:#e8e0cc'>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em style='color:#c8b896'>$1</em>")
    .replace(/`([^`\n]+)`/g, (_m, code: string) =>
      `<code style="background:var(--bg4);padding:2px 6px;border-radius:3px;font-family:var(--font-mono);font-size:0.8em;color:var(--gold);border:1px solid var(--border-bright)">${escapeHtml(code)}</code>`)
    .replace(/^(\d+)\.\s/gm, `<span style="color:${accent};font-weight:700">$1.</span> `)
    .replace(/^-\s/gm, `<span style="color:${accent};opacity:0.6">◦</span> `)
    .replace(/🔗 Cross-Domain Bridge/g,
      `<span style="color:var(--teal);font-weight:700">🔗 Cross-Domain Bridge</span>`)
    .replace(/⚡ Hidden Insight/g,
      `<span style="color:var(--gold);font-weight:700">⚡ Hidden Insight</span>`)
    .replace(/\*\*Conjecture:\*\*/g,
      `<span style="color:var(--purple);font-weight:700;font-family:var(--font-mono)">▶ CONJECTURE:</span>`)
    .replace(/\[KNOWN\]/g,
      `<span style="background:#1a2e1a;color:var(--green);padding:1px 5px;border-radius:3px;font-size:0.7em">KNOWN</span>`)
    .replace(/\[UNDEREXPLORED\]/g,
      `<span style="background:#2e2a1a;color:var(--gold);padding:1px 5px;border-radius:3px;font-size:0.7em">UNDEREXPLORED</span>`)
    .replace(/\[NOVEL\]/g,
      `<span style="background:#1a1a2e;color:var(--blue);padding:1px 5px;border-radius:3px;font-size:0.7em">NOVEL</span>`)
    .replace(/\[SPECULATIVE\]/g,
      `<span style="background:#2e1a2e;color:var(--purple);padding:1px 5px;border-radius:3px;font-size:0.7em">SPECULATIVE</span>`)
    .replace(/\n\n/g, '</p><p style="margin:8px 0">')
    .replace(/\n/g, '<br/>');
}

interface MathRendererProps {
  text: string;
  accent?: string;
  streaming?: boolean;
}

export function MathRenderer({ text, accent = 'var(--gold)' }: MathRendererProps) {
  const html = useMemo(() => {
    let src = renderKaTeX(text);
    src = applyMarkdown(src, accent);
    src = `<p style="margin:0">${src}</p>`;
    return getSanitizer().sanitize(src, PURIFY_CONFIG);
  }, [text, accent]);

  return (
    <div style={{ lineHeight: 1.8, color: 'var(--text)', fontSize: '0.88rem' }} dangerouslySetInnerHTML={{ __html: html }} /> // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- html is DOMPurify-sanitized with a strict tag/attr allowlist above.
  );
}
