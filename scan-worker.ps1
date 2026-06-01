# Persistent PowerShell scan worker.
#
# Reads commands (one per line) from stdin and replies on stdout:
#   "SCAN"  -> emits one compact JSON line, then a line "<<<SCAN_END>>>"
#   "QUIT"  -> exits
#
# Staying resident avoids paying PowerShell's ~700ms cold-start on every poll.

$ErrorActionPreference = 'Stop'
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
} catch {}

$SENTINEL = '<<<SCAN_END>>>'

# --- Current-directory resolution via the target process's PEB -------------
# Works for 64-bit, same-user, non-elevated processes (i.e. the dev servers
# we care about). Anything we can't read (elevated, 32-bit, protected) just
# yields $null and the Node side falls back to command-line path parsing.
$cwdReady = $false
try {
    Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace ScanWorker {
  public static class Peb {
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool IsWow64Process(IntPtr h, out bool wow64);
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr h, int cls, byte[] info, int len, out int ret);

    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_READ = 0x0010;

    public static string GetCwd(int pid) {
      IntPtr h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
      if (h == IntPtr.Zero) return null;
      try {
        bool wow;
        if (IsWow64Process(h, out wow) && wow) return null; // 32-bit target: different offsets
        byte[] pbi = new byte[48];
        int ret;
        if (NtQueryInformationProcess(h, 0, pbi, pbi.Length, out ret) != 0) return null;
        IntPtr peb = (IntPtr)BitConverter.ToInt64(pbi, 8);
        if (peb == IntPtr.Zero) return null;
        IntPtr procParams = ReadPtr(h, (IntPtr)((long)peb + 0x20));
        if (procParams == IntPtr.Zero) return null;
        byte[] us = ReadBytes(h, (IntPtr)((long)procParams + 0x38), 16);
        if (us == null) return null;
        ushort length = BitConverter.ToUInt16(us, 0);
        IntPtr buffer = (IntPtr)BitConverter.ToInt64(us, 8);
        if (length == 0 || buffer == IntPtr.Zero) return null;
        if (length > 0x7FFE) return null;        // sanity cap; reject absurd lengths
        if ((length & 1) != 0) length--;          // UTF-16 byte count must be even
        if (length == 0) return null;
        byte[] str = ReadBytes(h, buffer, length);
        if (str == null) return null;
        string s = Encoding.Unicode.GetString(str).TrimEnd('\0', '\\', '/');
        // Only accept a rooted path (drive-letter or UNC) so a value caught
        // mid-reallocation can't feed garbage into project resolution.
        if (s.Length >= 3 && char.IsLetter(s[0]) && s[1] == ':' && (s[2] == '\\' || s[2] == '/')) return s;
        if (s.Length >= 2 && s[0] == '\\' && s[1] == '\\') return s;
        return null;
      } catch { return null; }
      finally { CloseHandle(h); }
    }

    static IntPtr ReadPtr(IntPtr h, IntPtr addr) {
      byte[] b = ReadBytes(h, addr, 8);
      return b == null ? IntPtr.Zero : (IntPtr)BitConverter.ToInt64(b, 0);
    }
    static byte[] ReadBytes(IntPtr h, IntPtr addr, int size) {
      byte[] buf = new byte[size];
      IntPtr read;
      if (!ReadProcessMemory(h, addr, buf, size, out read) || (int)read != size) return null;
      return buf;
    }
  }
}
'@
    $cwdReady = $true
} catch {
    $cwdReady = $false
}

function Get-ProcCwd([int]$procId) {
    if (-not $cwdReady) { return $null }
    try {
        $cwd = [ScanWorker.Peb]::GetCwd($procId)
        if ([string]::IsNullOrWhiteSpace($cwd)) { return $null }
        return $cwd
    } catch { return $null }
}

function Get-ListeningPorts {
    # port -> owning PID, restricted to the user-server range [1024, 49152).
    $conns = Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -ge 1024 -and $_.LocalPort -lt 49152 }

    $byPid = @{}
    foreach ($c in $conns) {
        $procId = [int]$c.OwningProcess
        if ($procId -le 0) { continue }
        if (-not $byPid.ContainsKey($procId)) {
            $byPid[$procId] = New-Object System.Collections.Generic.HashSet[int]
        }
        [void]$byPid[$procId].Add([int]$c.LocalPort)
    }

    if ($byPid.Count -eq 0) { return @() }

    # Resolve name / path / command line / start time for just these PIDs.
    $ids = @($byPid.Keys)
    $filter = ($ids | ForEach-Object { "ProcessId=$_" }) -join ' OR '
    $procMap = @{}
    try {
        foreach ($proc in (Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop)) {
            $procMap[[int]$proc.ProcessId] = $proc
        }
    } catch {
        # CIM can fail (e.g. WMI hiccup); fall through with whatever we have.
    }

    $out = New-Object System.Collections.Generic.List[object]
    foreach ($procId in $ids) {
        $proc  = $procMap[$procId]
        $name  = if ($proc) { $proc.Name } else { $null }
        $path  = if ($proc) { $proc.ExecutablePath } else { $null }
        $cmd   = if ($proc) { $proc.CommandLine } else { $null }
        $start = $null
        if ($proc -and $proc.CreationDate) {
            try { $start = $proc.CreationDate.ToUniversalTime().ToString('o') } catch {}
        }
        $cwd = Get-ProcCwd $procId
        foreach ($port in $byPid[$procId]) {
            $out.Add([pscustomobject]@{
                port  = $port
                pid   = $procId
                name  = $name
                path  = $path
                cmd   = $cmd
                cwd   = $cwd
                start = $start
            })
        }
    }
    return $out
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }      # stdin closed -> exit
    $line = $line.Trim()
    if ($line -eq 'QUIT') { break }
    if ($line -ne 'SCAN') { continue }

    try {
        $ports = @(Get-ListeningPorts)
        $payload = [pscustomobject]@{ ok = $true; ports = $ports }
    } catch {
        $payload = [pscustomobject]@{ ok = $false; error = "$($_.Exception.Message)" }
    }

    $json = $payload | ConvertTo-Json -Compress -Depth 4
    [Console]::Out.WriteLine($json)
    [Console]::Out.WriteLine($SENTINEL)
    [Console]::Out.Flush()
}
