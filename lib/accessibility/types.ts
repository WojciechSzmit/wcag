export type Status = 'pass' | 'fail' | 'warning' | 'manual';
export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export interface Violation {
    id: string; // e.g. 'doc-title'
    wcagCriterion: string; // e.g. '2.4.2'
    description: string;
    help: string;
    impact: Impact;
    status: Status;
    details?: string;
}

export interface Report {
    fileName: string;
    fileType: 'pdf' | 'docx';
    complianceScore: number;
    passedChecks: number;
    totalChecks: number;
    violations: Violation[];
    metadata: {
        title?: string;
        language?: string;
        pageCount?: number;
        author?: string;
        createdAt?: string;
    };
}
