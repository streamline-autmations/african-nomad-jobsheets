// Every catch block in this app used to do:
//
//     err instanceof Error ? err.message : String(err)
//
// which is wrong for the errors this app actually throws. supabase-js rejects
// with a PostgrestError — a plain object `{ message, details, hint, code }`,
// not an Error instance — so `String(err)` produced the literally useless
// "[object Object]" for every database failure in the system. This surfaces
// the message that was there all along.

interface PostgrestLikeError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

function isPostgrestLike(err: unknown): err is PostgrestLikeError {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

/**
 * A human-readable message for anything that lands in a catch block.
 *
 * Postgres errors carry a `hint` that is genuinely useful ("perhaps you meant
 * to reference the column ...") and a `code` that is worth showing because
 * it's what you'd search for — so both are appended when present, rather than
 * being thrown away in favour of a bare message.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;

  if (isPostgrestLike(err)) {
    const parts = [err.message];
    if (err.details) parts.push(err.details);
    if (err.hint) parts.push(err.hint);
    const text = parts.join(" — ");
    return err.code ? `${text} (${err.code})` : text;
  }

  if (typeof err === "string") return err;

  // Last resort. Better a JSON blob than "[object Object]"; a circular
  // structure would make stringify throw, so guard that too.
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
