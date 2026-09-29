# 포인트 관리 프로그램 - POS 터미널 에이전트 (2026-09-27 전면 확장)
#
# 역할
#  1) 등록/하트비트 — 매장 대시보드에 "이 단말이 지금 켜져있다"고 알림 (기존 기능 유지)
#  2) 대표 포스기면 관리모드(웹과 동일 화면, concrab.com/store) 바로가기를 바탕화면에 만듦/지움
#  3) 큐 폴링 — 챔프 DB의 CRAB_EVENT_QUEUE(MEMBER_POINT 트리거가 결제 완료마다 자동 적재)를
#     지켜보다가, 전화번호가 등록된 회원이면 포인트 서버에 적립을 반영. 전화번호가 없으면
#     조용히 넘어간다(설계 결정: 카드만으로는 적립 안 함).
#  4) 포인트 사용 팝업 — 계산원이 실행하면 전화번호를 물어보고, 그 손님의 서버 포인트를
#     챔프 MEMBER.MEM_USABLE_PNT에 잠시 써넣는다(챔프 자체 포인트결제 기능을 그대로 쓰게 하기
#     위함). 결제가 끝나면(큐에 그 회원의 사용 내역이 들어오면) 원래 값으로 되돌린다.
#
# 전제: DSN=CHAMP(Sybase ASA 8.0, dba/sql) ODBC 연결이 이 PC에 이미 설정되어 있어야 함.
# 설계 문서: /root/projects/point-manager/docs/design-and-implementation-log.md
#
# 설치·최초 실행 안내(계산원용): 이 폴더를 통째로 이 PC에 두고 "start.bat"을 더블클릭하세요.
# 매장의 첫 단말이면 처음 한 번만 매장 대시보드에서 받은 6자리 등록코드를 입력합니다(자동으로
# 대표 포스기가 됩니다). 두 번째 단말부터는 코드를 몰라도 됩니다 — 대표 포스기의 관리모드
# 화면(같은 LAN)에 "발견된 포스기" 목록이 뜨고, 거기서 "등록" 버튼만 누르면 됩니다. 그 외
# 나머지(챔프 DB 준비, 다음부터 컴퓨터를 켤 때마다 자동 시작)는 전부 자동으로 됩니다.

param(
    [string]$BaseUrl = "https://concrab.com",
    [string]$ConfigPath = "$PSScriptRoot\terminal-config.json",
    [int]$QueuePollSec = 3,
    [int]$SwapTimeoutSec = 180,  # 사용 팝업으로 잠시 바꿔둔 포인트를 이 시간 안에 결제완료를 못 보면 강제로 원복
    [int]$LocalHttpPort = 58787, # 같은 LAN의 대표 포스기 관리화면이 이 단말과 대화하는 포트(등록 안내·발견 목록)
    [int]$DiscoveryUdpPort = 58788, # 같은 LAN에서 서로를 찾는 UDP 방송 포트
    [int]$DiscoveryIntervalSec = 5
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Script:MyInstanceId = [Guid]::NewGuid().ToString()  # LAN 방송에서 내가 보낸 것을 나한테서 다시 받았을 때 걸러내기 위한 값

# ─── 설정 ────────────────────────────────────────────────────────────────────

function Load-Config {
    if (Test-Path $ConfigPath) { return Get-Content $ConfigPath -Raw | ConvertFrom-Json }
    return $null
}
function Save-Config($cfg) { $cfg | ConvertTo-Json | Out-File -Encoding UTF8 $ConfigPath }

function Complete-Registration([string]$code, [string]$name) {
    $body = @{ code = $code; terminalName = $name } | ConvertTo-Json
    $res = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/pos/terminals/register" -ContentType "application/json" -Body $body
    $cfg = @{ terminalId = $res.terminalId; apiKey = $res.apiKey; name = $name; baseUrl = $BaseUrl; isPrimary = [bool]$res.isPrimary }
    Save-Config $cfg
    return $cfg
}

function Register-Terminal {
    $name = $env:COMPUTERNAME  # 단말 이름은 묻지 않고 컴퓨터 이름을 그대로 쓴다(설치 단계 하나 더 줄임)

    # 두 번째 이후 단말이면, 이미 켜져 있는 대표 포스기가 같은 LAN에서 자동으로 등록을
    # 완성해줄 수 있다 — 잠깐 기다려보고, 안 되면(첫 단말이거나 대표가 아직 없음) 코드를
    # 직접 입력하는 방식으로 넘어간다(유일하게 손이 가는 단계).
    Write-Host "이 매장에 이미 등록된 포스기(대표 포스기)가 있으면, 그 포스기의 관리모드 화면에서"
    Write-Host "이 컴퓨터('$name')를 찾아 '등록'을 눌러주세요 — 20초간 기다립니다..."

    $listener = $null
    $pendingCtx = $null
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://+:$LocalHttpPort/")
        $listener.Start()
        # HttpListener에는 Pending() 메서드가 없다(TcpListener와 다름, 2026-09-29 확인된 버그) —
        # BeginGetContext로 비동기 대기를 걸어두고 AsyncWaitHandle.WaitOne(0)으로 "요청 도착했는지"만
        # 논블로킹으로 확인하는 방식으로 대체.
        $pendingCtx = $listener.BeginGetContext($null, $null)
    } catch { $listener = $null }

    $udp = $null
    try { $udp = New-Object System.Net.Sockets.UdpClient; $udp.EnableBroadcast = $true } catch { }

    $deadline = (Get-Date).AddSeconds(20)
    $cfg = $null
    while ((Get-Date) -lt $deadline -and -not $cfg) {
        if ($udp) {
            try {
                $payload = @{ instanceId = $Script:MyInstanceId; name = $name; isPrimary = $false; registered = $false } | ConvertTo-Json -Compress
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
                $udp.Send($bytes, $bytes.Length, "255.255.255.255", $DiscoveryUdpPort) | Out-Null
            } catch { }
        }
        if ($listener -and $pendingCtx -and $pendingCtx.AsyncWaitHandle.WaitOne(0)) {
            $ctx = $listener.EndGetContext($pendingCtx)
            $pendingCtx = $listener.BeginGetContext($null, $null)
            $ok = $false
            if ($ctx.Request.Url.AbsolutePath -eq "/apply-code" -and $ctx.Request.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                try { $cfg = Complete-Registration -code $body.code -name $name; $ok = $true }
                catch { Write-Host "원격 등록코드 적용 실패: $_" -ForegroundColor Red }
            }
            $buf = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ ok = $ok }))
            try { $ctx.Response.OutputStream.Write($buf, 0, $buf.Length) } catch { }
            $ctx.Response.OutputStream.Close()
        }
        if (-not $cfg) { Start-Sleep -Milliseconds 500 }
    }
    if ($udp) { $udp.Close() }
    if ($listener) { $listener.Stop() }

    if ($cfg) {
        Write-Host "대표 포스기가 자동으로 등록을 완료해줬습니다." -ForegroundColor Green
        return $cfg
    }

    $code = Read-Host "자동으로 등록되지 않았습니다. 매장 대시보드(POS 터미널 등록)에서 발급한 6자리 코드를 입력하세요"
    try {
        $cfg = Complete-Registration -code $code -name $name
    } catch {
        Write-Host "등록 실패: $_" -ForegroundColor Red
        exit 1
    }
    Write-Host "등록 완료 — 이제부터 이 단말이 매장 대시보드에 '가동중'으로 표시됩니다." -ForegroundColor Green
    return $cfg
}

