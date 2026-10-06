# 챔프 포스 "전화번호 입력 순간 감지" 가능성 진단 — 읽기 전용(화면 글자·DB 상태를 읽기만 한다, 아무것도 바꾸지 않고 키·마우스 입력도 보내지 않는다).
#
# 포스 PC에서 챔프를 쓰는 같은 윈도우 계정의 PowerShell로 실행한다. 실행하는 동안 계산원(또는 사용자)이 챔프에서
# [고객 조회 → 전화번호 입력 → 조회/선택 → 실적 화면 열기]를 평소처럼 한 번 한다(결제·저장은 하지 않는다).
#   -Mode Ui  : 챔프 창들의 입력칸 글자를 0.2초마다 읽어, 숫자만 있는 글자(전화번호가 타이핑되는 모습)가 바뀔 때마다 시각과 함께 기록한다.
#               → 입력하는 순간 읽을 수 있는지(=화면 입력 감지 방식이 가능한지) 알 수 있다.
#   -Mode Sql : DB 연결별 "마지막 실행 SQL"을 0.1초마다 읽어, MEMBER 를 조회하는 문장이 보이는지 기록한다.
#               → 챔프가 전화번호로 실행하는 조회 SQL 의 실제 모양(어느 컬럼, 몇 번 읽는지)과 감지 가능 여부를 알 수 있다.
# 결과: champ-probe-<모드>.txt (이 스크립트가 있는 폴더). 전화번호가 들어 있으니 외부에 올리지 말 것(이 세션 보고용으로만).
param(
    [ValidateSet("Ui", "Sql")][string]$Mode = "Ui",
    [int]$Seconds = 60
)
$ErrorActionPreference = "Stop"
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$out = Join-Path $dir "champ-probe-$($Mode.ToLower()).txt"
$log = New-Object System.Collections.Generic.List[string]
function Note([string]$s) { $line = "$(Get-Date -Format 'HH:mm:ss.fff') $s"; $log.Add($line); Write-Host $line }

