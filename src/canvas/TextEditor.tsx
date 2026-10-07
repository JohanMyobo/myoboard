import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { INK, LINE_HEIGHT, textColorOn } from '../model/palette'
import { STICKY_PADDING, fitFontSize, stickyTextBox } from '../model/geometry'
import type { Point } from '../model/geometry'
import { labelBox } from '../model/shapes'
import type { ConnectorObject, SectionObject, ShapeObject, StickyObject, TextObject } from '../model/types'
import type { Camera } from './camera'
import { LABEL_FONT_SIZE, SECTION_TITLE_INSET, SECTION_TITLE_SIZE, SHAPE_FONT_SIZE, SHAPE_PADDING, labelSize } from './nodes'

export type EditableObject = StickyObject | ShapeObject | TextObject | SectionObject | ConnectorObject

/** The text an editable object shows: its text, a section's title or a connector's label. */
export function editableText(obj: EditableObject): string {
  if (obj.type === 'section') return obj.title
  if (obj.type === 'connector') return obj.label ?? ''
  return obj.text
}

interface TextEditorProps {
  obj: EditableObject
  /** Where a connector's label sits, in board coordinates. */
  anchor?: Point | null
  camera: Camera
  /** Called on every keystroke, so collaborators see the text as it is typed. */
  onChange(value: string): void
  onClose(): void
}

/** An HTML text field laid exactly over the object being edited. */
export function TextEditor({ obj, anchor, camera, onChange, onClose }: TextEditorProps) {
  const [value, setValue] = useState(editableText(obj))
  const fieldRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  // Focus at once, so nothing typed right after the click is lost. Objects are
  // created when the click is released, after the browser has moved focus.
  useLayoutEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [])

  useLayoutEffect(() => {
    const field = fieldRef.current
    if (!field || obj.type === 'section' || obj.type === 'connector') return
    field.style.height = '0px'
    field.style.height = `${field.scrollHeight}px`
  }, [value, camera.scale, obj.type])

  const change = (next: string) => {
    setValue(next)
    onChange(next)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    const finish = e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey || obj.type === 'section' || obj.type === 'connector'))
    if (finish) {
      e.preventDefault()
      onClose()
    }
  }

  const s = camera.scale
  const left = obj.x * s + camera.x
  const top = obj.y * s + camera.y
  const shared = {
    ref: fieldRef,
    value,
    spellCheck: true,
    onChange: (e: { target: { value: string } }) => change(e.target.value),
    onKeyDown,
    onBlur: onClose,
    'aria-label': obj.type === 'section' ? 'Section title' : obj.type === 'connector' ? 'Connector label' : 'Text',
  }

  switch (obj.type) {
    case 'sticky': {
      const box = stickyTextBox(obj.w, obj.h)
      const fontSize = fitFontSize(value, box.width, box.height)
      const style: CSSProperties = {
        left: left + STICKY_PADDING * s,
        top: top + STICKY_PADDING * s,
        width: box.width * s,
        maxHeight: box.height * s,
        fontSize: fontSize * s,
        lineHeight: LINE_HEIGHT,
        color: INK,
      }
      return <textarea className="text-editor" style={style} {...shared} />
    }
    case 'text': {
      const style: CSSProperties = { left, top, width: obj.w * s, fontSize: obj.fontSize * s, lineHeight: LINE_HEIGHT, color: obj.color }
      return <textarea className="text-editor" style={style} {...shared} />
    }
    case 'shape': {
      const label = labelBox(obj.kind, obj.w, obj.h)
      const style: CSSProperties = {
        left: left + label.x * s,
        top: top + label.y * s,
        width: label.w * s,
        height: label.h * s,
        padding: SHAPE_PADDING * s,
      }
      return (
        <div className="text-editor-box" style={style}>
          <textarea
            className="text-editor text-editor-centered"
            style={{ fontSize: SHAPE_FONT_SIZE * s, lineHeight: LINE_HEIGHT, color: textColorOn(obj.color) }}
            {...shared}
          />
        </div>
      )
    }
    case 'section': {
      const style: CSSProperties = {
        left: left + SECTION_TITLE_INSET * s,
        top: top + SECTION_TITLE_INSET * s,
        width: Math.max(160, (obj.w - 2 * SECTION_TITLE_INSET) * s),
        fontSize: SECTION_TITLE_SIZE * s,
        padding: 6 * s,
      }
      return <input className="text-editor text-editor-title" style={style} {...shared} />
    }
    case 'connector': {
      const at = anchor ?? { x: 0, y: 0 }
      const size = labelSize(value || 'Label')
      const style: CSSProperties = {
        left: at.x * s + camera.x,
        top: at.y * s + camera.y,
        width: Math.max(80, size.w + 16) * s,
        fontSize: LABEL_FONT_SIZE * s,
        padding: `${4 * s}px ${8 * s}px`,
      }
      return <input className="text-editor text-editor-title text-editor-label" placeholder="Label" style={style} {...shared} />
    }
  }
}
