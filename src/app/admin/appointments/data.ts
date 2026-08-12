import { db } from "@/lib/db";
import type { AppointmentOutboxRow } from "@/lib/appointment";

export type AppointmentOutboxSnapshot = Pick<
  AppointmentOutboxRow,
  | "id"
  | "appointment_id"
  | "task_type"
  | "status"
  | "attempts"
  | "next_attempt_at"
  | "last_error"
  | "created_at"
  | "updated_at"
>;

export async function listAppointmentOutboxSnapshots(
  appointmentIds: string[],
): Promise<AppointmentOutboxSnapshot[]> {
  const ids = Array.from(new Set(appointmentIds.filter(Boolean)));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.$queryRawUnsafe<AppointmentOutboxSnapshot[]>(
    `SELECT id, appointment_id, task_type, status, attempts, next_attempt_at,
            last_error, created_at, updated_at
       FROM appointment_outbox
      WHERE appointment_id IN (${placeholders})
      ORDER BY created_at DESC
      LIMIT 2000`,
    ...ids,
  );
}
