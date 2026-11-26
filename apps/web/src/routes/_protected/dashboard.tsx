import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_protected/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const { user } = Route.useRouteContext()

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Dashboard</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">Welcome, {user.name}</h1>
      <p className="mt-4 max-w-2xl text-slate-600">
        Authentication and ownership context are active. Catalog and job workflows are introduced in
        later phases through application use cases, not direct route logic.
      </p>
    </main>
  )
}
