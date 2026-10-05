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
# 압축을 (지워지지 않는 폴더에) 풀고 "start.bat"을 더블클릭하면(또는 PointManager-Setup.exe 실행) 인증코드 입력 없이 설치·등록이
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
    $name = $env:COMPUTERNAME  # 서버가 등록 순서대로 POS001, POS002… 이름을 정해 돌려준다(아래). 매장 관리모드에서 바꿀 수 있다.
    if (-not (Test-Path $ProvisionPath)) {
        Write-Host "설치 정보(provision.json)가 없습니다. 포인트 관리 홈페이지의 매장 관리모드에서 포스기를 다시 다운로드해 새로 설치해주세요." -ForegroundColor Red
        exit 1
    }
    $prov = Get-Content $ProvisionPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($prov.baseUrl) { $Script:BaseUrl = $prov.baseUrl }

    # 어느 고객사·매장에 등록되는지 보여주고 확인받는다 — 잘못된 매장이면 등록하지 않는다(설치 정보도 소모되지 않는다).
    $where = "$($prov.storeName)"
    if ($prov.companyName) { $where = "$($prov.companyName) › $($prov.storeName)" }
    $ans = [System.Windows.Forms.MessageBox]::Show("이 컴퓨터를 아래 매장의 포스기로 등록합니다.`n`n  $where`n`n맞으면 [예]를 눌러주세요. 매장이 다르면 [아니오]를 누르고, 올바른 매장 화면에서 설치 파일을 다시 받아주세요.", "포인트 관리 프로그램 - 포스기 등록", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($ans -ne [System.Windows.Forms.DialogResult]::Yes) {
        Write-Host "등록을 취소했습니다." -ForegroundColor Yellow
        exit 1
    }

    try {
        $body = @{ token = $prov.token; terminalName = $name } | ConvertTo-Json
        $res = Invoke-RestMethod -Method Post -Uri "$Script:BaseUrl/api/v1/pos/agent/register" -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
    } catch {
        Write-Host "등록 실패: $_" -ForegroundColor Red
        Write-Host "이미 사용했거나 24시간이 지난 설치 파일일 수 있습니다. 홈페이지에서 포스기를 다시 다운로드해주세요." -ForegroundColor Yellow
        exit 1
    }
    if ($res.terminalName) { $name = $res.terminalName }
    $cfg = @{ terminalId = $res.terminalId; apiKey = $res.apiKey; name = $name; baseUrl = $Script:BaseUrl; isPrimary = [bool]$res.isPrimary; storeName = $res.storeName; companyName = $res.companyName }
    Save-Config $cfg
    Remove-Item $ProvisionPath -Force -ErrorAction SilentlyContinue
    Write-Host "등록 완료 — '$where' 매장의 포스기($name)로 연결되었습니다." -ForegroundColor Green
    # 서버가 정해준 포스기 이름(POS001…)을 바로 보여준다 — 매장 관리모드 대시보드의 이름과 같다.
    [System.Windows.Forms.MessageBox]::Show("등록이 완료되었습니다.`n`n  포스기 이름: $name`n  매장: $where`n`n매장 관리모드 대시보드에서 이 이름을 확인하고 바꿀 수 있습니다.", "포인트 관리 프로그램", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
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
    $form.Text = "포스기 목록 — $($cfg.storeName) (이 포스기: $($cfg.name))"; $form.Width = 460; $form.Height = 360; $form.StartPosition = "CenterScreen"
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
    # 쉼표(,)로 감싸 반환 — PowerShell은 1건짜리 배열을 단일 객체로 풀어버려 .Count 가 비는 함정이 있다.
    return ,$rows
}
function Sql-Str($s) { return "'" + ($s -replace "'", "''") + "'" }

# ─── 매장 최초 설치 시 전화번호 있는 회원 전원의 잔액을 한 번에 서버로 이전 ──────────
# 손님이 다시 올 때까지 기다리는 방문 시점 이전(posEarn의 1회성 수입)은 계속 살아있지만,
# 이 포스기가 처음 설치될 때 이 일괄 이전이 필요하다. 포스기마다 로컬 DB가 따로라
# 매장의 다른 포스기가 영업 중(실적립·다른 포인트 이전 진행 중)이어도 이 포스기는 독립적으로,
# 대표 여부와 무관하게 실행된다. 이 포스기에서 딱 한 번만 실행되고(로컬 마커 파일),
# 서버 쪽도 포스기 단위 멱등으로 이중 방지된다(같은 고객이 여러 포스기에 남긴 잔액은
# 포스기별로 각각 더해짐 — 매장 계좌를 덮어쓰지 않음).


# 포스DB에 포인트를 그대로 남겨두면(서버로도 옮기고 로컬에도 남아있으면) 나중에 두 값이
# 어긋나 혼선이 생긴다(2026-09-28 결정) — 그래서 서버로 옮긴 뒤에는 로컬을 0으로 비운다.
# 대신 옮기기 "전"에 원본 그대로를 파일로 백업해둔다 — 전화번호 매칭 여부와 무관하게 전원
# 포함. 문제가 생기면 이 파일로 포스DB를 수동 원복할 수 있다(restore-bulk-import-backup.ps1).
function Export-PointBackupCsv($members, [string]$label) {
    $members = @($members)
    if ($members.Count -eq 0) { return $null }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
    $safeName = ($cfg.name -replace '[\\/:*?"<>|]', '_')
    $path = Join-Path $desktop "포인트서버이전백업_${safeName}_${label}_${ts}.csv"
    $esc = { param($v) '"' + ("$v" -replace '"', '""') + '"' }
    $lines = @('MEM_NO,MEM_NM,MEM_TEL_1,MEM_REP_TEL,MEM_CARD_NO,MEM_USABLE_PNT')
    foreach ($m in $members) {
        $lines += (@($m.MEM_NO, $m.MEM_NM, $m.MEM_TEL_1, $m.MEM_REP_TEL, $m.MEM_CARD_NO, $m.MEM_USABLE_PNT) | ForEach-Object { & $esc $_ }) -join ','
    }
    $lines | Out-File -Encoding UTF8 $path
    Write-Host "포인트 백업 파일 저장: $path ($($members.Count)명) — 문제 생기면 이 파일로 복구 가능" -ForegroundColor Cyan
    return $path
}

# 포인트 서버 이전 — 이 포스기에 남아 있는 모든 회원 포인트를 서버로 옮기고 포스 잔액을 0으로 만든다.
# 처음 설치한 뒤 한 번 하는 것이 보통이지만, 몇 번을 다시 실행해도 안전하다(잔액이 있는 회원만 옮기고, 이미 0이면 할 일이 없다).
# - 인터넷이 연결돼 있어야 한다(서버에서 확인).
# - 서버에 아직 못 보낸 결제(큐)가 남아 있거나 사용 조회 중인 손님이 있으면 하지 않는다(그 잔액이 이중으로 옮겨지는 것을 막기 위해).
# - 같은 요청이 다시 가도 서버가 한 번만 반영한다(묶음 번호+전화번호+금액이 같으면 중복 무시).
$TransferBatchPath = "$PSScriptRoot\transfer-pending-batch.txt"

function Invoke-PointTransfer([bool]$interactive) {
    $say = {
        param($text, $icon)
        Write-Host $text
        if ($interactive) { [System.Windows.Forms.MessageBox]::Show($text, "포인트 서버 이전", [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null }
    }
    $info = [System.Windows.Forms.MessageBoxIcon]::Information
    $warn = [System.Windows.Forms.MessageBoxIcon]::Warning

    # 1) 인터넷(서버) 연결 확인 — 연결돼 있지 않으면 시작하지 않는다.
    try { Invoke-RestMethod -Method Get -Uri "$($cfg.baseUrl)/api/v1/pos/agent/terminals" -Headers $AuthHeader -TimeoutSec 10 | Out-Null }
    catch { & $say "서버에 연결할 수 없어 포인트를 이전하지 않았습니다.`n인터넷 연결을 확인한 뒤 다시 실행해주세요.`n`n($(Get-FriendlyError $_))" $warn; return }

    # 2) 서버에 아직 못 보낸 결제부터 처리 — 남아 있으면 중단(그 적립분이 포스 잔액에 섞여 있어 지금 옮기면 이중 반영된다).
    if ($Script:SwapPending.Count -gt 0) { & $say "지금 포인트를 사용 중인 손님이 있습니다. 결제를 마친 뒤 다시 실행해주세요." $warn; return }
    try { Process-Queue } catch { Write-Host "큐 처리 오류: $_" -ForegroundColor Red }
    $left = 0
    try { $left = [int]$Champ.Execute("SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N'").Fields.Item("C").Value } catch { }
    if ($left -gt 0) { & $say "서버에 아직 반영되지 않은 결제가 $left 건 있어 포인트를 이전하지 않았습니다.`n인터넷 연결을 확인하고 잠시 뒤 다시 실행해주세요." $warn; return }

    Write-Host "=== 포인트 서버 이전을 시작합니다 ===" -ForegroundColor Cyan
    $members = Champ-Query "SELECT MEM_NO, MEM_NM, MEM_TEL_1, MEM_REP_TEL, MEM_CARD_NO, MEM_USABLE_PNT FROM MEMBER WHERE MEM_USABLE_PNT > 0"
    if ($members.Count -eq 0) { & $say "이전할 포인트가 없습니다(모든 회원의 포스 잔액이 0입니다)." $info; return }

    # 옮기기 전에 원본을 파일로 백업(문제가 생기면 restore.bat 으로 되돌릴 수 있다).
    Export-PointBackupCsv $members "transfer" | Out-Null

    $withPhone = @()
    $noPhoneMembers = @()
    foreach ($m in $members) {
        $phone = Resolve-MemberPhone $m.MEM_REP_TEL $m.MEM_TEL_1
        if ($phone) { $withPhone += @{ memNo = $m.MEM_NO; phone = $phone; cardNo = $m.MEM_CARD_NO; balance = [double]$m.MEM_USABLE_PNT } }
        else { $noPhoneMembers += $m }
    }
    Write-Host "전화번호 있는 회원 $($withPhone.Count)명 / 전화번호가 없어 옮길 수 없는 회원 $($noPhoneMembers.Count)명"

    # 묶음 번호 — 같은 이전을 다시 시도하면 같은 번호를 쓴다(서버가 중복 반영하지 않게). 끝까지 성공하면 지운다.
    $batchId = $null
    if (Test-Path $TransferBatchPath) { try { $batchId = (Get-Content $TransferBatchPath -Raw).Trim() } catch { } }
    if (-not $batchId -or $batchId -notmatch '^[A-Za-z0-9_-]{6,64}$') {
        $batchId = (Get-Date).ToString("yyyyMMddHHmmss") + "-" + ([guid]::NewGuid().ToString("N").Substring(0, 6))
        $batchId | Out-File -Encoding ASCII $TransferBatchPath
    }

    $imported = 0; $already = 0; $skipped = 0; $totalAmount = 0; $failed = 0
    $batchSize = 200
    for ($i = 0; $i -lt $withPhone.Count; $i += $batchSize) {
        $batch = @($withPhone[$i..([Math]::Min($i + $batchSize - 1, $withPhone.Count - 1))])
        try {
            # JSON을 직접 조립한다 — ConvertTo-Json은 1건짜리 배열을 객체로 직렬화한다.
            $items = @($batch | ForEach-Object { @{ phone = $_.phone; cardNo = $_.cardNo; balance = $_.balance } | ConvertTo-Json -Compress })
            $json = '{"batchId":"' + $batchId + '","entries":[' + ($items -join ',') + ']}'
            $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/bulk-import" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
            $imported += $res.imported; $already += $res.alreadyLinked; $skipped += $res.skippedInvalidPhone; $totalAmount += $res.totalAmount
            # 서버 반영이 확인된 회원만, 옮긴 금액만큼만 포스 잔액에서 뺀다(그 사이 새로 쌓인 잔액은 건드리지 않는다).
            foreach ($e in $batch) {
                $amt = [double]$e.balance
                Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT = CASE WHEN MEM_USABLE_PNT - $amt < 0 THEN 0 ELSE MEM_USABLE_PNT - $amt END WHERE MEM_NO=$(Sql-Str $e.memNo)"
            }
        } catch {
            Write-Host "포인트 이전 중 오류(이 묶음은 포스 잔액을 그대로 두고 다음 실행 때 다시 시도합니다): $_" -ForegroundColor Red
            Set-AgentError "포인트 서버 이전 실패: $(Get-FriendlyError $_)"
            $failed++
        }
    }

    # 전화번호가 없어 서버로 옮길 수 없는 회원 — 서버 이전이 전부 성공했을 때만(백업은 이미 저장됨) 0으로 비운다.
    if ($failed -eq 0) {
        foreach ($m in $noPhoneMembers) {
            Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $m.MEM_NO)"
        }
        Remove-Item $TransferBatchPath -Force -ErrorAction SilentlyContinue
    }
    $summary = @{ ranAt = (Get-Date).ToString("o"); memberCount = $members.Count; withPhone = $withPhone.Count; noPhone = $noPhoneMembers.Count; imported = $imported; alreadyApplied = $already; skippedInvalidPhone = $skipped; totalAmount = $totalAmount; failedBatches = $failed }
    $summary | ConvertTo-Json | Out-File -Encoding UTF8 "$PSScriptRoot\transfer-last.json"
    $resultText = "포인트 서버 이전 결과`n새로 이전 $imported 명 / 이미 반영됨 $already 명 / 합계 $totalAmount 포인트`n전화번호가 없어 옮기지 못한 회원 $($noPhoneMembers.Count)명 (실패 묶음 $failed)"
    if ($failed -gt 0) { $resultText += "`n`n일부 묶음이 실패했습니다. 인터넷 연결을 확인하고 다시 실행하면 이어서 처리됩니다." }
    Write-Host $resultText -ForegroundColor Green
    & $say $resultText $(if ($failed -gt 0) { $warn } else { $info })
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

# 최근 오류를 서버(매장 관리모드 "포스기 다운로드" 화면)에 알린다 — 하트비트에 실어 보낸다.
$Script:LastError = $null
$Script:LastErrorAt = $null
$Script:SkippedNoPhone = 0
$Script:RetryError = $null
$Script:ServerAgentVersion = $null

# 트레이 아이콘 툴팁과 메뉴 맨 위 줄에 "이 포스기의 이름·소속 매장"을 보여준다(이름은 서버 값이 기준).
function Update-IdentityDisplay {
    $where = "$($cfg.storeName)"
    if ($cfg.companyName) { $where = "$($cfg.companyName) › $($cfg.storeName)" }
    $tip = "포인트 관리 — $($cfg.name)"
    if ($tip.Length -gt 60) { $tip = $tip.Substring(0, 60) }  # 트레이 툴팁 길이 제한(63자)
    $trayIcon.Text = $tip
    $itemIdentity.Text = "$($cfg.name) · $where"
}
function Set-AgentError([string]$msg) {
    $Script:LastError = $msg
    $Script:LastErrorAt = (Get-Date).ToUniversalTime().ToString("o")
    try { Send-Heartbeat | Out-Null } catch { }
}

function Send-Heartbeat {
    try {
        $pending = 0
        try { $pending = [int]$Champ.Execute("SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N'").Fields.Item("C").Value } catch { }
        $status = @{ pending = $pending; skippedNoPhone = $Script:SkippedNoPhone; lastError = $(if ($Script:RetryError) { $Script:RetryError } else { $Script:LastError }); lastErrorAt = $Script:LastErrorAt }
        $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/terminals/heartbeat" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes(($status | ConvertTo-Json -Compress)))
        $Script:IsPrimary = [bool]$res.isPrimary
        if ($res.storeName -and ($res.storeName -ne $cfg.storeName -or $res.companyName -ne $cfg.companyName)) {
            # 이 포스기가 다른 매장으로 옮겨졌다 — 화면 표시를 맞추고 설정에 저장한다.
            $cfg.storeName = $res.storeName; $cfg.companyName = $res.companyName
            try { Save-Config $cfg } catch { }
            try { Show-ResultToast "이 포스기가 이동되었습니다`n$($res.companyName) › $($res.storeName)" } catch { }
        }
        if ($res.agentVersion) { $Script:ServerAgentVersion = [string]$res.agentVersion; try { Update-UpdateMenuText } catch { } }
        if ($res.terminalName -and $res.terminalName -ne $cfg.name) {
            # 매장 관리모드에서 포스기 이름을 바꿨다 — 화면 표시를 바꾸고 설정 파일에도 저장해 다음 시작 때도 같은 이름을 쓴다.
            $cfg.name = $res.terminalName
            try { Save-Config $cfg } catch { }
        }
        try { Update-IdentityDisplay } catch { }
        if ($res.storeUrl) { Set-ManageShortcut -isPrimary $Script:IsPrimary -storeUrl $res.storeUrl }
        return $true
    } catch {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 하트비트 실패: $_" -ForegroundColor Yellow
        return $false
    }
}


# ─── 사용(REDEEM) 팝업 — 스왑 대기 목록: MEM_NO -> {original=원래 로컬값, at=스왑 시각} ──

$Script:SwapPending = @{}

# 포스DB 안에서 일어난 포인트 이동·건너뜀을 서버 장부에 남긴다(문제 발생 시 추적용). 실패해도(인터넷 끊김 등) 본 처리에는 영향 없다.
function Send-TransferLog([string]$kind, [string]$phone, $amount, $localBefore, $localAfter, [string]$note, [string]$txn) {
    try {
        $b = @{ kind = $kind; phone = $phone; amount = $amount; localBefore = $localBefore; localAfter = $localAfter; note = $note; vendorTxnId = $txn }
        Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/transfer-log" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -TimeoutSec 5 -Body ([System.Text.Encoding]::UTF8.GetBytes(($b | ConvertTo-Json -Compress))) | Out-Null
    } catch { Write-Host "$(Get-Date -Format 'HH:mm:ss') 이동 기록 전송 실패(무시): $_" }
}

function Show-RedeemPopup {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "포인트 사용 — $($cfg.name)"; $form.Width = 380; $form.Height = 260; $form.StartPosition = "CenterScreen"
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
            $lookupErr = $_
            $lookupCode = $null; $lookupHolder = $null
            try { $eb = $lookupErr.ErrorDetails.Message | ConvertFrom-Json; $lookupCode = $eb.error; $lookupHolder = $eb.holder } catch { }
            $lookupStatus = 0
            try { $lookupStatus = [int]$lookupErr.Exception.Response.StatusCode } catch { }
            if ($lookupCode -eq "REDEEM_IN_PROGRESS_ELSEWHERE") {
                # 같은 손님을 다른 포스기에서 사용 조회 중 — 어디서 쓰는 중인지 보여주고, 이번에는 적립만 가능하다고 안내한다(적립은 그대로 진행됨).
                $where = ""
                if ($lookupHolder) { $where = "$($lookupHolder.companyName) / $($lookupHolder.storeName) ($($lookupHolder.terminalName))" }
                $busyMsg = "이 손님은 지금 다른 곳에서 포인트를 사용 중입니다.`n`n사용 중: $where`n`n현재는 [적립만] 가능합니다. 적립은 그대로 진행됩니다.`n포인트 사용(차감)은 정확한 잔액 확인이 어려워 진행하지 않습니다.`n잠시 후 다시 조회하면 사용할 수 있습니다."
                $lblResult.Text = "다른 곳에서 사용 중 — 현재 적립만 가능합니다."
                [System.Windows.Forms.MessageBox]::Show($busyMsg, "포인트 관리 프로그램", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
            } elseif ($lookupStatus -eq 0) {
                $lblResult.Text = "인터넷이 끊겨 지금은 포인트 [사용]을 할 수 없습니다.`n적립은 정상 진행되고 인터넷이 연결되면 서버로 옮겨집니다."
                [System.Windows.Forms.MessageBox]::Show("인터넷 연결이 끊겨 서버의 통합 포인트를 확인할 수 없습니다.`n`n- 포인트 적립: 가능 (연결되면 자동으로 서버에 반영)`n- 포인트 사용(차감): 불가 (정확한 잔액을 확인할 수 없음)", "포인트 관리 프로그램", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            } else {
                $lblResult.Text = Get-FriendlyError $lookupErr
            }
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
        Send-TransferLog "LOOKUP_TO_POS" $phone ([double]$res.availableBalance) $localBefore $newLocal "사용 조회: 서버 포인트를 포스 화면에 더함" ""

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
    $swapInfo = $Script:SwapPending[$memNo]
    $curLocal = $null
    try { $cur = Champ-Query "SELECT MEM_USABLE_PNT FROM MEMBER WHERE MEM_NO=$(Sql-Str $memNo)"; if ($cur.Count -gt 0) { $curLocal = [double]$cur[0].MEM_USABLE_PNT } } catch { }
    Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $memNo)"
    $Script:SwapPending.Remove($memNo)
    Send-TransferLog "RESTORE_POS" "$($swapInfo.phone)" 0 $curLocal 0 "결제 후/대기 종료: 포스 잔액을 0으로 되돌림(서버가 원본)" ""
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
    $rows = Champ-Query "SELECT CRAB_SEQ, MEM_NO, MEMP_AMT, MEMP_ADD_AMT, MEMP_USED_AMT, MEMP_CARD_NO, SRC_SELLS_DT, SRC_CHN_NO, CREATED_AT FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N' ORDER BY CRAB_SEQ"
    $passFailed = $false
    foreach ($r in $rows) {
        $memNo = $r.MEM_NO
        $vendorTxnKey = "$($cfg.terminalId)-$($r.CRAB_SEQ)"
        # 결제가 실제로 일어난 시각(인터넷이 끊겼다 나중에 반영돼도 원래 시각이 기록되게)
        $occurredIso = $null
        try { if ($r.CREATED_AT) { $occurredIso = ([datetime]$r.CREATED_AT).ToUniversalTime().ToString("o") } } catch { }
        try {
            $member = Champ-Query "SELECT MEM_TEL_1, MEM_REP_TEL FROM MEMBER WHERE MEM_NO=$(Sql-Str $memNo)"
            $phone = $null
            if ($member.Count -gt 0) { $phone = Resolve-MemberPhone $member[0].MEM_REP_TEL $member[0].MEM_TEL_1 }

            if ($phone) {
                if ([double]$r.MEMP_ADD_AMT -lt 0) {
                    # 결제 취소로 포스가 적립을 되돌린 건 — 직원이 직접 차감하지 않아도 서버 포인트를 자동으로 되돌린다.
                    Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/earn" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes((@{
                        phone = $phone; addAmount = [double]$r.MEMP_ADD_AMT; saleAmount = [double]$r.MEMP_AMT; cardNo = $r.MEMP_CARD_NO; vendorTxnId = "EARNCANCEL-$vendorTxnKey"; occurredAt = $occurredIso
                    } | ConvertTo-Json))) | Out-Null
                    Show-ResultToast "결제 취소 반영`n적립 $([int](-[double]$r.MEMP_ADD_AMT))원 취소"
                    # 포스 로컬 잔액은 0이 정상 — 취소로 어긋난 값을 0으로 맞춘다(사용 조회 중인 손님은 건드리지 않음).
                    if (-not $Script:SwapPending.ContainsKey($memNo)) { Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $memNo)" }
                }
                if ([double]$r.MEMP_USED_AMT -lt 0) {
                    Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/redeem" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes((@{
                        action = "cancel"; phone = $phone; refundAmount = (-[double]$r.MEMP_USED_AMT); cardNo = $r.MEMP_CARD_NO; vendorTxnId = "USECANCEL-$vendorTxnKey"; occurredAt = $occurredIso
                    } | ConvertTo-Json))) | Out-Null
                    Show-ResultToast "결제 취소 반영`n사용 $([int](-[double]$r.MEMP_USED_AMT))원 환원"
                    if (-not $Script:SwapPending.ContainsKey($memNo)) { Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $memNo)" }
                }
                if ([double]$r.MEMP_ADD_AMT -gt 0) {
                    # 챔프 자체 포인트 기능(자동 적립이든 계산원 수기 입력이든 MEMBER_POINT에
                    # 똑같이 기록됨)이 이미 계산해둔 적립액(MEMP_ADD_AMT)을 그대로 서버에 반영한다
                    # — 서버가 별도 요율로 재계산하지 않는다(2026-09-28).
                    $earnRes = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/earn" -Headers $AuthHeader -ContentType "application/json" -Body (@{
                        phone = $phone; addAmount = [double]$r.MEMP_ADD_AMT; saleAmount = [double]$r.MEMP_AMT; cardNo = $r.MEMP_CARD_NO; vendorTxnId = "EARN-$vendorTxnKey"; occurredAt = $occurredIso
                    } | ConvertTo-Json)
                    if ([double]$earnRes.earnAmount -gt 0) {
                        Show-ResultToast "적립 완료`n$([int]$earnRes.earnAmount)원 적립`n잔액 $([int]$earnRes.availableBalance)원"
                    }
                    # 서버 반영이 확인된 뒤에만 로컬을 소모한다(인터넷이 끊겨 위 호출이 실패하면
                    # 예외로 빠져 이 줄까지 오지 않고, 큐 행도 PROCESSED='Y'로 안 바뀌어 다음
                    # 폴링 때 재시도된다 — 오프라인 중 결제가 계속돼도 안전, 2026-09-28).
                    # 이번 처리분만큼만 차감(0으로 덮어쓰지 않음) — 그 사이 새 적립이 더 쌓였을
                    # 수 있어서다.
                    # 0 밑으로 내려가지 않게(인터넷이 끊겨 있는 동안 이미 0으로 비워 둔 경우에도 안전).
                    $addAmt = [double]$r.MEMP_ADD_AMT
                    Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT = CASE WHEN MEM_USABLE_PNT - $addAmt < 0 THEN 0 ELSE MEM_USABLE_PNT - $addAmt END WHERE MEM_NO=$(Sql-Str $memNo)"
                }
                if ([double]$r.MEMP_USED_AMT -gt 0) {
                    Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/redeem" -Headers $AuthHeader -ContentType "application/json" -Body (@{
                        action = "apply"; phone = $phone; usedAmount = [double]$r.MEMP_USED_AMT; cardNo = $r.MEMP_CARD_NO; vendorTxnId = "USE-$vendorTxnKey"; occurredAt = $occurredIso
                    } | ConvertTo-Json) | Out-Null
                }
            } else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss') MEM_NO=$memNo 전화번호 미등록 — 적립 건너뜀(보관)"
                # 'Y'가 아니라 'S'(전화번호 없어 건너뜀)로 남겨 나중에 번호가 등록되면 사후 처리할 수 있게 한다.
                $Script:SkippedNoPhone++
                Send-TransferLog "SKIPPED" "" ([double]$r.MEMP_ADD_AMT) $null $null "전화번호 없음 — 서버 반영 보류(MEM_NO=$memNo)" "SKIP-$vendorTxnKey"
                Set-AgentError "전화번호가 없는 회원($memNo)의 적립을 서버에 반영하지 못했습니다(보관됨)."
                Restore-SwappedIfDone $memNo
                Champ-Exec "UPDATE CRAB_EVENT_QUEUE SET PROCESSED='S' WHERE CRAB_SEQ=$($r.CRAB_SEQ)"
                continue
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
                Send-TransferLog "REJECTED" "$phone" ([double]$r.MEMP_ADD_AMT) $null $null "서버 거부로 건너뜀: $(Get-FriendlyError $qerr)" "REJ-$vendorTxnKey"
                Set-AgentError "적립·사용 1건을 서버가 거부해 건너뜀(CRAB_SEQ=$($r.CRAB_SEQ)): $(Get-FriendlyError $qerr)"
                try {
                    Restore-SwappedIfDone $memNo
                    Champ-Exec "UPDATE CRAB_EVENT_QUEUE SET PROCESSED='Y' WHERE CRAB_SEQ=$($r.CRAB_SEQ)"
                } catch { }
            } else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss') 큐 처리 실패(CRAB_SEQ=$($r.CRAB_SEQ)): $qerr" -ForegroundColor Red
                if ($qstatus -eq 0 -and -not $Script:SwapPending.ContainsKey($memNo)) {
                    # 인터넷이 끊겨 서버 반영을 못 한 상태 — 통합 포인트의 최종 상태를 알 수 없으므로 이 회원의 포스 잔액을 0으로 비워 [사용]을 막는다.
                    # 적립분은 큐에 그대로 남아 있다가 인터넷이 연결되면 서버에 반영된다(중복 없음: 거래별 고유키).
                    try { Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $memNo)" } catch { }
                }
                $Script:RetryError = "큐 처리 실패(재시도 중, 인터넷 연결 확인): $(Get-FriendlyError $qerr)"; $Script:LastErrorAt = (Get-Date).ToUniversalTime().ToString("o"); $passFailed = $true
                # 일시적인 실패(인터넷 끊김 등)는 PROCESSED='Y'로 안 바꿔서 다음 순회에 재시도(멱등키가 있어 서버 쪽 중복 반영은 안 됨)
            }
        }
    }
    if (-not $passFailed) { $Script:RetryError = $null }  # 이번 순회에서 막힌 건이 없으면 "재시도 중" 오류 표시를 지운다
    Restore-TimedOutSwaps
}

