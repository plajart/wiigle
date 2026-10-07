# 챔프 포스 DB 조사 스크립트 — 읽기 전용(SELECT만 실행, 아무것도 바꾸지 않는다).
#
# 사용법(포스 PC, 챔프를 쓰는 같은 윈도우 계정의 PowerShell):
#   1) 카탈로그(컬럼·트리거·프로시저·뷰·이벤트) 덤프:
#        powershell -ExecutionPolicy Bypass -File champ-survey.ps1 -Mode Catalog
#   2) 고객 한 명의 현재 값 스냅샷(전/후 비교용):
#        powershell -ExecutionPolicy Bypass -File champ-survey.ps1 -Mode Snapshot -MemNo SYS18195 -Label before
#      → 챔프에서 [고객 검색(전화번호) → 고객 실적 화면 열기]까지만 하고(저장·결제 금지)
#        powershell -ExecutionPolicy Bypass -File champ-survey.ps1 -Mode Snapshot -MemNo SYS18195 -Label after
#      → 두 파일을 비교:
#        powershell -ExecutionPolicy Bypass -File champ-survey.ps1 -Mode Diff -Label before -Label2 after
#      차이가 없으면 "고객 조회는 DB에 흔적을 남기지 않는다"는 뜻이다.
#   2-2) 판매(주문) 화면에서 고객이 붙는 순간을 찾기:
#        -Mode MemTables  → 고객번호·카드번호·전화 컬럼이 있는 테이블 목록과 행수(champ-survey-memtables.txt)
#        -Mode CountAll -Label x1 → 전체 테이블 행수(champ-survey-x1.txt). 계산대에서 [고객을 판매 건에 붙이기 직전]에 한 번,
#        [붙인 직후(결제 전)]에 -Label x2 로 한 번 더 실행한 뒤 -Mode Diff -Label x1 -Label2 x2 로 늘어난 테이블을 확인한다.
#   2-3) 포스기끼리 DB 가 복제돼 있는지 확인(다점포 도입 전):
#        -Mode Balances → 이 포스의 포인트 잔액(MEM_USABLE_PNT) 요약과 지문(해시)을 champ-survey-balances.txt 에 저장한다(전화번호는 뒤 4자리만).
#        같은 매장의 여러 포스기에서 실행해 "지문"이 같으면 DB 가 복제돼 같은 포인트를 각 포스기가 따로 보내게 된다(한 대만 이전해야 함).
#        지문이 다르면 포스기마다 따로 쌓인 포인트라 각각 이전한다. 읽기 전용.
#   3) 같은 방식으로 포인트 사용 결제 전/후 스냅샷(-Label pay-before / pay-after)을 비교하면 결제가 바꾸는 값을 알 수 있다.
# 결과는 이 스크립트가 있는 폴더의 champ-survey-<종류>.txt 에 저장된다(전화번호는 그대로 들어가니 외부에 올리지 말 것).
param(
    [ValidateSet("Catalog", "Snapshot", "Diff", "MemTables", "CountAll", "Balances")][string]$Mode = "Catalog",
    [string]$MemNo = "",
    [string]$Label = "snap",
    [string]$Label2 = "snap2"
)
$ErrorActionPreference = "Stop"
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

function Open-Champ {
    $c = New-Object -ComObject ADODB.Connection
    $c.ConnectionTimeout = 30
    $c.Open("DSN=CHAMP")
    return $c
}

# 결과를 "열=값" 줄들로 바꾼다(긴 값도 자르지 않는다).
function Query-Lines($conn, [string]$sql) {
    $out = New-Object System.Collections.Generic.List[string]
    try {
        $rs = $conn.Execute($sql)
        $n = 0
        while (-not $rs.EOF) {
            $n++
            $out.Add("--- 행 $n")
            for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
                $v = $rs.Fields.Item($i).Value
                if ($v -is [byte[]]) { $v = "(binary $($v.Length) bytes)" }
                $out.Add("  $($rs.Fields.Item($i).Name) = $v")
            }
            $rs.MoveNext()
        }
        $rs.Close()
        if ($n -eq 0) { $out.Add("(결과 없음)") }
    } catch {
        $out.Add("(실행 실패: $($_.Exception.Message))")
    }
    return $out
}

function Section($title, $conn, $sql) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("")
    $lines.Add("=== $title")
    $lines.Add("SQL> $sql")
    $lines.AddRange([string[]](Query-Lines $conn $sql))
    return $lines
}

