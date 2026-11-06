# setup-tlc.ps1: Download and configure tla2tools.jar for TLA+ model checking in GuardRuntime

$ErrorActionPreference = "Stop"

$repoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$targetJar = Join-Path $repoRoot "tla2tools.jar"
$tlcUrl = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"

Write-Host "=== GuardRuntime TLA+ / TLC Model Checker Setup ===" -ForegroundColor Cyan

# 1. Check Java installation
Write-Host "`n[1/3] Checking Java Runtime..."
try {
    $javaVer = java -version 2>&1
    Write-Host " -> Java detected:" -ForegroundColor Green
    $javaVer | ForEach-Object { Write-Host "    $_" }
} catch {
    Write-Warning "Java (JDK/JRE 17+) was not found in PATH. Please install Java 17+ (e.g., Eclipse Temurin or OpenJDK)."
}

# 2. Check / Download tla2tools.jar
Write-Host "`n[2/3] Checking tla2tools.jar in repository root ($targetJar)..."
if (Test-Path $targetJar) {
    $jarSize = (Get-Item $targetJar).Length
    Write-Host " -> tla2tools.jar already exists ($([math]::Round($jarSize / 1MB, 2)) MB)." -ForegroundColor Green
} else {
    Write-Host " -> tla2tools.jar not found. Downloading from GitHub ($tlcUrl)..."
    try {
        Invoke-WebRequest -Uri $tlcUrl -OutFile $targetJar -UseBasicParsing
        $jarSize = (Get-Item $targetJar).Length
        Write-Host " -> Download complete! ($([math]::Round($jarSize / 1MB, 2)) MB)" -ForegroundColor Green
    } catch {
        Write-Error "Failed to download tla2tools.jar: $_"
    }
}

# 3. Environment configuration
Write-Host "`n[3/3] Setting TLA_TOOLS_JAR environment variable for current session..."
$env:TLA_TOOLS_JAR = $targetJar
Write-Host " -> Set `$env:TLA_TOOLS_JAR = '$targetJar'" -ForegroundColor Green

Write-Host "`nSetup complete! You can now run model checking with:" -ForegroundColor Cyan
Write-Host "  npx --prefix demo-app tsx demo-app/scripts/generate_ground_truth.ts"
Write-Host "  npx --prefix demo-app tsx demo-app/scripts/verify_invariant_falsifiability.ts`n"
