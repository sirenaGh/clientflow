import { HttpError } from "./errors.js";

export const demoOperations = [
  "transaction.begin",
  "user.create",
  "company.create",
  "contact.create",
  "opportunity.create",
  "note.create",
  "task.create",
  "anonymous-session.delete",
  "authenticated-session.create",
  "transaction.commit",
] as const;
export type DemoOperation = (typeof demoOperations)[number];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function demoProvisioningFailure(
  operation: DemoOperation,
  error: unknown,
) {
  const source = record(error);
  const cause = record(record(record(source.meta).driverAdapterError).cause);
  const originalCode = cause.originalCode;
  // Never log error messages, SQL, arbitrary metadata, record IDs or payloads.
  const diagnostic = {
    operation: demoOperations.includes(operation) ? operation : "unknown",
    prismaCode:
      typeof source.code === "string" && /^P[0-9]{4}$/.test(source.code)
        ? source.code
        : "UNKNOWN",
    ...(typeof originalCode === "string" && /^[0-9]{4,5}$/.test(originalCode)
      ? { mysqlCode: originalCode }
      : {}),
  };
  console.error("Demo provisioning failed", diagnostic);
  return new HttpError(
    500,
    "The demo workspace could not be created. Please try again later.",
  );
}
