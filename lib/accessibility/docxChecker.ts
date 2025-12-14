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
    const headingStyleIds = new Set<string>();

    if (stylesFile) {
        const xml = await stylesFile.async('text');

        // Check for Language definition
        if (xml.includes('w:lang')) {
            langFound = true;
        }

        // Deep Heading Check: Parse styles.xml to find Style IDs that map to Headings
        try {
            const stylesResult = await parseStringPromise(xml);
            const styles = stylesResult?.['w:styles']?.['w:style'] || [];

            // Normalize potential array/single object structure from xml2js if simplified
            const styleArray = Array.isArray(styles) ? styles : [styles];

            styleArray.forEach((style: any) => {
                const styleId = style.$?.['w:styleId'];
                // Check name w:val
                const nameNode = style['w:name'];
                const nameVal = (Array.isArray(nameNode) ? nameNode[0] : nameNode)?.$?.['w:val']?.toLowerCase() || '';

                // Check basedOn w:val
                const basedOnNode = style['w:basedOn'];
                const basedOn = (Array.isArray(basedOnNode) ? basedOnNode[0] : basedOnNode)?.$?.['w:val']?.toLowerCase() || '';

                // Check if this style represents a heading
                // 1. Name matches Heading X / Nagłówek X / Tytuł (localized)
                // 2. BasedOn matches Heading X
                // 3. StyleID itself looks like Heading X

                const isHeadingName = /heading\s*[0-9]|nag[lł]ówek\s*[0-9]|tytuł/i.test(nameVal);
                const isHeadingBasedOn = /heading\s*[0-9]|nag[lł]ówek/i.test(basedOn);
                const isHeadingId = /heading[0-9]/i.test(styleId || '');

                if (styleId && (isHeadingName || isHeadingBasedOn || isHeadingId)) {
                    headingStyleIds.add(styleId);
                }
            });
        } catch (e) {
            console.warn('Failed to parse styles.xml for headings', e);
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


    // 3. Headings & Structure - WCAG 1.3.1 Info and Relationships
    const documentFile = zip.file('word/document.xml');
    let hasHeadings = false;
    let hasImages = false;
    let imagesMissingAlt = 0;

    if (documentFile) {
        const xml = await documentFile.async('text');

        // We check if any of the identified `headingStyleIds` are used in <w:pStyle w:val="ID"/>
        if (headingStyleIds.size > 0) {
            for (const id of Array.from(headingStyleIds)) {
                // Construct regex to find exact style usage: w:val="StyleID"
                // IDs in XML attributes are case-sensitive usually
                // Escape special regex chars in ID just in case
                const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                const regex = new RegExp(`w:val=["']${escapedId}["']`, 'i');
                if (regex.test(xml)) {
                    hasHeadings = true;
                    break;
                }
            }
        }

        // Fallback: If style parsing failed or return 0, try the raw regexes again
        if (!hasHeadings) {
            const fallbackRegex = /w:val=["'](Heading|Nagłówek|Naglowek|Tytuł)\s*[0-9]+["']|w:val=["']Heading[0-9]+["']/i;
            if (fallbackRegex.test(xml)) {
                hasHeadings = true;
            }
        }

        // 4. Images & Alt Text - WCAG 1.1.1 Non-text Content
        // Images are <wp:inline> or <wp:anchor> usually containing <wp:docPr> with descr or title attributes
        // <wp:docPr id="1" name="Picture 1" descr="A cat sitting on a mat"/>

        // Let's rely on regex for finding <wp:docPr ... /> tags
        const imgTags = xml.match(/<wp:docPr[^>]*>/g) || [];
        hasImages = imgTags.length > 0;

        imgTags.forEach(tag => {
            // Check for descr or description (older word versions might use different attrs, but descr is common in wp:docPr)
            const hasDescr = /descr="[^"]+"/.test(tag) && !/descr=""/.test(tag) && !/descr="\s*"/.test(tag);
            const hasTitle = /title="[^"]+"/.test(tag);
            // Some newer Office version use 'name' as title if no other attr, but let's stick to standard accessibility fields

            // If it lacks both, it's likely missing alt text.
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
            help: 'Dobrze, że używasz stylów nagłówków.',
            impact: 'serious',
            status: 'pass',
        });
    } else {
        violations.push({
            id: 'structure-headings',
            wcagCriterion: '1.3.1',
            description: 'Nie wykryto stylów nagłówków',
            help: 'Używaj stylów (Nagłówek 1, 2 itp.) w Wordzie, aby nadać strukturę, a nie tylko pogrubienie.',
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
                help: 'Upewnij się, że tekst jest sensowny.',
                impact: 'critical',
                status: 'pass',
            });
        } else {
            violations.push({
                id: 'images-alt',
                wcagCriterion: '1.1.1',
                description: `Znaleziono ${imagesMissingAlt} obrazów bez tekstu alternatywnego`,
                help: 'Kliknij prawym przyciskiem obraz w Word > Edytuj tekst alternatywny.',
                impact: 'critical',
                status: 'fail',
            });
        }
    } else {
        violations.push({
            id: 'images-alt',
            wcagCriterion: '1.1.1',
            description: 'Nie znaleziono obrazów',
            help: 'Jeśli dodasz obrazy, pamiętaj o tekście alternatywnym.',
            impact: 'minor',
            status: 'pass', // Passing because if no images, no violation
        });
    }

    // Calculate score
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
