import { Report, Violation, Status } from './types';

export async function checkPdf(file: File): Promise<Report> {
    // Dynamic import to avoid SSR issues with DOMMatrix/Canvas
    const pdfjsLib = await import('pdfjs-dist');

    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    const violations: Violation[] = [];
    const arrayBuffer = await file.arrayBuffer();

    // Load the PDF
    const leadingTask = pdfjsLib.getDocument(arrayBuffer);
    const pdf = await leadingTask.promise;

    const metadataReq = await pdf.getMetadata();
    const info = metadataReq.info as any;
    const metadata = metadataReq.metadata;

    // 1. Title Check - WCAG 2.4.2
    // info.Title is the standard property
    const title = info?.Title;

    if (title && title.trim().length > 0 && title !== 'Untitled') {
        violations.push({
            id: 'meta-title',
            wcagCriterion: '2.4.2',
            description: 'Tytuł pliku PDF jest obecny',
            help: 'Dobra robota!',
            impact: 'moderate',
            status: 'pass',
            details: `Tytuł: "${title}"`
        });
    } else {
        violations.push({
            id: 'meta-title',
            wcagCriterion: '2.4.2',
            description: 'Brak znaczącego tytułu PDF',
            help: 'Ustaw Tytuł Dokumentu w narzędziu autorskim (np. InDesign, Word, Acrobat).',
            impact: 'serious',
            status: 'fail',
        });
    }

    // 2. Language Check - WCAG 3.1.1
    let lang = null;
    const metaAny = metadata as any;
    if (metadata && metaAny.has && metaAny.has('dc:language')) {
        lang = metaAny.get('dc:language');
    }

    // Fallback: check generally if there is any language info we can find
    // Note: PDF.js high level API makes it hard to check Catalog / Lang without detailed transport access
    // We will mark it as manual check or warning if not found in XMP.

    if (lang) {
        violations.push({
            id: 'meta-lang',
            wcagCriterion: '3.1.1',
            description: 'Język określony',
            help: 'Świetnie.',
            impact: 'moderate',
            status: 'pass',
            details: `Język: ${lang}`
        });
    } else {
        violations.push({
            id: 'meta-lang',
            wcagCriterion: '3.1.1',
            description: 'Nie znaleziono języka w metadanych',
            help: 'Upewnij się, że język dokumentu jest ustawiony we Właściwościach > Zaawansowane.',
            impact: 'moderate',
            status: 'warning',
        });
    }


    // 3. Tagged PDF Check - WCAG 1.3.1
    // We can use `pdf.getOutline()` to see if bookmarks exist (2.4.5 Multiple Ways).
    const outline = await pdf.getOutline();
    if (outline && outline.length > 0) {
        violations.push({
            id: 'nav-bookmarks',
            wcagCriterion: '2.4.5',
            description: 'Wykryto zakładki / spis treści',
            help: 'Dobre dla nawigacji.',
            impact: 'minor',
            status: 'pass',
        });
    }

    // Check pages for text content vs image only (OCR check logic)
    let totalTextLength = 0;

    // We check first 3 pages or all
    const pagesToCheck = Math.min(pdf.numPages, 5);
    for (let i = 1; i <= pagesToCheck; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str);
        totalTextLength += strings.join('').length;
    }

    if (totalTextLength < 50) {
        violations.push({
            id: 'ocr-text',
            wcagCriterion: '1.4.5',
            description: 'Wykryto bardzo mało tekstu. Skan PDF?',
            help: 'Jeśli to zeskanowany dokument, upewnij się, że wykonałeś OCR (Optyczne Rozpoznawanie Znaków).',
            impact: 'critical',
            status: 'warning',
        });
    } else {
        violations.push({
            id: 'ocr-text',
            wcagCriterion: '1.4.5',
            description: 'Wykryto treść tekstową',
            help: 'Dobrze, dokument wydaje się mieć prawdziwy tekst.',
            impact: 'critical',
            status: 'pass',
        });
    }

    // NOTE: True "Tagged PDF" verification is hard with basic pdf.js API without using internals.
    // We will assume that if we can't find structural info easily, it might warn user to check strict structure tags manually.
    // 4. Structure Tree & Alt Text Check
    let structTree = null;
    try {
        structTree = await (pdf as any).getStructTree();
    } catch (e) {
        console.warn('StructTree fetch failed', e);
    }

    if (structTree) {
        violations.push({
            id: 'structure-tags',
            wcagCriterion: '1.3.1',
            description: 'Wykryto tagi strukturalne (PDF Tagged)',
            help: 'Dokument posiada strukturę znaczników.',
            impact: 'serious',
            status: 'pass',
        });

        // Check for Figures with/without Alt
        let figuresFound = 0;
        let figuresMissingAlt = 0;

        const traverse = (node: any) => {
            if (!node) return;

            // Check if node is a Figure
            // Role can be in .role or implicitly if we check the standard types
            // pdf.js structure tree nodes usually have `role` property.
            const role = node.role || '';

            if (role === 'Figure' || role === 'Sect') {
                // 'Sect' often wraps, but 'Figure' is the key for images.
            }

            if (role === 'Figure') {
                figuresFound++;
                // Check alt. API might expose it as `alt` or via `dict`.
                // For safe heuristic: check `alt` property directly if exposed by pdf.js middleware
                // or check if `dict.get('Alt')` exists.
                let hasAlt = false;
                if (node.alt && typeof node.alt === 'string' && node.alt.trim().length > 0) {
                    hasAlt = true;
                } else if (node.dict) {
                    const altEntry = node.dict.get('Alt');
                    if (altEntry && typeof altEntry === 'string' && altEntry.trim().length > 0) {
                        hasAlt = true;
                    }
                }

                if (!hasAlt) {
                    figuresMissingAlt++;
                }
            }

            if (node.children) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        };

        traverse(structTree);

        if (figuresFound > 0) {
            if (figuresMissingAlt === 0) {
                violations.push({
                    id: 'pdf-images-alt',
                    wcagCriterion: '1.1.1',
                    description: 'Wszystkie figury (obrazy) w strukturze mają tekst alternatywny',
                    help: 'Świetnie.',
                    impact: 'critical',
                    status: 'pass',
                });
            } else {
                violations.push({
                    id: 'pdf-images-alt',
                    wcagCriterion: '1.1.1',
                    description: `Znaleziono ${figuresMissingAlt} figur bez tekstu alternatywnego (Alt)`,
                    help: 'Użyj panelu Dostępność w Acrobat, aby dodać opisy.',
                    impact: 'critical',
                    status: 'fail',
                });
            }
        } else {
            // No figures found in structure
            // Check if there are images on pages? (Operator check from before)
            // If we found NO figures in structure, but strict tree exists
            violations.push({
                id: 'pdf-images-alt',
                wcagCriterion: '1.1.1',
                description: 'Nie znaleziono oznaczonych figur (obrazów) w strukturze',
                help: 'Jeśli dokument zawiera obrazy, upewnij się, że są one otagowane jako "Figure".',
                impact: 'moderate',
                status: 'warning',
            });
        }

    } else {
        violations.push({
            id: 'structure-tags',
            wcagCriterion: '1.3.1',
            description: 'Brak struktury tagów (Untagged PDF)',
            help: 'Dokument musi być otagowany (Tagged PDF), aby być dostępny.',
            impact: 'critical',
            status: 'fail',
        });

        // If untagged, we definitely can't check Alt text reliably
        violations.push({
            id: 'pdf-images-alt',
            wcagCriterion: '1.1.1',
            description: 'Nie można sprawdzić tekstów alternatywnych (brak tagów)',
            help: 'Włącz tagowanie w dokumencie źródłowym.',
            impact: 'critical',
            status: 'fail',
        });
    }


    // Final score calc
    const failCount = violations.filter(v => v.status === 'fail').length;
    const passCount = violations.filter(v => v.status === 'pass').length;
    const total = violations.length;
    const score = total === 0 ? 100 : Math.round((passCount / total) * 100);

    return {
        fileName: file.name,
        fileType: 'pdf',
        complianceScore: score,
        passedChecks: passCount,
        totalChecks: total,
        violations,
        metadata: {
            title: info?.Title,
            author: info?.Author,
            pageCount: pdf.numPages,
            createdAt: info?.CreationDate
        }
    };
}
