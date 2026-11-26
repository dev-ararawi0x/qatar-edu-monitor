import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_protected/jobs/')({
  component: JobsPage,
})

type Job = {
  id: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed'
  pauseReason: string | null
  message: string | null
  currentQuestionPosition: number | null
  totalQuestions: number
  completedQuestions: number
  updatedAt: string
  pollAfterMs: number | null
}

async function fetchJobs() {
  const response = await fetch('/api/v1/jobs')
  if (!response.ok) throw new Error('Jobs could not be loaded safely.')
  return (await response.json()) as { items: Job[] }
}

function JobsPage() {
  const query = useQuery({
    queryKey: ['jobs'],
    queryFn: fetchJobs,
    refetchInterval: (query) => query.state.data?.items.some((job) => job.status === 'queued' || job.status === 'running') ? 2_000 : false,
  })
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Jobs</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Background draft jobs</h1></div>
        <Link to="/dashboard" className="text-sm font-semibold text-sky-700 hover:text-sky-900">Back to dashboard</Link>
      </div>
      {query.isLoading ? <p className="mt-8 text-slate-600">Loading jobs…</p> : null}
      {query.error ? <p className="mt-8 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{query.error.message}</p> : null}
      {query.data?.items.length === 0 ? <p className="mt-8 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">No jobs yet. Job creation remains API-driven in this fixture slice.</p> : null}
      <div className="mt-8 space-y-3">
        {query.data?.items.map((job) => {
          const percent = job.totalQuestions === 0 ? 0 : Math.round((job.completedQuestions / job.totalQuestions) * 100)
          return <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }} className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-400">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-slate-950">Job {job.id.slice(0, 8)}</div><div className="mt-1 text-sm text-slate-600">{job.completedQuestions}/{job.totalQuestions} questions · updated {new Date(job.updatedAt).toLocaleString()}</div></div><StatusPill status={job.status} /></div>
            <div className="mt-4 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-sky-600" style={{ width: `${percent}%` }} /></div>
            {job.pauseReason ? <p className="mt-3 text-sm text-amber-700">{job.pauseReason}: {job.message}</p> : null}
          </Link>
        })}
      </div>
    </main>
  )
}
function StatusPill({ status }: { status: Job['status'] }) {
  const colors: Record<Job['status'], string> = { queued: 'bg-slate-100 text-slate-700', running: 'bg-sky-100 text-sky-800', paused: 'bg-amber-100 text-amber-800', completed: 'bg-emerald-100 text-emerald-800', failed: 'bg-rose-100 text-rose-800' }
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colors[status]}`}>{status}</span>
}
