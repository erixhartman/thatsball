import { useMemo, useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  label: string
  title?: string
  render: (row: T, rank: number) => ReactNode
  sort?: (row: T) => number | string
  /** true = bigger sorts first on first click */
  desc?: boolean
  className?: string
  hideOnMobile?: boolean
}

export function Leaderboard<T extends { id: number }>({
  rows,
  columns,
  initialSort,
  empty,
  caption,
}: {
  rows: T[]
  columns: Column<T>[]
  initialSort: { key: string; desc: boolean }
  empty: string
  caption: string
}) {
  const [sort, setSort] = useState(initialSort)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const get = col.sort
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sort.desc ? -cmp : cmp
    })
  }, [rows, columns, sort])

  const onSort = (c: Column<T>) => {
    if (!c.sort) return
    setSort((s) => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: c.desc ?? true }))
  }

  if (!rows.length) return <p className="empty">{empty}</p>

  return (
    <div className="table-wrap">
      <table className="board">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={[c.className, c.hideOnMobile ? 'hide-m' : '', c.sort ? 'sortable' : ''].join(' ')}
                title={c.title}
                aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}
              >
                {c.sort ? (
                  <button type="button" onClick={() => onSort(c)}>
                    {c.label}
                    {sort.key === c.key && <span className="arrow" aria-hidden="true">{sort.desc ? '▾' : '▴'}</span>}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.key} className={[c.className, c.hideOnMobile ? 'hide-m' : ''].join(' ')}>
                  {c.render(r, i + 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
