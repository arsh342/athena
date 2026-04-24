export function TermsPage() {
  return (
    <div className="page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// LEGAL: TERMS_OF_SERVICE</span>
          <span>001</span>
        </div>
        <span className="eyebrow">Legal</span>
        <div>
          <h1>Terms of Service</h1>
          <p>Terms governing access to and use of athena services, interfaces, and scan endpoints.</p>
        </div>
      </section>

      <section className="panel" style={{ display: 'grid', gap: '20px' }}>
        <p><strong>Last updated:</strong> April 20, 2026</p>

        <div>
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using athena, you agree to these Terms of Service and related policies.
            If you do not agree, do not use the service.
          </p>
        </div>

        <div>
          <h2>2. Eligibility and Authority</h2>
          <p>
            You represent that you are legally capable of entering these terms and are authorized to
            submit repositories and data for scanning.
          </p>
        </div>

        <div>
          <h2>3. Account Responsibilities</h2>
          <ul style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
            <li>Provide accurate registration information and keep it current.</li>
            <li>Maintain confidentiality of credentials and session access.</li>
            <li>Promptly report suspected unauthorized account activity.</li>
            <li>You are responsible for activity occurring under your account.</li>
          </ul>
        </div>

        <div>
          <h2>4. Permitted Use</h2>
          <p>You may use athena for lawful security and quality analysis of code you own or are authorized to assess.</p>
        </div>

        <div>
          <h2>5. Prohibited Conduct</h2>
          <ul style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
            <li>Scanning repositories without explicit authorization.</li>
            <li>Attempting to bypass authentication, rate limits, or security controls.</li>
            <li>Uploading malicious payloads or attempting to disrupt platform operations.</li>
            <li>Using service output for unlawful surveillance or exploitation.</li>
          </ul>
        </div>

        <div>
          <h2>6. Service Availability and Changes</h2>
          <p>
            Features may change, be updated, or be discontinued at any time. We may perform maintenance
            that temporarily affects availability.
          </p>
        </div>

        <div>
          <h2>7. Intellectual Property</h2>
          <p>
            athena software, branding, and associated materials are protected by applicable intellectual
            property laws. Except as explicitly granted, no license is transferred by use of service.
          </p>
        </div>

        <div>
          <h2>8. Customer Data and Content</h2>
          <p>
            You retain rights to your repositories and submitted content. You grant rights necessary for
            athena to process submitted data solely to provide requested functionality.
          </p>
        </div>

        <div>
          <h2>9. Disclaimers</h2>
          <p>
            Service is provided on an "as is" and "as available" basis. We do not guarantee uninterrupted
            operation, complete accuracy of findings, or fitness for a specific purpose.
          </p>
        </div>

        <div>
          <h2>10. Limitation of Liability</h2>
          <p>
            To maximum extent permitted by law, athena and its operators are not liable for indirect,
            incidental, special, consequential, or punitive damages arising from use or inability to use service.
          </p>
        </div>

        <div>
          <h2>11. Indemnification</h2>
          <p>
            You agree to defend and indemnify athena against claims arising from your misuse of service,
            unauthorized scanning, or violation of these terms.
          </p>
        </div>

        <div>
          <h2>12. Suspension and Termination</h2>
          <p>
            We may suspend or terminate access for violations, abuse indicators, or security risk.
            You may stop using service at any time.
          </p>
        </div>

        <div>
          <h2>13. Governing Law</h2>
          <p>
            These terms are governed by applicable local law as determined by your deployment or contractual
            environment, unless superseded by a written agreement.
          </p>
        </div>

        <div>
          <h2>14. Changes to Terms</h2>
          <p>
            We may revise these terms. Continued use after updates indicates acceptance of revised terms.
          </p>
        </div>

        <div>
          <h2>15. Contact</h2>
          <p>
            For legal notices or terms questions, contact your athena project administrator.
          </p>
        </div>
      </section>
    </div>
  );
}
