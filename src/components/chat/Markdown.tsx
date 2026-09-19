'use client';

// ============================================================================
// Markdown — dependency-free renderer for chat assistant messages
// ============================================================================
// Supports the subset of CommonMark that matters in a chat UI: fenced code
// blocks with a copy button, inline code, headings, bold / italic / strikethrough,
// links, unordered + ordered lists (with indentation nesting), task lists,
// tables, blockquotes, and horizontal rules. No external npm dependency.
// ============================================================================

import { useState, type ReactNode } from 'react';
import { Check, Copy, Terminal } from './markdown-icons';

// -- Inline parsing -----------------------------------------------------------

const INLINE_RE =
  /(`+)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([^\s*_][\s\S]*?)\5|~~([\s\S]*?)~~|\[([^\]]+)\]\(([^)\s]+)\)/g;

function parseInline(text: string, keyBase = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = keyBase;
  let m: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, codeMark, code, strongMark, strong, emMark, em, strike, linkText, href] = m;
    if (codeMark) {
      out.push(
        <code
          key={k++}
          className="rounded-md border border-white/10 bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-[#4ade80]"
        >
          {code}
        </code>,
      );
    } else if (strongMark) {
      out.push(<strong key={k++}>{parseInline(strong, k)}</strong>);
    } else if (emMark) {
      out.push(<em key={k++}>{parseInline(em, k)}</em>);
    } else if (strike !== undefined) {
      out.push(
        <s key={k++} className="text-gray-500">
          {strike}
        </s>,
      );
    } else if (linkText !== undefined) {
      const safeHref = href.startsWith('/') || /^https?:\/\//i.test(href) ? href : '#';
      out.push(
        <a
          key={k++}
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#4ade80] underline underline-offset-2 hover:text-[#86efac]"
        >
          {linkText}
        </a>,
      );
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// -- Fenced code block --------------------------------------------------------

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-white/10 bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500">
          <Terminal className="h-3 w-3" />
          {lang || 'code'}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover/code:opacity-100"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-[#4ade80]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono text-gray-200">{code.replace(/\n$/, '')}</code>
      </pre>
    </div>
  );
}

// -- Lists (indentation-nested) -----------------------------------------------

type ListItem = {
  text: string;
  checked: boolean | null;
  children: ListItem[];
};

function buildListTree(lines: string[], start: number, ordered: boolean): { items: ListItem[]; next: number } {
  const items: ListItem[] = [];
  let i = start;
  let baseIndent = -1;

  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
    if (!m) break;

    const isOrdered = /^\s*\d+\./.test(lines[i]);
    if (isOrdered !== ordered) break;

    const indent = m[1].length;
    if (baseIndent === -1) baseIndent = indent;
    if (indent > baseIndent) break; // nested handled by recursion below

    const marker = m[2];
    let content = m[3];
    let checked: boolean | null = null;
    const task = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (task && /[-+*]/.test(marker)) {
      checked = task[1].toLowerCase() === 'x';
      content = task[2];
    }

    // Peek ahead for nested children (deeper indentation, same list kind).
    const children: ListItem[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const child = lines[j].match(/^(\s+)([-+*]|\d+\.)\s+(.*)$/);
      if (!child || child[1].length <= indent) break;
      const childOrdered = /^\s*\d+\./.test(lines[j]);
      const childList = buildListTree(lines, j, childOrdered);
      children.push(...childList.items);
      j = childList.next;
    }
    if (children.length > 0) i = j;
    else i += 1;

    items.push({ text: content, checked, children });
  }

  return { items, next: i };
}

function renderListItems(items: ListItem[], ordered: boolean): ReactNode {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`my-2 space-y-1 ${ordered ? 'list-decimal pl-6' : 'list-disc pl-6'}`}>
      {items.map((item, idx) => (
        <li key={idx} className="leading-relaxed">
          {item.checked !== null ? (
            <span className="flex items-start gap-2">
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  item.checked ? 'border-[#22c55e] bg-[#22c55e]/20 text-[#4ade80]' : 'border-white/20'
                }`}
              >
                {item.checked ? '✓' : ''}
              </span>
              <span className="min-w-0">{parseInline(item.text)}</span>
            </span>
          ) : (
            <span className="block">{parseInline(item.text)}</span>
          )}
          {item.children.length > 0 && renderListItems(item.children, /^\d/.test(String(ordered)))}
        </li>
      ))}
    </Tag>
  );
}

