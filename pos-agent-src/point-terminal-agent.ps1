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
# 설치·최초 실행 안내(계산원용): 매장 관리자가 카운터 PC의 브라우저에서 홈페이지에 로그인해 매장
# 관리모드의 "포스기 다운로드"를 누르면, 그 매장 전용 설치 정보가 담긴 압축파일이 받아집니다.
# 압축을 (지워지지 않는 폴더에) 풀고 "start.bat"을 더블클릭하면 인증코드 입력 없이 설치·등록·초기화가
# 자동으로 끝나고, 이 매장의 포스기 목록이 창으로 표시됩니다(매장의 첫 단말은 자동으로 대표 포스기).
# 이후 컴퓨터를 켤 때마다 자동으로 시작됩니다. 챔프 DB 준비도 전부 자동입니다.
#
# start.bat은 여러 번 실행해도 안전합니다 — 이미 실행 중이면 새로 띄우지 않고, 이미 등록된 PC면 다시 등록하지
# 않습니다. 프로그램 본체는 창 없이(숨김) 실행되므로 검은 창을 닫아도 꺼지지 않습니다. 실행 기록은
# 같은 폴더의 agent.log에 남습니다. 제거는 uninstall.bat, 포인트 복구는 restore.bat 입니다.
#
# 실행 방식(-Setup): start.bat이 이 스크립트를 -Setup으로 실행 → 등록·자동시작 확인 후 본체를 숨김 실행하고 끝납니다.
#                   -Setup 없이 실행하면 프로그램 본체입니다(자동시작이 이 방식으로 실행).

