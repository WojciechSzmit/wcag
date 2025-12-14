import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { Report, Violation, Status } from './types';

export async function checkDocx(file: File): Promise<Report> {
    const violations: Violation[] = [];
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 1. Meta Data Check (Title) - WCAG 2.4.2 Page Titled
    const corePropsFile = zip.file('docProps/core.xml');
    let title = '';
    let author = '';
    let createdAt = '';

    if (corePropsFile) {
        const xml = await corePropsFile.async('text');
        const result = await parseStringPromise(xml);
        const core = result['cp:coreProperties'];

        title = core['dc:title']?.[0] || '';
        author = core['dc:creator']?.[0] || '';
        createdAt = core['dcterms:created']?.[0]?._ || '';

        if (!title || title.trim().length === 0) {
            violations.push({
                id: 'meta-title',
                wcagCriterion: '2.4.2',
                description: 'Tytuł dokumentu nie został znaleziony',
                help: 'Dodaj tytuł we właściwościach dokumentu w Word (Plik > Informacje).',
                impact: 'serious',
                status: 'fail',
            });
        } else {
            violations.push({
                id: 'meta-title',
                wcagCriterion: '2.4.2',
                description: 'Tytuł dokumentu jest obecny',
                help: 'Dobra robota!',
                impact: 'moderate',
                status: 'pass',
                details: `Znaleziony tytuł: "${title}"`
            });
        }
    } else {
        violations.push({
            id: 'meta-title',
            wcagCriterion: '2.4.2',
            description: 'Nie udało się odczytać właściwości dokumentu',
            help: 'Upewnij się, że plik to poprawny DOCX.',
            impact: 'serious',
            status: 'fail',
        });
    }

    // 2. Language & Style Analysis
    const stylesFile = zip.file('word/styles.xml');
    let langFound = false;
    // Map of StyleID -> Heading Level (1-6)
    const headingStyles = new Map<string, number>();

    if (stylesFile) {
        const xml = await stylesFile.async('text');

        if (xml.includes('w:lang')) {
            langFound = true;
        }

        try {
            const stylesResult = await parseStringPromise(xml);
            const styles = stylesResult?.['w:styles']?.['w:style'] || [];
            const styleArray = Array.isArray(styles) ? styles : [styles];

            styleArray.forEach((style: any) => {
                const styleId = style.$?.['w:styleId'];
                const nameVal = (style['w:name']?.[0]?.$?.['w:val'] || '').toLowerCase();
                const basedOn = (style['w:basedOn']?.[0]?.$?.['w:val'] || '').toLowerCase();

                // Regex matches to find level
                const nameMatch = nameVal.match(/(?:heading|nag[lł]ówek)\s*([1-6])/i);
                const idMatch = (styleId || '').match(/heading([1-6])/i);

                let level = 0;
                if (nameMatch) {
                    level = parseInt(nameMatch[1], 10);
                } else if (idMatch) {
                    level = parseInt(idMatch[1], 10);
                } else if (nameVal === 'tytuł' || nameVal === 'title') {
                    // Treat Title/Tytuł sort of like H1 for detection, but usually it's separate. 
                    // Let's treat it as H1 for hierarchy purposes if it acts as a main header.
                    level = 1;
                }

                if (styleId && level > 0) {
                    headingStyles.set(styleId, level);
                }
            });
        } catch (e) {
            console.warn('Failed to parse styles.xml', e);
        }
    }

    if (langFound) {
        violations.push({
            id: 'meta-lang',
            wcagCriterion: '3.1.1',
            description: 'Atrybut języka wykryty w stylach',
            help: 'Upewnij się, że ustawiony jest poprawny język treści.',
            impact: 'moderate',
            status: 'pass',
        });
    } else {
        violations.push({
            id: 'meta-lang',
            wcagCriterion: '3.1.1',
            description: 'Nie znaleziono definicji języka',
            help: 'Sprawdź ustawienia języka w Word.',
            impact: 'moderate',
            status: 'warning',
        });
    }


    // 3. Headings & Structure - WCAG 1.3.1
    const documentFile = zip.file('word/document.xml');
    let hasHeadings = false;
    let hasImages = false;
    let imagesMissingAlt = 0;
    let hierarchyErrors: string[] = [];

    if (documentFile) {
        const xml = await documentFile.async('text');
        const result = await parseStringPromise(xml);

        // Traverse Paragraphs
        const body = result?.['w:document']?.['w:body']?.[0];
        const paragraphs = body?.['w:p'] || [];

        let lastLevel = 0;

        // Ensure array
        const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

        pArray.forEach((p: any) => {
            const pStyle = p['w:pPr']?.[0]?.['w:pStyle']?.[0]?.$?.['w:val'];

            if (pStyle && headingStyles.has(pStyle)) {
                hasHeadings = true;
                const currentLevel = headingStyles.get(pStyle) || 0;

                // Check Hierarchy: Cannot skip level (e.g. 1 -> 3)
                // However, 1 -> 2 is OK. 2 -> 3 is OK. 2 -> 2 is OK. 2 -> 1 is OK.
                // Rule: current <= last + 1

                // Exception: The very first heading can be anything (usually H1), but strict WCAG often suggests starting with H1.
                // We'll be lenient: just check skips.
                // If lastLevel is 0 (start), we accept any starting level (though H1 is best practice).

                if (lastLevel > 0 && currentLevel > lastLevel + 1) {
                    hierarchyErrors.push(`Pominięto poziom nagłówka: z H${lastLevel} na H${currentLevel}`);
                }

                lastLevel = currentLevel;
            }
        });

        // 4. Images & Alt Text check (Regex fallback as it was working well and faster for attrs)
        const imgTags = xml.match(/<wp:docPr[^>]*>/g) || [];
        hasImages = imgTags.length > 0;
        imgTags.forEach(tag => {
            const hasDescr = /descr="[^"]+"/.test(tag) && !/descr=""/.test(tag) && !/descr="\s*"/.test(tag);
            const hasTitle = /title="[^"]+"/.test(tag);
            if (!hasDescr && !hasTitle) {
                imagesMissingAlt++;
            }
        });
    }

    if (hasHeadings) {
        violations.push({
            id: 'structure-headings',
            wcagCriterion: '1.3.1',
            description: 'Wykryto nagłówki',
            help: 'Znaleziono strukturę nagłówków.',
            impact: 'serious',
            status: 'pass',
        });

        if (hierarchyErrors.length === 0) {
            violations.push({
                id: 'heading-order',
                wcagCriterion: '1.3.1',
                description: 'Zachowano poprawną hierarchię nagłówków',
                help: 'Nagłówki następują po sobie w dobrej kolejności (np. H1 -> H2).',
                impact: 'moderate',
                status: 'pass',
            });
        } else {
            violations.push({
                id: 'heading-order',
                wcagCriterion: '1.3.1',
                description: `Błędy w hierarchii nagłówków (${hierarchyErrors.length})`,
                help: 'Nie pomijaj poziomów nagłówków (np. nie skacz z H1 od razu do H3).',
                impact: 'serious',
                status: 'warning',
                details: hierarchyErrors.slice(0, 5).join(', ') + (hierarchyErrors.length > 5 ? '...' : '')
            });
        }

    } else {
        violations.push({
            id: 'structure-headings',
            wcagCriterion: '1.3.1',
            description: 'Nie wykryto stylów nagłówków',
            help: 'Używaj stylów (Nagłówek 1, 2 itp.) w Wordzie.',
            impact: 'serious',
            status: 'fail',
        });
    }

    if (hasImages) {
        if (imagesMissingAlt === 0) {
            violations.push({
                id: 'images-alt',
                wcagCriterion: '1.1.1',
                description: 'Wszystkie obrazy mają tekst alternatywny',
                help: 'Świetnie.',
                impact: 'critical',
                status: 'pass',
            });
        } else {
            violations.push({
                id: 'images-alt',
                wcagCriterion: '1.1.1',
                description: `Znaleziono ${imagesMissingAlt} obrazów bez tekstu alternatywnego`,
                help: 'Edytuj tekst alternatywny w Wordzie.',
                impact: 'critical',
                status: 'fail',
            });
        }
    } else {
        violations.push({
            id: 'images-alt',
            wcagCriterion: '1.1.1',
            description: 'Nie znaleziono obrazów',
            help: 'Brak obrazów do sprawdzenia.',
            impact: 'minor',
            status: 'pass',
        });
    }

    const failCount = violations.filter(v => v.status === 'fail').length;
    const passCount = violations.filter(v => v.status === 'pass').length;
    const total = violations.length;
    const score = total === 0 ? 100 : Math.round((passCount / total) * 100);

    return {
        fileName: file.name,
        fileType: 'docx',
        complianceScore: score,
        passedChecks: passCount,
        totalChecks: total,
        violations,
        metadata: {
            title,
            author,
            createdAt
        }
    };
}
