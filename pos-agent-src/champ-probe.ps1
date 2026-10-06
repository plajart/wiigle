# 챔프 포스 "전화번호 입력 순간 감지" 가능성 진단 — 읽기 전용(화면 글자·DB 상태를 읽기만 한다, 아무것도 바꾸지 않고 키·마우스 입력도 보내지 않는다).
#
# 포스 PC에서 챔프를 쓰는 같은 윈도우 계정의 PowerShell로 실행한다. 실행하는 동안 계산원(또는 사용자)이 챔프에서
# [고객 조회 → 전화번호 입력 → 조회/선택 → 실적 화면 열기]를 평소처럼 한 번 한다(결제·저장은 하지 않는다).
#   -Mode Ui  : 챔프 창들의 입력칸 글자를 0.2초마다 읽어, 숫자만 있는 글자(전화번호가 타이핑되는 모습)가 바뀔 때마다 시각과 함께 기록한다.
#               → 입력하는 순간 읽을 수 있는지(=화면 입력 감지 방식이 가능한지) 알 수 있다.
#   -Needle "SYS18195|배병철" : 고객 코드·이름·전화·카드번호 등이 화면 글자로 처음 나타나는 순간을 기록한다(이름·카드번호로 조회하는 경우를 위해).
#   -Mode Keys: 키보드 훅(WH_KEYBOARD_LL)으로 숫자·Enter·Backspace 키만 "관찰"한다(막거나 바꾸거나 보내지 않는다).
#               → 챔프가 앞에 있을 때(관리자 권한 챔프 포함) 우리 프로그램이 키를 볼 수 있는지, 마지막 숫자와 Enter 사이 시간이 얼마인지,
#                 키가 외부 장치(스캐너 등)에서 들어온 것인지(injected 표시)를 확인한다. 숫자는 앞 3자리와 길이만 기록한다.
#   -Mode Mouse: 마우스 훅(WH_MOUSE_LL)으로 왼쪽 클릭(터치로 바뀐 클릭 포함)을 "관찰"한다(막거나 바꾸거나 보내지 않는다).
#               → 클릭한 위치 아래 컨트롤의 클래스·글자·창 제목, 터치 유래 여부, 클릭 순간의 숫자 입력칸 글자(전화번호가 읽히는지)를 기록한다.
#                 터치 키패드로 전화번호를 입력하고 [확인/조회] 버튼을 누르는 모습을 평소처럼 한 번 해 주세요.
#   -Mode Sql : DB 연결별 "마지막 실행 SQL"을 0.1초마다 읽어, MEMBER 를 조회하는 문장이 보이는지 기록한다.
#               → 챔프가 전화번호로 실행하는 조회 SQL 의 실제 모양(어느 컬럼, 몇 번 읽는지)과 감지 가능 여부를 알 수 있다.
# 결과: champ-probe-<모드>.txt (이 스크립트가 있는 폴더). 전화번호가 들어 있으니 외부에 올리지 말 것(이 세션 보고용으로만).
param(
    [ValidateSet("Ui", "Sql", "Keys", "Mouse")][string]$Mode = "Ui",
    [int]$Seconds = 60,
    # 이 글자(정규식, 예: "SYS18195|배병철|01035587496|129900001024")가 들어 있는 창 글자가 나타나는 순간을 기록한다 — 고객을 선택/부착했을 때 화면 어디에 고객 정보가 뜨는지 찾는 용도.
    [string]$Needle = ""
)
$ErrorActionPreference = "Stop"
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$out = Join-Path $dir "champ-probe-$($Mode.ToLower()).txt"
$log = New-Object System.Collections.Generic.List[string]
function Note([string]$s) { $line = "$(Get-Date -Format 'HH:mm:ss.fff') $s"; $log.Add($line); Write-Host $line }