# ─── 부팅/로그온 시 자동 시작 등록 (최초 실행 때 1회, 재부팅해도 사람이 다시 실행할 필요 없게) ──

function Ensure-AutoStart {
    $taskName = "PointManagerAgent"
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) { return }
    try {
        $scriptPath = $PSCommandPath
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
        Write-Host "다음 로그온부터 자동으로 시작되도록 등록했습니다." -ForegroundColor Green
    } catch {
        Write-Host "자동시작 등록 실패(수동으로 다시 실행해야 할 수 있음): $_" -ForegroundColor Yellow
    }
}

# ─── 챔프 DB 큐 테이블·트리거 최초 1회 자동 생성 (이미 있으면 건너뜀 — 계산원이 손댈 필요 없음) ──

function Ensure-ChampQueueAndTrigger($champConn) {
    $tableExists = $champConn.Execute("SELECT count(*) AS C FROM SYSTABLE WHERE table_name='CRAB_EVENT_QUEUE'").Fields.Item("C").Value
    if ($tableExists -eq 0) {
        Write-Host "챔프 DB에 큐 테이블을 생성합니다(최초 1회)..."
        $champConn.Execute(@"
CREATE TABLE CRAB_EVENT_QUEUE (
  CRAB_SEQ INTEGER DEFAULT AUTOINCREMENT PRIMARY KEY,
  MEM_NO VARCHAR(20),
  MEMP_AMT NUMERIC(15,2),
  MEMP_ADD_AMT NUMERIC(15,2),
  MEMP_USED_AMT NUMERIC(15,2),
  MEMP_CARD_NO VARCHAR(30),
  SRC_SELLS_DT DATE,
  SRC_CHN_NO VARCHAR(20),
  CREATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
  PROCESSED CHAR(1) DEFAULT 'N'
)
"@) | Out-Null
    }
    $triggerExists = $champConn.Execute("SELECT count(*) AS C FROM SYSTRIGGER WHERE trigger_name='CRAB_MEMBER_POINT_AI'").Fields.Item("C").Value
    if ($triggerExists -eq 0) {
        Write-Host "챔프 DB에 결제완료 감지 트리거를 생성합니다(최초 1회)..."
        $champConn.Execute(@"
CREATE TRIGGER CRAB_MEMBER_POINT_AI AFTER INSERT ON MEMBER_POINT
REFERENCING NEW AS NEWROW
FOR EACH ROW
BEGIN
  INSERT INTO CRAB_EVENT_QUEUE (MEM_NO, MEMP_AMT, MEMP_ADD_AMT, MEMP_USED_AMT, MEMP_CARD_NO, SRC_SELLS_DT, SRC_CHN_NO)
  VALUES (NEWROW.MEM_NO, NEWROW.MEMP_AMT, NEWROW.MEMP_ADD_AMT, NEWROW.MEMP_USED_AMT, NEWROW.MEMP_CARD_NO, NEWROW.SELLS_DT, NEWROW.CHN_NO);
END
"@) | Out-Null
    }
}

$isFirstRun = -not (Test-Path $ConfigPath)
$cfg = Load-Config
if (-not $cfg) { $cfg = Register-Terminal }
$AuthHeader = @{ Authorization = "Bearer $($cfg.apiKey)" }
if ($isFirstRun) { Ensure-AutoStart }

# ─── 챔프 DB 연결 ─────────────────────────────────────────────────────────────

function New-ChampConn { $c = New-Object -ComObject ADODB.Connection; $c.Open("DSN=CHAMP"); return $c }
$Champ = New-ChampConn
Ensure-ChampQueueAndTrigger $Champ

function Champ-Exec($sql) { $Champ.Execute($sql) | Out-Null }
function Champ-Query($sql) {
    $rs = $Champ.Execute($sql)
    $rows = @()
    while (-not $rs.EOF) {
        $row = @{}
        for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $row[$rs.Fields.Item($i).Name] = $rs.Fields.Item($i).Value }
        $rows += [PSCustomObject]$row
        $rs.MoveNext()
    }
    $rs.Close()
    return $rows
}
function Sql-Str($s) { return "'" + ($s -replace "'", "''") + "'" }

# ─── 매장 최초 설치 시 전화번호 있는 회원 전원의 잔액을 한 번에 서버로 이전 ──────────
# 손님이 다시 올 때까지 기다리는 방문 시점 이전(posEarn의 1회성 수입)은 계속 살아있지만,
# 이 포스기가 처음 설치될 때 이 일괄 이전이 필요하다. 포스기마다 로컬 DB가 따로라
# 매장의 다른 포스기가 영업 중(실적립·다른 초기화 진행 중)이어도 이 포스기는 독립적으로,
# 대표 여부와 무관하게 실행된다. 이 포스기에서 딱 한 번만 실행되고(로컬 마커 파일),
# 서버 쪽도 포스기 단위 멱등으로 이중 방지된다(같은 고객이 여러 포스기에 남긴 잔액은
# 포스기별로 각각 더해짐 — 매장 계좌를 덮어쓰지 않음).

$BulkImportMarkerPath = "$PSScriptRoot\bulk-import-done.json"

# 포스DB에 포인트를 그대로 남겨두면(서버로도 옮기고 로컬에도 남아있으면) 나중에 두 값이
# 어긋나 혼선이 생긴다(2026-09-28 결정) — 그래서 서버로 옮긴 뒤에는 로컬을 0으로 비운다.
# 대신 옮기기 "전"에 원본 그대로를 파일로 백업해둔다 — 전화번호 매칭 여부와 무관하게 전원
# 포함. 문제가 생기면 이 파일로 포스DB를 수동 원복할 수 있다(restore-bulk-import-backup.ps1).
function Export-PointBackupCsv($members, [string]$label) {
    if ($members.Count -eq 0) { return $null }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
    $safeName = ($cfg.name -replace '[\\/:*?"<>|]', '_')
    $path = Join-Path $desktop "포인트초기화백업_${safeName}_${label}_${ts}.csv"
    $esc = { param($v) '"' + ("$v" -replace '"', '""') + '"' }
    $lines = @('MEM_NO,MEM_NM,MEM_TEL_1,MEM_REP_TEL,MEM_CARD_NO,MEM_USABLE_PNT')
    foreach ($m in $members) {
        $lines += (@($m.MEM_NO, $m.MEM_NM, $m.MEM_TEL_1, $m.MEM_REP_TEL, $m.MEM_CARD_NO, $m.MEM_USABLE_PNT) | ForEach-Object { & $esc $_ }) -join ','
    }
    $lines | Out-File -Encoding UTF8 $path
    Write-Host "포인트 백업 파일 저장: $path ($($members.Count)명) — 문제 생기면 이 파일로 복구 가능" -ForegroundColor Cyan
    return $path
}

function Invoke-InitialBulkImport {
    if (Test-Path $BulkImportMarkerPath) { return }

    Write-Host "=== 최초 설치 확인: 기존 회원 포인트 일괄 이전을 시작합니다 ===" -ForegroundColor Cyan
    $members = Champ-Query "SELECT MEM_NO, MEM_NM, MEM_TEL_1, MEM_REP_TEL, MEM_CARD_NO, MEM_USABLE_PNT FROM MEMBER WHERE MEM_USABLE_PNT > 0"

    Export-PointBackupCsv $members "initial" | Out-Null

    $withPhone = @()
    $noPhoneMembers = @()
    foreach ($m in $members) {
        $phone = $null
        if ($m.MEM_REP_TEL) { $phone = $m.MEM_REP_TEL } elseif ($m.MEM_TEL_1) { $phone = $m.MEM_TEL_1 }
        if ($phone) {
            $withPhone += @{ memNo = $m.MEM_NO; phone = $phone; cardNo = $m.MEM_CARD_NO; balance = [double]$m.MEM_USABLE_PNT }
        } else {
            $noPhoneMembers += $m
        }
    }

    Write-Host "전화번호 있는 회원 $($withPhone.Count)명 / 전화번호 없어 이번엔 못 옮기는 회원 $($noPhoneMembers.Count)명 (포인트 보유 회원 총 $($members.Count)명)"

    # 전화번호 없는 회원 — 서버로 옮길 방법이 아직 없음(카드번호 기반 추후 병합은 별도 과제).
    # 그래도 포스DB에 그대로 두면 다음에 또 걸려 혼선만 생기므로, 위에서 이미 백업했으니
    # 영점화한다. 복구가 필요하면 반드시 백업 파일로 수동 처리.
    foreach ($m in $noPhoneMembers) {
        Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $m.MEM_NO)"
    }

    $imported = 0; $alreadyLinked = 0; $skipped = 0; $totalAmount = 0; $failed = 0
    $batchSize = 200
    for ($i = 0; $i -lt $withPhone.Count; $i += $batchSize) {
        $batch = $withPhone[$i..([Math]::Min($i + $batchSize - 1, $withPhone.Count - 1))]
        try {
            $entries = $batch | ForEach-Object { @{ phone = $_.phone; cardNo = $_.cardNo; balance = $_.balance } }
            $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/bulk-import" -Headers $AuthHeader -ContentType "application/json" -Body (@{ entries = $entries } | ConvertTo-Json -Depth 4)
            $imported += $res.imported; $alreadyLinked += $res.alreadyLinked; $skipped += $res.skippedInvalidPhone; $totalAmount += $res.totalAmount
            # 서버 반영이 확인된 배치만 로컬을 0으로 — 백업은 이미 떠둔 상태라 안전.
            foreach ($e in $batch) {
                Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $e.memNo)"
            }
        } catch {
            Write-Host "일괄 이전 중 오류(이 배치는 로컬 값을 그대로 두고 다음 실행 때 재시도합니다): $_" -ForegroundColor Red
            $failed++
        }
    }

    $summary = @{ ranAt = (Get-Date).ToString("o"); memberCount = $members.Count; withPhone = $withPhone.Count; noPhone = $noPhoneMembers.Count; imported = $imported; alreadyLinked = $alreadyLinked; skippedInvalidPhone = $skipped; totalAmount = $totalAmount; failedBatches = $failed }
    Write-Host "=== 일괄 이전 완료: 새로 이전 $imported 명 / 이미 있음 $alreadyLinked 명 / 합계 $totalAmount 원 (실패 배치 $failed) ===" -ForegroundColor Green
    if ($failed -eq 0) {
        $summary | ConvertTo-Json | Out-File -Encoding UTF8 $BulkImportMarkerPath
    } else {
        Write-Host "일부 배치가 실패해 완료 표시를 남기지 않았습니다 — 다음 실행 때 이어서 시도합니다(실패 배치 회원은 로컬 잔액이 남아있어 자동 재시도됨)." -ForegroundColor Yellow
    }
}