param(
    [string]$BaseUrl = "https://concrab.com",
    [string]$ConfigPath = "$PSScriptRoot\terminal-config.json",
    [int]$QueuePollSec = 3,
    [int]$SwapTimeoutSec = 180,  # 사용 팝업으로 잠시 바꿔둔 포인트를 이 시간 안에 결제완료를 못 보면 강제로 원복
    [switch]$Setup,    # start.bat이 지정 — 설치·등록·자동시작 확인 후 본체를 숨김 실행하고 종료
    [switch]$ShowList  # 방금 설치·등록한 직후 이 매장의 포스기 목록을 한 번 보여준다
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing


# ─── 공용 도우미: 중복 실행 방지·프로세스·로그 ───────────────────────────────────

$MutexName = "Global\PointManagerAgent"

# 프로그램 본체는 한 PC에서 하나만 실행돼야 한다 — 둘이 떠 있으면 같은 결제 대기열(CRAB_EVENT_QUEUE)을 둘 다 처리해
# 포스DB 잔액을 이중으로 차감하게 된다. 이미 실행 중이면 $false.
function Enter-SingleInstance {
    try { $m = New-Object System.Threading.Mutex($false, $MutexName) }
    catch { $m = New-Object System.Threading.Mutex($false, "Local\PointManagerAgent") }
    $Script:InstanceMutex = $m  # 프로세스가 끝날 때까지 유지
    try { return $m.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { return $true }  # 이전 프로세스가 비정상 종료한 경우
}

# 지금 프로그램 본체가 실행 중인가(실행 중이면 그 프로세스가 뮤텍스를 열어 두고 있다).
function Test-AgentRunning {
    try { $m = [System.Threading.Mutex]::OpenExisting($MutexName); $m.Dispose(); return $true }
    catch [System.Threading.WaitHandleCannotBeOpenedException] { return $false }
    catch { return $true }
}

# 압축 미리보기/임시 폴더에서 실행하면 설치 정보가 사라지거나 자동시작이 깨진다.
function Test-TempFolder {
    return ($PSScriptRoot -imatch '\\AppData\\Local\\Temp(\\|$)') -or ($PSScriptRoot -imatch '\.zip(\\|$)') -or ($PSScriptRoot -match 'Rar\$')
}

# 숨김 실행되는 본체의 출력(Write-Host 포함)을 agent.log에 남긴다. 5MB가 넘으면 agent.log.old로 넘기고 새로 시작.
function Start-AgentLog {
    try {
        $log = "$PSScriptRoot\agent.log"
        if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Move-Item $log "$log.old" -Force }
        Start-Transcript -Path $log -Append -Force | Out-Null
    } catch { }
}

# 서버·포스DB 오류를 계산원이 이해할 수 있는 문구로 바꾼다(기술 용어·영문 오류를 그대로 보여주지 않는다). 자세한 내용은 agent.log에 남는다.
function Get-FriendlyError($err) {
    $status = 0
    try { $status = [int]$err.Exception.Response.StatusCode } catch { }
    $code = $null
    try { $code = ($err.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
    if ($status -eq 0) { return "서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요." }
    switch ($code) {
        "TERMINAL_REVOKED" { return "이 포스기의 등록이 해지되었습니다. 매장 관리자에게 문의해주세요." }
        "INVALID_API_KEY" { return "이 포스기의 등록 정보가 올바르지 않습니다. 매장 관리자에게 문의해주세요." }
        "WRITE_REDEEM_NOT_CONSENTED" { return "이 매장은 포인트 사용이 꺼져 있습니다. 매장 관리모드의 'POS 연동 동의'에서 켜주세요." }
        "WRITE_EARN_NOT_CONSENTED" { return "이 매장은 포인트 적립이 꺼져 있습니다. 매장 관리모드의 'POS 연동 동의'에서 켜주세요." }
        "STORE_HAS_NO_COMPANY" { return "매장 정보가 아직 정리되지 않았습니다. 본사에 문의해주세요." }
        "REDEEM_IN_PROGRESS_ELSEWHERE" { return "이 손님은 지금 다른 포스기에서 포인트를 사용 중입니다.`n잠시 후 다시 조회해주세요." }
        "INVALID_PHONE" { return "전화번호를 확인해주세요." }
    }
    return "일시적인 오류입니다. 잠시 후 다시 시도해주세요."
}

# 회원의 전화번호 — 대표번호(MEM_REP_TEL)를 먼저, 없거나 짧으면 MEM_TEL_1. 숫자만 남겨 9자리 이상이어야 전화번호로 본다
# (짧은 값·메모는 전화번호가 아니다). 일괄 이전과 적립이 같은 규칙을 써야 같은 손님이 같은 계정에 쌓인다.
function Resolve-MemberPhone($rep, $tel1) {
    foreach ($cand in @($rep, $tel1)) {
        if ($cand) {
            $digits = ("$cand" -replace '[^0-9]', '')
            if ($digits.Length -ge 9) { return $digits }
        }
    }
    return $null
}

# ─── 설정 ────────────────────────────────────────────────────────────────────

function Load-Config {
    if (Test-Path $ConfigPath) { return Get-Content $ConfigPath -Raw | ConvertFrom-Json }
    return $null
}
function Save-Config($cfg) { $cfg | ConvertTo-Json | Out-File -Encoding UTF8 $ConfigPath }


# 다운로드한 압축파일에는 매장별 1회용 설치 토큰이 든 provision.json이 함께 들어 있다. 이 토큰으로
# 사람이 아무것도 입력하지 않아도 이 컴퓨터가 스스로 그 매장의 포스기로 등록된다(첫 단말은 자동으로
# 대표 포스기). 토큰은 등록에 성공하면 서버에서 소모되고, 이 파일도 지운다.
$ProvisionPath = "$PSScriptRoot\provision.json"

function Register-Terminal {
    $name = $env:COMPUTERNAME  # 단말 이름은 묻지 않고 컴퓨터 이름을 그대로 쓴다
    if (-not (Test-Path $ProvisionPath)) {
        Write-Host "설치 정보(provision.json)가 없습니다. 포인트 관리 홈페이지의 매장 관리모드에서 포스기를 다시 다운로드해 새로 설치해주세요." -ForegroundColor Red
        exit 1
    }
    $prov = Get-Content $ProvisionPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($prov.baseUrl) { $Script:BaseUrl = $prov.baseUrl }

    try {
        $body = @{ token = $prov.token; terminalName = $name } | ConvertTo-Json
        $res = Invoke-RestMethod -Method Post -Uri "$Script:BaseUrl/api/v1/pos/agent/register" -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
    } catch {
        Write-Host "등록 실패: $_" -ForegroundColor Red
        Write-Host "이미 사용했거나 24시간이 지난 설치 파일일 수 있습니다. 홈페이지에서 포스기를 다시 다운로드해주세요." -ForegroundColor Yellow
        exit 1
    }
    $cfg = @{ terminalId = $res.terminalId; apiKey = $res.apiKey; name = $name; baseUrl = $Script:BaseUrl; isPrimary = [bool]$res.isPrimary; storeName = $res.storeName }
    Save-Config $cfg
    Remove-Item $ProvisionPath -Force -ErrorAction SilentlyContinue
    Write-Host "등록 완료 — '$($res.storeName)' 매장의 포스기로 연결되었습니다." -ForegroundColor Green
    return ($cfg | ConvertTo-Json | ConvertFrom-Json)
}

# 이 매장에 등록된 포스기 목록을 창으로 보여준다(설치 직후 자동으로 한 번, 이후엔 트레이 메뉴에서).
function Show-TerminalList {
    try {
        $res = Invoke-RestMethod -Method Get -Uri "$($cfg.baseUrl)/api/v1/pos/agent/terminals" -Headers $AuthHeader
    } catch {
        Write-Host "포스기 목록 조회 실패: $_"
        [System.Windows.Forms.MessageBox]::Show("포스기 목록을 불러오지 못했습니다.`n$(Get-FriendlyError $_)", "포인트 관리 프로그램") | Out-Null
        return
    }
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "포스기 목록 — $($cfg.storeName)"; $form.Width = 460; $form.Height = 360; $form.StartPosition = "CenterScreen"
    $form.TopMost = $true; $form.FormBorderStyle = "FixedDialog"
    $list = New-Object System.Windows.Forms.ListBox
    $list.Location = New-Object System.Drawing.Point(15, 15); $list.Width = 415; $list.Height = 260
    $list.Font = New-Object System.Drawing.Font("맑은 고딕", 11)
    foreach ($t in $res.terminals) {
        $tags = @()
        if ($t.isPrimary) { $tags += "대표" }
        if ($t.isSelf) { $tags += "이 컴퓨터" }
        $state = if ($t.online) { "가동중" } else { "오프라인" }
        $tagText = if ($tags.Count -gt 0) { " [" + ($tags -join ", ") + "]" } else { "" }
        $list.Items.Add("$($t.name)$tagText — $state") | Out-Null
    }
    $btnClose = New-Object System.Windows.Forms.Button; $btnClose.Text = "닫기"; $btnClose.Location = New-Object System.Drawing.Point(15, 285); $btnClose.Width = 415
    $btnClose.Add_Click({ $form.Close() })
    $form.Controls.AddRange(@($list, $btnClose))
    $form.ShowDialog() | Out-Null
}


# ─── 부팅/로그온 시 자동 시작 등록 (최초 실행 때 1회, 재부팅해도 사람이 다시 실행할 필요 없게) ──

function Ensure-AutoStart {
    $taskName = "PointManagerAgent"
    $scriptPath = $PSCommandPath
    $taskArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
    try {
        # 이미 같은 경로로 등록돼 있으면 그대로 둔다. 폴더를 옮겼거나 등록이 사라졌으면 다시 등록한다.
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($existing) {
            $cur = ($existing.Actions | Select-Object -First 1).Arguments
            if ($cur -eq $taskArgs) { return }
        }
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        # 관리자 권한(Highest)은 필요 없다 — 일반 권한으로 등록해야 관리자가 아닌 계정에서도 실패하지 않는다.
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
        Write-Host "다음 로그온부터 자동으로 시작되도록 등록했습니다." -ForegroundColor Green
    } catch {
        # 작업 스케줄러 등록이 막힌 PC — 시작프로그램 폴더 바로가기로 대신한다.
        try {
            $startup = [Environment]::GetFolderPath('Startup')
            $lnkPath = Join-Path $startup "포인트 관리 프로그램.lnk"
            $ws = New-Object -ComObject WScript.Shell
            $lnk = $ws.CreateShortcut($lnkPath)
            $lnk.TargetPath = "powershell.exe"
            $lnk.Arguments = $taskArgs
            $lnk.WindowStyle = 7
            $lnk.Description = "포인트 관리 프로그램 자동 시작"
            $lnk.Save()
            Write-Host "다음 로그온부터 자동으로 시작되도록 시작프로그램에 등록했습니다." -ForegroundColor Green
        } catch {
            Write-Host "자동시작 등록 실패(컴퓨터를 켤 때마다 start.bat을 실행해야 할 수 있음): $_" -ForegroundColor Yellow
        }
    }
}

# ─── 설치·실행 단계(start.bat이 -Setup으로 실행) ──────────────────────────────────
# 여러 번 실행해도 안전하다: 이미 실행 중이면 새로 띄우지 않고, 이미 등록된 PC면 다시 등록하지 않는다.
function Invoke-Setup {
    Write-Host "=== 포인트 관리 프로그램 설치/실행 ===" -ForegroundColor Cyan

    if (Test-TempFolder) {
        Write-Host "이 폴더는 임시 위치(압축 미리보기/Temp)입니다. 압축을 지워지지 않는 폴더(예: C:\포인트관리)에 완전히 푼 뒤, 그 폴더의 start.bat을 실행해주세요." -ForegroundColor Red
        return
    }

    $running = Test-AgentRunning

    if (Load-Config) {
        # 이미 등록된 PC — 다시 등록하지 않는다(남아 있는 1회용 설치 정보도 쓰지 않는다).
        $c = Load-Config
        if (Test-Path $ProvisionPath) { Remove-Item $ProvisionPath -Force -ErrorAction SilentlyContinue }
        Write-Host "이미 등록된 포스기입니다 ($($c.storeName) / $($c.name))." -ForegroundColor Green
        $firstTime = $false
    } else {
        Register-Terminal | Out-Null   # 실패하면 안내를 출력하고 종료한다
        $firstTime = $true
    }

    Ensure-AutoStart

    if ($running) {
        Write-Host "프로그램이 이미 실행 중입니다. 다시 실행하지 않습니다 — 화면 오른쪽 아래 트레이의 '포인트 관리' 아이콘을 확인하세요." -ForegroundColor Green
        return
    }

    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$PSCommandPath`"")
    if ($firstTime) { $argList += "-ShowList" }
    Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WindowStyle Hidden
    Write-Host "포인트 관리 프로그램을 실행했습니다. 이 창은 닫아도 프로그램은 계속 실행됩니다." -ForegroundColor Green
    if ($firstTime) { Write-Host "(처음 설치라면 기존 회원 포인트 이전에 시간이 걸릴 수 있습니다. 진행 기록: agent.log)" }
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

# start.bat은 -Setup으로 실행한다 — 설치·등록만 하고 본체를 숨김 실행한 뒤 끝난다.
if ($Setup) { Invoke-Setup; exit 0 }

# ── 여기부터 프로그램 본체 ── 한 PC에서 하나만 실행된다(중복 실행은 같은 결제 대기열을 두 번 처리해 포스 잔액이 이중 차감됨).
if (-not (Enter-SingleInstance)) { exit 0 }
Start-AgentLog

$cfg = Load-Config
if (-not $cfg) {
    # 설정 없이 본체가 직접 실행된 경우(구버전 방식) — 설치 정보로 등록한다.
    $cfg = Register-Terminal
    $ShowList = $true
    Ensure-AutoStart
}
$AuthHeader = @{ Authorization = "Bearer $($cfg.apiKey)" }

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
        $phone = Resolve-MemberPhone $m.MEM_REP_TEL $m.MEM_TEL_1
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
            Write-Host "$(Get-Date -Format 'HH:mm:ss') 사용 조회 실패: $_"
            $lblResult.Text = Get-FriendlyError $_
            return
        }
        try {
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
        } catch {
            # 챔프(포스DB) 조회·수정이 실패한 경우 — 화면이 멈추거나 오류창이 뜨지 않고 안내만 보여준다.
            Write-Host "$(Get-Date -Format 'HH:mm:ss') 포스DB 처리 실패(사용 조회): $_" -ForegroundColor Red
            $lblResult.Text = "포스 프로그램(챔프)과 연결하지 못했습니다. 챔프가 켜져 있는지 확인하고 다시 조회해주세요."
        }
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
            if ($member.Count -gt 0) { $phone = Resolve-MemberPhone $member[0].MEM_REP_TEL $member[0].MEM_TEL_1 }

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
            $qerr = $_
            $qstatus = 0
            try { $qstatus = [int]$qerr.Exception.Response.StatusCode } catch { }
            if ($qstatus -eq 400) {
                # 서버가 "이 데이터는 처리할 수 없다"고 확정한 경우(잘못된 값) — 계속 재시도하면 같은 오류만 반복되므로 건너뛴다.
                # 포스 잔액은 건드리지 않는다(서버에 반영되지 않은 건이므로 그대로 둔다).
                Write-Host "$(Get-Date -Format 'HH:mm:ss') 큐 항목 건너뜀(서버가 거부, CRAB_SEQ=$($r.CRAB_SEQ)): $qerr" -ForegroundColor Yellow
                try {
                    Restore-SwappedIfDone $memNo
                    Champ-Exec "UPDATE CRAB_EVENT_QUEUE SET PROCESSED='Y' WHERE CRAB_SEQ=$($r.CRAB_SEQ)"
                } catch { }
            } else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss') 큐 처리 실패(CRAB_SEQ=$($r.CRAB_SEQ)): $qerr" -ForegroundColor Red
                # 일시적인 실패(인터넷 끊김 등)는 PROCESSED='Y'로 안 바꿔서 다음 순회에 재시도(멱등키가 있어 서버 쪽 중복 반영은 안 됨)
            }
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
$itemList = $menu.Items.Add("포스기 목록...")
$itemList.Add_Click({ Show-TerminalList })
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

# 방금 설치·등록한 직후라면 이 매장의 포스기 목록을 자동으로 한 번 보여준다.
if ($ShowList) {
    $Script:ListOnceTimer = New-Object System.Windows.Forms.Timer; $Script:ListOnceTimer.Interval = 1500
    $Script:ListOnceTimer.Add_Tick({ $Script:ListOnceTimer.Stop(); Show-TerminalList })
    $Script:ListOnceTimer.Start()
}

[System.Windows.Forms.Application]::Run()
