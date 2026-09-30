export function jsonResponse<T>(payload: T, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export function errorResponse(message: string, status = 400, details?: unknown): Response {
  const payload: Record<string, unknown> = {
    success: false,
    message,
  };

  if (details !== undefined) {
    payload.details = details;
  }

  return jsonResponse(payload, status);
}