# ─── 대표 포스기 바탕화면 바로가기 ────────────────────────────────────────────

function Set-ManageShortcut([bool]$isPrimary, [string]$storeUrl) {
    $shortcutPath = "$([Environment]::GetFolderPath('Desktop'))\포인트 관리모드.lnk"
    if ($isPrimary) {
        if (-not (Test-Path $shortcutPath)) {
            $ws = New-Object -ComObject WScript.Shell
            $lnk = $ws.CreateShortcut($shortcutPath)
            $lnk.TargetPath = (Get-Command "$env:ProgramFiles\Internet Explorer\iexplore.exe" -ErrorAction SilentlyContinue).Path
            if (-not $lnk.TargetPath) { $lnk.TargetPath = $storeUrl } # 브라우저 경로를 못 찾으면 URL만 지정(OS가 기본 브라우저로 열어줌)
            if ($lnk.TargetPath -ne $storeUrl) { $lnk.Arguments = $storeUrl }
            if (Test-Path "$PSScriptRoot\pointmanager.ico") { $lnk.IconLocation = "$PSScriptRoot\pointmanager.ico" }
            $lnk.Description = "포인트 관리 프로그램 — 매장 관리모드(웹과 동일 화면)"
            $lnk.Save()
        }
    } elseif (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force
    }
}

