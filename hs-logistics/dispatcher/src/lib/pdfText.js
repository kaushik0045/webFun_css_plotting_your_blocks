// Turns a PDF File into text lines using pdf.js.
// Everything happens in the browser; the PDF is never uploaded.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { itemsToLines } from './textLines.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfToLines(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    lines.push(...itemsToLines(items));
    page.cleanup();
  }
  await doc.destroy();
  return lines;
}
