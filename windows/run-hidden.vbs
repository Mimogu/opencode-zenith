' Start a program with no console window (used by the scheduled tasks).
' Usage: wscript.exe run-hidden.vbs <program> [args...]
Set shell = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
    arg = WScript.Arguments(i)
    If InStr(arg, " ") > 0 Then arg = Chr(34) & arg & Chr(34)
    cmd = cmd & arg & " "
Next
shell.Run Trim(cmd), 0, False
