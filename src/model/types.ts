/**
 * Board document model.
 *
 * A board is a flat map of objects. Each object is a bag of properties, and
 * concurrent edits are resolved property by property (last writer wins), so
 * two people moving and recolouring the same sticky never conflict.
 * `index` is a fractional index that orders objects from back to front.
 */

export type ObjectType = 'sticky' | 'shape' | 'text' | 'pen' | 'connector' | 'section' | 'stamp'

export type ShapeKind = 'rect' | 'ellipse' | 'diamond'

interface BaseObject {
  id: string
  type: ObjectType
  /** Fractional index: objects are drawn in ascending order. */
  index: string
  x: number
  y: number
  /** Display name of whoever created the object. */
  author?: string
}

export interface StickyObject extends BaseObject {
  type: 'sticky'
  w: number
  h: number
  color: string
  text: string
}

export interface ShapeObject extends BaseObject {
  type: 'shape'
  kind: ShapeKind
  w: number
  h: number
  color: string
  text: string
}

export interface TextObject extends BaseObject {
  type: 'text'
  /** Wrapping width; the height follows the text. */
  w: number
  text: string
  fontSize: number
  color: string
}

export interface PenObject extends BaseObject {
  type: 'pen'
  /** Flat [x0, y0, x1, y1, ...] list, relative to (x, y). */
  points: number[]
  color: string
  width: number
}

/** A connector end is either attached to an object or left at a free point. */
export type Endpoint = { id: string } | { x: number; y: number }

export interface ConnectorObject extends BaseObject {
  type: 'connector'
  from: Endpoint
  to: Endpoint
  color: string
}

export interface SectionObject extends BaseObject {
  type: 'section'
  w: number
  h: number
  title: string
  color: string
}

/** A reaction stamp; (x, y) is its centre. */
export interface StampObject extends BaseObject {
  type: 'stamp'
  emoji: string
  color: string
}

export type BoardObject =
  | StickyObject
  | ShapeObject
  | TextObject
  | PenObject
  | ConnectorObject
  | SectionObject
  | StampObject

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type DistributivePatch<T> = T extends unknown ? Partial<Omit<T, 'id' | 'type'>> : never

/** What callers pass to create an object: everything but the generated fields. */
export type NewObject = DistributiveOmit<BoardObject, 'id' | 'index'>

/** A partial update of one object's properties. */
export type ObjectPatch = DistributivePatch<BoardObject>

export const isAttached = (endpoint: Endpoint): endpoint is { id: string } => 'id' in endpoint
