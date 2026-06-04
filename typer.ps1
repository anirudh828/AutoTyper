# AutoTyper Core Engine (Windows Only)
# This script is launched by Electron to type text into the active target window.

param (
    [string]$Text,
    [int]$DelayMs = 50,
    [int]$JitterMs = 10,
    [string]$TypeMode = "character", # "character" or "line"
    [string]$StopFlagPath,
    [int]$ParentPid
)

# Win32 API declarations for active window tracking and low-level input injection
$Win32Source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern ushort MapVirtualKey(uint uCode, uint uMapType);

    // SendInput structure definitions
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public const int INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;

    // Sends a single unicode character directly into the OS hardware input stream
    public static void SendUnicodeChar(char ch) {
        INPUT[] inputDown = new INPUT[1];
        inputDown[0] = new INPUT();
        inputDown[0].type = INPUT_KEYBOARD;
        inputDown[0].U.ki.wVk = 0;
        inputDown[0].U.ki.wScan = (ushort)ch;
        inputDown[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
        inputDown[0].U.ki.time = 0;
        inputDown[0].U.ki.dwExtraInfo = IntPtr.Zero;
        
        uint sentDown = SendInput(1, inputDown, Marshal.SizeOf(typeof(INPUT)));
        if (sentDown == 0) {
            Console.WriteLine("DIAGNOSTIC_ERROR: SendUnicodeChar (Down) failed. Win32 Error: " + Marshal.GetLastWin32Error());
        }

        System.Threading.Thread.Sleep(1); // Micro-sleep for MS Word compatibility

        INPUT[] inputUp = new INPUT[1];
        inputUp[0] = new INPUT();
        inputUp[0].type = INPUT_KEYBOARD;
        inputUp[0].U.ki.wVk = 0;
        inputUp[0].U.ki.wScan = (ushort)ch;
        inputUp[0].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        inputUp[0].U.ki.time = 0;
        inputUp[0].U.ki.dwExtraInfo = IntPtr.Zero;

        uint sentUp = SendInput(1, inputUp, Marshal.SizeOf(typeof(INPUT)));
        if (sentUp == 0) {
            Console.WriteLine("DIAGNOSTIC_ERROR: SendUnicodeChar (Up) failed. Win32 Error: " + Marshal.GetLastWin32Error());
        }
    }

    // Sends a virtual key (e.g. Enter, Tab, Backspace)
    public static void SendVirtualKey(ushort vk) {
        ushort scanCode = MapVirtualKey(vk, 0);

        INPUT[] inputDown = new INPUT[1];
        inputDown[0] = new INPUT();
        inputDown[0].type = INPUT_KEYBOARD;
        inputDown[0].U.ki.wVk = vk;
        inputDown[0].U.ki.wScan = scanCode;
        inputDown[0].U.ki.dwFlags = 0;
        inputDown[0].U.ki.time = 0;
        inputDown[0].U.ki.dwExtraInfo = IntPtr.Zero;

        uint sentDown = SendInput(1, inputDown, Marshal.SizeOf(typeof(INPUT)));
        if (sentDown == 0) {
            Console.WriteLine("DIAGNOSTIC_ERROR: SendVirtualKey (Down) failed. Win32 Error: " + Marshal.GetLastWin32Error());
        }

        System.Threading.Thread.Sleep(1); // Micro-sleep for MS Word compatibility

        INPUT[] inputUp = new INPUT[1];
        inputUp[0] = new INPUT();
        inputUp[0].type = INPUT_KEYBOARD;
        inputUp[0].U.ki.wVk = vk;
        inputUp[0].U.ki.wScan = scanCode;
        inputUp[0].U.ki.dwFlags = KEYEVENTF_KEYUP;
        inputUp[0].U.ki.time = 0;
        inputUp[0].U.ki.dwExtraInfo = IntPtr.Zero;

        uint sentUp = SendInput(1, inputUp, Marshal.SizeOf(typeof(INPUT)));
        if (sentUp == 0) {
            Console.WriteLine("DIAGNOSTIC_ERROR: SendVirtualKey (Up) failed. Win32 Error: " + Marshal.GetLastWin32Error());
        }
    }
}
"@
Add-Type -TypeDefinition $Win32Source

# Helper to get the details of the current foreground window
function Get-ForegroundWindowDetails {
    $hwnd = [Win32]::GetForegroundWindow()
    $builder = New-Object System.Text.StringBuilder 512
    $null = [Win32]::GetWindowText($hwnd, $builder, 512)
    $wPid = 0
    $null = [Win32]::GetWindowThreadProcessId($hwnd, [ref]$wPid)
    return [PSCustomObject]@{
        Handle = $hwnd
        Title  = $builder.ToString()
        Pid    = $wPid
    }
}

