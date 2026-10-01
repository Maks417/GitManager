import { describe, expect, it } from 'vitest'
import { looksLikeHtml, toNoteNodes, type NoteSourceNode } from '../src/renderer/src/logic/release-notes'

const text = (value: string): NoteSourceNode => ({ nodeType: 3, nodeName: '#text', textContent: value, childNodes: [] })
const el = (name: string, children: NoteSourceNode[] = [], attrs: Record<string, string> = {}): NoteSourceNode => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  textContent: null,
  childNodes: children,
  getAttribute: (n) => attrs[n] ?? null
})
const body = (...children: NoteSourceNode[]): NoteSourceNode => el('body', children)

describe('toNoteNodes', () => {
  it('keeps formatting tags and scales headings down', () => {
    const nodes = toNoteNodes(
      body(el('h2', [text("What's new")]), el('ul', [text('\n'), el('li', [text('A '), el('strong', [text('bold')])]), text('\n')]))
    )
    expect(nodes).toEqual([
      { type: 'element', tag: 'h3', children: [{ type: 'text', text: "What's new" }] },
      {
        type: 'element',
        tag: 'ul',
        children: [
          {
            type: 'element',
            tag: 'li',
            children: [
              { type: 'text', text: 'A ' },
              { type: 'element', tag: 'strong', children: [{ type: 'text', text: 'bold' }] }
            ]
          }
        ]
      }
    ])
  })

  it('drops active content and unwraps unknown elements', () => {
    const nodes = toNoteNodes(
      body(
        el('script', [text('alert(1)')]),
        el('img', [], { src: 'https://example.com/x.png' }),
        el('div', [el('span', [text('kept')])])
      )
    )
    expect(nodes).toEqual([{ type: 'text', text: 'kept' }])
  })

  it('keeps only http(s) links; others become their text', () => {
    const nodes = toNoteNodes(
      body(
        el('a', [text('ok')], { href: 'https://github.com/Maks417/GitManager' }),
        el('a', [text('bad')], { href: 'javascript:alert(1)' }),
        el('a', [text('none')])
      )
    )
    expect(nodes).toEqual([
      { type: 'element', tag: 'a', href: 'https://github.com/Maks417/GitManager', children: [{ type: 'text', text: 'ok' }] },
      { type: 'text', text: 'bad' },
      { type: 'text', text: 'none' }
    ])
  })
})

describe('looksLikeHtml', () => {
  it('tells GitHub HTML from plain text', () => {
    expect(looksLikeHtml('<h2>What’s new</h2>')).toBe(true)
    expect(looksLikeHtml('Fixed a < b comparison')).toBe(false)
    expect(looksLikeHtml('Plain notes\n- item')).toBe(false)
  })
})
