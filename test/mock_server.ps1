<#
.SYNOPSIS
  Mandrain Mock Server - 纯 PowerShell 实现，无需 Node.js 或 Python
.DESCRIPTION
  模拟后端 session/init 和 analyze 两个接口
  用法：powershell -ExecutionPolicy Bypass -File mock_server.ps1
  默认端口：3721
#>

$Port = 3721
$Prefix = "http://localhost:$Port/"

# 云端模拟词库
$CloudDB = @{
    '内卷' = @{ zh='内卷'; en='involution'; definition='A state of excessive internal competition without meaningful progress'; implication='Reflects burnout culture and zero-sum mindset in workplaces'; sentiment='negative'; source='cloud' }
    '躺平' = @{ zh='躺平'; en='lying flat'; definition='To opt out of competitive pressure and adopt a minimalist lifestyle'; implication='A passive resistance to societal expectations and overwork culture'; sentiment='neutral'; source='cloud' }
    '摆烂' = @{ zh='摆烂'; en='let it rot'; definition='To deliberately stop trying and let things deteriorate'; implication='Expresses frustration and helplessness, often used humorously'; sentiment='negative'; source='cloud' }
}

# Token 映射
$TokenMap = @{
    'free-token-placeholder' = @{ plan='free'; valid=$true }
    'paid-token-test'        = @{ plan='pro';  valid=$true }
    'invalid-token'          = @{ plan=$null; valid=$false; code='TOKEN_INVALID';         message='license token is invalid' }
    'expired-token'          = @{ plan=$null; valid=$false; code='SUBSCRIPTION_INACTIVE';  message='subscription has expired' }
    'device-limit-token'     = @{ plan=$null; valid=$false; code='DEVICE_LIMIT_EXCEEDED';  message='device limit reached (3/3)' }
}

# 设备登记
$Devices = @{}

function Send-Json {
    param($Response, [int]$Status, $Data)
    $json = $Data | ConvertTo-Json -Depth 5 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $Status
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'POST, OPTIONS')
    $Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Install-Id, X-Mandrain-Version')
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Read-Body {
    param($Request)
    if ($Request.HasEntityBody) {
        $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
        $text = $reader.ReadToEnd()
        $reader.Close()
        try { return $text | ConvertFrom-Json } catch { return @{} }
    }
    return @{}
}

