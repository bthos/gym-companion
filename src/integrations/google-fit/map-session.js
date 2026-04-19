/**
 * Map Google Fitness session payload to Gym Companion external activity records.
 * @param {object} session - item from Fitness API session list
 */
export function mapFitnessSessionToExternalActivity(session) {
  const id = session?.id || session?.name;
  if (!id) return null;

  const toMillisFromNanos = (v) => {
    if (v == null) return null;
    try {
      return Number(BigInt(String(v)) / 1_000_000n);
    } catch {
      return null;
    }
  };

  const startMillis =
    session.startTimeMillis != null
      ? Number(session.startTimeMillis)
      : session.startTimeNanos != null
        ? toMillisFromNanos(session.startTimeNanos)
        : null;
  const endMillis =
    session.endTimeMillis != null
      ? Number(session.endTimeMillis)
      : session.endTimeNanos != null
        ? toMillisFromNanos(session.endTimeNanos)
        : null;

  return {
    externalId: `google_fit:${id}`,
    source: 'google_fit',
    kind: 'workout_session',
    name: session.name || session.activityType?.name || 'Activity',
    activityType: session.activityType?.name || session.activityType || null,
    startTimeMillis: startMillis,
    endTimeMillis: endMillis,
    ingestedAt: new Date().toISOString(),
    raw: {
      id: session.id,
      activityType: session.activityType,
      application: session.application
    }
  };
}

export function mapFitnessSessionsResponse(payload) {
  const sessions = Array.isArray(payload?.session) ? payload.session : [];
  const out = [];
  for (const s of sessions) {
    const mapped = mapFitnessSessionToExternalActivity(s);
    if (mapped) out.push(mapped);
  }
  return out;
}
