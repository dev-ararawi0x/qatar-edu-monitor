import { createFileRoute } from '@tanstack/react-router'
import { getWebHealth } from '~/server/composition/ops'
import { apiErrorResponse, getRequestId, jsonResponse } from '~/server/http'

export const Route = createFileRoute('/api/v1/health')({
  server: {
    handlers: {
      GET: async () => {
        try { return jsonResponse(await getWebHealth()) } catch (error) { return apiErrorResponse(error, getRequestId(new Request('http://localhost/health'))) }
      },
    },
  },
})
