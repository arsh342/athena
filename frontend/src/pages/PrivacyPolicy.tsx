export function PrivacyPolicyPage() {
  return (
    <div className="page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// LEGAL: PRIVACY_POLICY</span>
          <span>001</span>
        </div>
        <span className="eyebrow">Legal</span>
        <div>
          <h1>Privacy Policy</h1>
          <p>How athena collects, processes, stores, and protects personal and technical data.</p>
        </div>
      </section>

      <section className="panel" style={{ display: 'grid', gap: '20px' }}>
        <p><strong>Last updated:</strong> April 20, 2026</p>

        <div>
          <h2>1. Scope</h2>
          <p>
            This Privacy Policy applies to athena web, backend services, and related scan/report endpoints.
            It describes data handling for account authentication, route access, and operational security.
          </p>
        </div>

        <div>
          <h2>2. Data We Collect</h2>
          <p>We collect data required to operate, secure, and improve the service:</p>
          <ul style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
            <li>Account data: email address and password hash.</li>
            <li>Session data: access/refresh token hashes, expiration, revocation timestamps.</li>
            <li>Usage/diagnostic data: authentication failures, lockout events, and basic API error logs.</li>
            <li>Scan input metadata: repository URL submitted by user for scan execution.</li>
          </ul>
        </div>

        <div>
          <h2>3. How We Use Data</h2>
          <ul style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
            <li>Authenticate users and maintain secure sessions.</li>
            <li>Protect platform against abuse, brute-force attempts, and unauthorized access.</li>
            <li>Operate scan workflows and render findings/report interfaces.</li>
            <li>Troubleshoot incidents and improve reliability.</li>
          </ul>
        </div>

        <div>
          <h2>4. Legal Basis</h2>
          <p>
            Processing is based on contract performance (service operation), legitimate interests (security,
            abuse prevention), and compliance obligations where applicable.
          </p>
        </div>

        <div>
          <h2>5. Data Sharing</h2>
          <p>
            We do not sell personal data. Data is shared only with infrastructure providers necessary
            to run service components, and only to extent required for hosting, storage, and logging.
          </p>
        </div>

        <div>
          <h2>6. Security Controls</h2>
          <ul style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
            <li>Passwords stored as one-way bcrypt hashes.</li>
            <li>Session tokens stored as hashes and revocable server-side.</li>
            <li>Cookie protections using httpOnly/secure/sameSite policies.</li>
            <li>Account lockout controls on repeated failed login attempts.</li>
          </ul>
        </div>

        <div>
          <h2>7. Retention</h2>
          <p>
            We retain account and session data while account remains active and for limited periods
            required for security and operational integrity. Expired or revoked session records may
            be removed during maintenance cycles.
          </p>
        </div>

        <div>
          <h2>8. User Rights</h2>
          <p>
            Subject to local law, you may request access, correction, export, or deletion of personal data.
            You may also request account closure and session revocation.
          </p>
        </div>

        <div>
          <h2>9. International Transfers</h2>
          <p>
            If infrastructure spans multiple regions, data may be processed outside your country.
            We apply contractual and technical safeguards where required.
          </p>
        </div>

        <div>
          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this policy for legal, technical, or product changes.
            Material updates will be reflected with a new “Last updated” date.
          </p>
        </div>

        <div>
          <h2>11. Contact</h2>
          <p>
            For privacy questions, account deletion requests, or data rights inquiries,
            contact your athena project administrator.
          </p>
        </div>
      </section>
    </div>
  );
}
