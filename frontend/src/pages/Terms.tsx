export function TermsPage() {
  return (
    <div className="page">
      <section className="page-head">
        <span className="kicker">Legal</span>
        <h1>Terms of <span className="fx-muted">Service</span></h1>
        <p>The rules for using the athena website and its scan services. The command-line tool is open-source software under its own licence (section 8).</p>
      </section>

      <section className="prose">
        <p><strong>Last updated:</strong> November 20, 2026</p>

        <div>
          <h2>1. Acceptance of terms</h2>
          <p>
            By using athena you agree to these terms and to the Privacy Policy. If you do not agree, do not use the service.
          </p>
        </div>

        <div>
          <h2>2. Eligibility and authority</h2>
          <p>
            You must be able to enter a binding agreement, and you must have the right to submit anything you scan, whether that is a repository address, a folder or a zip file.
          </p>
        </div>

        <div>
          <h2>3. Your account</h2>
          <ul>
            <li>Give accurate registration details and keep them current.</li>
            <li>Keep your password and sessions confidential, and report suspected unauthorized use promptly.</li>
            <li>You are responsible for what happens under your account.</li>
          </ul>
        </div>

        <div>
          <h2>4. Permitted use</h2>
          <p>You may use athena for lawful security and quality review of code you own or are authorized to assess.</p>
        </div>

        <div>
          <h2>5. Prohibited conduct</h2>
          <ul>
            <li>Scanning code or repositories you are not authorized to assess.</li>
            <li>Trying to get around sign-in, rate limits, spend caps or other security controls.</li>
            <li>Uploading malicious files, or anything meant to disrupt the service or the hosts it runs on.</li>
            <li>Using an API key you are not entitled to use, or using the AI check in breach of your provider's terms.</li>
            <li>Using results to harass or surveil people, or to attack systems you do not own.</li>
          </ul>
        </div>

        <div>
          <h2>6. The AI check and your provider key</h2>
          <ul>
            <li>The AI check is optional and uses your own key with your own provider. You agree to that provider's terms, and you are responsible for the charges your key incurs.</li>
            <li>athena asks you to set a spend cap and stops when the next call could exceed it, but the cap is a safeguard, not a guarantee. Provider prices and billing are outside our control.</li>
            <li>Code excerpts you choose to send go to that provider. Do not use it on code you are not allowed to share with them.</li>
          </ul>
        </div>

        <div>
          <h2>7. Results are not guarantees</h2>
          <ul>
            <li>Findings can be wrong or incomplete. A clean report does not mean the code is secure, and a finding is not proof of a vulnerability. Check what matters before you act on it.</li>
            <li>AI-provenance figures are statistical estimates. Recorded history is a floor and the model's estimate is uncertain, so do not use either as evidence of who wrote code, in employment, academic or disciplinary decisions.</li>
            <li>Dependency and advisory data comes from public sources and can be late or wrong.</li>
          </ul>
        </div>

        <div>
          <h2>8. Intellectual property and open-source software</h2>
          <p>
            You keep all rights to your code and to what you submit, and you give athena the right to process it only to provide the service you asked for.
            The athena command-line tool, its detectors and rules are open-source software under the MIT licence published in its repository, and that licence governs
            the software. The athena name and branding remain the property of the project. Nothing else is licensed by using the service.
          </p>
        </div>

        <div>
          <h2>9. Availability and changes</h2>
          <p>
            Features can change or be withdrawn, and the service may be unavailable during maintenance or because of providers we depend on.
            Uploads are limited to 200MB and scans have a time limit.
          </p>
        </div>

        <div>
          <h2>10. Disclaimers</h2>
          <p>
            The service is provided "as is" and "as available", without warranties of any kind. We do not promise uninterrupted operation, accurate or complete results,
            or fitness for a particular purpose.
          </p>
        </div>

        <div>
          <h2>11. Limitation of liability</h2>
          <p>
            To the extent the law allows, athena and its operators are not liable for indirect, incidental, special, consequential or punitive damages,
            or for loss of data, profits or reputation, arising from use of or inability to use the service, including anything resulting from a missed or wrong finding.
          </p>
        </div>

        <div>
          <h2>12. Indemnification</h2>
          <p>
            You agree to defend and indemnify athena against claims arising from your misuse of the service, scanning without authorization, or breach of these terms.
          </p>
        </div>

        <div>
          <h2>13. Suspension and termination</h2>
          <p>
            We may suspend or end access for breaches, signs of abuse, or security risk. You can stop using the service at any time, and you can ask for your account and
            its saved scans to be deleted (see the Privacy Policy).
          </p>
        </div>

        <div>
          <h2>14. Governing law</h2>
          <p>
            These terms are governed by the law that applies to your deployment or agreement with the operator, unless a written agreement says otherwise.
          </p>
        </div>

        <div>
          <h2>15. Changes to these terms</h2>
          <p>
            We may revise these terms and will change the "Last updated" date when we do. Using the service after a change means you accept the revised terms.
          </p>
        </div>

        <div>
          <h2>16. Contact</h2>
          <p>
            For questions about these terms, open an issue at <a href="https://github.com/arsh342/athena/issues" target="_blank" rel="noopener noreferrer">github.com/arsh342/athena/issues</a>
            or contact your athena project administrator.
          </p>
        </div>
      </section>
    </div>
  );
}
