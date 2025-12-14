import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Report } from '@/lib/accessibility/types';

export async function generatePdfReport(report: Report) {
    const doc = new jsPDF();

    // Load Polish-compatible font (Roboto)
    try {
        // Use a TTF source (WOFF2 causes read errors in jsPDF)
        const fontUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
        const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());

        // Convert to base64 (Browser safe)
        let binary = '';
        const bytes = new Uint8Array(fontBytes);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64Font = btoa(binary);

        // Add to VFS and Register
        doc.addFileToVFS('Roboto-Regular.ttf', base64Font);
        doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
        doc.setFont('Roboto');
    } catch (e) {
        console.warn('Could not load custom font, falling back to default', e);
    }

    // Header
    doc.setFontSize(20);
    doc.setTextColor(59, 130, 246); // Blue
    doc.text('Raport Dostępności WCAG 2.1', 14, 22);

    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Plik: ${report.fileName}`, 14, 32);
    doc.text(`Data: ${new Date().toLocaleDateString()}`, 14, 38);
    doc.text(`Wynik: ${report.passedChecks}/${report.totalChecks} (${report.complianceScore}%)`, 14, 44);

    // Summary Line
    doc.setLineWidth(0.5);
    doc.line(14, 50, 196, 50);

    // Violations Table
    const tableData = report.violations.map(v => [
        (v.status === 'pass' ? 'ZALICZONE' : v.status === 'fail' ? 'BŁĄD' : 'OSTRZEŻENIE'),
        v.wcagCriterion,
        v.description,
        (v.impact === 'critical' ? 'Krytyczny' : v.impact === 'serious' ? 'Poważny' : v.impact === 'moderate' ? 'Średni' : 'Niski')
    ]);

    autoTable(doc, {
        startY: 55,
        head: [['Status', 'Kryterium', 'Problem', 'Wplyw']],
        body: tableData,
        styles: { fontSize: 10, cellPadding: 3, font: 'Roboto' }, // Apply font to table
        headStyles: { fillColor: [59, 130, 246], font: 'Roboto' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 0) {
                const status = data.cell.raw as string;
                if (status === 'PASS') data.cell.styles.textColor = [16, 185, 129];
                if (status === 'FAIL') data.cell.styles.textColor = [239, 68, 68];
                if (status === 'WARNING') data.cell.styles.textColor = [245, 158, 11];
            }
        }
    });

    // Footer
    const pageCount = doc.internal.pages.length - 1; // fix for jspdf counting
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text('Automatyczny Raport Heurystyczny - Wymagana Weryfikacja Ręczna', 14, doc.internal.pageSize.height - 10);

    doc.save(`Raport_WCAG_${report.fileName}.pdf`);
}
