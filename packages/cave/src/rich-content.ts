/**
 * Passive rich content: a strict, non-executable AST for message payloads.
 *
 * The parser accepts only the closed node vocabulary below, with exact keys
 * and bounded sizes. Raw HTML is never interpreted: markup-looking text is
 * preserved byte for byte inside inert text nodes, there is no HTML node
 * type, and no node carries event handlers or executable attributes. Link
 * targets are restricted to `https:` and `mailto:` schemes, so no unsafe
 * target can be produced from a parsed document. Unknown node types,
 * unknown fields, oversized payloads, and over-deep nesting are rejected
 * (fail closed).
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares no rich-content capability family
 * and no route that would carry rich payloads. This module defines the
 * SDK-side consumer half — the parsing and validation model — so that the
 * deferred producer contract can only ever deliver inert content through
 * it. The node vocabulary is SDK-owned and closed; extending it requires a
 * reviewed change here, not data from the wire.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */

export const CAVE_RICH_CONTENT_LIMITS = Object.freeze({
  /** Maximum total nodes in one document. */
  maxNodes: 512,
  /** Maximum nesting depth (the document itself is depth 0). */
  maxDepth: 24,
  /** Maximum characters in one text or code node. */
  maxTextCharacters: 8192,
  /** Maximum characters across all text and code nodes of one document. */
  maxTotalCharacters: 65536,
  /** Maximum characters in one link target. */
  maxUrlCharacters: 2048,
  /** Maximum characters in one code language tag. */
  maxLanguageCharacters: 32,
  /** Maximum characters in one link title. */
  maxTitleCharacters: 256,
});

export type CaveRichContentUrlScheme = 'https' | 'mailto';

export const CAVE_RICH_CONTENT_URL_SCHEMES: readonly CaveRichContentUrlScheme[] =
  Object.freeze(['https', 'mailto']);

export interface CaveRichContentText {
  readonly type: 'text';
  readonly text: string;
}

export interface CaveRichContentCode {
  readonly type: 'code';
  readonly text: string;
}

export interface CaveRichContentLineBreak {
  readonly type: 'lineBreak';
}

export interface CaveRichContentLink {
  readonly type: 'link';
  /** Always an `https:` or `mailto:` target; everything else is rejected. */
  readonly href: string;
  readonly title?: string;
  readonly children: readonly (CaveRichContentText | CaveRichContentCode | CaveRichContentLineBreak)[];
}

export type CaveRichContentInline =
  | CaveRichContentText
  | CaveRichContentCode
  | CaveRichContentLink
  | CaveRichContentLineBreak;

export interface CaveRichContentParagraph {
  readonly type: 'paragraph';
  readonly children: readonly CaveRichContentInline[];
}

export interface CaveRichContentHeading {
  readonly type: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly children: readonly CaveRichContentInline[];
}

export interface CaveRichContentCodeBlock {
  readonly type: 'codeBlock';
  readonly language?: string;
  readonly text: string;
}

export interface CaveRichContentQuote {
  readonly type: 'blockquote';
  readonly children: readonly CaveRichContentBlock[];
}

export interface CaveRichContentList {
  readonly type: 'list';
  readonly ordered: boolean;
  readonly children: readonly CaveRichContentListItem[];
}

export interface CaveRichContentListItem {
  readonly type: 'listItem';
  readonly children: readonly CaveRichContentBlock[];
}

export type CaveRichContentBlock =
  | CaveRichContentParagraph
  | CaveRichContentHeading
  | CaveRichContentCodeBlock
  | CaveRichContentQuote
  | CaveRichContentList;

export interface CaveRichContentDocument {
  readonly type: 'doc';
  readonly children: readonly CaveRichContentBlock[];
}

export class CaveRichContentError extends TypeError {
  readonly field: string;

  constructor(field: string) {
    super(`${field} was rejected by the passive rich-content model.`);
    this.name = 'CaveRichContentError';
    this.field = field;
  }
}

type JsonObject = Record<string, unknown>;

class ParseCounter {
  nodes = 0;
  totalCharacters = 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function node(value: unknown, field: string): JsonObject {
  if (!isObject(value)) {
    throw new CaveRichContentError(field);
  }
  return value;
}

function rejectUnknownKeys(
  value: JsonObject,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new CaveRichContentError(`${field}.${key}`);
    }
  }
}

function textContent(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new CaveRichContentError(field);
  }
  if (value.length > CAVE_RICH_CONTENT_LIMITS.maxTextCharacters) {
    throw new CaveRichContentError(field);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    // Control characters other than tab, newline, and carriage return are
    // malformed input, not content.
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    ) {
      throw new CaveRichContentError(field);
    }
  }
  return value;
}

