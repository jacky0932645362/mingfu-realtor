export type AppointmentRateLimitBucketKind =
  | "create_ip"
  | "create_contact"
  | "slots"
  | "track"
  | "manage"
  | "location_approval"
  | "other";

export function appointmentRateLimitBucketKind(
  key: string,
  explicit?: AppointmentRateLimitBucketKind,
): AppointmentRateLimitBucketKind {
  if (explicit) return explicit;
  if (key.startsWith("create:ip:")) return "create_ip";
  if (key.startsWith("create:contact:")) return "create_contact";
  if (key.startsWith("slots:")) return "slots";
  if (key.startsWith("track:")) return "track";
  if (key.startsWith("manage:")) return "manage";
  if (key.startsWith("location-approval:")) return "location_approval";
  return "other";
}
