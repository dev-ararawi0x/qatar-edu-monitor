import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Hallili</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Microsoft sign-in is shown only as a policy-gated integration. It remains disabled unless
          the approved tenant and account policy are configured on the server.
        </p>
        <button
          className="mt-6 w-full rounded-lg bg-sky-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-800"
          onClick={async () => {
            setError(null)
            const result = await authClient.signIn.social({
              provider: 'microsoft',
              callbackURL: '/dashboard',
            })
            if (result.error) setError('Microsoft sign-in is not enabled in this environment.')
          }}
        >
          Continue with Microsoft
        </button>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
      </div>
    </main>
  )
}
