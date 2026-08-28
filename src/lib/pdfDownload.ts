// Shared by both document types (NSA Quote/Invoice and AN Job Sheet
// Quote/Invoice) — captures the actual printable DOM node and downloads it
// as a real PDF file, as a one-click alternative to "Print / Save as PDF"
// (which still works too, since some people prefer that route).
//
// html2pdf.js bundles html2canvas + jsPDF, which together nearly quadrupled
// the app's main bundle (390KB -> 1.3MB gzipped) when statically imported —
// most page loads never touch a document view at all. Dynamic import keeps
// it out of the main chunk entirely, fetched only when someone actually
// clicks Download.
export async function downloadElementAsPdf(
  element: HTMLElement,
  filename: string,
  // The internal job sheet is two column blocks wide; portrait squeezes it to
  // the point of uselessness. Client-facing documents stay portrait.
  orientation: "portrait" | "landscape" = "portrait",
): Promise<void> {
  const { default: html2pdf } = await import("html2pdf.js");
  await html2pdf()
    .set({
      margin: 10,
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation },
    })
    .from(element)
    .save();
}