function Sql-Str([string]$s) { return "'" + ($s -replace "'", "''") + "'" }

if ($Mode -eq "Diff") {
    $a = Join-Path $dir "champ-survey-$Label.txt"
    $b = Join-Path $dir "champ-survey-$Label2.txt"
    if (-not (Test-Path $a) -or -not (Test-Path $b)) { Write-Host "비교할 파일이 없습니다: $a / $b"; exit 1 }
    $d = Compare-Object (Get-Content $a -Encoding UTF8) (Get-Content $b -Encoding UTF8)
    if (-not $d) { Write-Host "차이 없음 — 두 시점 사이에 조사한 값이 변하지 않았습니다." }
    else { $d | Format-Table -AutoSize | Out-String -Width 250 | Write-Host }
    exit 0
}

$conn = Open-Champ
$all = New-Object System.Collections.Generic.List[string]
$all.Add("챔프 조사 ($Mode) — $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') — $env:COMPUTERNAME")

if ($Mode -eq "Balances") {
    $rs = $conn.Execute("SELECT MEM_NO, MEM_REP_TEL, MEM_TEL_1, MEM_USABLE_PNT FROM MEMBER WHERE MEM_USABLE_PNT <> 0")
    $byPhone = @{}
    $noPhone = 0; $noPhoneSum = 0.0
    while (-not $rs.EOF) {
        $bal = [double]$rs.Fields.Item("MEM_USABLE_PNT").Value
        $ph = $null
        foreach ($cand in @($rs.Fields.Item("MEM_REP_TEL").Value, $rs.Fields.Item("MEM_TEL_1").Value)) {
            if ($cand) { $d = ("$cand" -replace '[^0-9]', ''); if ($d.Length -ge 9) { $ph = $d; break } }
        }
        if ($ph) { if ($byPhone.ContainsKey($ph)) { $byPhone[$ph] += $bal } else { $byPhone[$ph] = $bal } } else { $noPhone++; $noPhoneSum += $bal }
        $rs.MoveNext()
    }
    $rs.Close()
    $lines2 = @($byPhone.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name):$([math]::Round($_.Value, 2))" })
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = ([System.BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(($lines2 -join "`n")))) -replace '-', '').ToLower()
    $pos = @($byPhone.Values | Where-Object { $_ -gt 0 }); $neg = @($byPhone.Values | Where-Object { $_ -lt 0 })
    $all.Add("전화번호가 있는 회원: $($byPhone.Count)명, 잔액 합계 $([math]::Round(($byPhone.Values | Measure-Object -Sum).Sum, 2))")
    $all.Add("  양수 잔액 $($pos.Count)명(합계 $([math]::Round(($pos | Measure-Object -Sum).Sum, 2))), 음수 잔액 $($neg.Count)명")
    $all.Add("전화번호 없는 회원(이전 대상 아님): $noPhone 명, 잔액 합계 $([math]::Round($noPhoneSum, 2))")
    $all.Add("지문(복제 확인용, 같은 매장 포스기끼리 비교): $hash")
    $all.Add("예시(전화번호 뒤 4자리):")
    foreach ($l in ($lines2 | Select-Object -First 10)) { $k = $l.Split(':'); $all.Add("  ****$($k[0].Substring($k[0].Length - 4)) : $($k[1])") }
    $out = Join-Path $dir "champ-survey-balances.txt"
} elseif ($Mode -eq "MemTables") {
    $all.AddRange([string[]](Section "고객번호·카드번호·전화 컬럼이 있는 테이블(MEMBER·MEMBER_POINT 제외)" $conn "SELECT t.table_name, c.column_name, c.width FROM SYSCOLUMN c JOIN SYSTABLE t ON t.table_id=c.table_id WHERE t.table_type='BASE' AND (c.column_name LIKE '%MEM_NO%' OR c.column_name LIKE '%MEM_CARD%' OR c.column_name LIKE '%CARD_NO%' OR c.column_name LIKE '%MEM_REP_TEL%' OR c.column_name LIKE '%MEM_NM%') AND t.table_name NOT IN ('MEMBER','MEMBER_POINT') ORDER BY t.table_name, c.column_name"))
    $out = Join-Path $dir "champ-survey-memtables.txt"
} elseif ($Mode -eq "CountAll") {
    $names = @()
    $rs = $conn.Execute("SELECT table_name FROM SYSTABLE WHERE table_type='BASE' AND table_name NOT LIKE 'SYS%' AND table_name NOT LIKE 'sa_%' ORDER BY table_name")
    while (-not $rs.EOF) { $names += [string]$rs.Fields.Item(0).Value; $rs.MoveNext() }
    $rs.Close()
    $all.Add("=== 테이블별 행수($($names.Count)개)")
    foreach ($n in $names) {
        try { $r = $conn.Execute("SELECT count(*) FROM ""$n"""); $all.Add("$n = $($r.Fields.Item(0).Value)"); $r.Close() }
        catch { $all.Add("$n = (조회 실패)") }
    }
    $out = Join-Path $dir "champ-survey-$Label.txt"
} elseif ($Mode -eq "Catalog") {
    $all.AddRange([string[]](Section "MEMBER·MEMBER_POINT 컬럼" $conn "SELECT t.table_name, c.column_id, c.column_name, c.domain_id, c.width FROM SYSCOLUMN c JOIN SYSTABLE t ON t.table_id=c.table_id WHERE t.table_name IN ('MEMBER','MEMBER_POINT') ORDER BY t.table_name, c.column_id"))
    $all.AddRange([string[]](Section "전체 테이블 이름" $conn "SELECT table_name, table_type FROM SYSTABLE WHERE creator=1 OR table_type='BASE' ORDER BY table_name"))
    $all.AddRange([string[]](Section "트리거 전체(본문 포함)" $conn "SELECT tb.table_name, t.trigger_name, t.event, t.trigger_time, t.trigger_defn FROM SYSTRIGGER t JOIN SYSTABLE tb ON tb.table_id=t.table_id ORDER BY tb.table_name, t.trigger_name"))
    $all.AddRange([string[]](Section "포인트 관련 프로시저·함수(본문 포함)" $conn "SELECT proc_name, proc_defn FROM SYSPROCEDURE WHERE proc_defn LIKE '%MEM_USABLE_PNT%' OR proc_defn LIKE '%MEMBER_POINT%' OR proc_defn LIKE '%MEMP_%' OR proc_name LIKE '%MEM%'"))
    $all.AddRange([string[]](Section "이벤트" $conn "SELECT * FROM SYSEVENT"))
    $all.AddRange([string[]](Section "MEMBER 관련 뷰" $conn "SELECT t.table_name, v.view_def FROM SYSVIEW v JOIN SYSTABLE t ON t.table_id=v.view_object_id WHERE v.view_def LIKE '%MEMBER%'"))
    $all.AddRange([string[]](Section "MEMBER·MEMBER_POINT 제약(외래키·체크)" $conn "SELECT * FROM SYSCONSTRAINT"))
    $out = Join-Path $dir "champ-survey-catalog.txt"
} else {
    if (-not $MemNo) { Write-Host "-MemNo 가 필요합니다(예: SYS18195)."; $conn.Close(); exit 1 }
    $m = Sql-Str $MemNo
    $all.AddRange([string[]](Section "MEMBER 행 전체" $conn "SELECT * FROM MEMBER WHERE MEM_NO=$m"))
    $all.AddRange([string[]](Section "MEMBER_POINT 행수·최근시각" $conn "SELECT count(*) AS CNT, max(MEMP_DT) AS LAST_DT, sum(MEMP_ADD_AMT) AS SUM_ADD FROM MEMBER_POINT WHERE MEM_NO=$m"))
    $all.AddRange([string[]](Section "MEMBER_POINT 최근 5행 전체" $conn "SELECT TOP 5 * FROM MEMBER_POINT WHERE MEM_NO=$m ORDER BY MEMP_DT DESC, MEMP_SEQ DESC"))
    $all.AddRange([string[]](Section "CRAB_EVENT_QUEUE 행수" $conn "SELECT PROCESSED, count(*) AS CNT FROM CRAB_EVENT_QUEUE GROUP BY PROCESSED"))
    $out = Join-Path $dir "champ-survey-$Label.txt"
}
$conn.Close()
# BOM 포함 UTF-8 로 저장(메모장에서 한글이 깨지지 않게)
[System.IO.File]::WriteAllLines($out, $all, (New-Object System.Text.UTF8Encoding($true)))
Write-Host "저장했습니다: $out ($($all.Count)줄)"