function languageTag(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > CAVE_RICH_CONTENT_LIMITS.maxLanguageCharacters ||
    !/^[a-z0-9+#._-]+$/u.test(value)
  ) {
    throw new CaveRichContentError(field);
  }
  return value;
}

function linkTitle(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new CaveRichContentError(field);
  }
  if (
    value.length === 0 ||
    value.length > CAVE_RICH_CONTENT_LIMITS.maxTitleCharacters
  ) {
    throw new CaveRichContentError(field);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      throw new CaveRichContentError(field);
    }
  }
  return value;
}

/**
 * Link targets must carry an `https:` or `mailto:` scheme. Every other
 * scheme — `javascript:`, `data:`, `file:`, `vbscript:`, scheme-less
 * relative targets — is rejected, so a parsed document can never carry an
 * unsafe target.
 */
export function parseCaveRichContentUrl(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CaveRichContentError(field);
  }
  if (value.length > CAVE_RICH_CONTENT_LIMITS.maxUrlCharacters) {
    throw new CaveRichContentError(field);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    // Control characters and whitespace are never valid in a target.
    if (code <= 0x20 || code === 0x7f) {
      throw new CaveRichContentError(field);
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Scheme-less or malformed targets are rejected, not resolved.
    throw new CaveRichContentError(field);
  }
  const scheme = parsed.protocol.slice(0, -1);
  if (scheme !== 'https' && scheme !== 'mailto') {
    throw new CaveRichContentError(field);
  }
  if (scheme === 'https' && parsed.username.length > 0) {
    // userinfo in an https target is a credential-leak pattern; reject.
    throw new CaveRichContentError(field);
  }
  return parsed.toString();
}

function countNode(counter: ParseCounter, field: string): void {
  counter.nodes += 1;
  if (counter.nodes > CAVE_RICH_CONTENT_LIMITS.maxNodes) {
    throw new CaveRichContentError(field);
  }
}

function parseInline(value: unknown, field: string, counter: ParseCounter): CaveRichContentInline {
  const record = node(value, field);
  countNode(counter, field);
  const type = record.type;
  if (type === 'text') {
    rejectUnknownKeys(record, new Set(['type', 'text']), field);
    const text = textContent(record.text, `${field}.text`);
    counter.totalCharacters += text.length;
    return Object.freeze({ type: 'text', text });
  }
  if (type === 'code') {
    rejectUnknownKeys(record, new Set(['type', 'text']), field);
    const text = textContent(record.text, `${field}.text`);
    counter.totalCharacters += text.length;
    return Object.freeze({ type: 'code', text });
  }
  if (type === 'lineBreak') {
    rejectUnknownKeys(record, new Set(['type']), field);
    return Object.freeze({ type: 'lineBreak' });
  }
  if (type === 'link') {
    rejectUnknownKeys(
      record,
      new Set(['type', 'href', 'title', 'children']),
      field,
    );
    const href = parseCaveRichContentUrl(record.href, `${field}.href`);
    const title = linkTitle(record.title, `${field}.title`);
    if (!Array.isArray(record.children)) {
      throw new CaveRichContentError(`${field}.children`);
    }
    const children = record.children.map((child, index) => {
      const parsed = parseInline(child, `${field}.children[${index}]`, counter);
      // Links nest text, code, and line breaks only — never another link.
      if (parsed.type === 'link') {
        throw new CaveRichContentError(`${field}.children[${index}]`);
      }
      return parsed;
    });
    return Object.freeze({
      type: 'link',
      href,
      ...(title === undefined ? {} : { title }),
      children: Object.freeze(children),
    });
  }
  throw new CaveRichContentError(`${field}.type`);
}

