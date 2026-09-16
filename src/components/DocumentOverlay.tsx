import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

interface DocumentOverlayProps {
  /**
   * Printed page orientation. The internal job sheet is two column blocks
   * wide and needs landscape; the client-facing documents stay portrait.
   */
  orientation?: "portrait" | "landscape";
  children: ReactNode;
}

/**
 * The full-screen shell every printable document renders inside.
 *
 * Portalled onto document.body rather than left where it sits in the React
 * tree, because print isolation depends on it. The old approach hid the rest
 * of the app with `visibility: hidden`, which leaves every box in the layout —
 * the job sheet form behind the overlay is several screens tall, so its
 * leftover height printed as blank trailing pages. As a direct child of body
 * the document can be isolated with `display: none` on its siblings instead
 * (see the print block in styles.css), which removes those boxes from the
 * print layout entirely and leaves exactly one page of content.
 *
 * @page can only come from a stylesheet and only one orientation wins per
 * print job, so the open document declares its own for as long as it is
 * mounted.
 */
export function DocumentOverlay({ orientation = "portrait", children }: DocumentOverlayProps) {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@page { size: A4 ${orientation}; margin: 10mm; }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [orientation]);

  return createPortal(<div className="nsa-doc-overlay">{children}</div>, document.body);
}
