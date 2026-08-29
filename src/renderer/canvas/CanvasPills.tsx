import type { ReactNode } from 'react'

/** The bottom-left pill cluster opts into fit-view obstacle measurement as one rectangle. */
export function CanvasPills({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="canvas-pills" data-canvas-chrome>
      {children}
    </div>
  )
}