# ─── 하트비트 ────────────────────────────────────────────────────────────────

$Script:IsPrimary = [bool]$cfg.isPrimary

function Send-Heartbeat {
    try {
        $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/terminals/heartbeat" -Headers $AuthHeader
        $Script:IsPrimary = [bool]$res.isPrimary
        if ($res.storeUrl) { Set-ManageShortcut -isPrimary $Script:IsPrimary -storeUrl $res.storeUrl }
        return $true
    } catch {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 하트비트 실패: $_" -ForegroundColor Yellow
        return $false
    }
}

# ─── 같은 매장 내 다른 포스기를 LAN에서 찾아 등록하기 (2026-09-27, 코드 직접입력 대체) ──
# 미등록 단말은 "나 여기 있음"을 UDP로 방송하고, 대표 포스기는 그 방송을 모아뒀다가
# 관리모드 화면(같은 PC의 브라우저)이 로컬로 물어보면 목록을 보여준다. 관리자가 "등록"을
# 누르면 대표 포스기가 서버에서 코드를 대신 받아 그 단말에게 직접(LAN, 브라우저 안 거침)
# 전달해 등록을 완성시킨다 — 계산원이 코드를 몰라도 되게 하는 게 목적.

$Script:Peers = @{}  # ip -> @{ name; isPrimary; registered; lastSeen }

