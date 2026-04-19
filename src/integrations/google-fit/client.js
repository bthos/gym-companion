const FITNESS = 'https://www.googleapis.com/fitness/v1';

export async function listFitnessSessions({
  accessToken,
  startTimeNanos,
  endTimeNanos
}) {
  const params = new URLSearchParams({
    startTime: String(startTimeNanos),
    endTime: String(endTimeNanos)
  });
  const url = `${FITNESS}/users/me/sessions?${params.toString()}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || 'fitness_sessions_failed');
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

export function toNanos(ms) {
  return BigInt(ms) * 1_000_000n;
}

export function fromNanos(n) {
  return Number(n / 1_000_000n);
}
