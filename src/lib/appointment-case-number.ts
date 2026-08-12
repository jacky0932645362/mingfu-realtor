export type AppointmentCaseNumberRecord = {
  caseNo: string | null;
  createdAt: Date | string | null;
};

export type AppointmentCaseNumberTransaction = {
  lockAppointment: (appointmentId: string) => Promise<AppointmentCaseNumberRecord | null>;
  lockSequence: (caseDay: string) => Promise<number>;
  listExistingCaseNos: (prefix: string) => Promise<string[]>;
  saveSequence: (caseDay: string, lastSeq: number) => Promise<void>;
  saveAppointmentCaseNo: (appointmentId: string, caseNo: string) => Promise<boolean>;
  readAppointmentCaseNo: (appointmentId: string) => Promise<string | null>;
};

export type AppointmentCaseNumberStore = {
  transaction: <T>(
    work: (tx: AppointmentCaseNumberTransaction) => Promise<T>,
  ) => Promise<T>;
};

/** AP-260806-01 = appointment + Taipei creation date + daily sequence. */
export function formatAppointmentCaseNo(createdAt: Date, seq: number): string {
  const tw = new Date(createdAt.getTime() + 8 * 3600_000);
  const ymd = tw.toISOString().slice(2, 10).replace(/-/g, "");
  return `AP-${ymd}-${String(Math.max(1, seq)).padStart(2, "0")}`;
}

export function appointmentCasePrefix(createdAt: Date): string {
  return formatAppointmentCaseNo(createdAt, 1).slice(0, -2);
}

export function appointmentCaseDay(createdAt: Date): string {
  return appointmentCasePrefix(createdAt).slice(3, 9);
}

export function parseAppointmentCaseSequence(caseNo: string, prefix: string): number {
  if (!caseNo.startsWith(prefix)) return 0;
  const raw = caseNo.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCreatedAt(
  value: AppointmentCaseNumberRecord["createdAt"],
  fallback: Date,
): Date {
  const parsed = value instanceof Date ? value : new Date(value || "");
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

/**
 * Allocate and persist one case number inside a store-owned transaction.
 *
 * The appointment row is locked first so concurrent retries for the same ID
 * return the same value. A per-day sequence row then serializes different
 * appointments, while the current list of existing numbers seeds legacy days.
 */
export async function allocateAppointmentCaseNo(
  store: AppointmentCaseNumberStore,
  appointmentId: string,
  fallbackCreatedAt = new Date(),
): Promise<string | null> {
  return store.transaction(async (tx) => {
    const appointment = await tx.lockAppointment(appointmentId);
    if (!appointment) return null;
    if (appointment.caseNo) return appointment.caseNo;

    const createdAt = normalizeCreatedAt(appointment.createdAt, fallbackCreatedAt);
    const prefix = appointmentCasePrefix(createdAt);
    const caseDay = appointmentCaseDay(createdAt);
    const storedSequence = await tx.lockSequence(caseDay);
    const existingCaseNos = await tx.listExistingCaseNos(prefix);
    const existingMax = existingCaseNos.reduce(
      (max, caseNo) => Math.max(max, parseAppointmentCaseSequence(caseNo, prefix)),
      0,
    );
    const nextSequence = Math.max(storedSequence, existingMax) + 1;
    const caseNo = formatAppointmentCaseNo(createdAt, nextSequence);

    await tx.saveSequence(caseDay, nextSequence);
    const assigned = await tx.saveAppointmentCaseNo(appointmentId, caseNo);
    return assigned ? caseNo : tx.readAppointmentCaseNo(appointmentId);
  });
}
