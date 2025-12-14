'use client';

import React from 'react';
import styles from './ReportView.module.css';
import { Report } from '@/lib/accessibility/types';
import { generatePdfReport } from '@/utils/generatePdf';

interface ReportViewProps {
    report: Report;
    onReset: () => void;
}

export default function ReportView({ report, onReset }: ReportViewProps) {
    const getScoreColor = (score: number) => {
        if (score >= 90) return 'var(--success)';
        if (score >= 50) return 'var(--warning)';
        return 'var(--error)';
    };

    return (
        <div className={`${styles.container} fade-in`}>
            <div className={styles.header}>
                <button className="btn btn-outline" onClick={onReset}>
                    ← Wgraj inny plik
                </button>
                <button
                    className="btn btn-primary"
                    onClick={() => generatePdfReport(report)}
                >
                    Pobierz Raport PDF
                </button>
            </div>

            <div className={styles.scoreCard}>
                <div
                    className={styles.scoreValue}
                    style={{ color: getScoreColor(report.complianceScore) }}
                >
                    {report.passedChecks}/{report.totalChecks}
                </div>
                <div className={styles.scoreLabel}>Wynik Zgodności (Punkty)</div>
                <div style={{ marginTop: '0.5rem', color: '#64748b', fontSize: '0.9rem' }}>
                    Plik: {report.fileName} • {report.complianceScore}%
                </div>
            </div>

            <h3 className={styles.sectionTitle}>Wyniki Analizy</h3>

            <div className={styles.violationList}>
                {report.violations.map((v, idx) => (
                    <div key={idx} className={`${styles.violationItem} ${styles[`status-${v.status}`]}`}>
                        <div className={`badge ${styles.badge} ${styles[`badge-${v.status}`]}`}>
                            {v.status === 'pass' ? 'ZALICZONE' : v.status === 'fail' ? 'BŁĄD' : v.status === 'warning' ? 'OSTRZEŻENIE' : 'RĘCZNE'}
                        </div>

                        <div className={styles.content}>
                            <div className={styles.criterion}>WCAG {v.wcagCriterion} • {v.impact === 'critical' ? 'Krytyczny' : v.impact === 'serious' ? 'Poważny' : v.impact === 'moderate' ? 'Średni' : 'Niski'} Wpływ</div>
                            <div className={styles.description}>{v.description}</div>
                            <div className={styles.help}>{v.help}</div>
                            {v.details && (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#94a3b8' }}>
                                    Szczegóły: {v.details}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
