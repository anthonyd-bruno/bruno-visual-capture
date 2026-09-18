/** Phase 9: what the self-healer is shown about the live UI — handles, not pixels. No secrets, no source. */
export interface ObservedElement {
  tag: string;
  testId?: string;
  role?: string;
  name?: string;
  text?: string;
  placeholder?: string;
  disabled?: boolean;
  selected?: boolean;
  editor?: boolean;
}
export interface PageObservation {
  at: string;
  modalOpen: boolean;
  /** Visible interactive elements, document order, capped. */
  elements: ObservedElement[];
  truncated: boolean;
  /** Visible text of the main content area (first ~800 chars). */
  text: string;
}

/** Compact, line-oriented rendering for the model (≈ one token per attribute). */
export function formatObservation(o: PageObservation): string {
  const lines: string[] = [];
  lines.push(`modalOpen: ${o.modalOpen}`);
  lines.push(`visible interactive elements (${o.elements.length}${o.truncated ? ', truncated' : ''}):`);
  for (const e of o.elements) {
    const bits = [e.tag];
    if (e.testId) bits.push(`testId=${e.testId}`);
    if (e.role) bits.push(`role=${e.role}`);
    if (e.name) bits.push(`name="${e.name}"`);
    if (e.text && e.text !== e.name) bits.push(`text="${e.text}"`);
    if (e.placeholder) bits.push(`placeholder="${e.placeholder}"`);
    if (e.editor) bits.push('editor');
    if (e.disabled) bits.push('disabled');
    if (e.selected) bits.push('selected');
    lines.push('  ' + bits.join(' '));
  }
  lines.push(`main text: "${o.text}"`);
  return lines.join('\n');
}