function renderListBlock(lines: string[], index: number): { node: ReactNode; next: number } {
  const ordered = /^\s*\d+\./.test(lines[index]);
  const { items, next } = buildListTree(lines, index, ordered);
  return { node: renderListItems(items, ordered), next };
}

// -- Table --------------------------------------------------------------------

function parseTable(lines: string[], index: number): { node: ReactNode; next: number } {
  const header = lines[index].split('|').map((c) => c.trim());
  const rows: string[][] = [];
  let i = index + 2; // skip the separator row
  while (i < lines.length && lines[i].includes('|')) {
    rows.push(lines[i].split('|').map((c) => c.trim()));
    i += 1;
  }
  return {
    next: i,
    node: (
      <div className="my-3 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {header.map((h, hi) => (
                <th key={hi} className="px-3 py-2 font-semibold text-white">
                  {parseInline(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-white/5 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-gray-300">
                    {parseInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
}

// -- Block dispatcher ---------------------------------------------------------

function Heading({
  level,
  className,
  children,
}: {
  level: number;
  className?: string;
  children: ReactNode;
}) {
  switch (level) {
    case 1:
      return <h1 className={className}>{children}</h1>;
    case 2:
      return <h2 className={className}>{children}</h2>;
    case 3:
      return <h3 className={className}>{children}</h3>;
    case 4:
      return <h4 className={className}>{children}</h4>;
    case 5:
      return <h5 className={className}>{children}</h5>;
    default:
      return <h6 className={className}>{children}</h6>;
  }
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?$/.test(line) && line.includes('-');
}

function renderBlocks(lines: string[]): ReactNode {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      i += 1;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^(`{3,}|~{3,})(\w*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2];
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith(marker[0].repeat(marker.length))) {
        code.push(lines[j]);
        j += 1;
      }
      out.push(<CodeBlock key={k++} code={code.join('\n')} lang={lang} />);
      i = j + 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_]\s*){3,}$/.test(trimmed)) {
      out.push(<hr key={k++} className="my-4 border-white/10" />);
      i += 1;
      continue;
    }

    // Table (header row followed by a separator row)
    if (lines[i + 1] && isTableSeparator(lines[i + 1]) && line.includes('|')) {
      const table = parseTable(lines, i);
      out.push(<div key={k++}>{table.node}</div>);
      i = table.next;
      continue;
    }

    // Headings
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? 'text-xl font-bold text-white'
          : level === 2
            ? 'text-lg font-semibold text-white'
            : level === 3
              ? 'text-base font-semibold text-white'
              : 'text-sm font-semibold text-white';
      out.push(
        <Heading key={k++} level={level} className={`${cls} mb-1.5 mt-3 first:mt-0`}>
          {parseInline(heading[2])}
        </Heading>,
      );
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(
        <blockquote key={k++} className="my-2 border-l-2 border-[#22c55e]/50 pl-3 text-gray-400">
          {parseInline(quote.join(' '))}
        </blockquote>,
      );
      continue;
    }

    // Lists
    if (/^\s*([-+*]|\d+\.)\s+/.test(line)) {
      const list = renderListBlock(lines, i);
      out.push(<div key={k++}>{list.node}</div>);
      i = list.next;
      continue;
    }

    // Paragraph — gather until a blank line or another block opener.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^\s*([-+*]|\d+\.)\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('>') &&
      !/^(`{3,}|~{3,})/.test(lines[i].trim()) &&
      !/^\s*([-*_]\s*){3,}$/.test(lines[i].trim()) &&
      !(lines[i].includes('|') && lines[i + 1] && isTableSeparator(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length > 0) {
      out.push(
        <p key={k++} className="my-1.5 leading-relaxed first:mt-0">
          {parseInline(para.join(' '))}
        </p>,
      );
    }
  }

  return out;
}

// -- Public component ---------------------------------------------------------

export default function Markdown({ source }: { source: string }) {
  if (!source) return null;
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  return <div className="space-y-0.5">{renderBlocks(lines)}</div>;
}