# ─── 업데이트 — 서버의 최신 프로그램 파일(묶음)을 받아 덮어쓰고 다시 시작한다 ──────────────────
# 실행 중인 파일을 덮어쓰는 문제를 피하려고 이 프로그램의 스크립트 묶음만 교체한다(실행파일 PointManager.exe 자체는 거의 바뀌지 않는다).
# 설정·로그·백업 파일은 묶음에 들어 있지 않아 그대로 남는다.
$BundleVersionPath = "$PSScriptRoot\bundle-version.txt"

function Get-LocalAgentVersion {
    if (Test-Path $BundleVersionPath) { try { return (Get-Content $BundleVersionPath -Raw).Trim() } catch { } }
    return $null
}

function Update-UpdateMenuText {
    $latest = $Script:ServerAgentVersion
    $local = Get-LocalAgentVersion
    if ($latest -and $local -ne $latest) { $itemUpdate.Text = "업데이트 (새 버전 있음)..." } else { $itemUpdate.Text = "업데이트 확인..." }
}

function Invoke-AgentUpdate {
    $info = [System.Windows.Forms.MessageBoxIcon]::Information
    $warn = [System.Windows.Forms.MessageBoxIcon]::Warning
    try { $v = Invoke-RestMethod -Method Get -Uri "$($cfg.baseUrl)/api/v1/pos-agent/version" -TimeoutSec 15 }
    catch { [System.Windows.Forms.MessageBox]::Show("서버에 연결할 수 없어 업데이트를 확인하지 못했습니다.`n인터넷 연결을 확인해주세요.", "업데이트", "OK", $warn) | Out-Null; return }
    $local = Get-LocalAgentVersion
    if ($local -eq $v.version) { [System.Windows.Forms.MessageBox]::Show("이미 최신 버전입니다.", "업데이트", "OK", $info) | Out-Null; return }
    $ans = [System.Windows.Forms.MessageBox]::Show("새 버전이 있습니다. 지금 업데이트할까요?`n(업데이트하는 동안 프로그램이 잠깐 다시 시작됩니다. 결제 중이 아닐 때 진행해주세요.)", "업데이트", "YesNo", $info)
    if ($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    if ($Script:SwapPending.Count -gt 0) { [System.Windows.Forms.MessageBox]::Show("지금 포인트를 사용 중인 손님이 있습니다. 결제를 마친 뒤 다시 시도해주세요.", "업데이트", "OK", $warn) | Out-Null; return }
    $tmpZip = Join-Path $env:TEMP "pm-agent-update.zip"
    $tmpDir = Join-Path $env:TEMP "pm-agent-update"
    try {
        Invoke-WebRequest -Uri "$($cfg.baseUrl)/api/v1/pos-agent/bundle" -OutFile $tmpZip -UseBasicParsing -TimeoutSec 60
        if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($tmpZip, $tmpDir)
        if (-not (Test-Path "$tmpDir\point-terminal-agent.ps1")) { throw "받은 파일에 프로그램이 없습니다." }
        # 새 스크립트 문법 확인 — 깨진 파일이면 교체하지 않는다.
        $errs = $null; [System.Management.Automation.Language.Parser]::ParseFile("$tmpDir\point-terminal-agent.ps1", [ref]$null, [ref]$errs) | Out-Null
        if ($errs -and $errs.Count -gt 0) { throw "받은 프로그램 파일이 올바르지 않습니다." }
        Get-ChildItem $tmpDir -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $PSScriptRoot $_.Name) -Force }
        $v.version | Out-File -Encoding ASCII $BundleVersionPath
    } catch {
        [System.Windows.Forms.MessageBox]::Show("업데이트하지 못했습니다(기존 프로그램은 그대로 둡니다).`n$_", "업데이트", "OK", $warn) | Out-Null
        return
    }
    Write-Host "업데이트 완료($($v.version)) — 다시 시작합니다."
    # 이 프로세스가 끝나 뮤텍스가 풀린 뒤 새 프로세스가 뜨도록 잠깐 기다렸다 실행한다.
    $cmd = "Start-Sleep -Seconds 3; Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','$PSCommandPath' -WindowStyle Hidden"
    Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", $cmd) -WindowStyle Hidden
    $trayIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
}

