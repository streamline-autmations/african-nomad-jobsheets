import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("uses the message of a real Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("reads a Supabase PostgrestError instead of stringifying it", () => {
    // The regression this file exists for: these are plain objects, not
    // Errors, so the old `String(err)` rendered "[object Object]".
    const postgrestError = {
      message: 'relation "public.job_shets" does not exist',
      details: null,
      hint: null,
      code: "42P01",
    };
    expect(errorMessage(postgrestError)).toBe(
      'relation "public.job_shets" does not exist (42P01)',
    );
  });

  it("keeps the details and hint, which are the useful part of a Postgres error", () => {
    expect(
      errorMessage({
        message: "column reference is ambiguous",
        details: "It could refer to either a PL/pgSQL variable or a table column.",
        hint: "Qualify the column with the table name.",
        code: "42702",
      }),
    ).toBe(
      "column reference is ambiguous — It could refer to either a PL/pgSQL variable or a table column. — Qualify the column with the table name. (42702)",
    );
  });

  it("handles an error object with a message but no Postgres extras", () => {
    expect(errorMessage({ message: "Failed to fetch" })).toBe("Failed to fetch");
  });

  it("passes a plain string through", () => {
    expect(errorMessage("something went wrong")).toBe("something went wrong");
  });

  it("falls back to JSON rather than [object Object]", () => {
    expect(errorMessage({ status: 502 })).toBe('{"status":502}');
  });

  it("survives a circular structure", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => errorMessage(circular)).not.toThrow();
  });

  it("never returns [object Object]", () => {
    for (const value of [{}, { a: 1 }, [], null, undefined, 42, true]) {
      expect(errorMessage(value)).not.toBe("[object Object]");
    }
  });
});
