<# :
@echo off
rem Alias for Windows: removes what install.cmd added for the current user
rem (program folder, Start menu entry, entry in Settings > Apps). Alias's own Edge
rem profile (names and placeholders, model) is kept, so a reinstall finds them again; run
rem interactively, it asks whether to delete it too. /quiet: no question, no pause.
rem /purge: also delete the Edge profile with the names and placeholders and the model.
rem
rem Everything below the batch part is PowerShell, run as a command (see install.cmd).
rem The batch part is one block, which cmd reads before this file is deleted; a plain
rem "exit /b" would read the deleted file again, so "(goto)" ends the batch first; the "exit /b"
rem on the same line then sets the exit code ("cmd /c exit" there would always give 0).
setlocal
set "ALIAS_SELF=%~f0"
set "ALIAS_ARGS= %* "
set "ALIAS_QUIET="
set "ALIAS_PURGE="
if /i not "%ALIAS_ARGS:/quiet=%"=="%ALIAS_ARGS%" set "ALIAS_QUIET=1"
if /i not "%ALIAS_ARGS:/purge=%"=="%ALIAS_ARGS%" set "ALIAS_PURGE=1"
cd /d "%TEMP%"
(
  if not defined ALIAS_QUIET if not defined ALIAS_PURGE (
    choice /c YN /n /m "Also delete your names and placeholders and the downloaded model? [Y/N] "
    if not errorlevel 2 set "ALIAS_PURGE=1"
  )
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Invoke-Expression (Get-Content -LiteralPath $env:ALIAS_SELF -Raw)"
  if errorlevel 1 (
    if not defined ALIAS_QUIET pause
    (goto) 2>nul & exit /b 1
  )
  if not defined ALIAS_QUIET pause
  (goto) 2>nul & exit /b 0
)
#>

$ErrorActionPreference = 'Stop'
$name = 'Alias'
$dir  = Join-Path $env:LOCALAPPDATA "Programs\$name"
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$key  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Alias'
$data = Join-Path $env:LOCALAPPDATA 'AliasData'

try {
    Remove-Item -LiteralPath (Join-Path $menu "$name.lnk"), (Join-Path $menu "$name.url") -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $key -Recurse -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
    Write-Host "$name is removed. Your documents are not touched."
    if ($env:ALIAS_PURGE -eq '1') {
        if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force }
        Write-Host 'Your names and placeholders and the downloaded model are deleted as well.'
    } elseif (Test-Path -LiteralPath $data) {
        Write-Host "Your names and placeholders and the model are kept in $data; a reinstall finds them again."
        Write-Host 'To delete them, run uninstall.cmd /purge or delete that folder.'
    }
    exit 0
} catch {
    Write-Host "Removing $name failed: $_ (is Alias still open?)" -ForegroundColor Red
    exit 1
}
