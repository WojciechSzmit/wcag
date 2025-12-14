'use client';

import React, { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import ReportView from '@/components/ReportView';
import { checkDocx } from '@/lib/accessibility/docxChecker';
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
        // Dynamically import scanner to avoid SSR build issues with pdfjs-dist
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
    <main style={{ minHeight: '100vh', padding: '2rem' }}>
      <div className="container">
        <header style={{ textAlign: 'center', marginBottom: '4rem', marginTop: '2rem' }}>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', background: 'linear-gradient(to right, #60a5fa, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Sprawdzanie Dostępności WCAG
          </h1>
          <p style={{ color: '#94a3b8' }}>
            Wgraj plik PDF lub DOCX, aby sprawdzić zgodność z WCAG 2.1.
          </p>
        </header>

        {error && (
          <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '0.5rem', marginBottom: '2rem', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {!report ? (
          <div className="fade-in" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />
            <div style={{ marginTop: '2rem', fontSize: '0.875rem', color: '#64748b', textAlign: 'center' }}>
              <p>Sprawdzane elementy:</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                <span>✓ Metadane</span>
                <span>✓ Nagłówki</span>
                <span>✓ Tekst Alternatywny</span>
                <span>✓ Język</span>
              </div>
            </div>
          </div>
        ) : (
          <ReportView report={report} onReset={reset} />
        )}
      </div>
    </main>
  );
}
