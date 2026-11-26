import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_protected/notifications/')({ component: NotificationsPage })
type Notification = { id: string; type: string; title: string; body: string; targetId: string | null; readAt: string | null; createdAt: string }
async function fetchNotifications() {
  const response = await fetch('/api/v1/notifications')
  if (!response.ok) throw new Error('Notifications could not be loaded.')
  return (await response.json()) as { items: Notification[]; unreadCount: number }
}
function NotificationsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 10_000 })
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/v1/notifications/${id}/read`, { method: 'POST' })
      if (!response.ok) throw new Error('The notification could not be marked read.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  return <main className="mx-auto max-w-4xl px-6 py-10"><div className="flex items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Notifications</p><h1 className="mt-2 text-3xl font-bold text-slate-950">In-app notifications</h1><p className="mt-2 text-slate-600">Unread: {query.data?.unreadCount ?? '…'} · refreshes automatically.</p></div><Link to="/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Dashboard</Link></div>{query.error ? <p className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{query.error.message}</p> : null}<div className="mt-8 space-y-3">{query.data?.items.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No notifications yet.</p> : null}{query.data?.items.map((item) => <article key={item.id} className={`rounded-xl border p-5 shadow-sm ${item.readAt ? 'border-slate-200 bg-white' : 'border-sky-300 bg-sky-50'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-950">{item.title}</h2><p className="mt-2 text-sm text-slate-700">{item.body}</p><p className="mt-2 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p></div><div className="flex gap-2">{item.targetId ? <Link to="/jobs/$jobId" params={{ jobId: item.targetId }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Open job</Link> : null}{!item.readAt ? <button onClick={() => markRead.mutate(item.id)} className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white">Mark read</button> : null}</div></div></article>)}</div></main>
}