function Start-DiscoveryAnnounce {
    $Script:AnnounceTimer = New-Object System.Windows.Forms.Timer
    $Script:AnnounceTimer.Interval = $DiscoveryIntervalSec * 1000
    $Script:AnnounceTimer.Add_Tick({
        try {
            $udp = New-Object System.Net.Sockets.UdpClient
            $udp.EnableBroadcast = $true
            $payload = @{ instanceId = $Script:MyInstanceId; name = $cfg.name; isPrimary = $Script:IsPrimary; registered = $true } | ConvertTo-Json -Compress
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
            $udp.Send($bytes, $bytes.Length, "255.255.255.255", $DiscoveryUdpPort) | Out-Null
            $udp.Close()
        } catch { }
    })
    $Script:AnnounceTimer.Start()
}

function Start-DiscoveryListener {
    try {
        $Script:UdpListener = New-Object System.Net.Sockets.UdpClient($DiscoveryUdpPort)
        $Script:UdpListener.Client.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
    } catch {
        Write-Host "LAN 탐색 수신 실패(다른 프로그램이 포트를 쓰는 중일 수 있음): $_" -ForegroundColor Yellow
        return
    }
    $Script:DiscoveryPollTimer = New-Object System.Windows.Forms.Timer
    $Script:DiscoveryPollTimer.Interval = 1000
    $Script:DiscoveryPollTimer.Add_Tick({
        while ($Script:UdpListener.Available -gt 0) {
            $remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
            $bytes = $Script:UdpListener.Receive([ref]$remote)
            try {
                $msg = [System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
                if ($msg.instanceId -eq $Script:MyInstanceId) { continue } # 내가 보낸 걸 나한테서 받은 경우 무시
                $Script:Peers[$remote.Address.ToString()] = @{ name = $msg.name; isPrimary = $msg.isPrimary; registered = $msg.registered; lastSeen = Get-Date }
            } catch { }
        }
        # 30초 넘게 소식 없으면 목록에서 제거(꺼진 단말)
        foreach ($ip in @($Script:Peers.Keys)) {
            if (((Get-Date) - $Script:Peers[$ip].lastSeen).TotalSeconds -gt 30) { $Script:Peers.Remove($ip) }
        }
    })
    $Script:DiscoveryPollTimer.Start()
}

# 대표 포스기만 로컬 HTTP를 연다 — 같은 PC의 관리모드 브라우저 화면이 여기로 물어본다.
# 관리자 권한이 없으면 0.0.0.0 바인딩이 막힐 수 있어(그러면 발견 목록 기능만 빠짐) 실패해도
# 나머지 기능(적립·사용·하트비트)은 그대로 동작하게 try/catch로 감싼다.
function Start-LocalHttpApi {
    try {
        $Script:HttpListener = New-Object System.Net.HttpListener
        $Script:HttpListener.Prefixes.Add("http://+:$LocalHttpPort/")
        $Script:HttpListener.Start()
        # HttpListener에는 Pending() 메서드가 없다(TcpListener와 다름, 2026-09-29 확인된 버그) —
        # BeginGetContext/EndGetContext + AsyncWaitHandle.WaitOne(0)의 논블로킹 패턴으로 대체.
        $Script:HttpPendingCtx = $Script:HttpListener.BeginGetContext($null, $null)
    } catch {
        Write-Host "로컬 관리 API 시작 실패(발견 목록 기능만 빠짐, 관리자 권한으로 재실행하면 됩니다): $_" -ForegroundColor Yellow
        return
    }
    $Script:HttpPollTimer = New-Object System.Windows.Forms.Timer
    $Script:HttpPollTimer.Interval = 300
    $Script:HttpPollTimer.Add_Tick({
        while ($Script:HttpListener.IsListening -and $Script:HttpPendingCtx -and $Script:HttpPendingCtx.AsyncWaitHandle.WaitOne(0)) {
            $ctx = $Script:HttpListener.EndGetContext($Script:HttpPendingCtx)
            $Script:HttpPendingCtx = $Script:HttpListener.BeginGetContext($null, $null)
            try {
                $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
                if ($ctx.Request.Url.AbsolutePath -eq "/discovered" -and $ctx.Request.HttpMethod -eq "GET") {
                    $list = @($Script:Peers.GetEnumerator() | Where-Object { -not $_.Value.registered } | ForEach-Object {
                        @{ ip = $_.Key; name = $_.Value.name }
                    })
                    $json = ConvertTo-Json @{ isPrimary = $Script:IsPrimary; peers = $list } -Depth 4
                    $buf = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $ctx.Response.ContentType = "application/json"
                    $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
                } elseif ($ctx.Request.Url.AbsolutePath -eq "/register-peer" -and $ctx.Request.HttpMethod -eq "POST") {
                    $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
                    $body = $reader.ReadToEnd() | ConvertFrom-Json
                    $ok = Register-PeerByIp -targetIp $body.ip
                    $buf = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ ok = $ok }))
                    $ctx.Response.ContentType = "application/json"
                    $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
                } else {
                    $ctx.Response.StatusCode = 404
                }
            } catch {
                $ctx.Response.StatusCode = 500
            } finally {
                $ctx.Response.OutputStream.Close()
            }
        }
    })
    $Script:HttpPollTimer.Start()
}

