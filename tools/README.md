# TLA+ Tools Setup Guide for GuardRuntime

To execute live TLA+ Model Checking (TLC) and invariant falsifiability proofs:

1. **Install Java 17+ (OpenJDK / Temurin / Oracle)**:
   - Verify with: `java -version`

2. **Download `tla2tools.jar`**:
   - **Automated (PowerShell)**: Run `powershell -ExecutionPolicy Bypass -File tools/setup-tlc.ps1`
   - **Manual**: Download the official release from https://github.com/tlaplus/tlaplus/releases and place `tla2tools.jar` in the repository root or set the environment variable:
     - PowerShell: `$env:TLA_TOOLS_JAR = "C:\path\to\tla2tools.jar"`
     - Bash: `export TLA_TOOLS_JAR="/path/to/tla2tools.jar"`

3. **Run Formal Verification**:
   - Run falsifiability test:
     `npx --prefix demo-app tsx demo-app/scripts/verify_invariant_falsifiability.ts`
   - Run ground truth generation with live TLC:
     `npx --prefix demo-app tsx demo-app/scripts/generate_ground_truth.ts`
