import { boundsOf } from '../clipboard'
import { connectorRoute } from '../model/geometry'
import type { BoardObject } from '../model/types'

/** A small drawing of a template's layout. */
export function TemplatePreview({ objects }: { objects: readonly BoardObject[] }) {
  const bounds = boundsOf(objects)
  if (!bounds) return <svg className="template-preview" viewBox="0 0 160 100" aria-hidden />
  const pad = Math.max(bounds.w, bounds.h) * 0.06
  const byId = new Map(objects.map((obj) => [obj.id, obj]))
  return (
    <svg className="template-preview" viewBox={`${bounds.x - pad} ${bounds.y - pad} ${bounds.w + 2 * pad} ${bounds.h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {objects.map((obj) => {
        switch (obj.type) {
          case 'section':
            return <rect key={obj.id} x={obj.x} y={obj.y} width={obj.w} height={obj.h} rx={16} fill={obj.color} stroke="rgba(29,29,27,0.15)" strokeWidth={4} />
          case 'sticky':
          case 'image':
            return <rect key={obj.id} x={obj.x} y={obj.y} width={obj.w} height={obj.h} rx={6} fill={obj.type === 'sticky' ? obj.color : '#d9d9d4'} />
          case 'shape':
            return obj.kind === 'ellipse' ? (
              <ellipse key={obj.id} cx={obj.x + obj.w / 2} cy={obj.y + obj.h / 2} rx={obj.w / 2} ry={obj.h / 2} fill={obj.color} stroke="rgba(29,29,27,0.4)" strokeWidth={4} />
            ) : (
              <rect key={obj.id} x={obj.x} y={obj.y} width={obj.w} height={obj.h} rx={10} fill={obj.color} stroke="rgba(29,29,27,0.4)" strokeWidth={4} />
            )
          case 'text':
            return <rect key={obj.id} x={obj.x} y={obj.y} width={Math.min(obj.w, obj.text.length * obj.fontSize * 0.5)} height={obj.fontSize} rx={4} fill="rgba(29,29,27,0.7)" />
          case 'connector': {
            const route = connectorRoute(obj, (id) => byId.get(id))
            if (!route) return null
            return <path key={obj.id} d={pathFrom(route.points, route.bezier)} fill="none" stroke={obj.color} strokeWidth={4} />
          }
          default:
            return null
        }
      })}
    </svg>
  )
}

function pathFrom(points: number[], bezier: boolean): string {
  if (points.length < 4) return ''
  if (bezier && points.length === 8) return `M${points[0]} ${points[1]} C${points[2]} ${points[3]} ${points[4]} ${points[5]} ${points[6]} ${points[7]}`
  let d = `M${points[0]} ${points[1]}`
  for (let i = 2; i + 1 < points.length; i += 2) d += ` L${points[i]} ${points[i + 1]}`
  return d
}
