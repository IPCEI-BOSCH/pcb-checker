export function preferredAcademicEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1];
  return domain === "upb.ro" || domain === "student.upb.ro" || domain === "cetti.ro";
}

export function safeAuthDestination(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value) || value.startsWith("/auth") || value.startsWith("/reset-password")) return "/dashboard";
  return value;
}

export const AUTH_DESTINATION_KEY = "pcb-auth-destination";