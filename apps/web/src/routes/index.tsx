import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Hallili v0.1</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
        Reviewable assessment drafts with a safe background workflow.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
        This foundation intentionally uses fake LMS and AI integrations until the documented
        authorization, privacy, and policy gates are satisfied.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          'TanStack Start only HTTP backend',
          'Separate durable Worker',
          'Fail-closed LMS gates',
        ].map((item) => (
          <div key={item} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-800">{item}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
