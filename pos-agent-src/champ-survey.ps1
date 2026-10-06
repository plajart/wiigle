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
#   3) 같은 방식으로 포인트 사용 결제 전/후 스냅샷(-Label pay-before / pay-after)을 비교하면 결제가 바꾸는 값을 알 수 있다.
# 결과는 이 스크립트가 있는 폴더의 champ-survey-<종류>.txt 에 저장된다(전화번호는 그대로 들어가니 외부에 올리지 말 것).
param(
    [ValidateSet("Catalog", "Snapshot", "Diff")][string]$Mode = "Catalog",
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

if ($Mode -eq "Catalog") {
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
