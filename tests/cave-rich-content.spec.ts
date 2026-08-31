import {
  CAVE_RICH_CONTENT_LIMITS,
  collectCaveRichContentUrls,
  parseCaveRichContent,
  parseCaveRichContentUrl,
  serializeCaveRichContent,
  type CaveRichContentDocument,
} from '@opencoven/cave-client';
import { describe, expect, test } from 'vitest';

function doc(children: unknown): unknown {
  return { type: 'doc', children };
}

function paragraph(children: unknown): unknown {
  return { type: 'paragraph', children };
}

describe('passive rich-content parsing', () => {
  test('parses a valid document of every declared node type', () => {
    const parsed = parseCaveRichContent(
      doc([
        paragraph([
          { type: 'text', text: 'hello ' },
          { type: 'code', text: 'code()' },
          { type: 'lineBreak' },
          {
            type: 'link',
            href: 'https://example.com/docs',
            title: 'docs',
            children: [{ type: 'text', text: 'read more' }],
          },
        ]),
        {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: 'heading' }],
        },
        { type: 'codeBlock', language: 'ts', text: 'const x = 1;\n' },
        { type: 'blockquote', children: [paragraph([{ type: 'text', text: 'q' }])] },
        {
          type: 'list',
          ordered: true,
          children: [
            { type: 'listItem', children: [paragraph([{ type: 'text', text: 'one' }])] },
          ],
        },
      ]),
    );

    expect(parsed.type).toBe('doc');
    expect(parsed.children.length).toBe(5);
    expect(collectCaveRichContentUrls(parsed)).toEqual(['https://example.com/docs']);
  });

  test('preserves markup-looking text inertly, byte for byte', () => {
    const hostile = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const parsed = parseCaveRichContent(
      doc([paragraph([{ type: 'text', text: hostile }])]),
    );
    const node = (
      parsed.children[0] as unknown as { children: Array<{ text: string }> }
    ).children[0];
    // The hostile string is preserved as inert content, never interpreted.
    expect(node?.text).toBe(hostile);

    const serialized = serializeCaveRichContent(parsed);
    // It serializes as an escaped JSON string value only.
    expect(serialized).toContain(JSON.stringify(hostile).slice(1, -1));
    // And no declared node type can represent markup.
    expect(serialized).not.toContain('"type":"html"');
    expect(collectCaveRichContentUrls(parsed)).toEqual([]);
  });

  test('rejects markup node types and unknown fields', () => {
    const hostileNodes = [
      { type: 'html', html: '<b>bold</b>' },
      { type: 'script', children: [] },
      { type: 'iframe', src: 'https://example.com' },
      paragraph([{ type: 'text', text: 'ok', onClick: 'alert(1)' }]),
      paragraph([{ type: 'text', text: 'ok', class: 'x' }]),
      { type: 'paragraph', children: [], style: 'color:red' },
      { type: 'doc', children: [], onload: 'alert(1)' },
    ];
    for (const hostile of hostileNodes) {
      expect(() => parseCaveRichContent(doc([hostile]))).toThrowError(/rejected/u);
    }
  });

  test('rejects unsafe link targets', () => {
    const unsafeTargets = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'https://example.com/ ok', // whitespace
      '/relative/path', // scheme-less targets are rejected, not resolved
      '//protocol.relative.example.com',
      '://missing-scheme', // malformed target
      '',
    ];
    for (const href of unsafeTargets) {
      expect(() =>
        parseCaveRichContent(
          doc([paragraph([{ type: 'link', href, children: [{ type: 'text', text: 'x' }] }])]),
        ),
      ).toThrowError(/rejected/u);
    }
    // https with embedded userinfo is a credential-leak pattern.
    expect(() => parseCaveRichContentUrl('https://user:pass@example.com/', 'href')).toThrowError(
      /rejected/u,
    );
  });

  test('accepts the declared url schemes only', () => {
    expect(parseCaveRichContentUrl('https://example.com/a?b=c', 'href')).toBe(
      'https://example.com/a?b=c',
    );
    expect(parseCaveRichContentUrl('mailto:user@example.com', 'href')).toBe(
      'mailto:user@example.com',
    );
  });

  test('rejects oversized and over-deep structures', () => {
    // One text node past the per-node limit.
    expect(() =>
      parseCaveRichContent(
        doc([paragraph([{ type: 'text', text: 'x'.repeat(CAVE_RICH_CONTENT_LIMITS.maxTextCharacters + 1) }])]),
      ),
    ).toThrowError(/rejected/u);

    // Total characters past the document limit: 9 x 8192 > 65536.
    const bigText = 'x'.repeat(CAVE_RICH_CONTENT_LIMITS.maxTextCharacters);
    expect(() =>
      parseCaveRichContent(
        doc(
          Array.from({ length: 9 }, () =>
            paragraph([{ type: 'text', text: bigText }]),
          ),
        ),
      ),
    ).toThrowError(/rejected/u);

    // More nodes than the document limit.
    expect(() =>
      parseCaveRichContent(
        doc(
          Array.from(
            { length: CAVE_RICH_CONTENT_LIMITS.maxNodes + 1 },
            () => paragraph([]),
          ),
        ),
      ),
    ).toThrowError(/rejected/u);

    // Nesting deeper than the depth limit.
    let nested: unknown = paragraph([{ type: 'text', text: 'bottom' }]);
    for (let index = 0; index < CAVE_RICH_CONTENT_LIMITS.maxDepth + 4; index += 1) {
      nested = { type: 'blockquote', children: [nested] };
    }
    expect(() => parseCaveRichContent(doc([nested]))).toThrowError(/rejected/u);
  });

  test('rejects malformed structure', () => {
    for (const malformed of [
      null,
      undefined,
      'text',
      42,
      [],
      {},
      { type: 'not-doc', children: [] },
      doc('nope'),
      doc([paragraph('nope')]),
      doc([{ type: 'heading', level: 7, children: [] }]),
      doc([{ type: 'heading', level: 0, children: [] }]),
      doc([{ type: 'list', ordered: 'yes', children: [] }]),
      doc([{ type: 'list', ordered: true, children: [{ type: 'paragraph' }] }]),
      doc([{ type: 'codeBlock', language: 'INVALID LANGUAGE', text: 'x' }]),
      doc([{ type: 'codeBlock', text: 'x'.repeat(8193) }]),
      doc([paragraph([{ type: 'link', href: 'https://example.com', children: [{ type: 'link', href: 'https://example.com', children: [] }] }])]),
    ]) {
      expect(() => parseCaveRichContent(malformed)).toThrowError(/rejected/u);
    }
  });

  test('serialization of a parsed document contains only declared node types', () => {
    const parsed: CaveRichContentDocument = parseCaveRichContent(
      doc([
        paragraph([{ type: 'text', text: 'a' }]),
        { type: 'codeBlock', text: 'b' },
      ]),
    );
    const serialized = serializeCaveRichContent(parsed);
    const reparsed = JSON.parse(serialized) as { children: Array<{ type: string }> };
    for (const block of reparsed.children) {
      expect([
        'paragraph',
        'heading',
        'codeBlock',
        'blockquote',
        'list',
      ]).toContain(block.type);
    }
  });
});