# 대표 포스기 쪽: 관리모드 화면에서 "등록" 클릭 → 서버에서 코드를 대신 받아 그 단말(LAN, IP로 직접)에 전달
function Register-PeerByIp([string]$targetIp) {
    try {
        $codeRes = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/pairing-code" -Headers $AuthHeader
        Invoke-RestMethod -Method Post -Uri "http://${targetIp}:${LocalHttpPort}/apply-code" -ContentType "application/json" `
            -Body (@{ code = $codeRes.code } | ConvertTo-Json) -TimeoutSec 10 | Out-Null
        return $true
    } catch {
        Write-Host "원격 등록 전달 실패($targetIp): $_" -ForegroundColor Red
        return $false
    }
}

# ─── 사용(REDEEM) 팝업 — 스왑 대기 목록: MEM_NO -> {original=원래 로컬값, at=스왑 시각} ──

$Script:SwapPending = @{}

function Show-RedeemPopup {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "포인트 사용"; $form.Width = 380; $form.Height = 260; $form.StartPosition = "CenterScreen"
    $form.TopMost = $true; $form.FormBorderStyle = "FixedDialog"

    $lblPhone = New-Object System.Windows.Forms.Label; $lblPhone.Text = "손님 전화번호"; $lblPhone.Location = New-Object System.Drawing.Point(20, 20); $lblPhone.AutoSize = $true
    $txtPhone = New-Object System.Windows.Forms.TextBox; $txtPhone.Location = New-Object System.Drawing.Point(20, 45); $txtPhone.Width = 320; $txtPhone.Font = New-Object System.Drawing.Font("맑은 고딕", 14)
    $btnLookup = New-Object System.Windows.Forms.Button; $btnLookup.Text = "조회"; $btnLookup.Location = New-Object System.Drawing.Point(20, 80); $btnLookup.Width = 320; $btnLookup.Height = 34
    $lblResult = New-Object System.Windows.Forms.Label; $lblResult.Location = New-Object System.Drawing.Point(20, 125); $lblResult.Width = 320; $lblResult.Height = 70
    $lblResult.Font = New-Object System.Drawing.Font("맑은 고딕", 12)
    $btnClose = New-Object System.Windows.Forms.Button; $btnClose.Text = "닫기"; $btnClose.Location = New-Object System.Drawing.Point(20, 195); $btnClose.Width = 320

    $btnLookup.Add_Click({
        $phone = $txtPhone.Text -replace '[^0-9]', ''
        if ($phone.Length -lt 9) { $lblResult.Text = "전화번호를 확인해주세요."; return }
        try {
            $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/redeem" -Headers $AuthHeader -ContentType "application/json" `
                -Body (@{ action = "lookup"; phone = $phone } | ConvertTo-Json)
        } catch {
            # 같은 손님을 다른 포스기에서 이미 조회 중이면 서버가 409로 거부한다(이중사용 방지, 2026-09-28).
            $errBody = $null
            try { $errBody = ($_.ErrorDetails.Message | ConvertFrom-Json) } catch {}
            if ($errBody -and $errBody.error -eq "REDEEM_IN_PROGRESS_ELSEWHERE") {
                $lblResult.Text = "이 손님은 지금 다른 포스기에서 포인트를 사용 중입니다.`n잠시 후 다시 조회해주세요."
            } else {
                $lblResult.Text = "서버 조회 실패: $_"
            }
            return
        }
        $members = Champ-Query "SELECT MEM_NO, MEM_USABLE_PNT FROM MEMBER WHERE MEM_TEL_1=$(Sql-Str $phone) OR MEM_REP_TEL=$(Sql-Str $phone)"
        if ($members.Count -eq 0) {
            $lblResult.Text = "가용 포인트: $($res.availableBalance)원`n(주의: 이 손님은 챔프에 회원으로 등록돼 있지 않아 챔프 화면에서 포인트결제를 쓸 수 없습니다. 먼저 챔프에서 신규회원등록을 해주세요.)"
            return
        }
        $memNo = $members[0].MEM_NO
        # 덮어쓰기가 아니라 더하기: 이 조회 시점에 로컬 값이 이미 0이 아닐 수 있다(직전에
        # 발생한 적립이 아직 큐 처리를 못 받아 로컬에 남아있는 경우 등) — 덮어쓰면 그 값을
        # 그냥 날려버리게 되므로, 로컬 기존값 + 서버 가용잔액을 합쳐서 반영한다(2026-09-28).
        $localBefore = [double]$members[0].MEM_USABLE_PNT
        $newLocal = $localBefore + [double]$res.availableBalance
        Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=$newLocal WHERE MEM_NO=$(Sql-Str $memNo)"
        $Script:SwapPending[$memNo] = @{ localBefore = $localBefore; injected = [double]$res.availableBalance; at = Get-Date; phone = $phone }
        $lblResult.Text = "가용 포인트 $([int]$res.availableBalance)원을 챔프 화면에 더했습니다(화면 표시 $([int]$newLocal)원).`n계산원님, 챔프에서 포인트결제를 진행하세요."
    })
    $btnClose.Add_Click({ $form.Close() })

    $form.Controls.AddRange(@($lblPhone, $txtPhone, $btnLookup, $lblResult, $btnClose))
    $form.ShowDialog() | Out-Null
}

