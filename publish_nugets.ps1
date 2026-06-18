param(
    [Parameter(Mandatory=$true, HelpMessage="Introduce tu API Key de nuget.org")]
    [string]$ApiKey
)

Write-Host "Publicando paquetes en nuget.org..." -ForegroundColor Cyan

# Push de todos los paquetes .nupkg en la carpeta artifacts
dotnet nuget push .\artifacts\*.nupkg -k $ApiKey -s https://api.nuget.org/v3/index.json --skip-duplicate

Write-Host "¡Publicación completada!" -ForegroundColor Green