if ($Mode -eq "Ui") {
    Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ProbeWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
    const uint WM_GETTEXT = 0x000D;
    const uint SMTO_ABORTIFHUNG = 0x0002;
    static string TextOf(IntPtr h) {
        StringBuilder sb = new StringBuilder(512);
        IntPtr r;
        SendMessageTimeout(h, WM_GETTEXT, (IntPtr)512, sb, SMTO_ABORTIFHUNG, 100, out r);
        return sb.ToString();
    }
    // 각 줄: T(최상위)/C(자식)|pid|hwnd|클래스|글자  (보이는 창과 그 자식 컨트롤 중 글자가 있는 것)
    public static List<string> Dump() {
        List<string> res = new List<string>();
        EnumProc top = delegate (IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            StringBuilder cn = new StringBuilder(128); GetClassName(h, cn, 128);
            res.Add("T|" + pid + "|" + h.ToInt64() + "|" + cn + "|" + TextOf(h));
            EnumProc child = delegate (IntPtr c, IntPtr l2) {
                StringBuilder cc = new StringBuilder(128); GetClassName(c, cc, 128);
                res.Add("C|" + pid + "|" + c.ToInt64() + "|" + cc + "|" + TextOf(c));
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
    Note "화면 입력 감지 진단 시작 — ${Seconds}초 동안 챔프에서 전화번호를 조회해 주세요."
    $procNames = @{}
    Get-Process | ForEach-Object { $procNames[[string]$_.Id] = $_.ProcessName }
    $first = [ProbeWin]::Dump()
    $classes = @{}
    foreach ($row in $first) { $p = $row.Split('|', 5); $k = "$($procNames[$p[1]]) / $($p[3])"; if ($classes.ContainsKey($k)) { $classes[$k]++ } else { $classes[$k] = 1 } }
    Note "시작 시점 창/컨트롤 종류(프로세스 / 클래스 : 개수)"
    $classes.GetEnumerator() | Sort-Object Name | ForEach-Object { Note "  $($_.Name) : $($_.Value)" }
    $last = @{}
    $seenTop = @{}
    foreach ($row in $first) { $p = $row.Split('|', 5); if ($p[0] -eq 'T') { $seenTop["$($p[1])|$($p[2])"] = $p[4] } }
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) {
        $nowTop = @{}
        foreach ($row in [ProbeWin]::Dump()) {
            $p = $row.Split('|', 5)
            $level = $p[0]; $key = "$($p[1])|$($p[2])"; $cls = $p[3]; $txt = $p[4]
            if ($level -eq 'T') {
                $nowTop[$key] = $txt
                # 새로 뜨거나 제목이 바뀐 최상위 창(결제창·포인트 사용창 등이 열리는 순간)을 기록
                if (-not $seenTop.ContainsKey($key)) { Note "새 창: 프로세스=$($procNames[$p[1]]) 클래스=$cls 제목='$txt'" }
                elseif ($seenTop[$key] -ne $txt) { Note "창 제목 변화: 프로세스=$($procNames[$p[1]]) 클래스=$cls 제목='$($seenTop[$key])' → '$txt'" }
            }
            if ($txt -notmatch '^[0-9\- ]{1,15}$') { continue }   # 숫자만 있는 글자(타이핑 중인 전화번호 등)만 기록
            $dk = "$($p[1])|$($p[2])"
            if ($last[$dk] -ne $txt) {
                Note "숫자 글자 변화: 프로세스=$($procNames[$p[1]]) 클래스=$cls hwnd=$($p[2]) 글자='$txt'"
                $last[$dk] = $txt
            }
        }
        foreach ($k in $nowTop.Keys) { $seenTop[$k] = $nowTop[$k] }
        foreach ($k in @($seenTop.Keys)) { if (-not $nowTop.ContainsKey($k)) { Note "창 닫힘: $($seenTop[$k])"; $seenTop.Remove($k) } }
        Start-Sleep -Milliseconds 200
    }
    Note "종료. 위 '숫자 글자 변화' 줄이 전혀 없으면 이 방식으로는 입력칸 글자를 읽을 수 없는 것이다."
}
else {
    $conn = New-Object -ComObject ADODB.Connection
    $conn.ConnectionTimeout = 30
    $conn.Open("DSN=CHAMP")
    Note "SQL 감시 진단 시작 — ${Seconds}초 동안 챔프에서 전화번호를 조회해 주세요."
    $sqlVariants = @(
        "SELECT Number, Name, connection_property('LastStatement', Number) AS LastStatement FROM sa_conn_info()",
        "SELECT * FROM sa_conn_activity()"
    )
    $chosen = $null
    foreach ($v in $sqlVariants) {
        try { $rs = $conn.Execute($v); $rs.Close(); $chosen = $v; Note "사용 가능한 방식: $v"; break }
        catch { Note "실패: $v → $($_.Exception.Message)" }
    }
    if (-not $chosen) { Note "마지막 SQL 을 읽을 수 있는 방식이 없다(서버 옵션 -zl 필요할 수 있음). 서버 시작 옵션을 변경하지는 말고 이 결과만 보고하세요."; }
    else {
        $last = @{}
        $end = (Get-Date).AddSeconds($Seconds)
        while ((Get-Date) -lt $end) {
            try {
                $rs = $conn.Execute($chosen)
                while (-not $rs.EOF) {
                    $vals = @(); for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $vals += "$($rs.Fields.Item($i).Name)=$($rs.Fields.Item($i).Value)" }
                    $line = $vals -join " | "
                    $id = "$($rs.Fields.Item(0).Value)"
                    if ($line -match 'MEMBER' -and $last[$id] -ne $line) { Note "MEMBER 조회 감지: $line"; $last[$id] = $line }
                    $rs.MoveNext()
                }
                $rs.Close()
            } catch { Note "조회 오류: $($_.Exception.Message)" }
            Start-Sleep -Milliseconds 100
        }
        Note "종료. 'MEMBER 조회 감지' 줄이 없으면 이 방식으로는 챔프의 조회 SQL 을 볼 수 없는 것이다."
    }
    $conn.Close()
}
[System.IO.File]::WriteAllLines($out, $log, (New-Object System.Text.UTF8Encoding($true)))
Write-Host "저장했습니다: $out"
