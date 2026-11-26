import { createFileRoute } from '@tanstack/react-router'
import { handleApiRoute } from '~/server/api-route'
import { getOperationalMetrics } from '~/server/composition/ops'
import { jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/metrics')({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRoute(request, async () => jsonResponse(await getOperationalMetrics())),
    },
  },
})
