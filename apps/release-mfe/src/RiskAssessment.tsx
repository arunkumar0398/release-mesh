import type { ReleaseRiskAssessment } from "./api.js";

export function RiskAssessment({ value }: { value: ReleaseRiskAssessment }): React.JSX.Element {
  const { assessment, status } = value;
  const sourceLabel = status === "AVAILABLE"
    ? "GPT-5.6 advisory explanation"
    : "deterministic/rule-based fallback";

  return (
    <section aria-label="Risk assessment" className="risk-assessment">
      <div className="risk-heading">
        <div>
          <p className="eyebrow">Advisory intelligence</p>
          <h2>Risk assessment</h2>
        </div>
        <strong className={`risk-source risk-source-${status.toLowerCase()}`}>{sourceLabel}</strong>
      </div>
      <p className="authority-note">Advisory only. The deterministic gate remains the release authority.</p>

      <div className="risk-grid">
        <article>
          <h3>Root cause</h3>
          <p>{assessment.rootCause}</p>
        </article>
        <article>
          <h3>Confidence</h3>
          <p><strong>{`Confidence: ${assessment.confidence}`}</strong></p>
          <p>{assessment.uncertainty}</p>
        </article>
        <article>
          <h3>Blast radius</h3>
          {assessment.blastRadius.length === 0 ? <p>No registered blast radius was identified.</p> : (
            <ul>
              {assessment.blastRadius.map((impact) => <li key={impact}>{impact}</li>)}
            </ul>
          )}
        </article>
        <article>
          <h3>Compatible remediation</h3>
          <p>{assessment.compatibleRemediation}</p>
        </article>
      </div>

      <div className="risk-detail-grid">
        <div>
          <h3>Evidence links</h3>
          {assessment.evidenceLinks.length === 0 ? <p>No evidence links were added.</p> : (
            <ul>
              {assessment.evidenceLinks.map((link) => (
                <li key={link.artifactId}>
                  <a href={`#artifact-${link.artifactId}`}>{link.explanation}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Verification steps</h3>
          <ol>
            {assessment.verificationSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      </div>
    </section>
  );
}
