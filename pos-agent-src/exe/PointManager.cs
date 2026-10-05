// 포인트 관리 프로그램 실행파일(런처) — 한 번 빌드해 서버의 pos-agent-src/PointManager.exe 로 두면,
// 매장 화면의 "포스기 다운로드"가 이 exe 뒤에 그 매장 전용 설치 정보를 붙여 내려준다.
//
// 하는 일
//  1) 실행하면 자기 파일 끝에 붙은 설치 정보(provision)를 읽는다(없으면 이미 설치된 PC에서 다시 실행한 것).
//  2) %LOCALAPPDATA%\PointManager\ 에 자기 자신을 복사하고, 서버(/api/v1/pos-agent/bundle)에서 최신 프로그램 파일을 받아 app\ 에 푼다.
//  3) 설치 정보를 app\provision.json 으로 저장(UTF-8 BOM)하고, PowerShell로 프로그램(-Setup)을 실행한다 — 등록 확인창·자동시작·실행은 거기서 한다.
//  업데이트 확인은 프로그램(트레이 메뉴)이 같은 서버 API로 스크립트 묶음을 교체한다. 이 exe 자체는 거의 바뀌지 않는다
//  (바뀌면 --self-update: 실행 중인 exe는 덮어쓸 수 없지만 이름은 바꿀 수 있으므로 .old 로 바꾸고 새 파일을 그 자리에 둔다).
//
// 빌드: Windows 의 build-exe.bat (설치된 .NET Framework 4.x 의 csc.exe 사용, 별도 설치 없음). 서버에서는 빌드하지 않는다.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Windows.Forms;

static class PointManager
{
    const string Marker = "PMPAYLD1";
    const string DefaultBaseUrl = "https://concrab.com";

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768 | SecurityProtocolType.Tls; // TLS 1.2 이상
            string self = Process.GetCurrentProcess().MainModule.FileName;
            string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PointManager");
            string appDir = Path.Combine(installDir, "app");
            Directory.CreateDirectory(appDir);

            if (args.Length > 0 && args[0] == "--self-update") return SelfUpdate(self, installDir);

            string payload = ReadPayload(self);
            string baseUrl = DefaultBaseUrl;
            if (payload != null)
            {
                string b = JsonString(payload, "baseUrl");
                if (!string.IsNullOrEmpty(b)) baseUrl = b;
            }

            // 설치 위치에 자기 자신을 복사해 둔다(다운로드 폴더의 파일을 지워도 되도록). 이미 설치 위치에서 실행 중이면 건너뛴다.
            string installedExe = Path.Combine(installDir, "PointManager.exe");
            if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(installedExe), StringComparison.OrdinalIgnoreCase))
            {
                try { File.Copy(self, installedExe, true); } catch { /* 실행 중이면 기존 것을 그대로 쓴다 */ }
            }

            // 최신 프로그램 파일을 받는다(처음이거나 설치 정보가 새로 왔을 때). 이미 있고 설치 정보도 없으면 받지 않는다(업데이트는 트레이 메뉴).
            string agentPs1 = Path.Combine(appDir, "point-terminal-agent.ps1");
            if (!File.Exists(agentPs1) || payload != null)
            {
                string version = DownloadBundle(baseUrl, appDir);
                if (version != null) File.WriteAllText(Path.Combine(appDir, "bundle-version.txt"), version, Encoding.ASCII);
            }
            if (!File.Exists(agentPs1))
            {
                MessageBox.Show("프로그램 파일을 받지 못했습니다.\n인터넷 연결을 확인한 뒤 다시 실행해주세요.", "포인트 관리 프로그램", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }

            // 설치 정보 저장 — PowerShell 5.1 이 한글을 읽도록 UTF-8 BOM.
            if (payload != null)
                File.WriteAllText(Path.Combine(appDir, "provision.json"), payload, new UTF8Encoding(true));

            string psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + agentPs1 + "\" -Setup";
            var psi = new ProcessStartInfo("powershell.exe", psArgs) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = appDir };
            Process p = Process.Start(psi);
            p.WaitForExit();
            return p.ExitCode;
        }
        catch (Exception ex)
        {
            MessageBox.Show("실행 중 오류가 났습니다.\n" + ex.Message, "포인트 관리 프로그램", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }

    // exe 파일 끝: [json][json 길이 4바이트 LE]["PMPAYLD1"]
    static string ReadPayload(string path)
    {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            if (fs.Length < 12) return null;
            fs.Seek(-12, SeekOrigin.End);
            var tail = new byte[12];
            fs.Read(tail, 0, 12);
            if (Encoding.ASCII.GetString(tail, 4, 8) != Marker) return null;
            int len = BitConverter.ToInt32(tail, 0);
            if (len <= 0 || len > 65536 || len > fs.Length - 12) return null;
            fs.Seek(-12 - len, SeekOrigin.End);
            var buf = new byte[len];
            int read = 0;
            while (read < len) { int n = fs.Read(buf, read, len - read); if (n <= 0) break; read += n; }
            return Encoding.UTF8.GetString(buf, 0, read);
        }
    }

    // 아주 단순한 JSON 문자열 값 추출(설치 정보는 평평한 객체) — 외부 라이브러리 없이.
    static string JsonString(string json, string key)
    {
        string k = "\"" + key + "\"";
        int i = json.IndexOf(k, StringComparison.Ordinal);
        if (i < 0) return null;
        i = json.IndexOf(':', i + k.Length);
        if (i < 0) return null;
        i = json.IndexOf('"', i + 1);
        if (i < 0) return null;
        var sb = new StringBuilder();
        for (int j = i + 1; j < json.Length; j++)
        {
            char c = json[j];
            if (c == '\\' && j + 1 < json.Length) { sb.Append(json[++j]); continue; }
            if (c == '"') return sb.ToString();
            sb.Append(c);
        }
        return null;
    }

    static string DownloadBundle(string baseUrl, string appDir)
    {
        string tmpZip = Path.Combine(Path.GetTempPath(), "pm-bundle-" + Guid.NewGuid().ToString("N") + ".zip");
        try
        {
            using (var wc = new WebClient())
            {
                wc.DownloadFile(baseUrl.TrimEnd('/') + "/api/v1/pos-agent/bundle", tmpZip);
                string version = wc.ResponseHeaders["X-Agent-Version"];
                using (var zip = ZipFile.OpenRead(tmpZip))
                {
                    foreach (var e in zip.Entries)
                    {
                        if (string.IsNullOrEmpty(e.Name)) continue; // 폴더 항목
                        string dest = Path.Combine(appDir, Path.GetFileName(e.Name)); // 경로 이동 방지: 파일명만 사용
                        e.ExtractToFile(dest, true);
                    }
                }
                return version;
            }
        }
        catch { return null; }
        finally { try { File.Delete(tmpZip); } catch { } }
    }

    // exe 자체 교체 — 서버의 /api/v1/pos-agent/launcher 에서 새 exe 를 받아, 실행 중인 현재 exe 를 .old 로 이름만 바꾸고 그 자리에 둔다.
    static int SelfUpdate(string self, string installDir)
    {
        string installedExe = Path.Combine(installDir, "PointManager.exe");
        string tmp = installedExe + ".new";
        using (var wc = new WebClient()) wc.DownloadFile(DefaultBaseUrl + "/api/v1/pos-agent/launcher", tmp);
        string old = installedExe + ".old";
        if (File.Exists(old)) File.Delete(old);
        if (File.Exists(installedExe)) File.Move(installedExe, old);
        File.Move(tmp, installedExe);
        return 0;
    }
}