function Handle-SessionInit {
    param($Body, $Response)
    $token = if ($Body.license_token) { $Body.license_token } else { '' }
    $installId = if ($Body.install_id) { $Body.install_id } else { '' }
    $version = if ($Body.client_version) { $Body.client_version } else { '' }
    $platform = if ($Body.platform) { $Body.platform } else { '' }
    Write-Host "[session/init] token=$token, install_id=$installId, version=$version, platform=$platform"

    if (-not $token) {
        Send-Json -Response $Response -Status 400 -Data @{ code='TOKEN_MISSING'; message='license_token is required' }
        return
    }

    $info = $TokenMap[$token]
    if (-not $info) {
        Send-Json -Response $Response -Status 401 -Data @{ code='TOKEN_INVALID'; message='license token is invalid' }
        return
    }

    if (-not $info.valid) {
        $s = if ($info.code -eq 'DEVICE_LIMIT_EXCEEDED') { 403 } else { 401 }
        Send-Json -Response $Response -Status $s -Data @{ code=$info.code; message=$info.message }
        return
    }

    # 设备登记
    if (-not $Devices.ContainsKey($token)) { $Devices[$token] = [System.Collections.Generic.HashSet[string]]::new() }
    [void]$Devices[$token].Add($installId)
    $deviceCount = $Devices[$token].Count

    $suffix = -join ((48..57) + (97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
    $accessToken = "mock_at_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())_$suffix"

    $resp = @{
        access_token  = $accessToken
        expires_in    = 3600
        plan          = $info.plan
        device_count  = $deviceCount
        max_devices   = 3
        feature_flags = @{
            cloud_analyze = $true
            export        = ($info.plan -eq 'pro')
        }
    }
    Write-Host "[session/init] OK plan=$($resp.plan), devices=$deviceCount/3"
    Send-Json -Response $Response -Status 200 -Data $resp
}

function Handle-Analyze {
    param($Body, $Request, $Response)
    $auth = $Request.Headers['Authorization']
    $installId = $Request.Headers['X-Install-Id']
    $text = if ($Body.text) { ($Body.text).Trim() } else { '' }
    $lang = if ($Body.lang) { $Body.lang } else { 'zh' }
    Write-Host "[analyze] text=`"$text`", lang=$lang, install_id=$installId"

    if (-not $auth -or -not $auth.StartsWith('Bearer ') -or ($auth.Substring(7).Trim() -eq '')) {
        Send-Json -Response $Response -Status 401 -Data @{ code='UNAUTHORIZED'; message='missing or invalid access_token' }
        return
    }

    if (-not $text) {
        Send-Json -Response $Response -Status 400 -Data @{ code='EMPTY_TEXT'; message='text is required' }
        return
    }

    # 限制查询词长度: 30字符覆盖绝大多数中文词汇/短语/谚语，防止整句整段滥用
    if ($text.Length -gt 30) {
        Send-Json -Response $Response -Status 400 -Data @{ code='TEXT_TOO_LONG'; message='text exceeds 30 characters' }
        return
    }

    if ($CloudDB.ContainsKey($text)) {
        $result = $CloudDB[$text]
        Write-Host "[analyze] OK hit: $text -> $($result.en)"
        Send-Json -Response $Response -Status 200 -Data $result
        return
    }

    $fallback = @{
        zh          = $text
        en          = '[cloud translation]'
        definition  = "Cloud analysis for `"$text`" (mock)"
        implication = 'This is a mock cloud response for testing'
        sentiment   = 'neutral'
        source      = 'cloud'
    }
    Write-Host "[analyze] OK fallback: $text"
    Send-Json -Response $Response -Status 200 -Data $fallback
}

# ── Main ──────────────────────────────────────────────
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)

try {
    $listener.Start()
} catch {
    Write-Host "ERROR: Cannot start listener on $Prefix" -ForegroundColor Red
    Write-Host "Try running as Administrator or use: netsh http add urlacl url=$Prefix user=$env:USERNAME" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  Mandrain Mock Server running on http://localhost:$Port" -ForegroundColor Green
Write-Host "  -------------------------------------------------"
Write-Host "  POST /api/v1/session/init   - session init"
Write-Host "  POST /api/v1/analyze        - word analyze"
Write-Host "  -------------------------------------------------"
Write-Host '  Test Tokens:'
Write-Host '    "free-token-placeholder"  -> Free plan (default)'
Write-Host '    "paid-token-test"         -> Pro plan'
Write-Host '    "invalid-token"           -> TOKEN_INVALID'
Write-Host '    "expired-token"           -> SUBSCRIPTION_INACTIVE'
Write-Host '    "device-limit-token"      -> DEVICE_LIMIT_EXCEEDED'
Write-Host "  -------------------------------------------------"
Write-Host "  Cloud DB: $($CloudDB.Keys -join ', ')"
Write-Host "  Press Ctrl+C to stop"
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        # CORS preflight
        if ($req.HttpMethod -eq 'OPTIONS') {
            $res.StatusCode = 204
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            $res.Headers.Add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            $res.Headers.Add('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Install-Id, X-Mandrain-Version')
            $res.Headers.Add('Access-Control-Max-Age', '86400')
            $res.Close()
            continue
        }

        if ($req.HttpMethod -ne 'POST') {
            Send-Json -Response $res -Status 405 -Data @{ error='method not allowed' }
            continue
        }

        $body = Read-Body -Request $req
        $path = $req.Url.AbsolutePath

        switch ($path) {
            '/api/v1/session/init' { Handle-SessionInit -Body $body -Response $res }
            '/api/v1/analyze'     { Handle-Analyze -Body $body -Request $req -Response $res }
            default               { Send-Json -Response $res -Status 404 -Data @{ error='not found' } }
        }
    }
} finally {
    $listener.Stop()
    Write-Host "`n  Server stopped."
}
