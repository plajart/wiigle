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
    [switch]$ShowList,  # 방금 설치·등록한 직후 이 매장의 포스기 목록을 한 번 보여준다
    [switch]$InstallRun # 설치/실행 파일(start.bat·exe)로 시작한 실행 — 최초 포인트 서버 이전을 확인한다(윈도우 부팅 자동실행에서는 하지 않는다)
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

# 크롬 실행파일 경로 — 설치 위치(Program Files / Program Files (x86) / 사용자별)와 레지스트리 App Paths 를 차례로 찾는다. 없으면 $null.
function Get-ChromePath {
    $cands = @()
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($base) { $cands += (Join-Path $base "Google\Chrome\Application\chrome.exe") }
    }
    foreach ($hive in @("HKLM", "HKCU")) {
        try {
            $v = (Get-ItemProperty -Path "${hive}:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction Stop)."(default)"
            if ($v) { $cands += $v }
        } catch { }
    }
    foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

# 관리프로그램(웹 매장 관리모드)을 크롬으로 연다 — 크롬이 없으면 기본 브라우저.
function Open-ManagePage([string]$url) {
    $chrome = Get-ChromePath
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $url } else { Start-Process $url }
}

function Set-ManageShortcut([bool]$isPrimary, [string]$storeUrl) {
    # 바탕화면 "포인트 관리 프로그램" 바로가기 — 모든 포스기에 만든다(설치 때 한 번, 이후 하트비트가 없어졌거나 바뀌었으면 다시 만든다).
    # 크롬이 있으면 크롬으로 매장 관리모드(웹과 동일 화면)를 여는 바로가기(.lnk), 크롬이 없으면 기본 브라우저로 여는 인터넷 바로가기(.url).
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $oldLnk = "$desktop\포인트 관리모드.lnk"   # 예전 버전(대표 포스기 전용)이 만든 바로가기는 새 것으로 교체한다
        if (Test-Path $oldLnk) { Remove-Item $oldLnk -Force -ErrorAction SilentlyContinue }
        if (-not $storeUrl) { return }
        $icon = "$PSScriptRoot\pointmanager.ico"
        $chrome = Get-ChromePath
        $lnkPath = "$desktop\포인트 관리 프로그램.lnk"
        $urlPath = "$desktop\포인트 관리 프로그램.url"
        if ($chrome) {
            if (Test-Path $urlPath) { Remove-Item $urlPath -Force -ErrorAction SilentlyContinue }   # 크롬으로 바뀌면 예전 .url 은 지운다
            $ws = New-Object -ComObject WScript.Shell
            $needs = $true
            if (Test-Path $lnkPath) {
                try { $cur = $ws.CreateShortcut($lnkPath); if ($cur.TargetPath -eq $chrome -and $cur.Arguments -eq $storeUrl) { $needs = $false } } catch { }
            }
            if ($needs) {
                $lnk = $ws.CreateShortcut($lnkPath)
                $lnk.TargetPath = $chrome
                $lnk.Arguments = $storeUrl
                if (Test-Path $icon) { $lnk.IconLocation = $icon }
                $lnk.Description = "포인트 관리 프로그램 — 매장 관리모드(웹과 동일 화면)"
                $lnk.Save()
            }
        } else {
            $lines = @("[InternetShortcut]", "URL=$storeUrl")
            if (Test-Path $icon) { $lines += "IconFile=$icon"; $lines += "IconIndex=0" }
            $content = ($lines -join "`r`n") + "`r`n"
            $current = $null
            if (Test-Path $urlPath) { try { $current = [System.IO.File]::ReadAllText($urlPath, [System.Text.Encoding]::Default) } catch { } }
            if ($current -ne $content) { [System.IO.File]::WriteAllText($urlPath, $content, [System.Text.Encoding]::Default) }
        }
    } catch { Write-Host "바탕화면 바로가기 생성 실패(무시): $_" -ForegroundColor Yellow }
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
    try { $cs = Load-Config; if ($cs) { Set-ManageShortcut $false "$($cs.baseUrl)/store" } } catch { }  # 설치하면 바탕화면에 "포인트 관리 프로그램" 바로가기를 만든다

    if ($running) {
        Write-Host "프로그램이 이미 실행 중입니다. 다시 실행하지 않습니다 — 화면 오른쪽 아래 트레이의 '포인트 관리' 아이콘을 확인하세요." -ForegroundColor Green
        return
    }

    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$PSCommandPath`"")
    if ($firstTime) { $argList += "-ShowList" }
    $argList += "-InstallRun"
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

# 챔프 DB(ODBC DSN=CHAMP) 연결 — 실패하면 점점 길게(2·4·8·16·30초) 기다리며 다시 시도하고, 매번 원인을 agent.log 에 남긴다.
# 챔프가 아직 켜지는 중이거나(부팅 직후 DB 서버 준비 전) 일시적으로 끊긴 경우를 견디기 위한 것이다. 못 붙으면 $null.
$Script:ChampLastError = $null
function Connect-Champ([int]$attempts = 5) {
    $delay = 2
    for ($i = 1; $i -le $attempts; $i++) {
        try {
            $c = New-Object -ComObject ADODB.Connection
            $c.ConnectionTimeout = 30
            $c.Open("DSN=CHAMP")
            $Script:ChampLastError = $null
            return $c
        } catch {
            $Script:ChampLastError = $_.Exception.Message
            Write-Host "$(Get-Date -Format 'HH:mm:ss') 챔프 DB 연결 실패($i/$attempts, 사용자=$env:USERNAME, 세션=$([System.Diagnostics.Process]::GetCurrentProcess().SessionId)): $($_.Exception.Message)" -ForegroundColor Yellow
            if ($i -lt $attempts) { Start-Sleep -Seconds $delay; $delay = [Math]::Min($delay * 2, 30) }
        }
    }
    return $null
}

# 시작할 때 최대 약 10분까지 기다린다(포스 PC를 켠 직후 챔프 DB 서버가 준비되기 전일 수 있다). 끝내 못 붙으면 안내하고 종료한다(다음 로그온 때 자동으로 다시 시작).
$Champ = $null
for ($round = 1; $round -le 8 -and -not $Champ; $round++) {
    $Champ = Connect-Champ 5
    if (-not $Champ) { Write-Host "챔프 DB에 아직 연결하지 못했습니다(대기 $round/8)." -ForegroundColor Yellow }
}
if (-not $Champ) {
    $hint = "챔프 포스 DB에 연결하지 못했습니다.`n`n- 챔프 포스가 켜져 있는지(DB 서버 dbsrv8)`n- 이 프로그램을 챔프를 쓰는 같은 윈도우 계정으로 실행했는지(ODBC 'CHAMP' 설정은 계정별일 수 있음)`n`n마지막 오류: $($Script:ChampLastError)"
    # 서버(매장 대시보드)에도 알린다 — 이 시점에는 하트비트 함수가 아직 정의되기 전이라 직접 보낸다.
    try {
        $errBody = @{ agentVersion = $null; caps = @("update"); lastError = "챔프 DB 연결 실패: $($Script:ChampLastError)"; lastErrorAt = (Get-Date).ToUniversalTime().ToString("o"); pending = 0; skippedNoPhone = 0 } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/terminals/heartbeat" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -TimeoutSec 10 -Body ([System.Text.Encoding]::UTF8.GetBytes($errBody)) | Out-Null
    } catch { }
    [System.Windows.Forms.MessageBox]::Show($hint, "포인트 관리 프로그램", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    exit 1
}
Ensure-ChampQueueAndTrigger $Champ

