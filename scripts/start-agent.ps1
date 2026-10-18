[CmdletBinding()]
param(
    [ValidateSet('shell', 'codex', 'claude', 'gemini', 'copilot', 'grok')]
    [string]$Agent = 'shell',
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'AGENTS.md'))) {
    throw 'Project instructions are missing.'
}
Set-Location -LiteralPath $projectRoot

Write-Output ('Project: ' + $projectRoot)
Write-Output 'Read AGENTS.md before making changes. Use one agent per worktree.'
if ($Agent -eq 'shell') { return }

# Resolve the existing installation and preserve its normal account and approval settings.
$agentCommand = Get-Command $Agent -ErrorAction SilentlyContinue
if (-not $agentCommand) {
    throw ('The requested agent is not installed or is not on PATH: ' + $Agent)
}
if ($Check) {
    Write-Output ('Available: ' + $agentCommand.Name)
    return
}
& $Agent
