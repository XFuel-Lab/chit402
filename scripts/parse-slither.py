import json

data = json.load(open("slither-report.json"))
detectors = data.get("results", {}).get("detectors", [])
print("Total findings: " + str(len(detectors)))

for impact in ["High", "Medium", "Low", "Informational"]:
    findings = [d for d in detectors if d.get("impact") == impact]
    if not findings:
        continue
    print("\n=== " + impact.upper() + " (" + str(len(findings)) + ") ===")
    for f in findings:
        check = f.get("check", "")
        confidence = f.get("confidence", "")
        desc = f.get("description", "").split("\n")[0][:120]
        print("  [" + check + "] (" + confidence + ") " + desc)