function parseBlock(
  value: unknown,
  field: string,
  depth: number,
  counter: ParseCounter,
): CaveRichContentBlock {
  if (depth > CAVE_RICH_CONTENT_LIMITS.maxDepth) {
    throw new CaveRichContentError(field);
  }
  const record = node(value, field);
  countNode(counter, field);
  const type = record.type;
  if (type === 'paragraph') {
    rejectUnknownKeys(record, new Set(['type', 'children']), field);
    if (!Array.isArray(record.children)) {
      throw new CaveRichContentError(`${field}.children`);
    }
    const children = record.children.map((child, index) =>
      parseInline(child, `${field}.children[${index}]`, counter),
    );
    return Object.freeze({ type: 'paragraph', children: Object.freeze(children) });
  }
  if (type === 'heading') {
    rejectUnknownKeys(record, new Set(['type', 'level', 'children']), field);
    const level = record.level;
    if (
      typeof level !== 'number' ||
      !Number.isSafeInteger(level) ||
      level < 1 ||
      level > 6
    ) {
      throw new CaveRichContentError(`${field}.level`);
    }
    if (!Array.isArray(record.children)) {
      throw new CaveRichContentError(`${field}.children`);
    }
    const children = record.children.map((child, index) =>
      parseInline(child, `${field}.children[${index}]`, counter),
    );
    return Object.freeze({
      type: 'heading',
      level: level as 1 | 2 | 3 | 4 | 5 | 6,
      children: Object.freeze(children),
    });
  }
  if (type === 'codeBlock') {
    rejectUnknownKeys(record, new Set(['type', 'language', 'text']), field);
    const language = languageTag(record.language, `${field}.language`);
    const text = textContent(record.text, `${field}.text`);
    counter.totalCharacters += text.length;
    return Object.freeze({
      type: 'codeBlock',
      ...(language === undefined ? {} : { language }),
      text,
    });
  }
  if (type === 'blockquote') {
    rejectUnknownKeys(record, new Set(['type', 'children']), field);
    if (!Array.isArray(record.children)) {
      throw new CaveRichContentError(`${field}.children`);
    }
    const children = record.children.map((child, index) =>
      parseBlock(child, `${field}.children[${index}]`, depth + 1, counter),
    );
    return Object.freeze({ type: 'blockquote', children: Object.freeze(children) });
  }
  if (type === 'list') {
    rejectUnknownKeys(record, new Set(['type', 'ordered', 'children']), field);
    if (typeof record.ordered !== 'boolean') {
      throw new CaveRichContentError(`${field}.ordered`);
    }
    if (!Array.isArray(record.children)) {
      throw new CaveRichContentError(`${field}.children`);
    }
    const children = record.children.map((child, index) => {
      const item = node(child, `${field}.children[${index}]`);
      countNode(counter, `${field}.children[${index}]`);
      rejectUnknownKeys(
        item,
        new Set(['type', 'children']),
        `${field}.children[${index}]`,
      );
      if (item.type !== 'listItem') {
        throw new CaveRichContentError(`${field}.children[${index}].type`);
      }
      if (!Array.isArray(item.children)) {
        throw new CaveRichContentError(`${field}.children[${index}].children`);
      }
      const itemChildren = item.children.map((grandChild, grandIndex) =>
        parseBlock(
          grandChild,
          `${field}.children[${index}].children[${grandIndex}]`,
          depth + 1,
          counter,
        ),
      );
      return Object.freeze({
        type: 'listItem',
        children: Object.freeze(itemChildren),
      });
    });
    return Object.freeze({
      type: 'list',
      ordered: record.ordered,
      children: Object.freeze(children),
    });
  }
  throw new CaveRichContentError(`${field}.type`);
}

/**
 * Parse an untrusted rich-content payload into the strict inert AST. The
 * parser is total over its closed vocabulary: unknown node types, unknown
 * fields, executable markup declarations, unsafe link targets, oversized
 * payloads, and over-deep nesting are all rejected.
 */
export function parseCaveRichContent(value: unknown): CaveRichContentDocument {
  const record = node(value, 'doc');
  rejectUnknownKeys(record, new Set(['type', 'children']), 'doc');
  if (record.type !== 'doc') {
    throw new CaveRichContentError('doc.type');
  }
  if (!Array.isArray(record.children)) {
    throw new CaveRichContentError('doc.children');
  }
  const counter = new ParseCounter();
  const children = record.children.map((child, index) =>
    parseBlock(child, `children[${index}]`, 1, counter),
  );
  if (counter.totalCharacters > CAVE_RICH_CONTENT_LIMITS.maxTotalCharacters) {
    throw new CaveRichContentError('doc.totalCharacters');
  }
  return Object.freeze({ type: 'doc', children: Object.freeze(children) });
}

/**
 * Serialize a parsed document. Because the input type can only be produced
 * by `parseCaveRichContent`, the output is inert by construction: it
 * contains only the declared node types, never markup or event handlers.
 */
export function serializeCaveRichContent(
  document: CaveRichContentDocument,
): string {
  return JSON.stringify(document);
}

/**
 * Collect every link target of a parsed document. Every returned target has
 * already passed the `https:`/`mailto:` allowlist during parsing.
 */
export function collectCaveRichContentUrls(
  document: CaveRichContentDocument,
): string[] {
  const urls: string[] = [];
  const visitInline = (inline: CaveRichContentInline): void => {
    if (inline.type === 'link') {
      urls.push(inline.href);
      for (const child of inline.children) {
        visitInline(child);
      }
      return;
    }
  };
  const visitBlock = (block: CaveRichContentBlock): void => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      for (const child of block.children) {
        visitInline(child);
      }
      return;
    }
    if (block.type === 'blockquote' || block.type === 'list') {
      for (const child of block.children) {
        if (child.type === 'listItem') {
          for (const grandChild of child.children) {
            visitBlock(grandChild);
          }
        } else {
          visitBlock(child);
        }
      }
    }
  };
  for (const child of document.children) {
    visitBlock(child);
  }
  return urls;
}