function Show-ResultToast([string]$text) {
    # 적립 결과를 알려주는 알림창(입력 없음, 몇 초 후 자동 닫힘)
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "포인트 관리 프로그램"; $form.Width = 320; $form.Height = 130; $form.StartPosition = "CenterScreen"
    $form.TopMost = $true; $form.FormBorderStyle = "FixedToolWindow"
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $text; $lbl.Dock = "Fill"; $lbl.TextAlign = "MiddleCenter"; $lbl.Font = New-Object System.Drawing.Font("맑은 고딕", 12)
    $form.Controls.Add($lbl)
    $timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 4000
    $timer.Add_Tick({ $form.Close(); $timer.Stop() })
    $timer.Start()
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
}

# ─── 큐 폴링(백그라운드 루프) ──────────────────────────────────────────────────

function Restore-SwappedIfDone($memNo) {
    if (-not $Script:SwapPending.ContainsKey($memNo)) { return }
    # 초기화 이후 스테디스테이트: 거래가 없을 때 포스DB 잔액은 항상 0이어야 한다(서버가
    # 유일한 진실). 예전엔 스왑 전 값(entry.original)으로 되돌렸지만, 초기화 이후에는 그
    # 원래값도 사실 0이었어야 하므로 0으로 되돌린다(2026-09-28).
    Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $memNo)"
    $Script:SwapPending.Remove($memNo)
}

function Restore-TimedOutSwaps {
    $now = Get-Date
    foreach ($memNo in @($Script:SwapPending.Keys)) {
        if (($now - $Script:SwapPending[$memNo].at).TotalSeconds -gt $SwapTimeoutSec) {
            Write-Host "$(Get-Date -Format 'HH:mm:ss') 사용 대기 시간초과 — $memNo 원복"
            Restore-SwappedIfDone $memNo
        }
    }
}

