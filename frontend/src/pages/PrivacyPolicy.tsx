export function PrivacyPolicyPage() {
  return (
    <div className="page">
      <section className="page-head">
        <span className="kicker">Legal</span>
        <h1>Privacy <span className="fx-muted">Policy</span></h1>
        <p>What athena collects, what it does with it, and where it goes. The command-line tool and the website are different, so they are described separately.</p>
      </section>

      <section className="prose">
        <p><strong>Last updated:</strong> November 20, 2026</p>

        <div>
          <h2>1. Scope</h2>
          <p>
            This policy covers the athena website and its backend: sign-in, scans you start from the browser, saved reports,
            and the optional AI check. The command-line tool (<code>@arsh342/athena</code>) runs on your own machine and is covered in section 9.
          </p>
        </div>

        <div>
          <h2>2. What we collect</h2>
          <ul>
            <li><strong>Account:</strong> your email address and, if you register with a password, a bcrypt hash of it. If you sign in with Google or GitHub, we receive your email address and that provider's account identifier, and no password.</li>
            <li><strong>Sessions:</strong> hashed access and refresh tokens with their expiry and revocation times, so a session can be ended on the server.</li>
            <li><strong>Security events:</strong> failed sign-ins and account lockouts, and basic error logs.</li>
            <li><strong>What you scan:</strong> the repository address you submit, or the folder or zip file you upload (up to 200MB).</li>
            <li><strong>Scan results:</strong> findings with their file path, line number, the flagged line of code, severity and explanation; coverage and AI-provenance figures; the dependency list found in the project; a redacted Markdown report; and the terminal output of the scan. Secrets are masked before they are stored.</li>
            <li><strong>AI check results, if you used it:</strong> which provider and model ran, how many findings it checked and what it cost, and for each finding its verdict, the reason and the lines it cited. Never your key (see section 5).</li>
          </ul>
        </div>

        <div>
          <h2>3. How we use it</h2>
          <ul>
            <li>To sign you in, keep you signed in, and protect accounts from guessing and abuse.</li>
            <li>To run your scans and show you the findings, reports and history.</li>
            <li>To tell you when a vulnerability is published for a package in one of your saved scans: a daily job compares each saved dependency list with public advisory data.</li>
            <li>To find and fix faults in the service.</li>
          </ul>
          <p>We do not sell your data, use it for advertising, or use your code to train models.</p>
        </div>

        <div>
          <h2>4. Your code during a scan</h2>
          <ul>
            <li>A repository is cloned, and an upload is unpacked, into a temporary folder that is deleted when the scan ends, whether it succeeded or failed.</li>
            <li>To check dependencies, the scan sends package names and versions (not your code) to public vulnerability and package-registry services. Packages that look private are not looked up.</li>
            <li>Only scan code you are allowed to scan. Findings are saved to your account as described in section 2.</li>
          </ul>
        </div>

        <div>
          <h2>5. The optional AI check and your API key</h2>
          <p>
            The AI check is off unless you turn it on in Settings with your own provider key. When it is on, short excerpts of code around the findings
            athena could not settle itself are sent to the provider you chose (for example Anthropic, OpenAI, Google, Groq or OpenRouter), under that provider's own
            terms and privacy policy. Secrets and dependency findings are never sent. Settings shows exactly what will be sent and asks you to agree first.
          </p>
          <ul>
            <li>The key stays in your browser tab only (it is gone when you close the tab) and travels only with a scan you start with the AI check on.</li>
            <li>On our servers it is held in memory for that one scan. It is not written to the database, to reports, or to logs.</li>
            <li>You set a spend cap before each scan, and athena stops when the next call could exceed it. We do not see or control your provider account.</li>
          </ul>
        </div>

        <div>
          <h2>6. Cookies and browser storage</h2>
          <ul>
            <li>Two cookies keep you signed in (<code>athena_access_token</code> and <code>athena_refresh_token</code>, httpOnly), and a short-lived one (<code>athena_oauth_verifier</code>, about ten minutes) completes Google or GitHub sign-in.</li>
            <li>Your browser also stores your session tokens locally so the page can call the API and the terminal can connect.</li>
            <li>AI settings are kept in session storage (this tab only).</li>
            <li>There are no advertising or analytics cookies.</li>
          </ul>
        </div>

        <div>
          <h2>7. Who else handles data</h2>
          <p>
            Only the services needed to run athena: our hosting and database providers (currently Render and Supabase), Google or GitHub if you use them to sign in,
            GitHub when you scan a repository from there, public vulnerability and package-registry services for dependency checks, and the AI provider you choose
            if you use the AI check. We do not sell personal data.
          </p>
        </div>

        <div>
          <h2>8. Security, retention and your rights</h2>
          <ul>
            <li>Passwords are stored as one-way hashes, session tokens as hashes that can be revoked, cookies are httpOnly with secure and same-site settings in production, and repeated failed sign-ins lock the account for a while.</li>
            <li>Account, session and scan data are kept until you ask us to delete them. Nothing expires on its own, and there is not yet a delete button in the app. Closing an account removes its scans, findings and reports.</li>
            <li>Subject to your local law, you can ask for access to, correction of, export of or deletion of your data, and ask us to end your sessions. Send the request as described in section 11.</li>
            <li>If our systems span regions, data may be processed outside your country.</li>
          </ul>
        </div>

        <div>
          <h2>9. The command-line tool</h2>
          <p>
            The CLI, git hooks, MCP server and Claude Code plugin run on your machine. Scans, findings and the trained detector run locally, and nothing about your code is
            sent anywhere unless you pass <code>--ai</code>, in which case section 5 applies, with your key kept in <code>~/.athena</code> (mode 0600). It keeps its own state
            in <code>~/.athena</code> (scan history, learned labels as hashes and numbers, caches). It downloads public advisory data and rule packs, and looks up package
            names and versions for dependency checks (turn that off with <code>--no-deps</code> or <code>--offline</code>). It does not send us usage data.
          </p>
        </div>

        <div>
          <h2>10. Changes to this policy</h2>
          <p>
            We update this page when the product or the law changes. Material changes get a new "Last updated" date.
          </p>
        </div>

        <div>
          <h2>11. Contact</h2>
          <p>
            For privacy questions or to exercise your rights, open an issue at <a href="https://github.com/arsh342/athena/issues" target="_blank" rel="noopener noreferrer">github.com/arsh342/athena/issues</a>
            (do not post personal data there) or contact your athena project administrator.
          </p>
        </div>
      </section>
    </div>
  );
}