function Add-ProbeWin {
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
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
    public static string RootTitle(IntPtr h) {
        IntPtr root = GetAncestor(h, 2);
        if (root == IntPtr.Zero) return "";
        StringBuilder rc = new StringBuilder(128); GetClassName(root, rc, 128);
        return rc + ":'" + TextOf(root) + "'";
    }
    public static string Describe(IntPtr h) {
        if (h == IntPtr.Zero) return "(없음)";
        StringBuilder cn = new StringBuilder(128); GetClassName(h, cn, 128);
        IntPtr root = GetAncestor(h, 2);
        StringBuilder rc = new StringBuilder(128); if (root != IntPtr.Zero) GetClassName(root, rc, 128);
        return "클래스=" + cn + " 컨트롤ID=" + GetDlgCtrlID(h) + " 글자='" + TextOf(h) + "' / 최상위 클래스=" + rc + " 제목='" + (root != IntPtr.Zero ? TextOf(root) : "") + "'";
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
}

if ($Mode -eq "Mouse") {
    Add-ProbeWin
    Add-Type @"
using System;
using System.Diagnostics;
using System.Threading;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
public class MouseProbe {
    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x; public int y; }
    [StructLayout(LayoutKind.Sequential)] struct MSLL { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc p, IntPtr mod, uint tid);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    public static ConcurrentQueue<string> Q = new ConcurrentQueue<string>();
    public static string HookError = "";
    static HookProc proc; static IntPtr hook; static Thread th;
    public static void Start() { th = new Thread(Run); th.IsBackground = true; th.Start(); }
    static void Run() {
        proc = Callback;
        hook = SetWindowsHookEx(14, proc, GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName), 0);
        if (hook == IntPtr.Zero) { HookError = "SetWindowsHookEx 실패(오류 " + Marshal.GetLastWin32Error() + ")"; return; }
        MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
    }
    static IntPtr Callback(int n, IntPtr w, IntPtr l) {
        if (n >= 0 && w.ToInt32() == 0x201) {
            MSLL k = (MSLL)Marshal.PtrToStructure(l, typeof(MSLL));
            IntPtr h = WindowFromPoint(k.pt);
            Q.Enqueue(DateTime.Now.Ticks + "|" + k.pt.x + "|" + k.pt.y + "|" + k.flags + "|" + k.dwExtraInfo.ToInt64().ToString("X") + "|" + h.ToInt64());
        }
        return CallNextHookEx(hook, n, w, l);
    }
}
"@
    Note "마우스·터치 클릭 관찰 시작 — ${Seconds}초 동안 챔프 터치 키패드로 전화번호를 입력하고 [확인/조회] 버튼을 눌러 주세요(결제·저장 금지)."
    [MouseProbe]::Start()
    Start-Sleep -Milliseconds 500
    if ([MouseProbe]::HookError) { Note "훅 설치 오류: $([MouseProbe]::HookError)" }
    $procNames = @{}
    Get-Process | ForEach-Object { $procNames[[string]$_.Id] = $_.ProcessName }
    $end = (Get-Date).AddSeconds($Seconds); $clicks = 0
    while ((Get-Date) -lt $end) {
        $line = $null
        while ([MouseProbe]::Q.TryDequeue([ref]$line)) {
            $clicks++
            $f = $line.Split('|')
            $touch = ((([int64]"0x$($f[4])") -band 0xFFFFFF00) -eq 0xFF515700)
            $desc = [ProbeWin]::Describe([IntPtr][int64]$f[5])
            $digitsNow = @()
            foreach ($row in [ProbeWin]::Dump()) { $p = $row.Split('|', 5); if ($p[4] -match '^[0-9\- ]{4,15}$') { $digitsNow += "클래스=$($p[3]) 창=$([ProbeWin]::RootTitle([IntPtr][int64]$p[2])) 글자='$($p[4])'" } }
            Note "클릭 ($($f[1]),$($f[2])) 터치유래=$touch extra=0x$($f[4]) 대상: $desc / 이 순간 숫자 입력칸: $(if ($digitsNow.Count) { $digitsNow -join ' ; ' } else { '없음(읽히지 않음)' })"
        }
        Start-Sleep -Milliseconds 50
    }
    Note "관찰한 클릭 수: $clicks. 0이면 훅이 클릭을 못 받는 것(권한 문제 가능성)이다."
}
elseif ($Mode -eq "Keys") {
    Add-Type @"
using System;
using System.Diagnostics;
using System.Threading;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
public class KeyProbe {
    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] struct KBD { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc p, IntPtr mod, uint tid);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    public static ConcurrentQueue<string> Q = new ConcurrentQueue<string>();
    public static string HookError = "";
    static HookProc proc; static IntPtr hook; static Thread th;
    public static void Start() { th = new Thread(Run); th.IsBackground = true; th.Start(); }
    static void Run() {
        proc = Callback;
        hook = SetWindowsHookEx(13, proc, GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName), 0);
        if (hook == IntPtr.Zero) { HookError = "SetWindowsHookEx 실패(오류 " + Marshal.GetLastWin32Error() + ")"; return; }
        MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
    }
    static IntPtr Callback(int n, IntPtr w, IntPtr l) {
        if (n >= 0) {
            int msg = w.ToInt32();
            if (msg == 0x100 || msg == 0x104) {
                KBD k = (KBD)Marshal.PtrToStructure(l, typeof(KBD));
                uint vk = k.vkCode;
                if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x60 && vk <= 0x69) || vk == 0x0D || vk == 0x08) {
                    uint pid = 0; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
                    Q.Enqueue(DateTime.Now.Ticks + "|" + vk + "|" + k.flags + "|" + pid);
                }
            }
        }
        return CallNextHookEx(hook, n, w, l);
    }
}
"@
    Note "키 관찰 진단 시작 — ${Seconds}초 동안 챔프(앞 창)에서 평소처럼 키패드로 전화번호를 입력하고 Enter 를 눌러 주세요(결제·저장 금지)."
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Note "이 진단 프로세스 관리자 권한: $isAdmin"
    [KeyProbe]::Start()
    Start-Sleep -Milliseconds 500
    if ([KeyProbe]::HookError) { Note "훅 설치 오류: $([KeyProbe]::HookError)" }
    $procNames = @{}
    $digits = ""; $lastTicks = 0; $injected = $false; $lastPid = 0
    $end = (Get-Date).AddSeconds($Seconds)
    $seen = 0
    while ((Get-Date) -lt $end) {
        $line = $null
        while ([KeyProbe]::Q.TryDequeue([ref]$line)) {
            $seen++
            $f = $line.Split('|'); $ticks = [int64]$f[0]; $vk = [int]$f[1]; $flags = [int]$f[2]; $fpid = [string]$f[3]
            if (-not $procNames.ContainsKey($fpid)) { try { $procNames[$fpid] = (Get-Process -Id ([int]$fpid) -ErrorAction Stop).ProcessName } catch { $procNames[$fpid] = "?" } }
            $inj = (($flags -band 0x10) -ne 0) -or (($flags -band 0x02) -ne 0)
            if ($vk -ge 0x30 -and $vk -le 0x39) { $digits += [string]($vk - 0x30); $lastTicks = $ticks; $injected = $inj; $lastPid = $fpid }
            elseif ($vk -ge 0x60 -and $vk -le 0x69) { $digits += [string]($vk - 0x60); $lastTicks = $ticks; $injected = $inj; $lastPid = $fpid }
            elseif ($vk -eq 0x08) { if ($digits.Length -gt 0) { $digits = $digits.Substring(0, $digits.Length - 1) } }
            elseif ($vk -eq 0x0D) {
                $gap = if ($lastTicks -gt 0) { [int](($ticks - $lastTicks) / 10000) } else { -1 }
                $shape = if ($digits.Length -ge 3) { $digits.Substring(0, 3) + "…" } else { "(짧음)" }
                Note "Enter: 앞 창=$($procNames[$fpid]) / 직전 숫자열 $($digits.Length)자리 $shape / 마지막 숫자→Enter ${gap}ms / 외부장치·주입 표시=$injected"
                $digits = ""
            }
        }
        Start-Sleep -Milliseconds 50
    }
    Note "관찰한 키 수: $seen. 0이면 챔프가 앞에 있을 때 훅이 키를 못 받는 것(권한 문제 가능성)이다."
}
elseif ($Mode -eq "Ui") {
    Add-ProbeWin
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
            if ($Needle -and $txt -match $Needle) {
                $nk = "N|$($p[1])|$($p[2])"
                if ($last[$nk] -ne $txt) { Note "고객 정보 표시: 프로세스=$($procNames[$p[1]]) 클래스=$cls 글자='$txt'"; $last[$nk] = $txt }
            }
            if ($txt -notmatch '^[0-9\- ]{1,15}$') { continue }   # 숫자만 있는 글자(타이핑 중인 전화번호 등)만 기록
            $dk = "$($p[1])|$($p[2])"
            if ($last[$dk] -ne $txt) {
                Note "숫자 글자 변화: 프로세스=$($procNames[$p[1]]) 클래스=$cls 창=$([ProbeWin]::RootTitle([IntPtr][int64]$p[2])) hwnd=$($p[2]) 글자='$txt'"
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
