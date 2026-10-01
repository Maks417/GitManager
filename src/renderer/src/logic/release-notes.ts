/**
 * Release notes arrive from GitHub as HTML. They are shown through this allow-list, never as raw HTML: known
 * formatting tags are kept, unknown ones are unwrapped to their text, and active content is dropped.
 */

/** The part of a DOM node the conversion reads (a DOMParser node at runtime, plain objects in tests). */
export interface NoteSourceNode {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<NoteSourceNode>
  getAttribute?: (name: string) => string | null
}

export type NoteTag = 'h3' | 'h4' | 'p' | 'ul' | 'ol' | 'li' | 'strong' | 'em' | 'code' | 'pre' | 'blockquote' | 'br' | 'a'

export type NoteNode =
  | { type: 'text'; text: string }
  | { type: 'element'; tag: NoteTag; href?: string; children: NoteNode[] }

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** Headings are scaled down: the dialog already has its own title. */
const TAGS: Record<string, NoteTag> = {
  H1: 'h3',
  H2: 'h3',
  H3: 'h4',
  H4: 'h4',
  H5: 'h4',
  H6: 'h4',
  P: 'p',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  CODE: 'code',
  PRE: 'pre',
  BLOCKQUOTE: 'blockquote',
  BR: 'br',
  A: 'a'
}

/** Dropped with everything inside them. */
const DROPPED = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'svg', 'SVG', 'TEMPLATE', 'NOSCRIPT', 'FORM'])

/** Lists hold list items only: the whitespace between them is not text. */
const LIST_TAGS = new Set<NoteTag>(['ul', 'ol'])

function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function convertChildren(node: NoteSourceNode, parentTag: NoteTag | null): NoteNode[] {
  const out: NoteNode[] = []
  for (const child of Array.from(node.childNodes)) out.push(...convert(child, parentTag))
  return out
}

function convert(node: NoteSourceNode, parentTag: NoteTag | null): NoteNode[] {
  if (node.nodeType === TEXT_NODE) {
    const text = node.textContent ?? ''
    if (parentTag && LIST_TAGS.has(parentTag) && !text.trim()) return []
    return text ? [{ type: 'text', text }] : []
  }
  if (node.nodeType !== ELEMENT_NODE || DROPPED.has(node.nodeName)) return []
  const tag = TAGS[node.nodeName.toUpperCase()]
  // Unknown elements (div, span, details, …) keep their content without their markup.
  if (!tag) return convertChildren(node, parentTag)
  if (tag === 'br') return [{ type: 'element', tag, children: [] }]
  const children = convertChildren(node, tag)
  if (tag === 'a') {
    const href = safeHref(node.getAttribute?.('href'))
    // A link that is not http(s) stays as its text.
    return href ? [{ type: 'element', tag, href, children }] : children
  }
  return [{ type: 'element', tag, children }]
}

/** The notes of a parsed document body, as an allow-listed tree. */
export function toNoteNodes(body: NoteSourceNode): NoteNode[] {
  return convertChildren(body, null)
}

/** Whether release notes are HTML (GitHub) rather than plain text. */
export function looksLikeHtml(notes: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(notes)
}