function Process-Queue {
    $rows = Champ-Query "SELECT CRAB_SEQ, MEM_NO, MEMP_AMT, MEMP_ADD_AMT, MEMP_USED_AMT, MEMP_CARD_NO, SRC_SELLS_DT, SRC_CHN_NO FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N' ORDER BY CRAB_SEQ"
    foreach ($r in $rows) {
        $memNo = $r.MEM_NO
        $vendorTxnKey = "$($cfg.terminalId)-$($r.CRAB_SEQ)"
        try {
            $member = Champ-Query "SELECT MEM_TEL_1, MEM_REP_TEL FROM MEMBER WHERE MEM_NO=$(Sql-Str $memNo)"
            $phone = $null
            if ($member.Count -gt 0) {
                if ($member[0].MEM_TEL_1) { $phone = $member[0].MEM_TEL_1 }
                elseif ($member[0].MEM_REP_TEL) { $phone = $member[0].MEM_REP_TEL }
            }

            if ($phone) {
                if ([double]$r.MEMP_ADD_AMT -gt 0) {
                    # 챔프 자체 포인트 기능(자동 적립이든 계산원 수기 입력이든 MEMBER_POINT에
                    # 똑같이 기록됨)이 이미 계산해둔 적립액(MEMP_ADD_AMT)을 그대로 서버에 반영한다
                    # — 서버가 별도 요율로 재계산하지 않는다(2026-09-28).
                    $earnRes = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/earn" -Headers $AuthHeader -ContentType "application/json" -Body (@{
                        phone = $phone; addAmount = [double]$r.MEMP_ADD_AMT; saleAmount = [double]$r.MEMP_AMT; cardNo = $r.MEMP_CARD_NO; vendorTxnId = "EARN-$vendorTxnKey"
                    } | ConvertTo-Json)
                    if ([double]$earnRes.earnAmount -gt 0) {
                        Show-ResultToast "적립 완료`n$([int]$earnRes.earnAmount)원 적립`n잔액 $([int]$earnRes.availableBalance)원"
                    }
                    # 서버 반영이 확인된 뒤에만 로컬을 소모한다(인터넷이 끊겨 위 호출이 실패하면
                    # 예외로 빠져 이 줄까지 오지 않고, 큐 행도 PROCESSED='Y'로 안 바뀌어 다음
                    # 폴링 때 재시도된다 — 오프라인 중 결제가 계속돼도 안전, 2026-09-28).
                    # 이번 처리분만큼만 차감(0으로 덮어쓰지 않음) — 그 사이 새 적립이 더 쌓였을
                    # 수 있어서다.
                    Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=MEM_USABLE_PNT-$([double]$r.MEMP_ADD_AMT) WHERE MEM_NO=$(Sql-Str $memNo)"
                }
                if ([double]$r.MEMP_USED_AMT -gt 0) {
                    Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/redeem" -Headers $AuthHeader -ContentType "application/json" -Body (@{
                        action = "apply"; phone = $phone; usedAmount = [double]$r.MEMP_USED_AMT; cardNo = $r.MEMP_CARD_NO; vendorTxnId = "USE-$vendorTxnKey"
                    } | ConvertTo-Json) | Out-Null
                }
            } else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss') MEM_NO=$memNo 전화번호 미등록 — 적립 건너뜀"
            }

            Restore-SwappedIfDone $memNo
            Champ-Exec "UPDATE CRAB_EVENT_QUEUE SET PROCESSED='Y' WHERE CRAB_SEQ=$($r.CRAB_SEQ)"
        } catch {
            Write-Host "$(Get-Date -Format 'HH:mm:ss') 큐 처리 실패(CRAB_SEQ=$($r.CRAB_SEQ)): $_" -ForegroundColor Red
            # 처리 실패 건은 PROCESSED='Y'로 안 바꿔서 다음 순회에 재시도(멱등키가 있어 서버 쪽 중복 반영은 안 됨)
        }
    }
    Restore-TimedOutSwaps
}

# ─── 사용 팝업 트레이 아이콘 ───────────────────────────────────────────────────

$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = if (Test-Path "$PSScriptRoot\pointmanager.ico") { New-Object System.Drawing.Icon("$PSScriptRoot\pointmanager.ico") } else { [System.Drawing.SystemIcons]::Application }
$trayIcon.Text = "포인트 관리 프로그램 — $($cfg.name)"
$trayIcon.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemRedeem = $menu.Items.Add("포인트 사용...")
$itemRedeem.Add_Click({ Show-RedeemPopup })
$itemExit = $menu.Items.Add("종료")
$itemExit.Add_Click({ $trayIcon.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$trayIcon.ContextMenuStrip = $menu
$trayIcon.Add_DoubleClick({ Show-RedeemPopup })

Write-Host "터미널 '$($cfg.name)' 가동 시작 — 트레이 아이콘 더블클릭으로 '포인트 사용' 팝업을 엽니다."

$heartbeatTimer = New-Object System.Windows.Forms.Timer; $heartbeatTimer.Interval = 60000
$heartbeatTimer.Add_Tick({ Send-Heartbeat | Out-Null })
$heartbeatTimer.Start()
Send-Heartbeat | Out-Null

try { Invoke-InitialBulkImport } catch { Write-Host "일괄 이전 시도 중 오류: $_" -ForegroundColor Red }

$queueTimer = New-Object System.Windows.Forms.Timer; $queueTimer.Interval = $QueuePollSec * 1000
$queueTimer.Add_Tick({
    try { Process-Queue } catch { Write-Host "큐 폴링 오류: $_" -ForegroundColor Red }
})
$queueTimer.Start()

# LAN 안의 다른 포스기를 찾고(모든 단말) 대표 포스기면 등록 창구를 연다.
Start-DiscoveryAnnounce
Start-DiscoveryListener
Start-LocalHttpApi

[System.Windows.Forms.Application]::Run()