# 1. INITIAL ARMING AND TARGET LOCKING
Start-Sleep -Milliseconds 100 # Brief settle time

$target = Get-ForegroundWindowDetails
$targetHandle = $target.Handle
$targetTitle = $target.Title
$targetPid = $target.Pid

# Safety Check: Cannot lock to empty window
if ($targetHandle -eq 0) {
    Write-Output "ERROR: No active window detected. Aborting."
    exit 1
}

# Safety Check: Cannot lock to the AutoTyper app itself
if ($targetPid -eq $ParentPid) {
    Write-Output "ERROR: Cannot type into the AutoTyper app itself. Focus the target application."
    exit 1
}

# Output the locked target details so the Electron UI can show them
Write-Output "TARGET_LOCKED: $targetTitle"
Start-Sleep -Milliseconds 200 # Visual transition delay

# Ensure target is still focused before we start
$current = Get-ForegroundWindowDetails
if ($current.Handle -ne $targetHandle) {
    Write-Output "ERROR: Lost target focus before typing could begin."
    exit 1
}

# Clean input newlines (normalize CRLF/CR to LF)
$normalizedText = $Text -replace "`r`n", "`n" -replace "`r", "`n"

# 2. TYPING LOOP
if ($TypeMode -eq "character") {
    # Character by character mode
    $chars = $normalizedText.ToCharArray()
    for ($i = 0; $i -lt $chars.Length; $i++) {
        # Check cancellation token
        if (Test-Path $StopFlagPath) {
            Write-Output "STATUS: Interrupted by user."
            exit 0
        }

        # Check foreground window lock
        $current = Get-ForegroundWindowDetails
        if ($current.Handle -ne $targetHandle) {
            Write-Output "STATUS: Interrupted. Focus shifted to '$($current.Title)'."
            exit 0
        }

        # Select and send character
        $c = $chars[$i]
        try {
            if ($c -eq "`n") {
                [Win32]::SendVirtualKey(0x0D) # VK_RETURN
            } elseif ($c -eq "`t") {
                [Win32]::SendVirtualKey(0x09) # VK_TAB
            } else {
                [Win32]::SendUnicodeChar($c)
            }
            Write-Output "CHAR_TYPED"
        } catch {
            Write-Output "ERROR: Keystroke emulation failed. $_"
            exit 1
        }

        # Sleep with optional jitter
        $sleepTime = $DelayMs
        if ($JitterMs -gt 0) {
            $jitter = Get-Random -Minimum (-$JitterMs) -Maximum ($JitterMs + 1)
            $sleepTime += $jitter
            if ($sleepTime -lt 10) { $sleepTime = 10 } # Hard floor for safety/system health
        }
        Start-Sleep -Milliseconds $sleepTime
    }
} else {
    # Line by line mode
    $lines = $normalizedText.Split("`n")
    for ($i = 0; $i -lt $lines.Length; $i++) {
        # Check cancellation token
        if (Test-Path $StopFlagPath) {
            Write-Output "STATUS: Interrupted by user."
            exit 0
        }

        # Check foreground window lock
        $current = Get-ForegroundWindowDetails
        if ($current.Handle -ne $targetHandle) {
            Write-Output "STATUS: Interrupted. Focus shifted to '$($current.Title)'."
            exit 0
        }

        # Process and send the entire line at once
        $line = $lines[$i]
        try {
            foreach ($c in $line.ToCharArray()) {
                if ($c -eq "`t") {
                    [Win32]::SendVirtualKey(0x09) # VK_TAB
                } else {
                    [Win32]::SendUnicodeChar($c)
                }
                Write-Output "CHAR_TYPED"
            }
            # Only type Enter if it's not the last line or if the original text had a trailing newline
            if ($i -lt ($lines.Length - 1)) {
                [Win32]::SendVirtualKey(0x0D) # VK_RETURN
                Write-Output "CHAR_TYPED"
            }
        } catch {
            Write-Output "ERROR: Keystroke emulation failed. $_"
            exit 1
        }

        # Sleep with optional jitter
        $sleepTime = $DelayMs
        if ($JitterMs -gt 0) {
            $jitter = Get-Random -Minimum (-$JitterMs) -Maximum ($JitterMs + 1)
            $sleepTime += $jitter
            if ($sleepTime -lt 10) { $sleepTime = 10 }
        }
        Start-Sleep -Milliseconds $sleepTime
    }
}

Write-Output "STATUS: Typing completed successfully."
exit 0
