import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/_protected/dashboard')({
  component: DashboardPage,
})

type Subject = {
  id: string
  externalId: string
  name: string
  gradeLabel: string | null
  sectionLabel: string | null
  lastSyncedAt: string
}
type Assessment = {
  id: string
  title: string
  type: string | null
  dueAt: string | null
  sourceStatus: string | null
  displayStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'DRAFT_READY' | 'SUBMITTED'
  timedQuizStatus: 'yes' | 'no' | 'unknown'
  lastSyncedAt: string
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ?? 'The request could not be completed safely.')
  }
  return response.json() as Promise<T>
}

function DashboardPage() {
  const { user } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null)
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => fetchJson<{ items: Subject[] }>('/api/v1/subjects'),
  })
  const refreshSubjects = useMutation({
    mutationFn: () => fetchJson<{ subjectCount: number }>('/api/v1/subjects/refresh', { method: 'POST' }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['subjects'] }),
  })
  const assessments = useQuery({
    queryKey: ['assessments', selectedSubjectId],
    enabled: selectedSubjectId != null,
    queryFn: () => fetchJson<{ items: Assessment[] }>(`/api/v1/subjects/${selectedSubjectId}/assessments`),
  })
  const refreshAssessments = useMutation({
    mutationFn: (subjectId: string) => fetchJson<{ assessmentCount: number }>(`/api/v1/subjects/${subjectId}/assessments/refresh`, { method: 'POST' }),
    onSuccess: async (_data, subjectId) => queryClient.invalidateQueries({ queryKey: ['assessments', subjectId] }),
  })

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Welcome, {user.name}</h1>
          <p className="mt-3 max-w-2xl text-slate-600">Fixture-backed subjects and assessments are shown here. Live LMS access remains disabled until the documented authorization gates pass.</p>
        </div>
        <div className="flex gap-2"><Link to="/jobs" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Jobs</Link><Link to="/notifications" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Notifications</Link></div>
        <button className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={refreshSubjects.isPending} onClick={() => refreshSubjects.mutate()}>
          {refreshSubjects.isPending ? 'Refreshing…' : 'Refresh subjects'}
        </button>
      </div>
      {refreshSubjects.error ? <Notice tone="error" message={refreshSubjects.error.message} /> : null}
      {subjects.isLoading ? <Notice message="Loading subjects…" /> : null}
      {subjects.error ? <Notice tone="error" message={subjects.error.message} /> : null}
      {subjects.data?.items.length === 0 ? <Notice message="No cached subjects yet. Connect an LMS session, then refresh subjects." /> : null}
      <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          {subjects.data?.items.map((subject) => (
            <button key={subject.id} onClick={() => setSelectedSubjectId(subject.id)} className={`w-full rounded-xl border p-4 text-left shadow-sm transition ${selectedSubjectId === subject.id ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-300'}`}>
              <div className="font-semibold text-slate-950">{subject.name}</div>
              <div className="mt-1 text-sm text-slate-600">{[subject.gradeLabel, subject.sectionLabel].filter(Boolean).join(' · ') || 'No grade metadata'}</div>
              <div className="mt-2 text-xs text-slate-500">Synced {new Date(subject.lastSyncedAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">Assessments</h2>
            {selectedSubjectId ? <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={refreshAssessments.isPending} onClick={() => refreshAssessments.mutate(selectedSubjectId)}>{refreshAssessments.isPending ? 'Refreshing…' : 'Refresh'}</button> : null}
          </div>
          {!selectedSubjectId ? <p className="mt-4 text-sm text-slate-600">Choose a subject to inspect its assessments.</p> : null}
          {assessments.isLoading ? <p className="mt-4 text-sm text-slate-600">Loading assessments…</p> : null}
          {assessments.error ? <Notice tone="error" message={assessments.error.message} /> : null}
          {refreshAssessments.error ? <Notice tone="error" message={refreshAssessments.error.message} /> : null}
          <div className="mt-4 space-y-3">
            {assessments.data?.items.map((assessment) => (
              <article key={assessment.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">{assessment.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{assessment.type ?? 'Assessment'} · due {assessment.dueAt ? new Date(assessment.dueAt).toLocaleString() : 'unknown'}</p>
                  </div>
                  <StatusBadge status={assessment.displayStatus} timed={assessment.timedQuizStatus} />
                </div>
                <p className="mt-3 text-xs text-slate-500">Source status: {assessment.sourceStatus ?? 'not reported'} · timed: {assessment.timedQuizStatus}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

function Notice({ message, tone = 'info' }: { message: string; tone?: 'info' | 'error' }) {
  return <p className={`mt-5 rounded-lg px-4 py-3 text-sm ${tone === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>{message}</p>
}

function StatusBadge({ status, timed }: { status: Assessment['displayStatus']; timed: Assessment['timedQuizStatus'] }) {
  const label = status.replaceAll('_', ' ')
  const color = status === 'DRAFT_READY' ? 'bg-emerald-100 text-emerald-800' : status === 'SUBMITTED' ? 'bg-purple-100 text-purple-800' : status === 'IN_PROGRESS' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'
  return <div className="flex flex-col items-end gap-1"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{label}</span>{timed !== 'no' ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">solving blocked: {timed}</span> : null}</div>
}
