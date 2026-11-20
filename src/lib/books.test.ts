import assert from "node:assert/strict";
import test from "node:test";

import { BOOKS, bookById, byTag, readingMinutes, searchBooks } from "./books";
import { categoryBySlug, languageByCode } from "./catalog";

test("bookById finds existing books and returns undefined for missing ids", () => {
  const book = bookById("homo-deus");
  assert.ok(book);
  assert.equal(book.title, "Homo Deus");
  assert.equal(bookById("non-existent-book-id"), undefined);
});

test("searchBooks filters by query, language, category, and minRating", () => {
  const results = searchBooks("harari", {
    languages: ["en"],
    categories: ["history"],
    minRating: 4.0,
  });
  assert.ok(results.some((b) => b.id === "homo-deus"));

  const none = searchBooks("harari", { languages: ["ml"] });
  assert.equal(none.length, 0);
});

test("searchBooks sorts alphabetically when sort is az", () => {
  const sorted = searchBooks("", { sort: "az" });
  assert.equal(sorted.length, BOOKS.length);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i - 1]!.title.localeCompare(sorted[i]!.title) <= 0);
  }
});

test("byTag and readingMinutes return valid data", () => {
  const popular = byTag("popular");
  assert.ok(popular.length > 0);
  for (const book of popular) {
    assert.ok(book.tags.includes("popular"));
    assert.ok(readingMinutes(book) >= 3);
  }
});

test("catalog lookups resolve categories and languages", () => {
  assert.equal(categoryBySlug("mystery")?.name, "Mystery");
  assert.equal(languageByCode("ml")?.name, "Malayalam");
});
