import crypto from 'node:crypto';

function slugId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function normalizeRoutineImport(body, defaults = {}) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    errors.push('Body must be a JSON object');
    return { ok: false, errors };
  }

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : null;
  if (!name) errors.push('name is required');

  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source.trim()
      : defaults.source ?? 'import';

  const status =
    typeof body.status === 'string' && body.status.trim()
      ? body.status.trim()
      : 'active';

  const daysIn = Array.isArray(body.days) ? body.days : [];
  if (daysIn.length === 0) errors.push('days must be a non-empty array');

  if (errors.length) return { ok: false, errors };

  const routineId =
    typeof body.id === 'string' && body.id.trim() ? body.id.trim() : slugId('routine');

  const days = daysIn.map((day, dayIdx) => {
    const dayId =
      typeof day?.id === 'string' && day.id.trim() ? day.id.trim() : slugId('day');
    const label =
      typeof day?.label === 'string' && day.label.trim()
        ? day.label.trim()
        : `Day ${dayIdx + 1}`;
    const exercisesIn = Array.isArray(day?.exercises) ? day.exercises : [];
    const exercises = exercisesIn.map((ex, exIdx) => {
      const exerciseId =
        typeof ex?.id === 'string' && ex.id.trim() ? ex.id.trim() : slugId('ex');
      const exerciseName =
        typeof ex?.name === 'string' && ex.name.trim()
          ? ex.name.trim()
          : `Exercise ${exIdx + 1}`;
      const p = ex?.prescription && typeof ex.prescription === 'object' ? ex.prescription : {};
      const prescription = {
        sets: Number.isFinite(Number(p.sets)) ? Number(p.sets) : 3,
        reps: Number.isFinite(Number(p.reps)) ? Number(p.reps) : 8,
        loadKg: p.loadKg == null ? null : Number(p.loadKg),
        restSec: p.restSec == null ? null : Number(p.restSec)
      };
      return {
        id: exerciseId,
        name: exerciseName,
        notes: typeof ex?.notes === 'string' ? ex.notes : '',
        prescription
      };
    });
    return {
      id: dayId,
      label,
      order: Number.isFinite(Number(day?.order)) ? Number(day.order) : dayIdx,
      exercises
    };
  });

  const routine = {
    id: routineId,
    name,
    source,
    status,
    createdAt: new Date().toISOString(),
    days
  };

  return { ok: true, routine };
}
