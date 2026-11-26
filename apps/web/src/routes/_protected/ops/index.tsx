import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_protected/ops/')({ component: OpsPage })
async function fetchMetrics() {
  const response = await fetch('/api/v1/metrics')
  if (!response.ok) throw new Error('Operational metrics could not be loaded.')
  return (await response.json()) as { collectedAt: string; metrics: Record<string, number> }
}
function OpsPage() {
  const query = useQuery({ queryKey: ['ops-metrics'], queryFn: fetchMetrics, refetchInterval: 10_000 })
  return <main className="mx-auto max-w-5xl px-6 py-10"><p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Operations</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Queue and provider metrics</h1>{query.error ? <p className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{query.error.message}</p> : null}<div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(query.data?.metrics ?? {}).map(([key, value]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-500">{key.replaceAll('_', ' ')}</div><div className="mt-2 text-3xl font-bold text-slate-950">{value}</div></div>)}</div><p className="mt-5 text-sm text-slate-500">Collected {query.data ? new Date(query.data.collectedAt).toLocaleString() : '…'}; refreshes every 10 seconds.</p></main>
}
