import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/_protected/jobs/$jobId')({
  component: JobReviewPage,
})

type Answer = { kind: 'choice'; selectedOptionIds: string[] } | { kind: 'boolean'; value: boolean } | { kind: 'text'; value: string }
type Draft = { id: string; answer: Answer; explanation: string | null; confidence: number | null; version: number; reviewedAt: string | null }
type Question = { id: string; position: number; type: string | null; status: string; pauseReason: string | null; prompt: string | null; options: Array<{ id: string; label: string }>; draft: Draft | null }
type Job = { id: string; status: string; pauseReason: string | null; message: string | null; completedQuestions: number; totalQuestions: number; pollAfterMs: number | null }

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message ?? 'The request could not be completed safely.')
  return body as T
}

function JobReviewPage() {
  const { jobId } = Route.useParams()
  const queryClient = useQueryClient()
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJson<{ job: Job }>(`/api/v1/jobs/${jobId}`),
    refetchInterval: (query) => query.state.data?.job.pollAfterMs ?? false,
  })
  const questions = useQuery({
    queryKey: ['job-questions', jobId],
    queryFn: () => fetchJson<{ items: Question[] }>(`/api/v1/jobs/${jobId}/questions`),
    refetchInterval: () => job.data?.job.pollAfterMs ?? false,
  })
  const resume = useMutation({
    mutationFn: () => fetchJson(`/api/v1/jobs/${jobId}/resume`, { method: 'POST' }),
    onSuccess: async () => Promise.all([queryClient.invalidateQueries({ queryKey: ['job', jobId] }), queryClient.invalidateQueries({ queryKey: ['jobs'] })]),
  })
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link to="/jobs" className="text-sm font-semibold text-sky-700">← All jobs</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Review</p><h1 className="text-3xl font-bold text-slate-950">Job {jobId.slice(0, 8)}</h1></div>{job.data?.job.status === 'paused' ? <button className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={resume.isPending} onClick={() => resume.mutate()}>Resume job</button> : null}</div>
      {job.data ? <p className="mt-3 text-slate-600">{job.data.job.completedQuestions}/{job.data.job.totalQuestions} complete · status {job.data.job.status}</p> : null}
      {job.data?.job.pauseReason ? <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{job.data.job.pauseReason}: {job.data.job.message}</p> : null}
      {resume.error ? <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{resume.error.message}</p> : null}
      {questions.isLoading ? <p className="mt-8 text-slate-600">Loading questions…</p> : null}
      {questions.error ? <p className="mt-8 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{questions.error.message}</p> : null}
      <div className="mt-8 space-y-5">{questions.data?.items.map((question) => <QuestionCard key={question.id} question={question} jobId={jobId} />)}</div>
    </main>
  )
}

function QuestionCard({ question, jobId }: { question: Question; jobId: string }) {
  const queryClient = useQueryClient()
  const [answer, setAnswer] = useState<Answer | null>(question.draft?.answer ?? null)
  const mutation = useMutation({
    mutationFn: (next: Answer) => fetchJson<{ draft: Draft }>(`/api/v1/drafts/${question.draft!.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: question.draft!.version, answer: next }) }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['job-questions', jobId] }),
  })
  const review = useMutation({
    mutationFn: () => fetchJson(`/api/v1/drafts/${question.draft!.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: question.draft!.version }) }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['job-questions', jobId] }),
  })
  return <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap justify-between gap-3"><div><div className="text-sm font-semibold text-slate-500">Question {question.position}</div><h2 className="mt-1 text-lg font-semibold text-slate-950">{question.prompt ?? 'Question content unavailable'}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{question.status}</span></div>
    {question.draft ? <div className="mt-5 rounded-lg bg-slate-50 p-4">
      <div className="text-sm font-semibold text-slate-800">Local review draft · version {question.draft.version}</div>
      <DraftEditor question={question} answer={answer ?? question.draft.answer} onChange={setAnswer} />
      {question.draft.explanation ? <p className="mt-3 text-sm leading-6 text-slate-600">{question.draft.explanation}</p> : null}
      <p className="mt-2 text-xs text-slate-500">Model confidence: {question.draft.confidence == null ? 'not provided' : question.draft.confidence} · confidence is not correctness.</p>
      <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={mutation.isPending || !answer} onClick={() => answer && mutation.mutate(answer)}>Save local edit</button><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={review.isPending || question.draft.reviewedAt != null} onClick={() => review.mutate()}>{question.draft.reviewedAt ? 'Reviewed' : 'Mark reviewed'}</button></div>
      {mutation.error ? <p className="mt-3 text-sm text-rose-700">{mutation.error.message}</p> : null}{review.error ? <p className="mt-3 text-sm text-rose-700">{review.error.message}</p> : null}
    </div> : <p className="mt-5 text-sm text-slate-600">No local draft is available for this question yet.</p>}
  </article>
}

function DraftEditor({ question, answer, onChange }: { question: Question; answer: Answer; onChange(answer: Answer): void }) {
  if (answer.kind === 'text') return <textarea className="mt-3 min-h-28 w-full rounded-lg border border-slate-300 p-3 text-sm" value={answer.value} onChange={(event) => onChange({ kind: 'text', value: event.target.value })} />
  if (answer.kind === 'boolean') return <select className="mt-3 rounded-lg border border-slate-300 p-2 text-sm" value={String(answer.value)} onChange={(event) => onChange({ kind: 'boolean', value: event.target.value === 'true' })}><option value="true">True</option><option value="false">False</option></select>
  const multiple = question.type === 'multiple_choice'
  return <div className="mt-3 space-y-2">{question.options.map((option) => {
    const checked = answer.selectedOptionIds.includes(option.id)
    return <label key={option.id} className="flex items-center gap-2 text-sm text-slate-700"><input type={multiple ? 'checkbox' : 'radio'} checked={checked} onChange={() => {
      if (multiple) onChange({ kind: 'choice', selectedOptionIds: checked ? answer.selectedOptionIds.filter((id) => id !== option.id) : [...answer.selectedOptionIds, option.id] })
      else onChange({ kind: 'choice', selectedOptionIds: [option.id] })
    }} />{option.label}</label>
  })}</div>
}
