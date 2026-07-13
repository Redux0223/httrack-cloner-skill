import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { listFiles, safeJson, toPosix, writeText } from "./lib.mjs";

const LICENSE_NAME = /^(?:license|copying|notice)(?:[.].*)?$/i;
const RESTRICTED_PATH = /(?:^|\/)(?:brand|brands|logo|logos|trademark)(?:\/|$)/i;

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function licenseEvidence(siteRoot) {
  return listFiles(siteRoot)
    .filter((file) => LICENSE_NAME.test(basename(file)) || /[.]license(?:[.]|$)/i.test(file))
    .map((file) => ({
      path: toPosix(relative(siteRoot, file)),
      sha256: fileSha256(file),
      kind: "captured-license-file",
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function itemStatus(path, evidence) {
  if (RESTRICTED_PATH.test(path)) return "restricted";
  if (evidence.length > 0 && /(?:^|\/)(?:vendor|vendors|third-party)(?:\/|$)/i.test(path)) return "covered";
  return "unverified";
}

export function buildAuthorizationManifest({ sourceUrl, siteRoot, publicRoot, authorized = false }) {
  const evidence = licenseEvidence(siteRoot);
  const items = listFiles(publicRoot)
    .map((file) => {
      const path = toPosix(relative(publicRoot, file));
      return {
        path,
        sha256: fileSha256(file),
        status: itemStatus(path, evidence),
        evidence: evidence.map((item) => item.path),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const statuses = new Set(items.map((item) => item.status));
  const decision = statuses.has("restricted")
    ? "restricted"
    : statuses.has("unverified")
      ? "unverified"
      : "covered";

  return {
    sourceUrl,
    legalConclusion: false,
    decision,
    basis: authorized ? ["user-attestation"] : [],
    evidence,
    items,
    generatedBy: "httrack-cloner-skill",
    statement: "This is an automated evidence inventory, not a license grant or legal conclusion.",
  };
}

export function writeAuthorizationManifest({ outputFile, ...options }) {
  const manifest = buildAuthorizationManifest(options);
  writeText(outputFile, safeJson(manifest));
  return manifest;
}
