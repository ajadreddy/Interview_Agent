$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $repoRoot '.env.local'
$voiceExecutable = Join-Path $repoRoot '.venv\Scripts\speech-to-speech.exe'
if (-not (Test-Path $voiceExecutable)) {
  throw 'Speech runtime missing. Run: py -3.11 -m venv .venv; .\.venv\Scripts\pip.exe install "speech-to-speech[pocket]==1.1.0"'
}
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $repoRoot '.env.example') $envFile }
$existingKey = Get-Content $envFile | Where-Object { $_ -match '^S2S_BRIDGE_KEY=' } | Select-Object -Last 1
if ($existingKey) { $existingKey = ($existingKey -split '=', 2)[1].Trim() }
if (-not $existingKey -or $existingKey -eq 'replace-with-a-long-random-string') {
  $bytes = [byte[]]::new(32)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $existingKey = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^S2S_BRIDGE_KEY=' })
  $lines += "S2S_BRIDGE_KEY=$existingKey"
  [IO.File]::WriteAllLines($envFile, $lines)
  Write-Host 'Created local voice bridge key in .env.local.'
}
$env:S2S_BRIDGE_KEY = $existingKey
$env:NLTK_DATA = Join-Path $repoRoot '.nltk_data'
New-Item -ItemType Directory -Force -Path $env:NLTK_DATA | Out-Null
if ($env:S2S_APP_URL) {
  $appUrl = $env:S2S_APP_URL.TrimEnd('/')
} else {
  $appUrl = $null
  foreach ($port in 3000..3010) {
    $candidate = "http://127.0.0.1:$port"
    try {
      $response = Invoke-WebRequest -Uri "$candidate/api/voice-bridge/v1/chat/completions" -Method Get -UseBasicParsing -TimeoutSec 2
      $status = [int]$response.StatusCode
    } catch {
      $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    }
    if ($status -eq 405) { $appUrl = $candidate; break }
  }
  if (-not $appUrl) { throw 'Interview Agent is not running on ports 3000-3010. Start npm run dev first, or set S2S_APP_URL.' }
}
try {
  Invoke-WebRequest -Uri "$appUrl/api/voice-bridge/v1/chat/completions" -Method Post -Body '{}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5 | Out-Null
  $status = 200
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
}
if ($status -eq 503) { throw "Restart npm run dev so it loads the new .env.local, then run this script again. App: $appUrl" }
if ($status -ne 401) { throw "Voice bridge is unavailable at $appUrl (HTTP $status). Check the app URL and restart npm run dev." }
Write-Host "Starting speech server for $appUrl on ws://127.0.0.1:8765/v1/realtime"
& $voiceExecutable serve `
  --host 127.0.0.1 --port 8765 `
  --llm_backend chat-completions `
  --model_name interviewer-voice-bridge `
  --responses_api_base_url "$appUrl/api/voice-bridge/v1" `
  --responses_api_api_key $env:S2S_BRIDGE_KEY `
  --responses_api_stream `
  --enable_live_transcription `
  --tts pocket --pocket_tts_device cpu