import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/qlix/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Privacy Policy · Qlix",
  description:
    "How Qlix collects, uses, and protects personal data and agent-related information in the Exora ecosystem.",
};

const CONTACT_EMAIL = "privacy@exora.solutions";

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      lastUpdated="August 10, 2026"
      intro="This Privacy Policy explains how Qlix (“we”, “us”, or “our”), the developer console for the Exora ecosystem, collects, uses, stores, and shares information when you use qlix.exora.solutions and related APIs (the “Service”)."
      sections={[
        {
          id: "who-we-are",
          title: "Who we are",
          content: (
            <>
              <p>
                Qlix is operated as part of the Exora platform for AI agent identity
                management (cryptographic identities, DIDs, and verifiable credentials) and
                audit logging. The Service is intended for developers, individuals, and
                organizations that register and operate AI agents.
              </p>
              <p>
                Questions about this policy:{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-[#012F13] underline underline-offset-2 hover:opacity-70"
                >
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </>
          ),
        },
        {
          id: "information-we-collect",
          title: "Information we collect",
          content: (
            <>
              <p>We collect information in these categories:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <span className="font-medium text-[#012F13]/80">Account data</span> —
                  name, email address, password hashes (never plaintext passwords),
                  workspace type (individual or organization), and profile settings.
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Authentication data</span>{" "}
                  — OAuth identifiers when you sign in with Google or GitHub, session
                  cookies, and optional passkey / WebAuthn credentials.
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Organization data</span>{" "}
                  — organization name, membership, roles, team assignments, and invites.
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Agent &amp; identity data</span>{" "}
                  — agent names, DIDs, credential metadata, key material references,
                  permission scopes, and configuration you provide.
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Audit &amp; usage data</span>{" "}
                  — action logs (who did what, when, on whose behalf), API usage, billing
                  events, and connector activity needed to operate the ledger and console.
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Technical data</span> —
                  IP address, browser type, device information, and diagnostic logs
                  collected automatically when you use the Service.
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Payment data</span> —
                  billing contact details and payment status. Card numbers are processed by
                  our payment processor; we do not store full card numbers on our servers.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "how-we-use",
          title: "How we use information",
          content: (
            <>
              <p>We use information to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Provide, secure, and improve the Service</li>
                <li>Authenticate users and enforce role-based access within workspaces</li>
                <li>Register agents, issue and manage credentials, and maintain audit records</li>
                <li>Process billing, usage metering, and plan entitlements</li>
                <li>Communicate about account, security, and product changes</li>
                <li>Detect abuse, investigate incidents, and comply with law</li>
              </ul>
              <p>
                We do not sell your personal information. We do not use your private agent
                content or audit payloads to train general-purpose public AI models.
              </p>
            </>
          ),
        },
        {
          id: "sharing",
          title: "How we share information",
          content: (
            <>
              <p>We may share information with:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <span className="font-medium text-[#012F13]/80">Service providers</span>{" "}
                  that host infrastructure, send email, process payments, or provide
                  observability — under contracts that limit use to providing services to us
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Organization admins</span>{" "}
                  and other members of a workspace you join, according to that
                  organization’s roles and settings
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Legal authorities</span>{" "}
                  when required by law, legal process, or to protect rights, safety, and the
                  integrity of the Service
                </li>
                <li>
                  <span className="font-medium text-[#012F13]/80">Successors</span> in
                  connection with a merger, acquisition, or asset transfer, subject to
                  appropriate confidentiality protections
                </li>
              </ul>
              <p>
                Third-party connectors you authorize (for example email, CRM, or messaging
                integrations) receive only the access you grant. Their privacy practices are
                governed by their own policies.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          title: "Retention",
          content: (
            <p>
              We retain account and workspace data for as long as your account remains
              active and as needed to provide the Service. Audit ledger records may be kept
              for longer where required for security, compliance, billing disputes, or legal
              obligations. When you delete an account or agent, we delete or anonymize
              associated personal data within a reasonable period, except where retention is
              required by law or needed to resolve disputes.
            </p>
          ),
        },
        {
          id: "security",
          title: "Security",
          content: (
            <p>
              We use industry-standard measures appropriate to the sensitivity of the data,
              including encrypted transport (HTTPS), hashed passwords, access controls, and
              least-privilege practices for cryptographic identity material. No method of
              transmission or storage is completely secure; you are responsible for
              safeguarding API keys, private keys, and account credentials under your
              control.
            </p>
          ),
        },
        {
          id: "your-rights",
          title: "Your rights",
          content: (
            <>
              <p>
                Depending on your location, you may have rights to access, correct, delete,
                or export personal data, or to object to or restrict certain processing. To
                exercise these rights, contact{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-[#012F13] underline underline-offset-2 hover:opacity-70"
                >
                  {CONTACT_EMAIL}
                </a>
                . We may need to verify your identity before fulfilling a request.
              </p>
              <p>
                You can update profile information in Settings. Organization members should
                also contact their organization admin for workspace-managed data.
              </p>
            </>
          ),
        },
        {
          id: "cookies",
          title: "Cookies and similar technologies",
          content: (
            <p>
              We use essential cookies and similar technologies for authentication,
              session continuity, and security. We may also use limited analytics cookies to
              understand product usage. You can control cookies through your browser
              settings; disabling essential cookies may prevent sign-in or core features
              from working.
            </p>
          ),
        },
        {
          id: "international",
          title: "International transfers",
          content: (
            <p>
              The Service may be hosted or processed in jurisdictions other than where you
              reside. Where we transfer personal data internationally, we use appropriate
              safeguards consistent with applicable law.
            </p>
          ),
        },
        {
          id: "children",
          title: "Children",
          content: (
            <p>
              The Service is not directed to individuals under 16 (or the minimum age
              required in your jurisdiction). We do not knowingly collect personal
              information from children. If you believe a child has provided us data,
              contact us and we will take appropriate steps to delete it.
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes to this policy",
          content: (
            <p>
              We may update this Privacy Policy from time to time. We will post the revised
              version on this page and update the “Last updated” date. Material changes may
              also be communicated by email or in-product notice. Continued use of the
              Service after changes become effective constitutes acceptance of the updated
              policy.
            </p>
          ),
        },
        {
          id: "contact",
          title: "Contact",
          content: (
            <p>
              For privacy inquiries:{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-[#012F13] underline underline-offset-2 hover:opacity-70"
              >
                {CONTACT_EMAIL}
              </a>
              . General product support may be available through your Qlix account or the
              contact channels published on{" "}
              <a
                href="https://qlix.exora.solutions"
                className="text-[#012F13] underline underline-offset-2 hover:opacity-70"
              >
                qlix.exora.solutions
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
