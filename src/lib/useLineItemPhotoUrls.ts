import { useEffect, useState } from "react";
import { getLineItemPhotoUrl } from "./jobSheets";

/**
 * Resolves line-item photo storage paths to signed URLs an <img> can load.
 *
 * The bucket is private, so a stored path is never itself a usable src.
 * Keyed off the joined path list rather than the array reference, so a
 * caller that recomputes `photoPaths` on every render (e.g. a fresh
 * `.flatMap` over rows) doesn't retrigger the fetch when the actual paths
 * haven't changed.
 */
export function useLineItemPhotoUrls(paths: string[]): Record<string, string> {
  const key = paths.join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (paths.length === 0) {
      setUrls({});
      return;
    }
    let cancelled = false;
    Promise.all(
      paths.map((path) =>
        getLineItemPhotoUrl(path)
          .then((url) => [path, url] as const)
          .catch(() => [path, ""] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setUrls(Object.fromEntries(entries.filter(([, url]) => url !== "")));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}
