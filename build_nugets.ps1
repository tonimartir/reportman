param(
    [string]$Configuration = "Release",
    [string]$OutputDirectory = ".\artifacts",
    [string]$Version = "4.0.10"
)

# Limpiar directorio de salida
if (Test-Path $OutputDirectory) {
    Remove-Item -Recurse -Force $OutputDirectory
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Write-Host "Empaquetando proyectos de Reportman en configuración '$Configuration' con versión '$Version'..." -ForegroundColor Cyan

# Find all projects that have a PackageId defined and pack them
$projects = Get-ChildItem -Path . -Filter *.csproj -Recurse | Where-Object { $_.FullName -notmatch "\\tests\\|\\rtharness\\|\\designer\\" }

foreach ($proj in $projects) {
    $content = Get-Content $proj.FullName -Raw
    if ($content -match "<PackageId>") {
        Write-Host "Empaquetando: $($proj.Name)"
        dotnet pack $proj.FullName -c $Configuration -o $OutputDirectory /p:Version=$Version /p:ContinuousIntegrationBuild=true /p:IsPackable=true
    }
}

Write-Host "Empaquetado completado. Paquetes generados en: $OutputDirectory" -ForegroundColor Green
