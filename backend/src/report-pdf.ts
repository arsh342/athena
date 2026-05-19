import PDFDocument from 'pdfkit';
import { marked } from 'marked';

/** Render markdown into a PDF buffer (no browser dependency). */
export async function renderPdfFromMarkdown(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const tokens = marked.lexer(markdown);
    renderTokens(doc, tokens);

    doc.end();
  });
}

type TokensList = ReturnType<typeof marked.lexer>;

function renderTokens(doc: PDFKit.PDFDocument, tokens: TokensList): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const size = Math.max(12, 20 - token.depth * 2);
        doc.font('Helvetica-Bold').fontSize(size).text(token.text);
        doc.moveDown(0.4);
        break;
      }
      case 'paragraph':
        doc.font('Helvetica').fontSize(11).text(token.text);
        doc.moveDown(0.4);
        break;
      case 'list':
        for (const item of token.items) {
          doc.font('Helvetica').fontSize(11).text(`• ${item.text}`, { indent: 12 });
        }
        doc.moveDown(0.4);
        break;
      case 'code':
        doc.font('Courier').fontSize(10).text(token.text, { indent: 12 });
        doc.moveDown(0.4);
        break;
      case 'blockquote':
        doc.font('Helvetica-Oblique').fontSize(11).text(token.text, { indent: 12 });
        doc.moveDown(0.4);
        break;
      case 'hr':
        doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
        doc.moveDown(0.6);
        break;
      default:
        break;
    }
  }
}
