import { useEffect, useState } from 'react'
import { animate } from 'motion/react'
import { ParentSize } from '@visx/responsive'
import { RingChart } from '@/components/charts/ring-chart'
import { Ring } from '@/components/charts/ring'
import { RingCenter } from '@/components/charts/ring-center'
import { defaultScatterColors } from '@/components/charts/chart-context'

interface StatusDonutProps {
  completed: number
  abandoned: number
}

/** Count up 0 → target, ~0.9s ease-out. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const controls = animate(0, target, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: setValue,
    })
    return () => controls.stop()
  }, [target])
  return Math.round(value)
}

/** Session outcomes (completed vs abandoned) as a ring donut with an animated
 *  completion rate in the center. Uses the shared chart palette. */
export function StatusDonut({ completed, abandoned }: StatusDonutProps) {
  const total = completed + abandoned
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0
  const animatedRate = useCountUp(rate)

  if (total <= 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No sessions yet.
      </p>
    )
  }

  const rings = [
    { label: 'Completed', value: completed, color: defaultScatterColors[0] },
    { label: 'Abandoned', value: abandoned, color: defaultScatterColors[1] },
  ].map((r) => ({ ...r, maxValue: total }))

  return (
    <div className="flex w-full justify-center py-2">
      <div className="w-full max-w-[320px]">
        <ParentSize>
          {({ width }) =>
            width > 0 ? (
              <RingChart
                data={rings}
                size={width}
                strokeWidth={Math.max(8, width * 0.06)}
                baseInnerRadius={width * 0.28}
              >
                {rings.map((r, i) => (
                  <Ring key={r.label} index={i} color={r.color} />
                ))}
                <RingCenter>
                  {({ isHovered, data }) => (
                    <div className="text-center leading-tight">
                      <div className="font-data text-2xl font-semibold tabular-nums">
                        {isHovered ? data.value : `${animatedRate}%`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {isHovered ? data.label : 'Completed'}
                      </div>
                    </div>
                  )}
                </RingCenter>
              </RingChart>
            ) : null
          }
        </ParentSize>
      </div>
    </div>
  )
}
