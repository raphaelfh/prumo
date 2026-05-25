# Security Policy

This document outlines vulnerability reporting guidelines for Prumo.
We highly value responsible disclosure and community support.

## Reporting a vulnerability

If you identify a security vulnerability, submit it privately through GitHub Security Advisories:

- https://github.com/raphaelfh/prumo/security/advisories/new

Include enough detail for reproduction and impact assessment.
If relevant, include the affected endpoint, URL, or component.

To ensure responsible disclosure:

- Do not publicly disclose the issue before remediation.
- Do not run destructive or high-volume scans without consent.
- Do not exploit vulnerabilities to access or alter user data.
- Do not perform physical attacks, social engineering, DDoS, spam campaigns,
  or attacks against third-party systems.

## Out of scope

The following reports are generally out of scope unless they include a clear,
demonstrable attack path:

- Vulnerabilities requiring physical access or full man-in-the-middle control.
- Content spoofing/text injection with no security impact.
- Email spoofing without direct platform compromise.
- Missing DNSSEC, CAA, or CSP headers without exploitability evidence.
- Missing secure or HTTP-only flags on non-sensitive cookies.

## Our commitment

- We acknowledge reports within three business days.
- We coordinate remediation and communicate status updates.
- We keep reporter details confidential whenever possible.
- We may publicly credit reporters after resolution, with permission.
