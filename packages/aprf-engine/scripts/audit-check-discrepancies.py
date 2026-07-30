#!/usr/bin/env python3
"""Audit APRF Check YAMLs for title / passCondition / evidence / detector discrepancies."""
from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "rules" / "by-category"
OUT = Path(__file__).resolve().parents[1] / "rules" / "_audit" / "discrepancy-report.json"


def field(text: str, name: str) -> str | None:
    m = re.search(rf'(?ms)^{name}:\s*"(.*?)"\s*(?=\n[a-zA-Z])', text)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    m = re.search(rf'(?m)^{name}:\s*"(.*)"\s*$', text)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    return None


def list_field(text: str, name: str) -> list[str]:
    m = re.search(rf'(?ms)^{name}:\s*\n((?:\s+-\s+".*?"\s*\n(?:\s+".*?"\s*\n)*)+)', text)
    if not m:
        return []
    return [re.sub(r"\s+", " ", x).strip() for x in re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))]


def detectors(text: str) -> tuple[list[str], str | None]:
    block = re.search(r"(?ms)^detection:\s*\n(.*?)(?=\n[a-zA-Z])", text)
    if not block:
        return [], None
    b = block.group(1)
    cap = re.search(r'capability:\s*"([^"]+)"', b)
    ids = re.findall(r'id:\s*"([^"]+)"', b)
    return ids, (cap.group(1) if cap else None)


TEST_COVERAGE_PASS = re.compile(
    r"(automated tests cover|test coverage|100% of .+ entry points|in the suite|in the test harness)",
    re.I,
)
RUNTIME_TITLE = re.compile(
    r"\b(must|shall)\b.+\b(enforce|require|reject|live|redact|isolate|pin|version|monitor|alert)\b",
    re.I,
)


def title_core(title: str) -> str:
    return re.sub(r"^(.*?)\s+(must|shall)\s+", "", title or "", flags=re.I).lower()


