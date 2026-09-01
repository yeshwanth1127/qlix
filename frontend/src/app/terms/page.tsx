import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocumentPage } from "@/components/qlix/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Terms of Service · Qlix",
  description:
    "Terms governing use of Qlix, the Exora developer console for agent identity and audit.",
};

const CONTACT_EMAIL = "legal@exora.solutions";

export default function TermsOfServicePage() {
  return (
    <LegalDocumentPage
      title="Terms of Service"
      lastUpdated="August 10, 2026"
      intro="These Terms of Service (“Terms”) govern your access to and use of Qlix, the developer console and related APIs for the Exora ecosystem (the “Service”). By creating an account or using the Service, you agree to these Terms."
      sections={[
        {
          id: "service",
          title: "The Service",
          content: (
            <>
              <p>
                Qlix provides tools to register and manage AI agent identities
                (including DIDs and verifiable credentials), inspect audit logs, manage API
                keys, connect integrations, and administer individual or organization
                workspaces.
              </p>
              <p>
                Features, plans, and availability may change as we develop the product.
                Beta or preview features are provided as-is and may be modified or
                withdrawn at any time.
              </p>
            </>
          ),
        },
        {
          id: "eligibility",
          title: "Eligibility and accounts",
          content: (
            <>
              <p>
                You must be at least 16 years old (or the age of digital consent in your
                jurisdiction) and able to form a binding contract. You are responsible for
                the accuracy of account information and for keeping credentials, API keys,
                and private keys secure.
              </p>
              <p>
                If you create an organization workspace, you represent that you have
                authority to bind that organization to these Terms. Organization admins are
                responsible for member access and for content and agents under that
                workspace.
              </p>
            </>
          ),
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          content: (
            <>
              <p>You agree not to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Use the Service for unlawful, harmful, fraudulent, or abusive purposes</li>
                <li>
                  Attempt to bypass security, rate limits, billing controls, or access
                  controls
                </li>
                <li>
                  Interfere with or disrupt the Service, audit integrity, or other users’
                  workspaces
                </li>
                <li>
                  Misrepresent agent identity, credentials, or audit records, or use
                  identity features to deceive others
                </li>
                <li>
                  Upload malware, scrape the Service beyond permitted APIs, or reverse
                  engineer except where allowed by law
                </li>
                <li>
                  Use agents or connectors in ways that violate third-party terms, privacy
                  laws, or the rights of others
                </li>
              </ul>
              <p>
                We may suspend or terminate access for violations, security risk, or unpaid
                fees.
              </p>
            </>
          ),
        },
        {
          id: "agents-connectors",
          title: "Agents, credentials, and connectors",
          content: (
            <>
              <p>
                You retain ownership of content and configuration you submit. You grant us a
                license to host, process, and display that material solely to operate and
                improve the Service for you.
              </p>
              <p>
                You are solely responsible for agent behavior, prompts, skills, connector
                authorizations, and actions taken by agents under your account or
                organization. Cryptographic credentials and keys issued or managed through
                Qlix must be handled according to your internal security policies.
              </p>
              <p>
                Audit logs are provided for operational and compliance visibility; they do
                not replace your own legal, security, or retention obligations.
              </p>
            </>
          ),
        },
        {
          id: "billing",
          title: "Plans, credits, and billing",
          content: (
            <>
              <p>
                Paid plans, usage-based charges, and action credits (if applicable) are
                described in the product or order materials at the time of purchase. Fees
                are non-refundable except where required by law or expressly stated
                otherwise.
              </p>
              <p>
                You authorize us and our payment processors to charge applicable amounts. We
                may change pricing with reasonable notice; continued use after the effective
                date constitutes acceptance. Failure to pay may result in suspension or
                limitation of the Service.
              </p>
            </>
          ),
        },
        {
          id: "ip",
          title: "Intellectual property",
          content: (
            <p>
              Qlix, Exora, and related names, logos, software, and documentation are owned
              by us or our licensors. These Terms do not grant you any right to use our
              trademarks except as needed to refer to the Service accurately. Feedback you
              provide may be used without obligation to you.
            </p>
          ),
        },
        {
          id: "disclaimer",
          title: "Disclaimers",
          content: (
            <p>
              THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT
              PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, OR
              STATUTORY, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
              NON-INFRINGEMENT. We do not warrant that the Service will be uninterrupted,
              error-free, or that audit or identity features will meet a particular
              regulatory standard without your own review and controls.
            </p>
          ),
        },
        {
          id: "liability",
          title: "Limitation of liability",
          content: (
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR AFFILIATES WILL NOT BE
              LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
              OR FOR LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS INTERRUPTION. OUR
              AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THE SERVICE WILL NOT EXCEED
              THE AMOUNTS YOU PAID TO US FOR THE SERVICE IN THE TWELVE (12) MONTHS BEFORE
              THE EVENT GIVING RISE TO LIABILITY, OR ONE HUNDRED U.S. DOLLARS (US $100) IF
              YOU HAVE NOT PAID ANY FEES.
            </p>
          ),
        },
        {
          id: "indemnity",
          title: "Indemnity",
          content: (
            <p>
              You will defend and indemnify us against claims, damages, and expenses
              (including reasonable attorneys’ fees) arising from your use of the Service,
              your agents’ actions, your content, or your violation of these Terms or
              applicable law.
            </p>
          ),
        },
        {
          id: "termination",
          title: "Termination",
          content: (
            <p>
              You may stop using the Service and delete your account as provided in the
              product. We may suspend or terminate access immediately for breach, legal
              risk, or non-payment. Upon termination, your right to use the Service ends.
              Provisions that by their nature should survive (including ownership,
              disclaimers, limitations, and indemnity) will survive.
            </p>
          ),
        },
        {
          id: "privacy",
          title: "Privacy",
          content: (
            <p>
              Our collection and use of personal information is described in our{" "}
              <Link
                href="/privacy"
                className="text-[#012F13] underline underline-offset-2 hover:opacity-70"
              >
                Privacy Policy
              </Link>
              , which is incorporated by reference.
            </p>
          ),
        },
        {
          id: "governing-law",
          title: "Governing law",
          content: (
            <p>
              These Terms are governed by the laws applicable to the operator of the Exora
              platform, without regard to conflict-of-law principles. Courts in that
              jurisdiction will have exclusive venue for disputes, except where applicable
              law requires otherwise for consumers.
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes to these Terms",
          content: (
            <p>
              We may update these Terms by posting a revised version on this page and
              updating the “Last updated” date. Material changes may be communicated by
              email or in-product notice. Continued use after the effective date constitutes
              acceptance.
            </p>
          ),
        },
        {
          id: "contact",
          title: "Contact",
          content: (
            <p>
              Questions about these Terms:{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-[#012F13] underline underline-offset-2 hover:opacity-70"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
