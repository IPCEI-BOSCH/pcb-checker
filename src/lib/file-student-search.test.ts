import { expect, it } from "vitest";
import { filterFileStudents } from "./file-student-search";
const students = [
  { id: "1", full_name: "Ștefan Ionescu", email: "stefan@example.com", file_prefix: "Ionescu_P1", theme_name: "Amplificator", theme_number: 7, group_id: "g1", variant: "SMT" as const, projectCount: 2, fabricationCount: 9 },
  { id: "2", full_name: "Maria Pop", email: null, file_prefix: null, theme_name: "Oscilator", theme_number: 8, group_id: "g2", variant: "THT" as const, projectCount: 0, fabricationCount: 0 },
];
const groups = [{ id: "g1", name: "432A", series_id: "A" }, { id: "g2", name: "433B", series_id: "B" }];
const filters = { query: "", series: "", group: "", variant: "", files: "" };
it("searches names without diacritics and combines group/theme terms", () => {
  expect(filterFileStudents(students, { ...filters, query: "stefan 432a 7" }, groups).map(s => s.id)).toEqual(["1"]);
  expect(filterFileStudents(students, { ...filters, query: "example.com Ionescu_P1" }, groups).map(s => s.id)).toEqual(["1"]);
});
it("combines series, group and variant without leaking other results", () => {
  expect(filterFileStudents(students, { ...filters, series: "B", group: "g2", variant: "THT" }, groups).map(s => s.id)).toEqual(["2"]);
  expect(filterFileStudents(students, { ...filters, series: "B", variant: "SMT" }, groups)).toEqual([]);
});
it("distinguishes folders with uploaded files from empty folders", () => {
  expect(filterFileStudents(students, { ...filters, files: "with" }, groups).map(s => s.id)).toEqual(["1"]);
  expect(filterFileStudents(students, { ...filters, files: "without" }, groups).map(s => s.id)).toEqual(["2"]);
});