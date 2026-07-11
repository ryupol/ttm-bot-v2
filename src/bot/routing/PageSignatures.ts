import type { ManualInterventionReason } from "../manual/ManualIntervention.ts";
import type { PageKind } from "./PageClassifier.ts";

export type PageSignature = {
  id: string;
  pageKind?: PageKind;
  manualReason?: ManualInterventionReason;
  host?: string;
  path?: RegExp;
  url?: RegExp;
  html?: string[];
};

export type SignatureMatch = {
  signature: PageSignature;
  htmlConfirmed: boolean;
};

export const PAGE_SIGNATURES: PageSignature[] = [
  {
    id: "queueit_wait",
    pageKind: "queue",
    host: "wait.thaiticketmajor.com",
    path: /^\/view/i,
    html: ["queueViewModel", "ticketmasterasia"],
  },
  {
    id: "gatekeeper_inflow",
    pageKind: "queue",
    host: "gatekeeper.thaiticketmajor.com",
    path: /^\/inflow\/v2/i,
  },
  {
    id: "queueit_html",
    pageKind: "queue",
    html: ["queueViewModel", "ticketmasterasia"],
  },
  {
    id: "gatekeeper_captcha",
    manualReason: "captcha",
    host: "gatekeeper.thaiticketmajor.com",
    path: /^\/stacks\/sep/i,
    html: ["CAPTCHA verification", "Verify You Are Human"],
  },
  {
    id: "queueit_presence_confirm",
    manualReason: "queue_presence_confirm",
    host: "wait.thaiticketmajor.com",
    html: ["buttonConfirmVisitorPresence", "Still here?"],
  },
];

export function matchSignatures(input: { url: string; html?: string }): SignatureMatch[] {
  return PAGE_SIGNATURES.flatMap((signature) => {
    const hasUrlConstraint = Boolean(signature.host || signature.path || signature.url);
    const urlMatches = !hasUrlConstraint || signatureUrlMatches(signature, input.url);
    const htmlMatches = signature.html ? htmlHasAllMarkers(input.html, signature.html) : true;
    if (!urlMatches) return [];
    if (!hasUrlConstraint && signature.html && !htmlMatches) return [];
    if (signature.html && input.html !== undefined && !htmlMatches) return [];
    return [{ signature, htmlConfirmed: Boolean(signature.html && htmlMatches) }];
  });
}

export function htmlHasAllMarkers(html: string | undefined, markers: string[]): boolean {
  if (html === undefined) return false;
  return markers.every((marker) => html.includes(marker));
}

function signatureUrlMatches(signature: PageSignature, url: string): boolean {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }

  if (signature.host && parsed?.host.toLowerCase() !== signature.host.toLowerCase()) return false;
  if (signature.path && !signature.path.test(parsed?.pathname ?? "")) return false;
  if (signature.url && !signature.url.test(url)) return false;
  return Boolean(signature.host || signature.path || signature.url);
}
