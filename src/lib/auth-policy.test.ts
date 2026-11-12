import { expect, it } from "vitest";
import { preferredAcademicEmail, safeAuthDestination } from "./auth-policy";
it("institutional domains are preferred, not lookalikes", () => {
  expect(preferredAcademicEmail("student@student.upb.ro")).toBe(true);
  expect(preferredAcademicEmail("prof@upb.ro")).toBe(true);
  expect(preferredAcademicEmail("prof@cetti.ro")).toBe(true);
  expect(preferredAcademicEmail("student@gmail.com")).toBe(false);
  expect(preferredAcademicEmail("fake@upb.ro.example.com")).toBe(false);
});
it("OAuth destination stays inside the app", () => {
  expect(safeAuthDestination("/self-check")).toBe("/self-check");
  expect(safeAuthDestination("https://example.com")).toBe("/dashboard");
  expect(safeAuthDestination("//example.com")).toBe("/dashboard");
  expect(safeAuthDestination("/\\example.com")).toBe("/dashboard");
  expect(safeAuthDestination("/auth")).toBe("/dashboard");
});