# 실행 중 연결이 끊기면(챔프 재시작 등) 한 번 다시 연결해서 같은 문장을 다시 실행한다.
function Invoke-Champ($sql) {
    try { return $Script:Champ.Execute($sql) }
    catch {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 챔프 DB 연결이 끊긴 것으로 보여 다시 연결합니다: $($_.Exception.Message)" -ForegroundColor Yellow
        $c = Connect-Champ 3
        if (-not $c) { throw }
        $Script:Champ = $c
        return $Script:Champ.Execute($sql)
    }
}

function Champ-Exec($sql) { Invoke-Champ $sql | Out-Null }
function Champ-Query($sql) {
    $rs = Invoke-Champ $sql
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

function Invoke-PointTransfer([bool]$interactive, [bool]$auto = $false) {
    # $auto: 설치 직후 자동 실행 — 성공은 짧은 알림만, 문제(인터넷 없음 등)는 창으로 알린다.
    $say = {
        param($text, $icon)
        Write-Host $text
        if ($interactive -or ($auto -and $icon -eq [System.Windows.Forms.MessageBoxIcon]::Warning)) { [System.Windows.Forms.MessageBox]::Show($text, "포인트 서버 이전", [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null }
    }
    $info = [System.Windows.Forms.MessageBoxIcon]::Information
    $warn = [System.Windows.Forms.MessageBoxIcon]::Warning

    # 1) 인터넷(서버) 연결 확인 — 연결돼 있지 않으면 시작하지 않는다.
    $initialDone = $false
    try { $chk = Invoke-RestMethod -Method Get -Uri "$($cfg.baseUrl)/api/v1/pos/agent/terminals" -Headers $AuthHeader -TimeoutSec 10; $initialDone = [bool]$chk.initialTransferDone }
    catch { & $say "서버에 연결할 수 없어 포인트를 이전하지 않았습니다.`n인터넷 연결을 확인한 뒤 다시 실행해주세요.`n`n($(Get-FriendlyError $_))" $warn; return }

    if ($initialDone) { "ok" | Out-File -Encoding ASCII "$PSScriptRoot\initial-transfer-done.txt" }  # 서버에 최초 이전 기록이 이미 있으면 로컬에도 표시
    # 2) 서버에 아직 못 보낸 결제부터 처리 — 남아 있으면 중단(그 적립분이 포스 잔액에 섞여 있어 지금 옮기면 이중 반영된다).
    if ($Script:SwapPending.Count -gt 0) { & $say "지금 포인트를 사용 중인 손님이 있습니다. 결제를 마친 뒤 다시 실행해주세요." $warn; return }
    try { Process-Queue } catch { Write-Host "큐 처리 오류: $_" -ForegroundColor Red }
    $left = 0
    try { $left = [int](Invoke-Champ "SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N'").Fields.Item("C").Value } catch { }
    if ($left -gt 0) { & $say "서버에 아직 반영되지 않은 결제가 $left 건 있어 포인트를 이전하지 않았습니다.`n인터넷 연결을 확인하고 잠시 뒤 다시 실행해주세요." $warn; return }

    # 포스 잔액이 마이너스인 회원(이미 서버에서 차감된 사용분)은 0으로 정리한다 — 서버 이전 대상이 아니다.
    try { Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_USABLE_PNT < 0" } catch { Write-Host "마이너스 잔액 정리 실패(무시): $_" }

    # 이전하는 짧은 동안(서버 반영 → 포스 잔액 차감 사이) 같은 포스 프로그램 안에서 포인트가 바뀌지 않게 막는다 — 결제 큐 처리, 남은 포인트 이전, 사용 조회, 업데이트를 잠시 멈춘다.
    $Script:TransferBusy = $true
    try {
    Write-Host "=== 포인트 서버 이전을 시작합니다 ===" -ForegroundColor Cyan
    $members = Champ-Query "SELECT MEM_NO, MEM_NM, MEM_TEL_1, MEM_REP_TEL, MEM_CARD_NO, MEM_USABLE_PNT FROM MEMBER WHERE MEM_USABLE_PNT > 0"
    if ($members.Count -eq 0) {
        if (-not $initialDone) { Send-TransferLog "INITIAL_DONE" "" 0 $null $null "최초 포인트 서버 이전: 이전할 포인트 없음" ""; "ok" | Out-File -Encoding ASCII "$PSScriptRoot\initial-transfer-done.txt" }
        & $say "이전할 포인트가 없습니다(모든 회원의 포스 잔액이 0입니다)." $info
        return
    }

    $withPhone = @()
    $noPhoneMembers = @()
    foreach ($m in $members) {
        $phone = Resolve-MemberPhone $m.MEM_REP_TEL $m.MEM_TEL_1
        if ($phone) { $withPhone += @{ memNo = $m.MEM_NO; phone = $phone; cardNo = $m.MEM_CARD_NO; balance = [double]$m.MEM_USABLE_PNT } }
        else { $noPhoneMembers += $m }
    }
    Write-Host "전화번호 있는 회원 $($withPhone.Count)명 / 전화번호가 없어 포스에 그대로 두는 회원 $($noPhoneMembers.Count)명"

    # 서버로 옮길 회원(전화번호가 있는 회원)의 원본을 파일로 백업 — 목적은 "프로그램을 처음 설치하는 시점에 이미 있던 포인트"를 기록해 두는 것이므로,
    # 서버에 이 포스기의 최초 이전 기록이 없을 때(첫 이전)만 만든다. 이후 이전에는 백업하지 않는다.
    # 전화번호가 없는 회원의 포인트는 건드리지 않고(백업·0 처리 없음) 포스에 그대로 둔다 — 전화번호가 등록되면 다음 이전 때, 또는 그 회원이 결제할 때 서버로 옮겨진다.
    if (-not $initialDone -and $withPhone.Count -gt 0) {
        $withPhoneNos = @($withPhone | ForEach-Object { [string]$_.memNo })
        $backupMembers = @($members | Where-Object { $withPhoneNos -contains [string]$_.MEM_NO })
        Export-PointBackupCsv $backupMembers "initial" | Out-Null
    }

    # 묶음 번호 — 같은 이전을 다시 시도하면 같은 번호를 쓴다(서버가 중복 반영하지 않게). 끝까지 성공하면 지운다.
    $batchId = $null
    if (Test-Path $TransferBatchPath) { try { $batchId = (Get-Content $TransferBatchPath -Raw).Trim() } catch { } }
    if (-not $batchId -or $batchId -notmatch '^[A-Za-z0-9_-]{6,64}$') {
        $batchId = (Get-Date).ToString("yyyyMMddHHmmss") + "-" + ([guid]::NewGuid().ToString("N").Substring(0, 6))
        $batchId | Out-File -Encoding ASCII $TransferBatchPath
    }

    $imported = 0; $already = 0; $skipped = 0; $totalAmount = 0; $failed = 0
    $heldAll = @(); $zeroedAlready = @()
    $batchSize = 200
    for ($i = 0; $i -lt $withPhone.Count; $i += $batchSize) {
        $batch = @($withPhone[$i..([Math]::Min($i + $batchSize - 1, $withPhone.Count - 1))])
        try {
            # JSON을 직접 조립한다 — ConvertTo-Json은 1건짜리 배열을 객체로 직렬화한다.
            $items = @($batch | ForEach-Object { @{ phone = $_.phone; cardNo = $_.cardNo; balance = $_.balance } | ConvertTo-Json -Compress })
            $json = '{"batchId":"' + $batchId + '","entries":[' + ($items -join ',') + ']}'
            $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/bulk-import" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
            $imported += $res.imported; $already += $res.alreadyLinked; $skipped += $res.skippedInvalidPhone; $totalAmount += $res.totalAmount
            # 서버가 "이미 이전한 기록이 있어 반영하지 않음"으로 돌려준 항목: 이전 기록 이하(alreadyApplied)면 이미 서버에 있는 포인트가 포스에 영점화되지 않고 남은 것이므로
            # 포스 쪽만 0으로 정리하고, 이전 기록보다 많은 경우(held)는 자동 처리하지 않고 포스 잔액을 그대로 둔 채 경고한다.
            $heldPhones = @()
            foreach ($h in @($res.held)) { if ($h) { $heldPhones += [string]$h.phone; $heldAll += $h } }
            foreach ($a in @($res.alreadyApplied)) { if ($a) { $zeroedAlready += $a } }
            # 서버 반영이 확인된 회원만, 옮긴 금액만큼만 포스 잔액에서 뺀다(그 사이 새로 쌓인 잔액은 건드리지 않는다).
            foreach ($e in $batch) {
                if ($heldPhones -contains [string]$e.phone) { continue }
                $amt = [double]$e.balance
                Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT = CASE WHEN MEM_USABLE_PNT - $amt < 0 THEN 0 ELSE MEM_USABLE_PNT - $amt END WHERE MEM_NO=$(Sql-Str $e.memNo)"
            }
        } catch {
            Write-Host "포인트 이전 중 오류(이 묶음은 포스 잔액을 그대로 두고 다음 실행 때 다시 시도합니다): $_" -ForegroundColor Red
            Set-AgentError "포인트 서버 이전 실패: $(Get-FriendlyError $_)"
            $failed++
        }
    }

    # 전화번호가 없는 회원은 0으로 지우지 않는다(포스에 그대로 남아 번호가 등록되면 처리된다).
    if ($failed -eq 0) {
        Remove-Item $TransferBatchPath -Force -ErrorAction SilentlyContinue
        if (-not $initialDone) {
            Send-TransferLog "INITIAL_DONE" "" $totalAmount $null $null "최초 포인트 서버 이전 완료(회원 $imported 명, 합계 $totalAmount)" ""
            "ok" | Out-File -Encoding ASCII "$PSScriptRoot\initial-transfer-done.txt"
        }
    }
    $summary = @{ ranAt = (Get-Date).ToString("o"); memberCount = $members.Count; withPhone = $withPhone.Count; noPhone = $noPhoneMembers.Count; imported = $imported; alreadyApplied = $already; skippedInvalidPhone = $skipped; totalAmount = $totalAmount; failedBatches = $failed }
    $summary | ConvertTo-Json | Out-File -Encoding UTF8 "$PSScriptRoot\transfer-last.json"
    if ($zeroedAlready.Count -gt 0) { Write-Host "이미 서버로 이전된 포인트가 포스에 영점화되지 않고 남아 있던 회원 $($zeroedAlready.Count)명 — 포스 잔액만 0으로 정리했습니다(서버에 중복 반영 안 함)." -ForegroundColor Yellow }
    $resultText = "포인트 서버 이전 결과`n새로 이전 $imported 명 / 이미 반영됨 $already 명 / 합계 $totalAmount 포인트`n전화번호가 없는 회원 $($noPhoneMembers.Count)명의 포인트는 포스에 그대로 남겨 두었습니다(번호가 등록되면 다음 이전 때 또는 그 회원이 결제할 때 서버로 옮겨집니다). (실패 묶음 $failed)"
    if ($zeroedAlready.Count -gt 0) { $resultText += "`n`n[알림] 이미 서버로 이전된 포인트가 포스에 남아 있던 회원 $($zeroedAlready.Count)명은 서버에 다시 더하지 않고 포스 잔액만 0으로 정리했습니다." }
    if ($heldAll.Count -gt 0) {
        $heldText = ($heldAll | Select-Object -First 5 | ForEach-Object { "$($_.phone): 포스 $($_.balance) / 서버에 이전한 기록 $($_.previous)" }) -join "`n"
        $resultText += "`n`n[경고] 이 회원 $($heldAll.Count)명은 포스 잔액이 이미 서버로 이전한 금액보다 많아 자동으로 처리하지 않았습니다(포스 잔액 그대로).`n$heldText`n매장 관리자·본사에 확인을 요청하세요."
        Send-TransferLog "REJECTED" "" 0 $null $null "이전 보류(이전 기록보다 포스 잔액이 많음) $($heldAll.Count)명" ""
    }
    if ($failed -gt 0) { $resultText += "`n`n일부 묶음이 실패했습니다. 인터넷 연결을 확인하고 다시 실행하면 이어서 처리됩니다." }
    Write-Host $resultText -ForegroundColor Green
    & $say $resultText $(if ($failed -gt 0) { $warn } else { $info })
    } finally {
        $Script:TransferBusy = $false
    }
}

# ─── 대표 포스기 바탕화면 바로가기 ────────────────────────────────────────────

# ─── 하트비트 ────────────────────────────────────────────────────────────────

$Script:IsPrimary = [bool]$cfg.isPrimary

# 최근 오류를 서버(매장 관리모드 "포스기 다운로드" 화면)에 알린다 — 하트비트에 실어 보낸다.
$Script:LastError = $null
$Script:LastErrorAt = $null
$Script:SkippedNoPhone = 0
$Script:RetryError = $null
$Script:ServerAgentVersion = $null
$Script:TransferBusy = $false   # 포인트 서버 이전이 진행 중인 동안 true — 다른 포인트 처리를 잠시 막는다
$Script:HeldWarned = @{}   # 이전 보류 경고를 회원별로 한 번만 띄우기 위한 목록
$Script:StoreUrl = $null
$Script:UpdateReport = $null      # 서버가 지시한 업데이트의 결과(BUSY/FAILED)를 다음 하트비트로 알린다
$Script:UpdateInProgress = $false

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
        try { $pending = [int](Invoke-Champ "SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N'").Fields.Item("C").Value } catch { }
        $localVer = $null
        try { $localVer = Get-LocalAgentVersion } catch { }
        $report = $Script:UpdateReport; $Script:UpdateReport = $null
        $status = @{ agentVersion = $localVer; caps = @("update"); updateStatus = $(if ($report) { $report.status } else { $null }); updateError = $(if ($report) { $report.error } else { $null }); pending = $pending; skippedNoPhone = $Script:SkippedNoPhone; lastError = $(if ($Script:RetryError) { $Script:RetryError } else { $Script:LastError }); lastErrorAt = $Script:LastErrorAt }
        $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/terminals/heartbeat" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes(($status | ConvertTo-Json -Compress)))
        $Script:IsPrimary = [bool]$res.isPrimary
        if ($res.storeName -and ($res.storeName -ne $cfg.storeName -or $res.companyName -ne $cfg.companyName)) {
            # 이 포스기가 다른 매장으로 옮겨졌다 — 화면 표시를 맞추고 설정에 저장한다.
            $cfg.storeName = $res.storeName; $cfg.companyName = $res.companyName
            try { Save-Config $cfg } catch { }
            try { Show-ResultToast "이 포스기가 이동되었습니다`n$($res.companyName) › $($res.storeName)" } catch { }
        }
        if ($res.agentVersion) { $Script:ServerAgentVersion = [string]$res.agentVersion; try { Update-UpdateMenuText } catch { } }
        # 본사가 시작한 전체 순차 업데이트에서 내 차례가 왔다 — 확인창 없이 업데이트한다(결제 중이면 미뤘다고 알린다).
        if ($res.updateNow -eq $true -and -not $Script:UpdateInProgress) { try { Invoke-AgentUpdate -Auto } catch { Write-Host "자동 업데이트 오류: $_" -ForegroundColor Red } }
        if ($res.terminalName -and $res.terminalName -ne $cfg.name) {
            # 매장 관리모드에서 포스기 이름을 바꿨다 — 화면 표시를 바꾸고 설정 파일에도 저장해 다음 시작 때도 같은 이름을 쓴다.
            $cfg.name = $res.terminalName
            try { Save-Config $cfg } catch { }
        }
        try { Update-IdentityDisplay } catch { }
        if ($res.storeUrl) { $Script:StoreUrl = [string]$res.storeUrl }
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

# 챔프 화면의 가용·잔여 포인트는 MEM_ACC_PNT(누적 적립) - MEM_USED_PNT(누적 사용) + MEM_USABLE_PNT 로 계산된다(실기기 값으로 확인).
# 서버가 이미 가진 이 포스의 이력(누적-사용)이 화면에 또 얹히지 않도록, 주입할 때 이 값을 빼서 화면 가용이 서버 가용과 같아지게 한다.
function Get-DisplayBase($m) {
    $a = 0.0; $u = 0.0
    try { if ($null -ne $m.MEM_ACC_PNT -and "$($m.MEM_ACC_PNT)" -ne "") { $a = [double]$m.MEM_ACC_PNT } } catch { }
    try { if ($null -ne $m.MEM_USED_PNT -and "$($m.MEM_USED_PNT)" -ne "") { $u = [double]$m.MEM_USED_PNT } } catch { }
    return ($a - $u)
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
        if ($Script:TransferBusy) { $lblResult.Text = "포인트 서버 이전 중입니다. 잠시 후 다시 조회해주세요."; return }
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
        $members = Champ-Query "SELECT MEM_NO, MEM_USABLE_PNT, MEM_ACC_PNT, MEM_USED_PNT FROM MEMBER WHERE MEM_TEL_1=$(Sql-Str $phone) OR MEM_REP_TEL=$(Sql-Str $phone)"
        if ($members.Count -eq 0) {
            $lblResult.Text = "가용 포인트: $($res.availableBalance)원`n(주의: 이 손님은 챔프에 회원으로 등록돼 있지 않아 챔프 화면에서 포인트결제를 쓸 수 없습니다. 먼저 챔프에서 신규회원등록을 해주세요.)"
            return
        }
        $memNo = $members[0].MEM_NO
        # 이 회원의 포스에 예전 포인트가 남아 있으면(번호가 뒤늦게 등록된 경우 등) 먼저 서버로 옮긴다 — 결제가 끝나 포스 잔액을 0으로 되돌릴 때 사라지지 않게.
        if ([double]$members[0].MEM_USABLE_PNT -gt 0) {
            try {
                Move-LeftoverToServer $memNo $phone $null
                $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/redeem" -Headers $AuthHeader -ContentType "application/json" -Body (@{ action = "lookup"; phone = $phone } | ConvertTo-Json)
                $members = Champ-Query "SELECT MEM_NO, MEM_USABLE_PNT, MEM_ACC_PNT, MEM_USED_PNT FROM MEMBER WHERE MEM_NO=$(Sql-Str $memNo)"
            } catch { Write-Host "남은 포인트를 서버로 옮기지 못했습니다(그대로 두고 진행): $_" }
        }
        # 덮어쓰기가 아니라 더하기: 이 조회 시점에 로컬 값이 이미 0이 아닐 수 있다(직전에
        # 발생한 적립이 아직 큐 처리를 못 받아 로컬에 남아있는 경우 등) — 덮어쓰면 그 값을
        # 그냥 날려버리게 되므로, 로컬 기존값 + 서버 가용잔액을 합쳐서 반영한다(2026-09-28).
        $localBefore = [double]$members[0].MEM_USABLE_PNT
        $adj = Get-DisplayBase $members[0]
        $newLocal = $localBefore + [double]$res.availableBalance - $adj
        Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=$newLocal WHERE MEM_NO=$(Sql-Str $memNo)"
        $Script:SwapPending[$memNo] = @{ localBefore = $localBefore; injected = [double]$res.availableBalance; at = Get-Date; phone = $phone }
        Send-TransferLog "LOOKUP_TO_POS" $phone ([double]$res.availableBalance) $localBefore $newLocal "사용 조회: 서버 포인트를 포스 화면에 더함" ""

        $lblResult.Text = "가용 포인트 $([int]$res.availableBalance)원을 챔프 화면에 반영했습니다(화면 표시 $([int]($newLocal + $adj))원).`n챔프 고객 관리 창이 이미 열려 있다면 [조회]를 다시 눌러 잔여 포인트가 바뀐 것을 확인한 뒤 포인트결제를 진행하세요."
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
    # 함수가 끝난 뒤에 실행되는 타이머 처리기는 이 함수의 지역 변수($form, $timer)를 볼 수 없다 — 변수 대신 보낸 타이머($s)와 Tag 로 창을 닫는다.
    $timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 4000
    $timer.Tag = $form
    $timer.Add_Tick({
        param($s, $e)
        $s.Stop()
        try { $s.Tag.Close(); $s.Tag.Dispose() } catch { }
        try { $s.Dispose() } catch { }
    })
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
    # 이 손님의 계산이 끝났다(결제 처리·되돌림) — 정정 대상으로 남겨 두지 않는다.
    if ($Script:LastInjected -and "$($Script:LastInjected.phone)" -eq "$($swapInfo.phone)") { $Script:LastInjected = $null }
    Send-TransferLog "RESTORE_POS" "$($swapInfo.phone)" 0 $curLocal 0 "결제 후/대기 종료: 포스 잔액을 0으로 되돌림(서버가 원본)" ""
}

function Restore-TimedOutSwaps {
    $now = Get-Date
    foreach ($memNo in @($Script:SwapPending.Keys)) {
        if (($now - $Script:SwapPending[$memNo].at).TotalSeconds -gt $SwapTimeoutSec) {
            Write-Host "$(Get-Date -Format 'HH:mm:ss') 사용 대기 시간초과 — $memNo 원복"
            $expPhone = "$($Script:SwapPending[$memNo].phone)"
            Restore-SwappedIfDone $memNo
            # 고객 검색창 등에 이 손님 번호가 계속 남아 있으면(손님이 아직 계산대에 있음) 감시 기록을 지워 다시 반영되게 한다 — 번호가 계속 보이는 동안 최대 2번까지.
            if ($expPhone -and $Script:AutoInject) {
                $n = 0; if ($Script:AutoReinject.ContainsKey($expPhone)) { $n = [int]$Script:AutoReinject[$expPhone] }
                if ($n -lt 2) {
                    $Script:AutoReinject[$expPhone] = $n + 1
                    foreach ($k in @($Script:AutoSeen.Keys)) { if ($k.EndsWith("|$expPhone")) { $Script:AutoSeen.Remove($k) } }
                }
            }
        }
    }
}

# 결제가 처리된 회원에게 포스에 남아 있는 예전 포인트(전화번호가 없어 옮기지 못했다가 번호가 등록된 경우 등)가 있으면 그 자리에서 서버로 옮긴다.
# 같은 회원의 처리 대기 결제가 남아 있으면(그 적립분이 포스 잔액에 섞여 있어 이중 반영된다) 하지 않는다. 같은 날 같은 금액은 서버가 한 번만 반영한다.
# 포스 잔액이 마이너스로 남은 회원을 0으로 되돌린다 — 챔프는 [포인트 사용] 조회 없이도 포인트결제를 허용해 포스 잔액이 마이너스가 되고(예: -1,500),
# 그 사용분은 이미 서버에서 차감됐다(결제 처리). 마이너스가 남아 있으면 다음 사용 조회 때 서버 포인트에서 그만큼이 빠져 보이므로 정리한다.
# 처리 대기 결제가 남아 있거나 사용 조회 중인 회원은 건드리지 않는다.
function Reset-NegativeLocal($memNo) {
    if ($Script:SwapPending.ContainsKey($memNo)) { return }
    $other = [int](Invoke-Champ "SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N' AND MEM_NO=$(Sql-Str $memNo)").Fields.Item("C").Value
    if ($other -gt 0) { return }
    Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=0 WHERE MEM_NO=$(Sql-Str $memNo) AND MEM_USABLE_PNT < 0"
}

function Move-LeftoverToServer($memNo, [string]$phone, $cardNo) {
    if ($Script:TransferBusy) { return }
    $other = [int](Invoke-Champ "SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N' AND MEM_NO=$(Sql-Str $memNo)").Fields.Item("C").Value
    if ($other -gt 0) { return }
    $cur = Champ-Query "SELECT MEM_USABLE_PNT FROM MEMBER WHERE MEM_NO=$(Sql-Str $memNo)"
    if ($cur.Count -eq 0) { return }
    $bal = [double]$cur[0].MEM_USABLE_PNT
    if ($bal -le 0) { return }
    $safe = ("$memNo" -replace '[^A-Za-z0-9]', '')
    if ($safe.Length -gt 20) { $safe = $safe.Substring(0, 20) }
    $batchId = "LEFT-$safe-" + (Get-Date).ToString("yyyyMMdd")
    $item = @{ phone = $phone; cardNo = $cardNo; balance = $bal } | ConvertTo-Json -Compress
    $json = '{"batchId":"' + $batchId + '","entries":[' + $item + ']}'
    $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/bulk-import" -Headers $AuthHeader -ContentType "application/json; charset=utf-8" -TimeoutSec 15 -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
    $heldNow = @($res.held | Where-Object { $_ })
    if ($heldNow.Count -gt 0) {
        # 이미 서버로 이전한 기록보다 포스 잔액이 많다 — 자동으로 더하거나 지우지 않고 한 번만 경고한다.
        if (-not $Script:HeldWarned.ContainsKey("$memNo")) {
            $Script:HeldWarned["$memNo"] = $true
            Send-TransferLog "REJECTED" $phone $bal $null $null "이전 보류: 포스 잔액 $bal 이 서버 이전 기록 $($heldNow[0].previous) 보다 많음" ""
            [System.Windows.Forms.MessageBox]::Show("이 손님($phone)의 포스 포인트 $bal 이(가) 이미 서버로 이전한 금액($($heldNow[0].previous))보다 많아 자동으로 처리하지 않았습니다.`n`n서버 포인트가 중복되거나 틀어질 수 있으니 매장 관리자·본사에 확인을 요청해주세요.", "포인트 관리 프로그램 - 확인 필요", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
        }
        return
    }
    $applied = @($res.alreadyApplied | Where-Object { $_ })
    if ($applied.Count -gt 0) {
        # 이미 서버로 이전된 포인트가 포스에 영점화되지 않고 남아 있던 경우 — 서버에 다시 더하지 않고 포스 잔액만 0으로 정리하고 알린다.
        Show-ResultToast "이미 서버로 이전된 포인트가`n포스에 남아 있어 0으로 정리했습니다`n($phone, $bal)"
    }
    if ($res.imported -gt 0 -or $res.alreadyLinked -gt 0) {
        Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT = CASE WHEN MEM_USABLE_PNT - $bal < 0 THEN 0 ELSE MEM_USABLE_PNT - $bal END WHERE MEM_NO=$(Sql-Str $memNo)"
        Write-Host "$(Get-Date -Format 'HH:mm:ss') MEM_NO=$memNo 포스에 남아 있던 포인트 $bal 을(를) 서버로 옮겼습니다."
    }
}

function Process-Queue {
    if ($Script:TransferBusy) { return }  # 포인트 서버 이전 중에는 결제 큐 처리를 잠시 멈춘다(이전이 끝나면 이어서 처리)
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
            # 이 회원의 포스에 남은 예전 포인트(번호가 뒤늦게 등록된 경우 등)가 있으면 이 결제 처리와 함께 서버로 옮긴다(실패해도 결제 처리에는 영향 없음 — 다음 결제·수동 이전 때 다시).
            if (-not $Script:SwapPending.ContainsKey($memNo)) { try { Reset-NegativeLocal $memNo } catch { } }
            if ($phone -and -not $Script:SwapPending.ContainsKey($memNo)) { try { Move-LeftoverToServer $memNo $phone $r.MEMP_CARD_NO } catch { Write-Host "남은 포인트 이전 보류: $_" } }
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

# ─── 고객 조회 시 통합포인트 자동 반영 (시험 기능, 기본 꺼짐) ─────────────────────────────────────────────
# 챔프는 고객 조회·실적 화면이 포스DB(MEMBER.MEM_USABLE_PNT)를 읽는 순간 이미 값이 정해져 있어야 통합 잔액이 보인다.
# 조회는 DB에 흔적을 남기지 않으므로, 챔프 고객 검색창의 전화번호 입력칸(Edit/PBEDIT80)을 읽기만 해서(키·마우스를 가로채지 않는다)
# 번호가 완성되는 순간 서버 통합 잔액을 포스DB에 미리 주입한다. 계산원이 [확인]을 누르기 전에 반영이 끝나도록 0.3초마다 살핀다.
# 트레이 메뉴의 "고객 조회 시 통합포인트 자동 반영" 체크로 켜고 끈다(설정 파일 autoInject). 끄면 기존 '포인트 사용...' 팝업만 쓴다.
if (-not ([System.Management.Automation.PSTypeName]'ChampWatch').Type) {
    Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class ChampWatch {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
    public static bool IsVisible(long h) { return IsWindowVisible(new IntPtr(h)); }
    static string TextOf(IntPtr h) {
        StringBuilder sb = new StringBuilder(64);
        IntPtr r;
        SendMessageTimeout(h, 0x000D, (IntPtr)64, sb, 0x0002, 100, out r);
        return sb.ToString();
    }
    static string DigitsOnly(string t) {
        StringBuilder b = new StringBuilder();
        foreach (char c in t) { if (c >= '0' && c <= '9') b.Append(c); else if (c != '-' && c != ' ') return ""; }
        return b.ToString();
    }
    // 지정한 프로세스의 보이는 창 안에서, 전화번호 모양(01로 시작하는 10~11자리 숫자)이 들어 있는 입력칸을 "hwnd|클래스|숫자" 로 돌려준다.
    public static List<string> FindPhones(string[] procNames) {
        HashSet<uint> pids = new HashSet<uint>();
        foreach (string n in procNames) { foreach (Process p in Process.GetProcessesByName(n)) pids.Add((uint)p.Id); }
        List<string> res = new List<string>();
        if (pids.Count == 0) return res;
        EnumProc top = delegate (IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (!pids.Contains(pid)) return true;
            EnumProc child = delegate (IntPtr c, IntPtr l2) {
                if (!IsWindowVisible(c)) return true;
                StringBuilder cc = new StringBuilder(64); GetClassName(c, cc, 64);
                string cls = cc.ToString();
                if (cls == "Edit" || cls == "PBEDIT80") {
                    string d = DigitsOnly(TextOf(c));
                    if (d.Length >= 10 && d.Length <= 11 && d.StartsWith("01")) res.Add(c.ToInt64() + "|" + cls + "|" + d);
                }
                return true;
            };
            EnumChildWindows(h, child, IntPtr.Zero);
            return true;
        };
        EnumWindows(top, IntPtr.Zero);
        return res;
    }
}
"@
}

$Script:AutoInject = $false
try { $Script:AutoInject = [bool]$cfg.autoInject } catch { }
$Script:ChampProcNames = @("champos")
try { if ($cfg.champProcess) { $Script:ChampProcNames = @("$($cfg.champProcess)") } } catch { }
$Script:AutoSeen = @{}
$Script:LastInjected = $null   # 마지막으로 반영한 번호와 시각 — 곧바로 다른 번호로 고쳐 입력했을 때 잘못 반영한 값을 되돌리는 데 쓴다
$Script:AutoReinject = @{}   # 번호가 화면에 계속 남은 채 유효시간이 만료돼 다시 반영한 횟수(번호가 사라지면 초기화)
$Script:WatchBusy = $false

# 서버 통합 가용 잔액을 이 번호의 챔프 회원 행(MEM_USABLE_PNT)에 주입한다 — '포인트 사용...' 팝업과 같은 처리(조회 잠금 포함)를 조용히 수행.
function Inject-ServerBalance([string]$phone) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $tail = if ($phone.Length -ge 4) { $phone.Substring($phone.Length - 4) } else { $phone }
    $members = Champ-Query "SELECT MEM_NO, MEM_USABLE_PNT, MEM_ACC_PNT, MEM_USED_PNT FROM MEMBER WHERE MEM_TEL_1=$(Sql-Str $phone) OR MEM_REP_TEL=$(Sql-Str $phone)"
    if ($members.Count -eq 0) { Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영: 챔프에 이 번호의 회원이 없어 건너뜀(****$tail)"; return }   # 입력 중이거나 비회원
    $memNo = $members[0].MEM_NO
    if ($Script:SwapPending.ContainsKey($memNo)) {
        # 이미 반영돼 있는 손님을 다시 조회한 경우 — 값을 다시 더하지 않고 유효시간만 연장하며 알려 준다.
        $sw = $Script:SwapPending[$memNo]
        $sw.at = Get-Date
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영(****$tail): 이미 반영 중이라 유효시간만 연장(MEM_NO=$memNo)"
        # 같은 손님의 알림이 연달아 뜨지 않게(고객 관리 화면이 열리며 같은 번호가 또 보이는 경우 등) 8초 안에는 다시 띄우지 않는다.
        $lt = $sw.lastToast
        if (-not $lt -or ((Get-Date) - $lt).TotalSeconds -ge 8) {
            $sw.lastToast = Get-Date
            Show-ResultToast "통합 포인트 $([int]$sw.injected)원이 이미 반영돼 있습니다`n(유효시간 연장)"
        }
        return
    }
    try {
        $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/redeem" -Headers $AuthHeader -ContentType "application/json" -TimeoutSec 6 `
            -Body (@{ action = "lookup"; phone = $phone } | ConvertTo-Json)
    } catch {
        $e = $_
        $code = $null; $holder = $null
        try { $eb = $e.ErrorDetails.Message | ConvertFrom-Json; $code = $eb.error; $holder = $eb.holder } catch { }
        $status = 0
        try { $status = [int]$e.Exception.Response.StatusCode } catch { }
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영 조회 실패(****$tail): $e"
        if ($code -eq "REDEEM_IN_PROGRESS_ELSEWHERE") {
            $where = ""; if ($holder) { $where = "$($holder.storeName) ($($holder.terminalName))" }
            Show-ResultToast "다른 곳에서 포인트 사용 중`n$where`n지금은 적립만 가능"
        } elseif ($status -eq 0) {
            Show-ResultToast "인터넷이 끊겨 포인트 사용 불가`n(적립은 가능)"
        } else {
            Show-ResultToast "서버 포인트 조회 실패`n$(Get-FriendlyError $e)"
        }
        return
    }
    $avail = [double]$res.availableBalance
    if ($avail -le 0) {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영: 서버 통합 포인트가 0원이라 반영할 것이 없음(****$tail)"
        Show-ResultToast "서버 통합 포인트 0원`n(반영할 포인트 없음)"
        return
    }
    # 포스에 예전 포인트가 남아 있으면 먼저 서버로 옮긴다(팝업과 동일).
    if ([double]$members[0].MEM_USABLE_PNT -gt 0) {
        try {
            Move-LeftoverToServer $memNo $phone $null
            $res = Invoke-RestMethod -Method Post -Uri "$($cfg.baseUrl)/api/v1/pos/agent/redeem" -Headers $AuthHeader -ContentType "application/json" -TimeoutSec 6 -Body (@{ action = "lookup"; phone = $phone } | ConvertTo-Json)
            $avail = [double]$res.availableBalance
            $members = Champ-Query "SELECT MEM_NO, MEM_USABLE_PNT, MEM_ACC_PNT, MEM_USED_PNT FROM MEMBER WHERE MEM_NO=$(Sql-Str $memNo)"
        } catch { Write-Host "자동 반영: 남은 포인트를 서버로 옮기지 못했습니다(그대로 진행): $_" }
    }
    if ($avail -le 0) { return }
    $localBefore = [double]$members[0].MEM_USABLE_PNT
    $adj = Get-DisplayBase $members[0]
    $newLocal = $localBefore + $avail - $adj
    Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=$newLocal WHERE MEM_NO=$(Sql-Str $memNo)"
    $Script:SwapPending[$memNo] = @{ localBefore = $localBefore; injected = $avail; at = Get-Date; phone = $phone; lastToast = Get-Date }
    Send-TransferLog "LOOKUP_TO_POS" $phone $avail $localBefore $newLocal "고객 조회 자동 반영: 서버 포인트를 포스 화면에 더함" ""
    Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영(****$tail): 통합 포인트 $([int]$avail)원을 포스 잔여에 반영(MEM_NO=$memNo, 포스 이력 누적-사용=$([int]$adj)로 보정, MEM_USABLE_PNT=$([int]$newLocal)) — 번호 감지부터 반영 완료까지 $($sw.ElapsedMilliseconds)ms"
    Show-ResultToast "통합 포인트 $([int]$avail)원 반영`n챔프에서 [조회/확인]을 누르세요"
}

# 번호를 잘못 입력해(다른 실제 손님 번호) 반영했다가, 그 입력창이 닫히기 전에 같은 창에서 다른 번호로 고쳐 입력한 경우 — 잘못 반영한 값을 되돌린다.
# 그 손님의 결제 처리 대기 건이 있으면(실제로 결제 중) 건드리지 않는다.
function Undo-WrongInjection([string]$phone) {
    foreach ($memNo in @($Script:SwapPending.Keys)) {
        if ("$($Script:SwapPending[$memNo].phone)" -ne $phone) { continue }
        $pending = [int](Invoke-Champ "SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N' AND MEM_NO=$(Sql-Str $memNo)").Fields.Item("C").Value
        if ($pending -gt 0) { return }
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영: 번호가 곧바로 정정돼 잘못 반영한 값을 되돌림(MEM_NO=$memNo)"
        Restore-SwappedIfDone $memNo
    }
}

function Watch-ChampPhone {
    if (-not $Script:AutoInject -or $Script:TransferBusy -or $Script:WatchBusy) { return }
    $Script:WatchBusy = $true
    try {
        # 마지막으로 반영한 손님의 입력창이 닫혔으면 그 손님은 '확정'된 것(계산대로 넘어감) — 이후 입력되는 번호는 다음 손님이다.
        $li = $Script:LastInjected
        if ($li -and -not $li.committed) {
            if (-not [ChampWatch]::IsVisible([int64]$li.hwnd)) { $li.committed = $true }
        }
        $current = @{}
        foreach ($row in [ChampWatch]::FindPhones([string[]]$Script:ChampProcNames)) {
            $f = $row.Split('|', 3)
            $key = "$($f[0])|$($f[2])"
            $current[$key] = $true
            if ($Script:AutoSeen.ContainsKey($key)) { continue }   # 같은 칸의 같은 번호는 화면에 남아 있는 동안 한 번만 처리
            $Script:AutoSeen[$key] = $true
            Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영: 전화번호 입력 감지(****$($f[2].Substring($f[2].Length - 4)), $($f[1]))"
            $prevInj = $Script:LastInjected
            if ($prevInj -and -not $prevInj.committed -and "$($prevInj.hwnd)" -eq "$($f[0])" -and $prevInj.phone -ne $f[2] -and ((Get-Date) - $prevInj.at).TotalSeconds -lt 120) {
                try { Undo-WrongInjection $prevInj.phone } catch { Write-Host "자동 반영: 정정 되돌리기 오류: $_" -ForegroundColor Red }
                $Script:LastInjected = $null
            }
            try { Inject-ServerBalance $f[2] } catch { Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영 오류: $_" -ForegroundColor Red }
            foreach ($sw in $Script:SwapPending.Values) { if ("$($sw.phone)" -eq $f[2] -and "$($sw.lastToast)" -ne "") { $Script:LastInjected = @{ phone = $f[2]; hwnd = $f[0]; at = Get-Date; committed = $false }; break } }
        }
        # 화면에서 사라진 번호는 기록에서 지운다(같은 번호를 다시 입력하면 다시 반영).
        foreach ($k in @($Script:AutoSeen.Keys)) { if (-not $current.ContainsKey($k)) { $Script:AutoSeen.Remove($k); $Script:AutoReinject.Remove($k.Split('|')[1]); Write-Host "$(Get-Date -Format 'HH:mm:ss') 자동 반영: 입력칸에서 번호가 사라져 감시 기록을 지움($($k.Split('|')[0]))" } }
    } finally { $Script:WatchBusy = $false }
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

function Invoke-AgentUpdate([switch]$Auto) {
    $info = [System.Windows.Forms.MessageBoxIcon]::Information
    $warn = [System.Windows.Forms.MessageBoxIcon]::Warning
    # 자동(본사가 시작한 순차 업데이트)에는 확인창을 띄우지 않는다. 결제·사용 조회 중이거나 서버에 못 보낸 결제가 있으면 미루고(BUSY) 나중에 다시 순서가 온다.
    if ($Auto) {
        if ($Script:TransferBusy) { $Script:UpdateReport = @{ status = "BUSY"; error = $null }; return }
        $pendingQ = 0
        try { $pendingQ = [int](Invoke-Champ "SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N'").Fields.Item("C").Value } catch { }
        if ($Script:SwapPending.Count -gt 0 -or $pendingQ -gt 0) { $Script:UpdateReport = @{ status = "BUSY"; error = $null }; return }
        $Script:UpdateInProgress = $true
    }
    try { $v = Invoke-RestMethod -Method Get -Uri "$($cfg.baseUrl)/api/v1/pos-agent/version" -TimeoutSec 15 }
    catch {
        if ($Auto) { $Script:UpdateReport = @{ status = "FAILED"; error = "서버에 연결할 수 없음" }; $Script:UpdateInProgress = $false; return }
        [System.Windows.Forms.MessageBox]::Show("서버에 연결할 수 없어 업데이트를 확인하지 못했습니다.`n인터넷 연결을 확인해주세요.", "업데이트", "OK", $warn) | Out-Null; return }
    $local = Get-LocalAgentVersion
    if ($local -eq $v.version) {
        if (-not $Auto) { [System.Windows.Forms.MessageBox]::Show("이미 최신 버전입니다.", "업데이트", "OK", $info) | Out-Null } else { $Script:UpdateInProgress = $false }
        return
    }
    if (-not $Auto) {
        $ans = [System.Windows.Forms.MessageBox]::Show("새 버전이 있습니다. 지금 업데이트할까요?`n(업데이트하는 동안 프로그램이 잠깐 다시 시작됩니다. 결제 중이 아닐 때 진행해주세요.)", "업데이트", "YesNo", $info)
        if ($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return }
        if ($Script:SwapPending.Count -gt 0) { [System.Windows.Forms.MessageBox]::Show("지금 포인트를 사용 중인 손님이 있습니다. 결제를 마친 뒤 다시 시도해주세요.", "업데이트", "OK", $warn) | Out-Null; return }
    }
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
        if ($Auto) { $Script:UpdateReport = @{ status = "FAILED"; error = "$_" }; $Script:UpdateInProgress = $false; Write-Host "자동 업데이트 실패: $_" -ForegroundColor Red; return }
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
$itemManage = $menu.Items.Add("관리프로그램 실행하기")
$itemManage.Add_Click({
    try { Open-ManagePage $(if ($Script:StoreUrl) { $Script:StoreUrl } else { "$($cfg.baseUrl)/store" }) }
    catch { [System.Windows.Forms.MessageBox]::Show("관리프로그램(웹)을 열지 못했습니다.`n브라우저에서 $($cfg.baseUrl)/store 로 접속해주세요.", "포인트 관리 프로그램", "OK", "Warning") | Out-Null }
})
$itemRedeem = $menu.Items.Add("포인트 사용...")
$itemRedeem.Add_Click({ Show-RedeemPopup })
$itemAuto = New-Object System.Windows.Forms.ToolStripMenuItem("고객 조회 시 통합포인트 자동 반영 (시험)")
$itemAuto.CheckOnClick = $true
$itemAuto.Checked = $Script:AutoInject
$itemAuto.Add_Click({
    $Script:AutoInject = $itemAuto.Checked
    try { $cfg | Add-Member -NotePropertyName autoInject -NotePropertyValue ([bool]$Script:AutoInject) -Force; Save-Config $cfg } catch { Write-Host "자동 반영 설정 저장 실패: $_" }
    Write-Host "$(Get-Date -Format 'HH:mm:ss') 고객 조회 자동 반영: $(if ($Script:AutoInject) { '켬' } else { '끔' })"
})
$menu.Items.Add($itemAuto) | Out-Null
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

# 챔프 고객 검색창의 전화번호 입력을 0.3초마다 살핀다(자동 반영이 꺼져 있으면 아무것도 하지 않는다).
$watchTimer = New-Object System.Windows.Forms.Timer; $watchTimer.Interval = 300
$watchTimer.Add_Tick({ try { Watch-ChampPhone } catch { Write-Host "자동 반영 감시 오류: $_" -ForegroundColor Red } })
$watchTimer.Start()

# 방금 설치·등록한 직후라면 이 매장의 포스기 목록을 자동으로 한 번 보여준다.
if ($ShowList) {
    $Script:ListOnceTimer = New-Object System.Windows.Forms.Timer; $Script:ListOnceTimer.Interval = 1500
    $Script:ListOnceTimer.Add_Tick({
        $Script:ListOnceTimer.Stop()
        Show-TerminalList
    })
    $Script:ListOnceTimer.Start()
}

# 설치/실행 파일로 시작한 경우에만(윈도우 부팅 자동실행은 제외) 최초 포인트 서버 이전을 한 번 실행한다 — 인터넷이 연결돼 있을 때.
# 이미 끝났으면(로컬 표시 파일) 건너뛴다. 인터넷이 없으면 안내만 하고, 이후 트레이 메뉴 '포인트 서버로 이전'으로 하면 된다.
if ($InstallRun -and -not (Test-Path "$PSScriptRoot\initial-transfer-done.txt")) {
    $Script:InitTimer = New-Object System.Windows.Forms.Timer; $Script:InitTimer.Interval = 4000
    $Script:InitTimer.Add_Tick({
        $Script:InitTimer.Stop()
        try { Invoke-PointTransfer $false $true } catch { Write-Host "최초 포인트 이전 중 오류: $_" -ForegroundColor Red }
    })
    $Script:InitTimer.Start()
}

[System.Windows.Forms.Application]::Run()
