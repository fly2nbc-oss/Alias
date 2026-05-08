@echo off
setlocal EnableDelayedExpansion

set "APP_DATA=%APPDATA%\com.fly2nbc.alias"
set "APP_LOCAL=%LOCALAPPDATA%\com.fly2nbc.alias"
set "MODEL_DIR=%APP_DATA%\models\ner"
set "STORE_FILE=%APP_DATA%\alias_store.json"

echo ================================================
echo   Alias App - Reset Tool
echo ================================================
echo.
echo AppData path: %APP_DATA%
echo.

:: Check if app data exists at all
if not exist "%APP_DATA%" (
    echo [INFO] No app data found. Nothing to delete.
    pause
    exit /b 0
)

:: Menu
echo What do you want to delete?
echo.
echo   [1] NER model only  (re-download on next start)
echo   [2] Alias store only  (alias_store.json)
echo   [3] NER model + Alias store
echo   [4] Everything  (model + store + WebView cache)
echo   [0] Cancel
echo.
set /p CHOICE="Your choice: "

if "%CHOICE%"=="0" goto :cancel
if "%CHOICE%"=="1" goto :del_model
if "%CHOICE%"=="2" goto :del_store
if "%CHOICE%"=="3" goto :del_both
if "%CHOICE%"=="4" goto :del_all

echo [ERROR] Invalid choice.
pause
exit /b 1

:del_model
    call :do_del_model
    goto :done

:del_store
    call :do_del_store
    goto :done

:del_both
    call :do_del_model
    call :do_del_store
    goto :done

:del_all
    call :do_del_model
    call :do_del_store
    call :do_del_webview
    goto :done

:cancel
    echo Cancelled.
    pause
    exit /b 0

:: ── Subroutines ───────────────────────────────────────────────

:do_del_model
    if exist "%MODEL_DIR%" (
        echo [DEL] NER model: %MODEL_DIR%
        rd /s /q "%MODEL_DIR%"
        if exist "%MODEL_DIR%" (
            echo [WARN] Could not delete model directory.
        ) else (
            echo [OK]  NER model deleted. Will be re-downloaded on next start.
        )
    ) else (
        echo [INFO] NER model not found, skipping.
    )
    exit /b 0

:do_del_store
    if exist "%STORE_FILE%" (
        echo [DEL] Alias store: %STORE_FILE%
        del /f /q "%STORE_FILE%"
        if exist "%STORE_FILE%" (
            echo [WARN] Could not delete store file.
        ) else (
            echo [OK]  Alias store deleted.
        )
    ) else (
        echo [INFO] Alias store not found, skipping.
    )
    exit /b 0

:do_del_webview
    if exist "%APP_LOCAL%\EBWebView" (
        echo [DEL] WebView cache: %APP_LOCAL%\EBWebView
        rd /s /q "%APP_LOCAL%\EBWebView"
        echo [OK]  WebView cache deleted.
    ) else (
        echo [INFO] WebView cache not found, skipping.
    )
    exit /b 0

:done
    echo.
    echo Done.
    pause
    exit /b 0
