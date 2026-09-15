/** Fit the review pane without mutating the separately persisted user preferences. */
export function fitReviewColumns(paneWidth: number, preferred: {question?: number; value?: number}) {
    const pane = Number.isFinite(paneWidth) ? Math.max(0, Math.floor(paneWidth)) : 0;
    if (pane < 900) {
        const question = Math.floor(pane * 0.3);
        const value = Math.floor(pane * 0.35);
        return {question, value, proposal: pane - question - value};
    }
    const question = Number.isFinite(preferred.question) ? Math.max(160, preferred.question!) : pane * 0.3;
    const value = Number.isFinite(preferred.value) ? Math.max(200, preferred.value!) : pane * 0.35;
    // Scale only the space above each readable minimum, leaving 220 for proposals.
    const extra = question - 160 + value - 200;
    const scale = extra > 0 ? Math.min(1, (pane - 580) / extra) : 1;
    const fittedQuestion = Math.floor(160 + (question - 160) * scale);
    const fittedValue = Math.floor(200 + (value - 200) * scale);
    return {question: fittedQuestion, value: fittedValue, proposal: pane - fittedQuestion - fittedValue};
}