def main() -> None:
    files = sorted(ROOT.rglob("*.yaml"))
    findings: list[dict] = []

    for f in files:
        text = f.read_text()
        rid = field(text, "id") or f.stem
        cat = field(text, "category") or f.parent.name
        title = field(text, "title") or ""
        desc = field(text, "description") or ""
        why = field(text, "whyItMatters") or ""
        pc = field(text, "passCondition") or ""
        evid = list_field(text, "evidenceRequired")
        det_ids, cap = detectors(text)
        tags = re.findall(
            r'(?m)^\s+-\s+"(mandatory|recommended|manual|hybrid|automated)"\s*$',
            text,
        )
        mv = field(text, "manualVerification") or ""
        gate = field(text, "gate")
        issues: list[tuple[str, str, str]] = []

        if title and desc:
            t_norm = title.lower().replace("must", "shall")
            if SequenceMatcher(None, t_norm, desc.lower()).ratio() < 0.85:
                issues.append(("medium", "title_description_drift", "title/description diverge"))

        if why and pc:
            why_n = re.sub(r"\s+", " ", why)
            pc_n = re.sub(r"\s+", " ", pc)
            if "against:" in why_n.lower():
                after = why_n.lower().split("against:", 1)[1].strip()
                if pc_n.lower() not in after and SequenceMatcher(
                    None, after[: len(pc_n) + 40], pc_n.lower()
                ).ratio() < 0.9:
                    issues.append(
                        (
                            "high",
                            "why_passcondition_mismatch",
                            'whyItMatters "against:" text does not match passCondition',
                        )
                    )

        if mv and pc:
            mv_n = re.sub(r"\s+", " ", mv).lower()
            pc_n = re.sub(r"\s+", " ", pc).lower()
            anchor = pc_n[:50]
            if anchor not in mv_n and SequenceMatcher(
                None, mv_n[-(len(pc_n) + 80) :], pc_n
            ).ratio() < 0.85:
                issues.append(
                    (
                        "medium",
                        "manual_verification_stale",
                        "manualVerification may not include current passCondition",
                    )
                )

        if cat == "authorization" and re.search(r"\bunauthenticated\b", pc + " " + title, re.I):
            issues.append(
                (
                    "high",
                    "authn_terms_in_authz",
                    "authorization Check uses unauthenticated (AUTHN concern)",
                )
            )

        if RUNTIME_TITLE.search(title) and TEST_COVERAGE_PASS.search(pc):
            title_words = set(re.findall(r"[a-z]{4,}", title_core(title)))
            pc_words = set(re.findall(r"[a-z]{4,}", pc.lower()))
            stop = {
                "must",
                "shall",
                "with",
                "from",
                "that",
                "this",
                "have",
                "been",
                "were",
                "their",
                "into",
                "over",
                "when",
                "than",
                "only",
                "also",
                "does",
                "without",
                "against",
            }
            tw = title_words - stop
            overlap = tw & pc_words
            if len(tw) >= 3 and len(overlap) / max(len(tw), 1) < 0.35:
                issues.append(
                    (
                        "high",
                        "title_pass_semantic_gap",
                        "title states a runtime property but passCondition is mostly test-coverage meta",
                    )
                )

        if cap and tags and cap in ("manual", "hybrid", "automated") and cap not in tags:
            issues.append(
                ("medium", "capability_tag_mismatch", f"capability={cap} but tags={tags}")
            )

        if cat == "authorization" and any(d.startswith("iam-") for d in det_ids):
            if any(k in title.lower() for k in ["feature", "tool", "retrieval", "ai "]):
                issues.append(
                    (
                        "high",
                        "detector_mismatch",
                        f"AI-feature authz Check uses cloud IAM detectors: {det_ids}",
                    )
                )

        if gate == "mandatory" and not evid:
            issues.append(("high", "missing_evidence", "mandatory Check has no evidenceRequired"))
        if gate == "mandatory" and not (pc or "").strip():
            issues.append(
                ("high", "missing_passcondition", "mandatory Check has empty passCondition")
            )

        if title and pc:
            tl = title.lower()
            pl = pc.lower()
            topic_checks = [
                ("secret", ["secret", "credential", "vault", "redact", "scan"]),
                ("mfa", ["mfa", "multi-factor", "2fa", "second factor"]),
                ("tenant", ["tenant", "cross-tenant", "isolation"]),
                ("rollback", ["rollback", "revert"]),
                ("slo", ["slo", "latency", "error budget", "availability"]),
                ("trace", ["trace", "span", "otel", "observ"]),
                ("prompt", ["prompt"]),
                ("eval", ["eval", "benchmark", "suite", "gate"]),
                ("cost", ["cost", "budget", "spend", "token"]),
                ("pii", ["pii", "privacy", "personal", "gdpr", "residen"]),
            ]
            for needle, stems in topic_checks:
                if needle in tl and not any(s in pl for s in stems):
                    issues.append(
                        (
                            "high",
                            "title_topic_absent_in_pass",
                            f'title mentions "{needle}" but passCondition lacks related stems {stems}',
                        )
                    )

        if evid and pc:
            ev = " ".join(evid).lower()
            pl = pc.lower()
            for token in ["secrets manager", "mfa", "cross-tenant"]:
                if token in pl and token not in ev and token.split()[0] not in ev:
                    issues.append(
                        (
                            "medium",
                            "evidence_gap_vs_pass",
                            f'passCondition mentions "{token}" but evidenceRequired does not',
                        )
                    )

        # Detector/capability consistency (mirror loader)
        if cap == "automated" and det_ids and all(d == "manual-attest" for d in det_ids):
            issues.append(
                (
                    "high",
                    "capability_detector_inconsistent",
                    'capability "automated" with only manual-attest',
                )
            )
        if cap == "hybrid" and det_ids and all(d == "manual-attest" for d in det_ids):
            issues.append(
                (
                    "high",
                    "capability_detector_inconsistent",
                    'capability "hybrid" with only manual-attest',
                )
            )

        for sev, code, msg in issues:
            findings.append(
                {
                    "id": rid,
                    "file": str(f.relative_to(ROOT.parent)),
                    "category": cat,
                    "severity": sev,
                    "code": code,
                    "message": msg,
                    "title": title[:120],
                    "passCondition": (pc or "")[:200],
                }
            )

    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda x: (order[x["severity"]], x["code"], x["id"]))
    high = [f for f in findings if f["severity"] == "high"]
    med = [f for f in findings if f["severity"] == "medium"]

    print(f"Checked {len(files)} YAML files")
    print(f"Findings: {len(findings)} total ({len(high)} high, {len(med)} medium)")
    print("\n=== HIGH ===")
    for item in high:
        print(f"{item['id']:12} [{item['code']}] {item['message']}")
        print(f"             title: {item['title']}")
        print(f"             pass:  {item['passCondition']}")
    print("\n=== MEDIUM ===")
    for item in med:
        print(f"{item['id']:12} [{item['code']}] {item['message']}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"checked": len(files), "findings": findings}, indent=2) + "\n"
    )
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
