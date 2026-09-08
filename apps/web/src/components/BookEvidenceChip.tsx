import {
  evidenceBadgeTone,
  evidenceHint,
  evidenceLabel,
  resolveRowEvidence,
  type BookEntry,
} from '../lib/agentBook';

interface BookEvidenceChipProps {
  row: BookEntry;
}

export default function BookEvidenceChip({ row }: BookEvidenceChipProps) {
  const evidence = resolveRowEvidence(row);
  const tone = evidenceBadgeTone(evidence);
  const className = tone === 'danger'
    ? 'badge book-evidence-chip book-evidence-danger'
    : `badge book-evidence-chip badge-${tone}`;

  return (
    <span className={className} title={evidenceHint(evidence)}>
      {evidenceLabel(evidence)}
    </span>
  );
}
