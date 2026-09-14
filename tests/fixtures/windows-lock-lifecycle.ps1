$ErrorActionPreference = 'Stop'

# Synthetic controls only: no production paths, credentials, or ACLs are inspected.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LockLifecycle {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share,
    IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetFileInformationByHandle(IntPtr handle, int kind,
    ref uint flags, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@

$root = Join-Path (Get-Location) ('.artifacts/lock-diagnostic-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$env:OPENCOVEN_SYNTHETIC_LOCK = Join-Path $root 'slot.lock'

function Probe-Mkdir {
  $output = & node -e 'const fs=require("node:fs");try{fs.mkdirSync(process.env.OPENCOVEN_SYNTHETIC_LOCK);console.log("OK")}catch(e){console.log(e.code)}'
  if ($LASTEXITCODE -ne 0) { throw 'Node mkdir probe failed' }
  return "$output".Trim()
}

try {
  foreach ($control in @('legacy-disposition', 'posix-disposition')) {
    if ((Probe-Mkdir) -ne 'OK') { throw 'Initial synthetic mkdir failed' }
    $occupied = Probe-Mkdir
    # Match libuv's access/share/open flags; hold the deleting handle deliberately.
    $handle = [LockLifecycle]::CreateFileW($env:OPENCOVEN_SYNTHETIC_LOCK,
      0x10080, 7, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero)
    if ($handle -eq [IntPtr]::new(-1)) { throw 'Synthetic directory open failed' }
    try {
      [uint32]$flags = 1
      $kind = 4 # FileDispositionInfo
      if ($control -eq 'posix-disposition') {
        $flags = 0x13 # DELETE | POSIX_SEMANTICS | IGNORE_READONLY_ATTRIBUTE
        $kind = 21 # FileDispositionInfoEx
      }
      $marked = [LockLifecycle]::SetFileInformationByHandle($handle, $kind, [ref]$flags, 4)
      $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      $pending = Probe-Mkdir
    } finally {
      if (-not [LockLifecycle]::CloseHandle($handle)) { throw 'Synthetic close failed' }
    }
    $closed = Probe-Mkdir
    [ordered]@{
      control = $control; occupied = $occupied; dispositionAccepted = $marked
      dispositionError = $(if ($marked) { 0 } else { $nativeError })
      deletingHandleOpen = $pending; deletingHandleClosed = $closed
    } | ConvertTo-Json -Compress | Write-Output
    if (-not $marked -or $occupied -ne 'EEXIST' -or $closed -ne 'OK') {
      throw 'Synthetic deletion control did not complete'
    }
    Remove-Item -LiteralPath $env:OPENCOVEN_SYNTHETIC_LOCK
  }

  # An independent deny-create ACL produces the same public error without deletion.
  $acl = Get-Acl -LiteralPath $root
  $original = $acl.Sddl
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $deny = [Security.AccessControl.FileSystemAccessRule]::new(
    $sid, [Security.AccessControl.FileSystemRights]::CreateDirectories,
    [Security.AccessControl.AccessControlType]::Deny)
  try {
    $acl.AddAccessRule($deny)
    Set-Acl -LiteralPath $root -AclObject $acl
    $denied = Probe-Mkdir
  } finally {
    $acl.SetSecurityDescriptorSddlForm($original)
    Set-Acl -LiteralPath $root -AclObject $acl
  }
  $restored = Probe-Mkdir
  [ordered]@{ control = 'deny-create'; denied = $denied; restored = $restored } |
    ConvertTo-Json -Compress | Write-Output
  if ($denied -ne 'EPERM' -or $restored -ne 'OK') { throw 'Synthetic ACL control failed' }
} finally {
  Remove-Item Env:OPENCOVEN_SYNTHETIC_LOCK
  Remove-Item -LiteralPath $root -Recurse -Force
}
