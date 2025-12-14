'use client';

import React, { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import ReportView from '@/components/ReportView';
import { checkDocx } from '@/lib/accessibility/docxChecker';
import { checkPdf } from '@/lib/accessibility/pdfChecker'; // Imported directly, we will handle dynamic import if needed or rely on nextjs optimization
// Note: Keeping dynamic import for pdf inside function is safer for SSR
import { Report } from '@/lib/accessibility/types';

export default function Home() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    try {
      let result: Report;
      if (file.type === 'application/pdf') {
        // Dynamic import to avoid SSR issues with pdfjs-dist
        const { checkPdf } = await import('@/lib/accessibility/pdfChecker');
        result = await checkPdf(file);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        result = await checkDocx(file);
      } else {
        throw new Error('Unsupported file type');
      }
      setReport(result);
    } catch (err: any) {
      console.error(err);
      setError('Failed to analyze document. Please ensure it is a valid file. ' + (err.message || ''));
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setReport(null);
    setError(null);
  };

  return (
    <main style={{ minHeight: '100vh', padding: '2rem 1rem', background: 'white' }}>
      <div className="container" style={{ maxWidth: '960px', margin: '0 auto' }}>
        {/* Official Header Strip */}
        <div style={{ borderBottom: '1px solid #e0e0e0', paddingBottom: '1rem', marginBottom: '2rem' }}>


          <h1 style={{ fontSize: '2.2rem', color: '#0b0c10', margin: '1rem 0 0.5rem 0' }}>
            Weryfikacja Dostępności Cyfrowej
          </h1>
          <p style={{ color: '#555', fontSize: '1.1rem' }}>
            Narzędzie pomocnicze do weryfikacji dokumentów pod kątem WCAG 2.1
          </p>
        </div>

        {error && (
          <div style={{ padding: '1rem', background: '#ffebee', color: '#c62828', borderLeft: '4px solid #d32f2f', marginBottom: '2rem' }}>
            <strong>Błąd:</strong> {error}
          </div>
        )}

        {!report ? (
          <div className="fade-in" style={{ maxWidth: '100%', margin: '0 0' }}>

            <div style={{ background: '#f0f7ff', border: '1px solid #d0e4f7', padding: '1.5rem', marginBottom: '2rem' }}>
              <p style={{ margin: 0, color: '#004d9d', fontWeight: '600' }}>
                System obsługuje pliki PDF oraz DOCX. Maksymalny rozmiar pliku: 10MB.
              </p>
            </div>

            <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />

            <div style={{ marginTop: '3rem', padding: '0', background: 'transparent' }}>
              <h3 style={{ fontSize: '1.25rem', borderBottom: '2px solid #004d9d', paddingBottom: '0.5rem', display: 'inline-block', marginBottom: '1.5rem' }}>
                Zakres weryfikacji
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div>
                  <h4 style={{ fontSize: '1rem', color: '#333' }}>Dokumenty Tekstowe (DOCX)</h4>
                  <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem', color: '#555', lineHeight: '1.8' }}>
                    <li>Tytuł dokumentu</li>
                    <li>Język treści</li>
                    <li>Struktura nagłówków</li>
                    <li>Teksty alternatywne obrazów</li>
                  </ul>
                </div>
                <div>
                  <h4 style={{ fontSize: '1rem', color: '#333' }}>Dokumenty PDF</h4>
                  <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem', color: '#555', lineHeight: '1.8' }}>
                    <li>Metadane (Tytuł, Język)</li>
                    <li>Tagi strukturalne (Tagged PDF)</li>
                    <li>Teksty alternatywne (Figury)</li>
                    <li>Obecność warstwy tekstowej (OCR)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <ReportView report={report} onReset={reset} />
        )}
      </div>

      <footer style={{ marginTop: '5rem', borderTop: '1px solid #eee', padding: '2rem 0', color: '#777', fontSize: '0.85rem' }}>
        <div className="container" style={{ maxWidth: '960px' }}>
          <p>Aplikacja zgodna ze standardami dostępności.</p>
        </div>
      </footer>
    </main>
  );
}