# ─── 사용 팝업 트레이 아이콘 ───────────────────────────────────────────────────

$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = if (Test-Path "$PSScriptRoot\pointmanager.ico") { New-Object System.Drawing.Icon("$PSScriptRoot\pointmanager.ico") } else { [System.Drawing.SystemIcons]::Application }
$trayIcon.Text = "포인트 관리 프로그램 — $($cfg.name)"
$trayIcon.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemIdentity = $menu.Items.Add("$($cfg.name)")
$itemIdentity.Enabled = $false
$menu.Items.Add("-") | Out-Null
$itemRedeem = $menu.Items.Add("포인트 사용...")
$itemRedeem.Add_Click({ Show-RedeemPopup })
$itemList = $menu.Items.Add("포스기 목록...")
$itemList.Add_Click({ Show-TerminalList })
$itemTransfer = $menu.Items.Add("포인트 서버로 이전...")
$itemTransfer.Add_Click({
    $a = [System.Windows.Forms.MessageBox]::Show("이 포스기에 남아 있는 회원 포인트를 모두 서버로 옮기고 포스 잔액을 0으로 만듭니다.`n(이미 옮겼다면 남은 포인트가 있는 회원만 옮기며, 여러 번 실행해도 안전합니다. 옮기기 전 원본을 바탕화면에 백업합니다.)`n`n진행할까요?", "포인트 서버로 이전", "YesNo", "Question")
    if ($a -eq [System.Windows.Forms.DialogResult]::Yes) { try { Invoke-PointTransfer $true } catch { [System.Windows.Forms.MessageBox]::Show("포인트 이전 중 오류가 났습니다.`n$_", "포인트 서버로 이전", "OK", "Warning") | Out-Null } }
})
$itemUpdate = $menu.Items.Add("업데이트 확인...")
$itemUpdate.Add_Click({ Invoke-AgentUpdate })
$itemExit = $menu.Items.Add("종료")
$itemExit.Add_Click({ $trayIcon.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$trayIcon.ContextMenuStrip = $menu
try { Update-IdentityDisplay } catch { }
$trayIcon.Add_DoubleClick({ Show-RedeemPopup })

Write-Host "터미널 '$($cfg.name)' 가동 시작 — 트레이 아이콘 더블클릭으로 '포인트 사용' 팝업을 엽니다."

$heartbeatTimer = New-Object System.Windows.Forms.Timer; $heartbeatTimer.Interval = 30000  # 30초마다 — 이름·소속 매장·새 버전 변경을 빨리 반영
$heartbeatTimer.Add_Tick({ Send-Heartbeat | Out-Null })
$heartbeatTimer.Start()
Send-Heartbeat | Out-Null


$queueTimer = New-Object System.Windows.Forms.Timer; $queueTimer.Interval = $QueuePollSec * 1000
$queueTimer.Add_Tick({
    try { Process-Queue } catch { Write-Host "큐 폴링 오류: $_" -ForegroundColor Red }
})
$queueTimer.Start()

# 방금 설치·등록한 직후라면 이 매장의 포스기 목록을 자동으로 한 번 보여준다.
if ($ShowList) {
    $Script:ListOnceTimer = New-Object System.Windows.Forms.Timer; $Script:ListOnceTimer.Interval = 1500
    $Script:ListOnceTimer.Add_Tick({
        $Script:ListOnceTimer.Stop()
        Show-TerminalList
        # 설치 직후 한 번 — 기존 회원 포인트를 지금 서버로 옮길지 묻는다(나중에 트레이 메뉴 '포인트 서버로 이전'으로도 할 수 있다).
        $a = [System.Windows.Forms.MessageBox]::Show("설치가 끝났습니다.`n이 포스기에 남아 있는 기존 회원 포인트를 지금 서버로 옮길까요?`n(나중에 트레이 메뉴의 '포인트 서버로 이전'으로도 할 수 있습니다.)", "포인트 관리 프로그램", "YesNo", "Question")
        if ($a -eq [System.Windows.Forms.DialogResult]::Yes) { try { Invoke-PointTransfer $true } catch { [System.Windows.Forms.MessageBox]::Show("포인트 이전 중 오류가 났습니다.`n$_", "포인트 서버로 이전", "OK", "Warning") | Out-Null } }
    })
    $Script:ListOnceTimer.Start()
}

[System.Windows.Forms.Application]::Run()
